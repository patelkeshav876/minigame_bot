"""Main menu, commands, and callback router for all in-bot and Mini App entry points."""

from __future__ import annotations

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.ext import ContextTypes

from config import ADMIN_USER_IDS, WEBAPP_URL
from core.storage import storage
from core.telegram_utils import player_display_name, safe_edit_message
from handlers.games.chess_game import handle_chess_callback, init_chess_state, render_chess
from handlers.games.connect4 import handle_connect4_callback, init_connect4_state, render_connect4
from handlers.games.dots_and_boxes import handle_dots_callback, init_dots_state, render_dots
from handlers.games.memory import handle_memory_callback
from handlers.games.pacman import handle_pacman_callback
from handlers.games.pinball import handle_pinball_callback
from handlers.games.rock_paper_scissors import handle_rps_callback, init_rps_state, render_rps
from handlers.games.snake import handle_snake_callback
from handlers.games.tic_tac_toe import (
    handle_tictactoe_callback,
    init_tictactoe_state,
    render_tictactoe,
)


def _main_menu_markup(is_private_chat: bool = True) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton("🎮 Single Player", callback_data="menu:single")],
        [InlineKeyboardButton("👥 Two Player (In Chat)", callback_data="menu:two")],
        [InlineKeyboardButton("💬 Challenge Friend (Inline)", switch_inline_query="")],
    ]
    if WEBAPP_URL and is_private_chat:
        rows.append(
            [InlineKeyboardButton("👻 Ghost Plays (Mini App)", web_app=WebAppInfo(url=WEBAPP_URL))]
        )
    else:
        rows.append([InlineKeyboardButton("👻 Ghost Plays (Mini App)", callback_data="menu:arena")])
    rows.append([InlineKeyboardButton("🏆 Leaderboard", callback_data="menu:leaderboard")])
    return InlineKeyboardMarkup(rows)


def _single_menu_markup() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("🐍 Snake", callback_data="snake:start"),
                InlineKeyboardButton("🟡 Pac-Man", callback_data="pac:start"),
            ],
            [
                InlineKeyboardButton("🧠 Memory", callback_data="mem:start"),
                InlineKeyboardButton("🧲 Pinball", callback_data="pin:start"),
            ],
            [InlineKeyboardButton("⬅️ Main Menu", callback_data="menu:main")],
        ]
    )


def _two_menu_markup() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("♟️ Chess", callback_data="start2p:chess"),
                InlineKeyboardButton("🔴 Connect 4", callback_data="start2p:connect4"),
            ],
            [
                InlineKeyboardButton("❌ Tic-Tac-Toe ⭕", callback_data="start2p:tictactoe"),
                InlineKeyboardButton("🟦 Dots & Boxes 🟥", callback_data="start2p:dots"),
            ],
            [
                InlineKeyboardButton("✂️ Rock Paper Scissors", callback_data="start2p:rps"),
            ],
            [InlineKeyboardButton("💬 Invite via Inline Mode", switch_inline_query="")],
            [InlineKeyboardButton("⬅️ Main Menu", callback_data="menu:main")],
        ]
    )


def _format_leaderboard() -> str:
    rows = storage.get_leaderboard(limit=10)
    if not rows:
        return (
            "🏆 *Competitive Leaderboard*\n\n"
            "No ranked 2-player matches finished yet.\n"
            "Play Chess, Connect 4, Tic-Tac-Toe, or Battle Arena to earn ELO!"
        )

    medals = ["🥇", "🥈", "🥉"]
    lines = ["🏆 *Competitive Leaderboard (Top 10)*\n"]
    for idx, p in enumerate(rows, start=1):
        prefix = medals[idx - 1] if idx <= 3 else f"`{idx}.`"
        lines.append(
            f"{prefix} *{p['display_name']}* — `{int(round(p['elo']))}` ELO "
            f"({p['wins']}W/{p['losses']}L/{p['draws']}D)"
        )
    return "\n".join(lines)


