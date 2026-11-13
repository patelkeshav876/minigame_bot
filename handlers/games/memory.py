"""Single-player Memory card-matching game."""

from __future__ import annotations

import random
from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from core.telegram_utils import safe_edit_message


def init_memory_game() -> dict[str, Any]:
    cards = list("🍎🍌🍇🍓🍍🍒") * 2
    random.shuffle(cards)
    return {
        "cards": cards,
        "flipped": [],
        "matched": [],
        "turns": 0,
        "pending_clear": False,
        "game_over": False,
    }


def flip_card(state: dict[str, Any], index: int) -> dict[str, Any]:
    if state.get("game_over") or not (0 <= index < len(state["cards"])):
        return state

    if state.get("pending_clear"):
        was_shown = index in state["flipped"]
        state["flipped"] = []
        state["pending_clear"] = False
        if was_shown:
            return state

    if index in state["flipped"] or index in state["matched"]:
        return state

    state["flipped"].append(index)

    if len(state["flipped"]) == 2:
        a, b = state["flipped"]
        state["turns"] += 1
        if state["cards"][a] == state["cards"][b]:
            state["matched"].extend([a, b])
            state["flipped"] = []
        else:
            # Keep mismatched cards visible until the player's next tap
            state["pending_clear"] = True

    if len(state["matched"]) == len(state["cards"]):
        state["game_over"] = True

    return state


def render_memory_game(state: dict[str, Any]) -> str:
    rows = []
    for i in range(0, len(state["cards"]), 4):
        row = []
        for idx in range(i, i + 4):
            if idx in state["matched"] or idx in state["flipped"]:
                row.append(state["cards"][idx])
            else:
                row.append("❓")
        rows.append(" ".join(row))
    grid = "\n".join(rows)
    note = "\n\n❌ Not a match! Tap any next card to continue." if state.get("pending_clear") else ""
    return f"🧠 *Memory Game*\nTurns: `{state['turns']}`\n\n{grid}{note}"


def get_memory_controls(state: dict[str, Any]) -> InlineKeyboardMarkup:
    if state.get("game_over"):
        return InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("🔁 Play Again", callback_data="mem:start")],
                [InlineKeyboardButton("🏠 Single Player Menu", callback_data="menu:single")],
            ]
        )

    keyboard = []
    for i in range(0, len(state["cards"]), 4):
        row = []
        for j in range(i, i + 4):
            if j in state["matched"]:
                label = f"✅ {state['cards'][j]}"
            elif j in state["flipped"]:
                label = state["cards"][j]
            else:
                label = str(j + 1)
            row.append(InlineKeyboardButton(label, callback_data=f"mem:flip:{j}"))
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("🏠 Back", callback_data="menu:single")])
    return InlineKeyboardMarkup(keyboard)


async def handle_memory_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    parts = query.data.split(":")
    action = parts[1]

    if action == "start":
        state = init_memory_game()
        context.user_data["memory"] = state
        await safe_edit_message(
            query,
            render_memory_game(state),
            get_memory_controls(state),
            parse_mode="Markdown",
        )
        return

    state = context.user_data.get("memory")
    if not state:
        await safe_edit_message(
            query,
            "❌ Memory session expired. Start a new game!",
            InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("🔁 New Game", callback_data="mem:start")],
                    [InlineKeyboardButton("🏠 Single Player Menu", callback_data="menu:single")],
                ]
            ),
        )
        return

    if action == "flip" and len(parts) == 3:
        flip_card(state, int(parts[2]))
        context.user_data["memory"] = state

    if state["game_over"]:
        await safe_edit_message(
            query,
            f"🎉 *You matched all pairs!*\nTotal Turns: `{state['turns']}`",
            get_memory_controls(state),
            parse_mode="Markdown",
        )
        return

    await safe_edit_message(
        query,
        render_memory_game(state),
        get_memory_controls(state),
        parse_mode="Markdown",
    )
