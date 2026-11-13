"""Two-player Connect 4 supporting bot chats and Inline Mode."""

from __future__ import annotations

from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from core.storage import GameStorage
from core.telegram_utils import player_display_name, safe_edit_message

ROWS = 6
COLS = 7
COL_LABELS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣"]


def init_connect4_state(
    player1_id: int | str,
    player1_name: str,
    mode: str = "chat",
) -> dict[str, Any]:
    return {
        "board": [["" for _ in range(COLS)] for _ in range(ROWS)],
        "turn": "R",  # "R" (🔴) or "Y" (🟡)
        "players": {
            "R": {"id": str(player1_id), "name": player1_name},
            "Y": None,
        },
        "game_over": False,
        "winner": None,  # "R", "Y", or "Draw"
        "mode": mode,
    }


def _check_connect4_win(board: list[list[str]], token: str) -> bool:
    for r in range(ROWS):
        for c in range(COLS):
            if board[r][c] != token:
                continue
            for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
                if all(
                    0 <= r + i * dr < ROWS
                    and 0 <= c + i * dc < COLS
                    and board[r + i * dr][c + i * dc] == token
                    for i in range(4)
                ):
                    return True
    return False


def drop_connect4_disc(
    state: dict[str, Any],
    user_id: int | str,
    user_name: str,
    col: int,
) -> tuple[bool, str]:
    if state["game_over"]:
        return False, "Game is already over."
    if not (0 <= col < COLS):
        return False, "Invalid column."

    uid = str(user_id)
    turn = state["turn"]
    players = state["players"]

    if players[turn] is None:
        if players["R"]["id"] == uid:
            return False, "Waiting for Player 🟡 to join!"
        players[turn] = {"id": uid, "name": user_name}
    elif players[turn]["id"] != uid:
        return False, "It's not your turn!"

    board = state["board"]
    target_row = None
    for r in range(ROWS - 1, -1, -1):
        if board[r][col] == "":
            target_row = r
            break

    if target_row is None:
        return False, "That column is full!"

    board[target_row][col] = turn
    if _check_connect4_win(board, turn):
        state["game_over"] = True
        state["winner"] = turn
    elif all(board[0][c] != "" for c in range(COLS)):
        state["game_over"] = True
        state["winner"] = "Draw"
    else:
        state["turn"] = "Y" if turn == "R" else "R"

    return True, ""


def render_connect4(state: dict[str, Any], match_id: str) -> tuple[str, InlineKeyboardMarkup]:
    sym = {"R": "🔴", "Y": "🟡", "": "⚫"}
    grid = "\n".join("".join(sym[cell] for cell in row) for row in state["board"])
    grid += "\n" + "".join(COL_LABELS)

    pr = state["players"]["R"]["name"]
    py = state["players"]["Y"]["name"] if state["players"]["Y"] else "Waiting..."
    header = f"🔴 *Connect 4* 🟡\n🔴 {pr} vs 🟡 {py}\n\n{grid}\n\n"

    if not state["game_over"]:
        t = state["turn"]
        tp = state["players"][t]
        status = f"👉 Turn: {sym[t]} *{tp['name']}*" if tp else f"👉 Tap a column to join as {sym[t]}!"
    elif state["winner"] == "Draw":
        status = "🤝 *It's a draw!*"
    else:
        win_name = state["players"][state["winner"]]["name"]
        status = f"🏆 *{win_name}* ({sym[state['winner']]}) wins!"

    keyboard = []
    if not state["game_over"]:
        keyboard.append(
            [
                InlineKeyboardButton(COL_LABELS[c], callback_data=f"c4:{match_id}:{c}")
                for c in range(COLS)
            ]
        )
    else:
        keyboard.append([InlineKeyboardButton("🔄 Rematch", callback_data=f"c4:{match_id}:rematch")])

    if state.get("mode") != "inline":
        keyboard.append([InlineKeyboardButton("🏠 Two-Player Menu", callback_data="menu:two")])

    return header + status, InlineKeyboardMarkup(keyboard)


async def handle_connect4_callback(
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
        old_r = state["players"]["R"]
        old_y = state["players"]["Y"]
        starter = old_y if old_y else old_r
        second = old_r if old_y else None
        new_state = init_connect4_state(starter["id"], starter["name"], mode=state.get("mode", "chat"))
        new_state["players"]["Y"] = second
        new_id = storage.create_match("connect4", new_state, mode=new_state["mode"])
        text, markup = render_connect4(new_state, new_id)
        await query.answer()
        await safe_edit_message(query, text, markup, parse_mode="Markdown")
        return

    changed, msg = drop_connect4_disc(state, user.id, uname, int(action))
    if not changed:
        await query.answer(msg, show_alert=False)
        return

    await query.answer()
    winner_id = None
    status = "active"
    if state["game_over"]:
        status = "finished"
        if state["winner"] in ("R", "Y"):
            winner_id = state["players"][state["winner"]]["id"]
        if state["players"]["R"] and state["players"]["Y"]:
            storage.record_two_player_result(
                match_id,
                state["players"]["R"]["id"],
                state["players"]["Y"]["id"],
                winner_id,
            )

    storage.save_match(match_id, state, status=status, winner_id=winner_id)
    text, markup = render_connect4(state, match_id)
    await safe_edit_message(query, text, markup, parse_mode="Markdown")
