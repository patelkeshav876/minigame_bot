"""Single-player Pac-Man mini-game for Telegram inline keyboards."""

from __future__ import annotations

from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from core.telegram_utils import safe_edit_message

GRID_SIZE = 5
WALLS = {(1, 1), (3, 3), (0, 4), (4, 0)}


def init_pacman_game() -> dict[str, Any]:
    pacman_pos = (0, 0)
    ghost_pos = (4, 4)
    dots = {
        (r, c)
        for r in range(GRID_SIZE)
        for c in range(GRID_SIZE)
        if (r, c) not in WALLS and (r, c) != pacman_pos
    }
    return {
        "pacman": list(pacman_pos),
        "ghost": list(ghost_pos),
        "dots": [list(d) for d in sorted(dots)],
        "score": 0,
        "game_over": False,
        "won": False,
    }


def _move_ghost(state: dict[str, Any]) -> None:
    gx, gy = state["ghost"]
    px, py = state["pacman"]

    candidates = []
    if px != gx:
        candidates.append((gx + (1 if px > gx else -1), gy))
    if py != gy:
        candidates.append((gx, gy + (1 if py > gy else -1)))

    # Try diagonal chase first if both axes differ, then axis-aligned moves
    if px != gx and py != gy:
        dx = 1 if px > gx else -1
        dy = 1 if py > gy else -1
        candidates.insert(0, (gx + dx, gy + dy))

    for nx, ny in candidates:
        if 0 <= nx < GRID_SIZE and 0 <= ny < GRID_SIZE and (nx, ny) not in WALLS:
            state["ghost"] = [nx, ny]
            return


def move_pacman(state: dict[str, Any], direction: str) -> dict[str, Any]:
    if state.get("game_over"):
        return state

    x, y = state["pacman"]
    dx, dy = {
        "UP": (-1, 0),
        "DOWN": (1, 0),
        "LEFT": (0, -1),
        "RIGHT": (0, 1),
    }[direction]
    nx, ny = x + dx, y + dy

    if not (0 <= nx < GRID_SIZE and 0 <= ny < GRID_SIZE) or (nx, ny) in WALLS:
        return state

    state["pacman"] = [nx, ny]

    # Eat dot if present before ghost moves
    dots_set = {tuple(d) for d in state["dots"]}
    if (nx, ny) in dots_set:
        dots_set.remove((nx, ny))
        state["dots"] = [list(d) for d in sorted(dots_set)]
        state["score"] += 1

    if not dots_set:
        state["game_over"] = True
        state["won"] = True
        return state

    _move_ghost(state)
    if tuple(state["pacman"]) == tuple(state["ghost"]):
        state["game_over"] = True

    return state


def render_pacman(state: dict[str, Any]) -> str:
    dots_set = {tuple(d) for d in state["dots"]}
    px, py = state["pacman"]
    gx, gy = state["ghost"]

    rows = []
    for r in range(GRID_SIZE):
        row = []
        for c in range(GRID_SIZE):
            pos = (r, c)
            if pos == (gx, gy):
                row.append("👻")
            elif pos == (px, py):
                row.append("😋")
            elif pos in WALLS:
                row.append("🧱")
            elif pos in dots_set:
                row.append("🟡")
            else:
                row.append("⬛")
        rows.append("".join(row))

    board = "\n".join(rows)
    return (
        f"😋 *Pac-Man*\n"
        f"Score: `{state['score']}` | Dots left: `{len(dots_set)}`\n\n"
        f"{board}"
    )


def get_pacman_controls(game_over: bool = False) -> InlineKeyboardMarkup:
    if game_over:
        return InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("🔄 Restart", callback_data="pac:start")],
                [InlineKeyboardButton("🏠 Single Player Menu", callback_data="menu:single")],
            ]
        )
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("⬆️", callback_data="pac:UP")],
            [
                InlineKeyboardButton("⬅️", callback_data="pac:LEFT"),
                InlineKeyboardButton("⬇️", callback_data="pac:DOWN"),
                InlineKeyboardButton("➡️", callback_data="pac:RIGHT"),
            ],
            [InlineKeyboardButton("🏠 Back", callback_data="menu:single")],
        ]
    )


async def handle_pacman_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    action = query.data.split(":", 1)[1]

    if action == "start":
        state = init_pacman_game()
        context.user_data["pacman"] = state
        await safe_edit_message(
            query,
            render_pacman(state),
            get_pacman_controls(),
            parse_mode="Markdown",
        )
        return

    state = context.user_data.get("pacman")
    if not state:
        await safe_edit_message(
            query,
            "❌ Pac-Man session expired. Start a new game!",
            get_pacman_controls(game_over=True),
        )
        return

    move_pacman(state, action)
    context.user_data["pacman"] = state

    if state["game_over"]:
        banner = "🏆 *You cleared all the dots!*" if state["won"] else "👻 *Caught by the ghost!*"
        await safe_edit_message(
            query,
            f"{banner}\nFinal Score: `{state['score']}`",
            get_pacman_controls(game_over=True),
            parse_mode="Markdown",
        )
        return

    await safe_edit_message(
        query,
        render_pacman(state),
        get_pacman_controls(),
        parse_mode="Markdown",
    )
