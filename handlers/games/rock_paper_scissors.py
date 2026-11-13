"""Two-player Rock Paper Scissors supporting bot chats and Inline Mode."""

from __future__ import annotations

from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from core.storage import GameStorage
from core.telegram_utils import player_display_name, safe_edit_message

CHOICE_LABELS = {"R": "✊ Rock", "P": "✋ Paper", "S": "✌️ Scissors"}


def init_rps_state(
    player1_id: int | str,
    player1_name: str,
    mode: str = "chat",
) -> dict[str, Any]:
    return {
        "players": {
            "p1": {"id": str(player1_id), "name": player1_name},
            "p2": None,
        },
        "choices": {"p1": None, "p2": None},
        "winner": None,  # "p1", "p2", or "Draw"
        "game_over": False,
        "mode": mode,
    }


def determine_rps_winner(c1: str, c2: str) -> str:
    if c1 == c2:
        return "Draw"
    if (c1 == "R" and c2 == "S") or (c1 == "S" and c2 == "P") or (c1 == "P" and c2 == "R"):
        return "p1"
    return "p2"


def make_rps_choice(
    state: dict[str, Any],
    user_id: int | str,
    user_name: str,
    choice: str,
) -> tuple[bool, str]:
    if state["game_over"]:
        return False, "Round is already over!"
    if choice not in CHOICE_LABELS:
        return False, "Invalid choice."

    uid = str(user_id)
    p1 = state["players"]["p1"]
    p2 = state["players"]["p2"]

    if uid == p1["id"]:
        if state["choices"]["p1"] is not None:
            return False, "You already locked in your move!"
        state["choices"]["p1"] = choice
    elif p2 is None:
        state["players"]["p2"] = {"id": uid, "name": user_name}
        state["choices"]["p2"] = choice
    elif uid == p2["id"]:
        if state["choices"]["p2"] is not None:
            return False, "You already locked in your move!"
        state["choices"]["p2"] = choice
    else:
        return False, "Two players are already in this match!"

    if state["choices"]["p1"] and state["choices"]["p2"]:
        state["winner"] = determine_rps_winner(state["choices"]["p1"], state["choices"]["p2"])
        state["game_over"] = True

    return True, f"Locked in {CHOICE_LABELS[choice]}!"


def render_rps(state: dict[str, Any], match_id: str) -> tuple[str, InlineKeyboardMarkup]:
    p1_name = state["players"]["p1"]["name"]
    p2_name = state["players"]["p2"]["name"] if state["players"]["p2"] else "Waiting for opponent..."

    if state["game_over"]:
        c1 = CHOICE_LABELS[state["choices"]["p1"]]
        c2 = CHOICE_LABELS[state["choices"]["p2"]]
        text = (
            f"✂️ *Rock Paper Scissors — Result*\n\n"
            f"🧑 *{p1_name}*: {c1}\n"
            f"👤 *{p2_name}*: {c2}\n\n"
        )
        if state["winner"] == "Draw":
            text += "🤝 *It's a draw!*"
        else:
            win_name = state["players"][state["winner"]]["name"]
            text += f"🏆 *{win_name}* wins!"

        keyboard = [[InlineKeyboardButton("🔄 Play Again", callback_data=f"rps:{match_id}:rematch")]]
        if state.get("mode") != "inline":
            keyboard.append([InlineKeyboardButton("🏠 Two-Player Menu", callback_data="menu:two")])
        return text, InlineKeyboardMarkup(keyboard)

    s1 = "✅ Ready" if state["choices"]["p1"] else "⏳ Choosing..."
    s2 = "✅ Ready" if state["choices"]["p2"] else "⏳ Waiting..."
    text = (
        f"✂️ *Rock Paper Scissors*\n\n"
        f"🧑 *{p1_name}*: {s1}\n"
        f"👤 *{p2_name}*: {s2}\n\n"
        f"Pick your move below (kept secret until both lock in!):"
    )
    keyboard = [
        [
            InlineKeyboardButton("✊ Rock", callback_data=f"rps:{match_id}:R"),
            InlineKeyboardButton("✋ Paper", callback_data=f"rps:{match_id}:P"),
            InlineKeyboardButton("✌️ Scissors", callback_data=f"rps:{match_id}:S"),
        ]
    ]
    if state.get("mode") != "inline":
        keyboard.append([InlineKeyboardButton("🏠 Two-Player Menu", callback_data="menu:two")])
    return text, InlineKeyboardMarkup(keyboard)


async def handle_rps_callback(
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
        new_state = init_rps_state(user.id, uname, mode=state.get("mode", "chat"))
        new_id = storage.create_match("rps", new_state, mode=new_state["mode"])
        text, markup = render_rps(new_state, new_id)
        await query.answer()
        await safe_edit_message(query, text, markup, parse_mode="Markdown")
        return

    changed, msg = make_rps_choice(state, user.id, uname, action)
    await query.answer(msg, show_alert=False)
    if not changed:
        return

    winner_id = None
    status = "active"
    if state["game_over"]:
        status = "finished"
        if state["winner"] in ("p1", "p2"):
            winner_id = state["players"][state["winner"]]["id"]
        storage.record_two_player_result(
            match_id,
            state["players"]["p1"]["id"],
            state["players"]["p2"]["id"],
            winner_id,
        )

    storage.save_match(match_id, state, status=status, winner_id=winner_id)
    text, markup = render_rps(state, match_id)
    await safe_edit_message(query, text, markup, parse_mode="Markdown")
