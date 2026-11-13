"""Two-player Chess via 8x8 Inline Keyboard (powered by python-chess)."""

from __future__ import annotations

from typing import Any

import chess
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from config import BOT_USERNAME, WEBAPP_URL
from core.storage import GameStorage
from core.telegram_utils import player_display_name, safe_edit_message

PIECE_SYMBOLS = {
    "P": "♙", "N": "♘", "B": "♗", "R": "♖", "Q": "♕", "K": "♔",
    "p": "♟", "n": "♞", "b": "♝", "r": "♜", "q": "♛", "k": "♚",
}
START_COUNTS = {
    "P": 8, "N": 2, "B": 2, "R": 2, "Q": 1,
    "p": 8, "n": 2, "b": 2, "r": 2, "q": 1,
}


def _captured_summary(board: chess.Board) -> tuple[str, str]:
    on_board: dict[str, int] = {}
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece:
            sym = piece.symbol()
            on_board[sym] = on_board.get(sym, 0) + 1
    captured_by_white = "".join(
        PIECE_SYMBOLS[k] * max(0, START_COUNTS[k] - on_board.get(k, 0))
        for k in ("q", "r", "b", "n", "p")
    )
    captured_by_black = "".join(
        PIECE_SYMBOLS[k] * max(0, START_COUNTS[k] - on_board.get(k, 0))
        for k in ("Q", "R", "B", "N", "P")
    )
    return captured_by_white, captured_by_black


def init_chess_state(
    white_id: int | str,
    white_name: str,
    mode: str = "chat",
) -> dict[str, Any]:
    return {
        "fen": chess.STARTING_FEN,
        "selected": None,
        "players": {
            "w": {"id": str(white_id), "name": white_name},
            "b": None,
        },
        "last_move": None,
        "game_over": False,
        "winner": None,  # "w", "b", or "Draw"
        "reason": None,
        "mode": mode,
    }


def _legal_targets_for_square(board: chess.Board, square_name: str | None) -> set[int]:
    if not square_name:
        return set()
    try:
        from_sq = chess.parse_square(square_name)
    except ValueError:
        return set()
    return {m.to_square for m in board.legal_moves if m.from_square == from_sq}


def handle_chess_square_tap(
    state: dict[str, Any],
    user_id: int | str,
    user_name: str,
    square_name: str,
) -> tuple[bool, str]:
    """Process a square tap (select piece or execute move). Returns (changed, toast)."""
    if state["game_over"]:
        return False, "Match is finished."

    board = chess.Board(state["fen"])
    turn_key = "w" if board.turn == chess.WHITE else "b"
    uid = str(user_id)
    players = state["players"]

    if players[turn_key] is None:
        if players["w"]["id"] == uid:
            return False, "Waiting for a second player to join as Black!"
        players[turn_key] = {"id": uid, "name": user_name}
    elif players[turn_key]["id"] != uid:
        return False, "It's your opponent's turn!"

    try:
        tapped_sq = chess.parse_square(square_name)
    except ValueError:
        return False, "Invalid square."

    selected = state["selected"]

    # Clicking the already-selected square deselects it
    if selected == square_name:
        state["selected"] = None
        return True, ""

    # If a piece is selected, check if tapped square is a legal destination
    if selected is not None:
        from_sq = chess.parse_square(selected)
        candidate = chess.Move(from_sq, tapped_sq)
        # Auto-promote pawns to Queen for smooth chat UX
        piece = board.piece_at(from_sq)
        if (
            piece
            and piece.piece_type == chess.PAWN
            and chess.square_rank(tapped_sq) in (0, 7)
        ):
            candidate = chess.Move(from_sq, tapped_sq, promotion=chess.QUEEN)

        if candidate in board.legal_moves:
            san = board.san(candidate)
            board.push(candidate)
            state["fen"] = board.fen()
            state["selected"] = None
            state["last_move"] = san

            if board.is_checkmate():
                state["game_over"] = True
                state["winner"] = turn_key
                state["reason"] = "Checkmate"
            elif board.is_stalemate():
                state["game_over"] = True
                state["winner"] = "Draw"
                state["reason"] = "Stalemate"
            elif board.is_insufficient_material():
                state["game_over"] = True
                state["winner"] = "Draw"
                state["reason"] = "Insufficient material"
            elif board.can_claim_threefold_repetition() or board.is_fifty_moves():
                state["game_over"] = True
                state["winner"] = "Draw"
                state["reason"] = "Draw by repetition / 50-move rule"

            return True, f"Played {san}"

    # Otherwise select own piece on tapped square if it has at least one legal move
    piece = board.piece_at(tapped_sq)
    if piece and piece.color == board.turn:
        targets = _legal_targets_for_square(board, square_name)
        if not targets:
            return False, "That piece has no legal moves."
        state["selected"] = square_name
        return True, f"Selected {square_name}"

    return False, "Select one of your pieces first."


def resign_chess(state: dict[str, Any], user_id: int | str) -> tuple[bool, str]:
    if state["game_over"]:
        return False, "Match is already finished."
    uid = str(user_id)
    pw = state["players"]["w"]
    pb = state["players"]["b"]
    if uid == pw["id"]:
        if pb is None:
            state["game_over"] = True
            state["winner"] = "Draw"
            state["reason"] = "Cancelled before opponent joined"
            return True, "Match cancelled."
        state["game_over"] = True
        state["winner"] = "b"
        state["reason"] = f"{pw['name']} resigned"
        return True, "You resigned."
    if pb and uid == pb["id"]:
        state["game_over"] = True
        state["winner"] = "w"
        state["reason"] = f"{pb['name']} resigned"
        return True, "You resigned."
    return False, "You are not a player in this match."


