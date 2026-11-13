"""Single-player Snake mini-game for Telegram inline keyboards."""

from __future__ import annotations

import random
from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from core.telegram_utils import safe_edit_message

GRID_SIZE = 5
OPPOSITE_DIR = {"UP": "DOWN", "DOWN": "UP", "LEFT": "RIGHT", "RIGHT": "LEFT"}


def spawn_apple(snake: list[tuple[int, int]]) -> tuple[int, int] | None:
    """Return a free cell for the next apple, or None if the board is full."""
    occupied = set(map(tuple, snake))
    free = [
        (r, c)
        for r in range(GRID_SIZE)
        for c in range(GRID_SIZE)
        if (r, c) not in occupied
    ]
    return random.choice(free) if free else None


def init_snake_game() -> dict[str, Any]:
    start = [(2, 2)]
    return {
        "snake": start,
        "direction": "RIGHT",
        "apple": spawn_apple(start),
        "score": 0,
        "game_over": False,
        "won": False,
    }


def move_snake(state: dict[str, Any], direction: str | None = None) -> dict[str, Any]:
    """Advance the snake by one step and return updated state."""
    if state.get("game_over"):
        return state

    if direction in OPPOSITE_DIR:
        # Prevent instant 180-degree reversal when snake length > 1
        if len(state["snake"]) == 1 or OPPOSITE_DIR[state["direction"]] != direction:
            state["direction"] = direction

    head_x, head_y = state["snake"][0]
    dx, dy = {
        "UP": (-1, 0),
        "DOWN": (1, 0),
        "LEFT": (0, -1),
        "RIGHT": (0, 1),
    }[state["direction"]]

    new_head = (head_x + dx, head_y + dy)
    will_eat = state["apple"] is not None and new_head == tuple(state["apple"])

    body_to_check = state["snake"] if will_eat else state["snake"][:-1]
    if not (0 <= new_head[0] < GRID_SIZE and 0 <= new_head[1] < GRID_SIZE) or new_head in [
        tuple(p) for p in body_to_check
    ]:
        state["game_over"] = True
        return state

    state["snake"].insert(0, new_head)
    if will_eat:
        state["score"] += 1
        next_apple = spawn_apple(state["snake"])
        state["apple"] = next_apple
        if next_apple is None:
            state["game_over"] = True
            state["won"] = True
    else:
        state["snake"].pop()

    return state


def render_snake(state: dict[str, Any]) -> str:
    board = [["⬛" for _ in range(GRID_SIZE)] for _ in range(GRID_SIZE)]
    for idx, (x, y) in enumerate(state["snake"]):
        board[x][y] = "🐲" if idx == 0 else "🟩"
    if state["apple"] is not None:
        ax, ay = state["apple"]
        board[ax][ay] = "🍎"
    grid_str = "\n".join("".join(row) for row in board)
    return f"🐍 *Snake Game*\nScore: `{state['score']}`\n\n{grid_str}"


def get_snake_controls(game_over: bool = False) -> InlineKeyboardMarkup:
    if game_over:
        return InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("🔄 Restart", callback_data="snake:start")],
                [InlineKeyboardButton("🏠 Single Player Menu", callback_data="menu:single")],
            ]
        )
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("⬆️", callback_data="snake:UP")],
            [
                InlineKeyboardButton("⬅️", callback_data="snake:LEFT"),
                InlineKeyboardButton("⬇️", callback_data="snake:DOWN"),
                InlineKeyboardButton("➡️", callback_data="snake:RIGHT"),
            ],
            [InlineKeyboardButton("🏠 Back", callback_data="menu:single")],
        ]
    )


async def handle_snake_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    action = query.data.split(":", 1)[1]

    if action == "start":
        state = init_snake_game()
        context.user_data["snake"] = state
        await safe_edit_message(
            query,
            render_snake(state),
            get_snake_controls(),
            parse_mode="Markdown",
        )
        return

    state = context.user_data.get("snake")
    if not state:
        await safe_edit_message(
            query,
            "❌ Snake session expired. Start a new game!",
            get_snake_controls(game_over=True),
        )
        return

    move_snake(state, action)
    context.user_data["snake"] = state

    if state["game_over"]:
        banner = "🏆 *You filled the whole board!*" if state["won"] else "💀 *Game Over!*"
        await safe_edit_message(
            query,
            f"{banner}\nFinal Score: `{state['score']}`",
            get_snake_controls(game_over=True),
            parse_mode="Markdown",
        )
        return

    await safe_edit_message(
        query,
        render_snake(state),
        get_snake_controls(),
        parse_mode="Markdown",
    )