async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start and /play commands."""
    user = update.effective_user
    if user:
        storage.upsert_player(user.id, player_display_name(user), user.username or "")

    is_private = bool(update.effective_chat and update.effective_chat.type == "private")
    text = (
        "👻 *Ghost Plays • Gaming Hub*\n\n"
        "• Play casual games directly in chat\n"
        "• Type `@" + (context.bot.username or "yourbot") + "` in any DM/group for Inline games\n"
        "• Open *Ghost Plays Mini App* for 30+ arcade games & ranked battles!"
    )
    markup = _main_menu_markup(is_private_chat=is_private)
    if update.message:
        await update.message.reply_text(text, reply_markup=markup, parse_mode="Markdown")
    elif update.callback_query:
        await safe_edit_message(update.callback_query, text, markup, parse_mode="Markdown")


async def leaderboard_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(_format_leaderboard(), parse_mode="Markdown")


async def arena_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    is_private = bool(update.effective_chat and update.effective_chat.type == "private")
    if WEBAPP_URL and is_private:
        await update.message.reply_text(
            "👻 *Ghost Plays Mini App*\n\n"
            "Jump into 30+ arcade games, real-time ranked battles, and ELO leaderboards!",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("🚀 Launch Ghost Plays", web_app=WebAppInfo(url=WEBAPP_URL))]]
            ),
            parse_mode="Markdown",
        )
    else:
        bot_name = context.bot.username or "your_bot"
        msg = (
            "⚔️ *Battle Arena (Telegram Mini App)*\n\n"
            + (
                f"Tap to open in private chat: https://t.me/{bot_name}?startapp=lobby"
                if WEBAPP_URL
                else "Set `WEBAPP_URL` in `.env` to a public HTTPS URL (e.g. via ngrok or cloudflared) "
                     "pointing to `http://localhost:8000` to launch the Mini App inside Telegram."
            )
        )
        await update.message.reply_text(msg, parse_mode="Markdown")


async def addgame_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin command to add a custom web game: /addgame <title> <https://url> [icon]."""
    user = update.effective_user
    if not user:
        return
    if ADMIN_USER_IDS and str(user.id) not in ADMIN_USER_IDS:
        await update.message.reply_text("⛔ Admin only command.")
        return

    args = context.args or []
    if len(args) < 2:
        await update.message.reply_text(
            "Usage: `/addgame <Title> <https://url> [icon]`\n"
            "Example: `/addgame SpaceShooter https://mygame.com 🚀`",
            parse_mode="Markdown",
        )
        return

    # Find the URL among arguments
    url_idx = next((i for i, a in enumerate(args) if a.startswith("http://") or a.startswith("https://")), -1)
    if url_idx == -1:
        await update.message.reply_text("❌ Please include a valid `https://` game link.", parse_mode="Markdown")
        return

    url = args[url_idx]
    title = " ".join(args[:url_idx]) if url_idx > 0 else "Custom Game"
    icon = args[url_idx + 1] if len(args) > url_idx + 1 else "🎮"

    game = storage.add_custom_game(title=title, url=url, icon=icon)
    await update.message.reply_text(
        f"✅ *Added Web Game #{game['id']} to Mini App!*\n\n"
        f"*{game['icon']} {game['title']}*\n🔗 `{game['url']}`\n\n"
        f"It is now live in the Mini App Home screen!",
        parse_mode="Markdown",
    )