def render_chess(state: dict[str, Any], match_id: str) -> tuple[str, InlineKeyboardMarkup]:
    board = chess.Board(state["fen"])
    selected = state["selected"]
    targets = _legal_targets_for_square(board, selected)

    pw = state["players"]["w"]["name"]
    pb = state["players"]["b"]["name"] if state["players"]["b"] else "Waiting..."
    turn_label = "White ♔" if board.turn == chess.WHITE else "Black ♚"
    turn_key = "w" if board.turn == chess.WHITE else "b"
    active_player = state["players"][turn_key]

    cap_w, cap_b = _captured_summary(board)
    lines = [
        "♟️ *Telegram Chess*",
        f"⬜ White: *{pw}*" + (f" ({cap_w})" if cap_w else ""),
        f"⬛ Black: *{pb}*" + (f" ({cap_b})" if cap_b else ""),
    ]
    if state.get("last_move"):
        lines.append(f"📝 Move #{board.fullmove_number}: `{state['last_move']}`")

    if state["game_over"]:
        if state["winner"] == "Draw":
            lines.append(f"\n🤝 *Draw!* ({state.get('reason', 'Draw')})")
        else:
            win_name = state["players"][state["winner"]]["name"]
            lines.append(f"\n🏆 *{win_name}* wins! ({state.get('reason', 'Game over')})")
    else:
        check_note = " — ⚠️ *CHECK!*" if board.is_check() else ""
        if selected:
            sel_sq = chess.parse_square(selected)
            sel_p = board.piece_at(sel_sq)
            sel_sym = PIECE_SYMBOLS.get(sel_p.symbol(), "") if sel_p else ""
            lines.append(f"\n✨ Selected: *{selected.upper()}* {sel_sym} — tap 🟢/💥 to move")
        elif active_player:
            lines.append(f"\n👉 Turn: *{active_player['name']}* ({turn_label}){check_note}")
        else:
            lines.append(f"\n👉 Tap any Black piece to join as *{turn_label}*!")

    keyboard: list[list[InlineKeyboardButton]] = []
    for rank in range(7, -1, -1):
        row_btns = []
        for file_idx in range(8):
            sq = chess.square(file_idx, rank)
            sq_name = chess.square_name(sq)
            piece = board.piece_at(sq)
            is_dark = (rank + file_idx) % 2 == 0

            if sq_name == selected and piece:
                # Keep 1-char width so the column never widens or deforms
                label = f"✨"
            elif sq in targets:
                # Keep strictly 1-char width for all target squares
                label = "💥" if piece else "🟢"
            elif piece:
                label = PIECE_SYMBOLS[piece.symbol()]
            else:
                # Uniform single-character markers for empty squares
                label = "·" if is_dark else "·"

            cb = f"ch:{match_id}:{sq_name}" if not state["game_over"] else "noop"
            row_btns.append(InlineKeyboardButton(label, callback_data=cb))
        keyboard.append(row_btns)

    if not state["game_over"]:
        footer = [InlineKeyboardButton("🏳️ Resign", callback_data=f"ch:{match_id}:resign")]
    else:
        footer = [InlineKeyboardButton("🔄 Rematch", callback_data=f"ch:{match_id}:rematch")]

    if state.get("mode") != "inline":
        footer.append(InlineKeyboardButton("🏠 Menu", callback_data="menu:two"))
    if WEBAPP_URL and BOT_USERNAME:
        footer.append(
            InlineKeyboardButton("⚔️ Full Board", url=f"https://t.me/{BOT_USERNAME}?startapp=lobby")
        )
    keyboard.append(footer)

    return "\n".join(lines), InlineKeyboardMarkup(keyboard)


async def handle_chess_callback(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    storage: GameStorage,
) -> None:
    query = update.callback_query
    _, match_id, action = query.data.split(":", 2)
    user = query.from_user
    uname = player_display_name(user)
    storage.upsert_player(user.id, uname, user.username or "")

    match = storage.get_match(match_id)
    if not match:
        await query.answer("Chess match not found or expired.", show_alert=True)
        return

    state = match["state"]

    if action == "rematch":
        old_w = state["players"]["w"]
        old_b = state["players"]["b"]
        new_white = old_b if old_b else old_w
        new_black = old_w if old_b else None
        new_state = init_chess_state(new_white["id"], new_white["name"], mode=state.get("mode", "chat"))
        new_state["players"]["b"] = new_black
        new_id = storage.create_match("chess", new_state, mode=new_state["mode"])
        text, markup = render_chess(new_state, new_id)
        await query.answer()
        await safe_edit_message(query, text, markup, parse_mode="Markdown")
        return

    if action == "resign":
        changed, msg = resign_chess(state, user.id)
    else:
        changed, msg = handle_chess_square_tap(state, user.id, uname, action)

    await query.answer(msg, show_alert=False)
    if not changed:
        return

    winner_id = None
    status = "active"
    if state["game_over"]:
        status = "finished"
        if state["winner"] in ("w", "b"):
            winner_id = state["players"][state["winner"]]["id"]
        if state["players"]["w"] and state["players"]["b"]:
            storage.record_two_player_result(
                match_id,
                state["players"]["w"]["id"],
                state["players"]["b"]["id"],
                winner_id,
            )

    storage.save_match(match_id, state, status=status, winner_id=winner_id)
    text, markup = render_chess(state, match_id)
    await safe_edit_message(query, text, markup, parse_mode="Markdown")
