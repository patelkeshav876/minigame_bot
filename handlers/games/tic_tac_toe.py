"""Two-player Tic-Tac-Toe supporting bot chats and Inline Mode."""

from __future__ import annotations

from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from core.storage import GameStorage
from core.telegram_utils import player_display_name, safe_edit_message

WIN_LINES = [
    (0, 1, 2), (3, 4, 5), (6, 7, 8),
    (0, 3, 6), (1, 4, 7), (2, 5, 8),
    (0, 4, 8), (2, 4, 6),
]


def init_tictactoe_state(
    player1_id: int | str,
    player1_name: str,
    mode: str = "chat",
) -> dict[str, Any]:
    return {
        "board": [" "] * 9,
        "turn": "X",
        "players": {
            "X": {"id": str(player1_id), "name": player1_name},
            "O": None,
        },
        "game_over": False,
        "winner": None,  # "X", "O", or "Draw"
        "mode": mode,
    }


def check_winner(board: list[str]) -> str | None:
    for a, b, c in WIN_LINES:
        if board[a] == board[b] == board[c] != " ":
            return board[a]
    return None


def make_tictactoe_move(
    state: dict[str, Any],
    user_id: int | str,
    user_name: str,
    index: int,
) -> tuple[bool, str]:
    """Attempt a move at `index`. Returns (changed, feedback_message)."""
    if state["game_over"]:
        return False, "Game is already over."

    if not (0 <= index < 9) or state["board"][index] != " ":
        return False, "That cell is already taken!"

    uid = str(user_id)
    turn = state["turn"]
    players = state["players"]

    if players[turn] is None:
        if players["X"]["id"] == uid:
            return False, "Waiting for Player ⭕ to join!"
        players[turn] = {"id": uid, "name": user_name}
    elif players[turn]["id"] != uid:
        return False, "It's not your turn!"

    state["board"][index] = turn
    winner = check_winner(state["board"])
    if winner:
        state["game_over"] = True
        state["winner"] = winner
    elif " " not in state["board"]:
        state["game_over"] = True
        state["winner"] = "Draw"
    else:
        state["turn"] = "O" if turn == "X" else "X"

    return True, ""


def render_tictactoe(state: dict[str, Any], match_id: str) -> tuple[str, InlineKeyboardMarkup]:
    symbols = {"X": "❌", "O": "⭕", " ": "⬜"}
    board = state["board"]
    grid = "\n".join(
        "".join(symbols[board[r * 3 + c]] for c in range(3)) for r in range(3)
    )
    px = state["players"]["X"]["name"]
    po = state["players"]["O"]["name"] if state["players"]["O"] else "Waiting..."

    header = f"❌ *Tic-Tac-Toe* ⭕\n❌ {px} vs ⭕ {po}\n\n{grid}\n\n"
    if not state["game_over"]:
        turn_sym = symbols[state["turn"]]
        turn_player = state["players"][state["turn"]]
        if turn_player:
            status = f"👉 Turn: {turn_sym} *{turn_player['name']}*"
        else:
            status = f"👉 Tap any square to join as {turn_sym}!"
    elif state["winner"] == "Draw":
        status = "🤝 *It's a draw!*"
    else:
        win_name = state["players"][state["winner"]]["name"]
        status = f"🏆 *{win_name}* ({symbols[state['winner']]}) wins!"

    keyboard = []
    for r in range(3):
        row = []
        for c in range(3):
            idx = r * 3 + c
            cell = board[idx]
            label = symbols[cell]
            cb = f"ttt:{match_id}:{idx}" if cell == " " and not state["game_over"] else "noop"
            row.append(InlineKeyboardButton(label, callback_data=cb))
        keyboard.append(row)

    if state["game_over"]:
        keyboard.append([InlineKeyboardButton("🔄 Rematch", callback_data=f"ttt:{match_id}:rematch")])
    if state.get("mode") != "inline":
        keyboard.append([InlineKeyboardButton("🏠 Two-Player Menu", callback_data="menu:two")])

    return header + status, InlineKeyboardMarkup(keyboard)


async def handle_tictactoe_callback(
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
        await query.answer("Match not found or expired.", show_alert=True)
        return

    state = match["state"]

    if action == "rematch":
        # Swap starter for fairness
        old_x = state["players"]["X"]
        old_o = state["players"]["O"]
        new_starter = old_o if old_o else old_x
        new_second = old_x if old_o else None
        new_state = init_tictactoe_state(new_starter["id"], new_starter["name"], mode=state.get("mode", "chat"))
        new_state["players"]["O"] = new_second
        new_id = storage.create_match("tictactoe", new_state, mode=new_state["mode"])
        text, markup = render_tictactoe(new_state, new_id)
        await query.answer()
        await safe_edit_message(query, text, markup, parse_mode="Markdown")
        return

    changed, msg = make_tictactoe_move(state, user.id, uname, int(action))
    if not changed:
        await query.answer(msg, show_alert=False)
        return

    await query.answer()
    winner_id = None
    status = "active"
    if state["game_over"]:
        status = "finished"
        if state["winner"] in ("X", "O"):
            winner_id = state["players"][state["winner"]]["id"]
        if state["players"]["X"] and state["players"]["O"]:
            storage.record_two_player_result(
                match_id,
                state["players"]["X"]["id"],
                state["players"]["O"]["id"],
                winner_id,
            )

    storage.save_match(match_id, state, status=status, winner_id=winner_id)
    text, markup = render_tictactoe(state, match_id)
    await safe_edit_message(query, text, markup, parse_mode="Markdown")
