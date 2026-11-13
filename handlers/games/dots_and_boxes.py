"""Two-player Dots and Boxes (3x3 boxes) for bot chats and Inline Mode."""

from __future__ import annotations

from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from core.storage import GameStorage
from core.telegram_utils import player_display_name, safe_edit_message

BOX_SIZE = 3  # 3x3 boxes => 4x4 dots


def init_dots_state(
    player1_id: int | str,
    player1_name: str,
    mode: str = "chat",
) -> dict[str, Any]:
    return {
        "h_edges": [[False] * BOX_SIZE for _ in range(BOX_SIZE + 1)],  # 4x3
        "v_edges": [[False] * (BOX_SIZE + 1) for _ in range(BOX_SIZE)],  # 3x4
        "boxes": [[""] * BOX_SIZE for _ in range(BOX_SIZE)],  # "", "1", "2"
        "scores": {"1": 0, "2": 0},
        "turn": "1",
        "players": {
            "1": {"id": str(player1_id), "name": player1_name},
            "2": None,
        },
        "game_over": False,
        "winner": None,  # "1", "2", or "Draw"
        "mode": mode,
    }


def make_dots_move(
    state: dict[str, Any],
    user_id: int | str,
    user_name: str,
    edge_kind: str,
    r: int,
    c: int,
) -> tuple[bool, str]:
    if state["game_over"]:
        return False, "Match is already finished."

    uid = str(user_id)
    turn = state["turn"]
    players = state["players"]

    if players[turn] is None:
        if players["1"]["id"] == uid:
            return False, "Waiting for Player 2 to join!"
        players[turn] = {"id": uid, "name": user_name}
    elif players[turn]["id"] != uid:
        return False, "It's not your turn!"

    if edge_kind == "h":
        if not (0 <= r <= BOX_SIZE and 0 <= c < BOX_SIZE) or state["h_edges"][r][c]:
            return False, "Line already drawn!"
        state["h_edges"][r][c] = True
    elif edge_kind == "v":
        if not (0 <= r < BOX_SIZE and 0 <= c <= BOX_SIZE) or state["v_edges"][r][c]:
            return False, "Line already drawn!"
        state["v_edges"][r][c] = True
    else:
        return False, "Invalid edge."

    # Check if any 1x1 box just became enclosed
    claimed = 0
    for br in range(BOX_SIZE):
        for bc in range(BOX_SIZE):
            if state["boxes"][br][bc] == "":
                if (
                    state["h_edges"][br][bc]
                    and state["h_edges"][br + 1][bc]
                    and state["v_edges"][br][bc]
                    and state["v_edges"][br][bc + 1]
                ):
                    state["boxes"][br][bc] = turn
                    state["scores"][turn] += 1
                    claimed += 1

    total_claimed = state["scores"]["1"] + state["scores"]["2"]
    if total_claimed == BOX_SIZE * BOX_SIZE:
        state["game_over"] = True
        if state["scores"]["1"] > state["scores"]["2"]:
            state["winner"] = "1"
        elif state["scores"]["2"] > state["scores"]["1"]:
            state["winner"] = "2"
        else:
            state["winner"] = "Draw"
        return True, f"Box claimed! Game over!"

    if claimed > 0:
        return True, f"Claimed {claimed} box(es)! Go again!"

    state["turn"] = "2" if turn == "1" else "1"
    return True, ""