async def handle_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Route all inline keyboard callbacks."""
    query = update.callback_query
    data = query.data or ""
    user = query.from_user
    uname = player_display_name(user)

    if data == "noop":
        await query.answer()
        return

    # Menu navigation
    if data.startswith("menu:"):
        await query.answer()
        section = data.split(":", 1)[1]
        is_private = bool(query.message and query.message.chat.type == "private")
        if section == "main":
            await play_command(update, context)
        elif section == "single":
            await safe_edit_message(
                query,
                "🎮 *Single Player Games*\nPick a game:",
                _single_menu_markup(),
                parse_mode="Markdown",
            )
        elif section == "two":
            await safe_edit_message(
                query,
                "👥 *Two Player Games (In-Chat)*\n"
                "Start a board here, or use *Inline Mode* to challenge someone in any chat:",
                _two_menu_markup(),
                parse_mode="Markdown",
            )
        elif section == "leaderboard":
            await safe_edit_message(
                query,
                _format_leaderboard(),
                InlineKeyboardMarkup(
                    [[InlineKeyboardButton("⬅️ Main Menu", callback_data="menu:main")]]
                ),
                parse_mode="Markdown",
            )
        elif section == "arena":
            bot_name = context.bot.username or "your_bot"
            info = (
                f"⚔️ *Battle Arena (Mini App)*\n\nOpen in DM: https://t.me/{bot_name}?startapp=lobby"
                if WEBAPP_URL
                else "⚔️ *Battle Arena (Mini App)*\n\n"
                     "The Mini App server runs on port `8000`, and needs a public HTTPS `WEBAPP_URL` "
                     "in `.env` (for example via `cloudflared` or `ngrok`) so Telegram can open it."
            )
            await safe_edit_message(
                query,
                info,
                InlineKeyboardMarkup(
                    [[InlineKeyboardButton("⬅️ Main Menu", callback_data="menu:main")]]
                ),
                parse_mode="Markdown",
            )
        return

    # Single-player games
    if data.startswith("snake:"):
        await query.answer()
        await handle_snake_callback(update, context)
        return
    if data.startswith("pac:"):
        await query.answer()
        await handle_pacman_callback(update, context)
        return
    if data.startswith("mem:"):
        await query.answer()
        await handle_memory_callback(update, context)
        return
    if data.startswith("pin:"):
        await query.answer()
        await handle_pinball_callback(update, context)
        return

    # Starting 2-player games from bot chat
    if data.startswith("start2p:"):
        await query.answer()
        storage.upsert_player(user.id, uname, user.username or "")
        game = data.split(":", 1)[1]
        if game == "chess":
            state = init_chess_state(user.id, uname, mode="chat")
            mid = storage.create_match("chess", state, mode="chat")
            text, markup = render_chess(state, mid)
        elif game == "connect4":
            state = init_connect4_state(user.id, uname, mode="chat")
            mid = storage.create_match("connect4", state, mode="chat")
            text, markup = render_connect4(state, mid)
        elif game == "tictactoe":
            state = init_tictactoe_state(user.id, uname, mode="chat")
            mid = storage.create_match("tictactoe", state, mode="chat")
            text, markup = render_tictactoe(state, mid)
        elif game == "dots":
            state = init_dots_state(user.id, uname, mode="chat")
            mid = storage.create_match("dots_and_boxes", state, mode="chat")
            text, markup = render_dots(state, mid)
        elif game == "rps":
            state = init_rps_state(user.id, uname, mode="chat")
            mid = storage.create_match("rps", state, mode="chat")
            text, markup = render_rps(state, mid)
        else:
            await safe_edit_message(query, "🛠️ Unknown game.")
            return
        await safe_edit_message(query, text, markup, parse_mode="Markdown")
        return

    # Active 2-player game callbacks (chat + inline mode)
    if data.startswith("ttt:"):
        await handle_tictactoe_callback(update, context, storage)
        return
    if data.startswith("rps:"):
        await handle_rps_callback(update, context, storage)
        return
    if data.startswith("c4:"):
        await handle_connect4_callback(update, context, storage)
        return
    if data.startswith("ch:"):
        await handle_chess_callback(update, context, storage)
        return
    if data.startswith("dab:"):
        await handle_dots_callback(update, context, storage)
        return

    await query.answer()
    await safe_edit_message(query, "⚠️ Action not recognized. Use /play to reopen the menu.")
