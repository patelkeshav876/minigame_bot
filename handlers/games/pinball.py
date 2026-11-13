"""Single-player Pinball mini-game."""

from __future__ import annotations

import random
from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from core.telegram_utils import safe_edit_message


def init_pinball_game() -> dict[str, Any]:
    return {
        "ball_position": 3,
        "score": 0,
        "game_over": False,
    }


def launch_ball(state: dict[str, Any]) -> dict[str, Any]:
    if state.get("game_over"):
        return state

    state["ball_position"] += random.choice([-1, 0, 1])
    state["score"] += 1

    if state["ball_position"] < 0 or state["ball_position"] > 6:
        state["game_over"] = True

    return state


def render_pinball(state: dict[str, Any]) -> str:
    ball_row = ["⬛"] * 7
    if 0 <= state["ball_position"] < len(ball_row):
        ball_row[state["ball_position"]] = "⚪"

    display = f"🧲 *Pinball*\nScore: `{state['score']}`\n\n{''.join(ball_row)}"
    if state["game_over"]:
        display += "\n\n💥 *Ball drained — Game Over!*"
    return display


def get_pinball_controls(game_over: bool = False) -> InlineKeyboardMarkup:
    if game_over:
        return InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("🔄 Restart", callback_data="pin:start")],
                [InlineKeyboardButton("🏠 Single Player Menu", callback_data="menu:single")],
            ]
        )
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("🎯 Launch / Bounce", callback_data="pin:launch")],
            [InlineKeyboardButton("🏠 Back", callback_data="menu:single")],
        ]
    )


async def handle_pinball_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    action = query.data.split(":", 1)[1]

    if action == "start":
        state = init_pinball_game()
        context.user_data["pinball"] = state
        await safe_edit_message(
            query,
            render_pinball(state),
            get_pinball_controls(),
            parse_mode="Markdown",
        )
        return

    state = context.user_data.get("pinball")
    if not state:
        await safe_edit_message(
            query,
            "❌ Pinball session expired. Start a new game!",
            get_pinball_controls(game_over=True),
        )
        return

    launch_ball(state)
    context.user_data["pinball"] = state
    await safe_edit_message(
        query,
        render_pinball(state),
        get_pinball_controls(game_over=state["game_over"]),
        parse_mode="Markdown",
    )