def render_dots(state: dict[str, Any], match_id: str) -> tuple[str, InlineKeyboardMarkup]:
    p1 = state["players"]["1"]["name"]
    p2 = state["players"]["2"]["name"] if state["players"]["2"] else "Waiting..."
    s1, s2 = state["scores"]["1"], state["scores"]["2"]

    lines = [
        "🟦 *Dots and Boxes* 🟥",
        f"🟥 *{p1}*: `{s1}`  |  🟦 *{p2}*: `{s2}`",
    ]
    if state["game_over"]:
        if state["winner"] == "Draw":
            lines.append("\n🤝 *It's a draw!*")
        else:
            wname = state["players"][state["winner"]]["name"]
            wicon = "🟥" if state["winner"] == "1" else "🟦"
            lines.append(f"\n🏆 {wicon} *{wname}* wins!")
    else:
        t = state["turn"]
        ticon = "🟥" if t == "1" else "🟦"
        tp = state["players"][t]
        if tp:
            lines.append(f"\n👉 Turn: {ticon} *{tp['name']}* (tap a dashed edge)")
        else:
            lines.append(f"\n👉 Tap any dashed edge to join as {ticon}!")

    keyboard: list[list[InlineKeyboardButton]] = []
    for grid_r in range(BOX_SIZE * 2 + 1):
        row_btns: list[InlineKeyboardButton] = []
        if grid_r % 2 == 0:
            hr = grid_r // 2
            for grid_c in range(BOX_SIZE * 2 + 1):
                if grid_c % 2 == 0:
                    row_btns.append(InlineKeyboardButton("•", callback_data="noop"))
                else:
                    hc = grid_c // 2
                    drawn = state["h_edges"][hr][hc]
                    label = "━━" if drawn else "┄┄"
                    cb = (
                        f"dab:{match_id}:h_{hr}_{hc}"
                        if not drawn and not state["game_over"]
                        else "noop"
                    )
                    row_btns.append(InlineKeyboardButton(label, callback_data=cb))
        else:
            vr = grid_r // 2
            for grid_c in range(BOX_SIZE * 2 + 1):
                if grid_c % 2 == 0:
                    vc = grid_c // 2
                    drawn = state["v_edges"][vr][vc]
                    label = "┃" if drawn else "┆"
                    cb = (
                        f"dab:{match_id}:v_{vr}_{vc}"
                        if not drawn and not state["game_over"]
                        else "noop"
                    )
                    row_btns.append(InlineKeyboardButton(label, callback_data=cb))
                else:
                    bc = grid_c // 2
                    owner = state["boxes"][vr][bc]
                    box_lbl = "🟥" if owner == "1" else "🟦" if owner == "2" else "⬜"
                    row_btns.append(InlineKeyboardButton(box_lbl, callback_data="noop"))
        keyboard.append(row_btns)

    footer = []
    if state["game_over"]:
        footer.append(InlineKeyboardButton("🔄 Rematch", callback_data=f"dab:{match_id}:rematch"))
    if state.get("mode") != "inline":
        footer.append(InlineKeyboardButton("🏠 Menu", callback_data="menu:two"))
    if footer:
        keyboard.append(footer)

    return "\n".join(lines), InlineKeyboardMarkup(keyboard)


async def handle_dots_callback(
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
        old_1 = state["players"]["1"]
        old_2 = state["players"]["2"]
        starter = old_2 if old_2 else old_1
        second = old_1 if old_2 else None
        new_state = init_dots_state(starter["id"], starter["name"], mode=state.get("mode", "chat"))
        new_state["players"]["2"] = second
        new_id = storage.create_match("dots_and_boxes", new_state, mode=new_state["mode"])
        text, markup = render_dots(new_state, new_id)
        await query.answer()
        await safe_edit_message(query, text, markup, parse_mode="Markdown")
        return

    kind, r_str, c_str = action.split("_")
    changed, msg = make_dots_move(state, user.id, uname, kind, int(r_str), int(c_str))
    await query.answer(msg, show_alert=False)
    if not changed:
        return

    winner_id = None
    status = "active"
    if state["game_over"]:
        status = "finished"
        if state["winner"] in ("1", "2"):
            winner_id = state["players"][state["winner"]]["id"]
        if state["players"]["1"] and state["players"]["2"]:
            storage.record_two_player_result(
                match_id,
                state["players"]["1"]["id"],
                state["players"]["2"]["id"],
                winner_id,
                game_type="dots_and_boxes",
            )

    storage.save_match(match_id, state, status=status, winner_id=winner_id)
    text, markup = render_dots(state, match_id)
    await safe_edit_message(query, text, markup, parse_mode="Markdown")
