"""Inline mode support (@botname in any chat) for instant 2-player games."""

from __future__ import annotations

import secrets
from uuid import uuid4

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InlineQueryResultArticle,
    InputTextMessageContent,
    Update,
)
from telegram.ext import ContextTypes

from config import BOT_USERNAME, WEBAPP_URL
from core.storage import storage
from core.telegram_utils import player_display_name
from handlers.games.chess_game import init_chess_state, render_chess
from handlers.games.connect4 import init_connect4_state, render_connect4
from handlers.games.dots_and_boxes import init_dots_state, render_dots
from handlers.games.rock_paper_scissors import init_rps_state, render_rps
from handlers.games.tic_tac_toe import init_tictactoe_state, render_tictactoe


async def handle_inline_query(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Serve playable 2-player games when a user types @botname in any chat."""
    inline_query = update.inline_query
    user = inline_query.from_user
    uname = player_display_name(user)
    storage.upsert_player(user.id, uname, user.username or "")

    filter_text = (inline_query.query or "").strip().lower()
    results: list[InlineQueryResultArticle] = []
    bot_user = BOT_USERNAME or (context.bot.username or "")

    # Gamee-style Challenge Cards (e.g. @bot challenge aviator)
    if "challenge" in filter_text or any(k in filter_text for k in ["aviator", "dino", "tetris", "space", "knife", "2048"]):
        target_game = "aviator"
        for k in ["aviator", "dino", "tetris", "space_invaders", "knife", "xo", "2048"]:
            if k in filter_text:
                target_game = k
                break

        game_meta = {
            "aviator": ("🚀 Aviator Rocket Duel", "Multiply coins up to 100x — cash out before the crash!"),
            "dino": ("🦖 Cyber Dino 60FPS", "Endless neon runner — beat my high score!"),
            "tetris": ("🧩 Retro Tetris Battle", "Clear lines, make combos, score higher!"),
            "space_invaders": ("👾 Galaxy Defender", "Defend Sector 7 from alien armadas!"),
            "knife": ("🗡️ Knife Master 3D", "Hit the spinning log, avoid blades!"),
            "xo": ("❌ XO Blitz Arena", "Quick 3x3 duel with ranked ELO!"),
            "2048": ("🔢 2048 Neon Merge", "Merge tiles to 2048 — test your brain!"),
        }
        g_name, g_desc = game_meta.get(target_game, game_meta["aviator"])
        direct_link = (
            f"https://t.me/{bot_user}?startapp=game_{target_game}"
            if bot_user
            else (f"{WEBAPP_URL}?game={target_game}" if WEBAPP_URL else "")
        )

        btn_row = []
        if direct_link:
            btn_row.append(InlineKeyboardButton(f"🚀 Play {g_name.split()[1]}", url=direct_link))
        btn_row.append(InlineKeyboardButton("⚔️ Challenge Back", switch_inline_query=f"challenge {target_game}"))

        results.append(
            InlineQueryResultArticle(
                id=f"chal_{uuid4().hex[:8]}",
                title=f"⚔️ Challenge: {g_name}",
                description=g_desc,
                input_message_content=InputTextMessageContent(
                    f"⚔️ *GAME CHALLENGE!*\n\n"
                    f"👤 *{uname}* challenges you to a showdown in *{g_name}*!\n\n"
                    f"⚡ {g_desc}\n\n"
                    f"Can you beat their record? Tap below to play directly in Telegram!",
                    parse_mode="Markdown",
                ),
                reply_markup=InlineKeyboardMarkup([btn_row]),
            )
        )

    # 1. Chess
    if not filter_text or "chess" in filter_text:
        ch_state = init_chess_state(user.id, uname, mode="inline")
        ch_id = storage.create_match("chess", ch_state, mode="inline")
        ch_text, ch_markup = render_chess(ch_state, ch_id)
        results.append(
            InlineQueryResultArticle(
                id=f"ch_{uuid4().hex[:8]}",
                title="♟️ Chess (2 Players)",
                description="Full 8x8 interactive Chess right in chat",
                input_message_content=InputTextMessageContent(ch_text, parse_mode="Markdown"),
                reply_markup=ch_markup,
            )
        )

    # 2. Connect 4
    if not filter_text or "connect" in filter_text or "4" in filter_text:
        c4_state = init_connect4_state(user.id, uname, mode="inline")
        c4_id = storage.create_match("connect4", c4_state, mode="inline")
        c4_text, c4_markup = render_connect4(c4_state, c4_id)
        results.append(
            InlineQueryResultArticle(
                id=f"c4_{uuid4().hex[:8]}",
                title="🔴 Connect 4 (2 Players)",
                description="Drop discs and connect 4 in a row",
                input_message_content=InputTextMessageContent(c4_text, parse_mode="Markdown"),
                reply_markup=c4_markup,
            )
        )

    # 3. Tic-Tac-Toe
    if not filter_text or "tic" in filter_text or "xo" in filter_text:
        ttt_state = init_tictactoe_state(user.id, uname, mode="inline")
        ttt_id = storage.create_match("tictactoe", ttt_state, mode="inline")
        ttt_text, ttt_markup = render_tictactoe(ttt_state, ttt_id)
        results.append(
            InlineQueryResultArticle(
                id=f"ttt_{uuid4().hex[:8]}",
                title="❌ Tic-Tac-Toe ⭕",
                description="Quick classic 3x3 duel",
                input_message_content=InputTextMessageContent(ttt_text, parse_mode="Markdown"),
                reply_markup=ttt_markup,
            )
        )

    # 4. Dots and Boxes
    if not filter_text or "dot" in filter_text or "box" in filter_text:
        dab_state = init_dots_state(user.id, uname, mode="inline")
        dab_id = storage.create_match("dots_and_boxes", dab_state, mode="inline")
        dab_text, dab_markup = render_dots(dab_state, dab_id)
        results.append(
            InlineQueryResultArticle(
                id=f"dab_{uuid4().hex[:8]}",
                title="🟦 Dots & Boxes 🟥",
                description="Draw lines & claim boxes to score",
                input_message_content=InputTextMessageContent(dab_text, parse_mode="Markdown"),
                reply_markup=dab_markup,
            )
        )

    # 5. Rock Paper Scissors
    if not filter_text or "rock" in filter_text or "rps" in filter_text:
        rps_state = init_rps_state(user.id, uname, mode="inline")
        rps_id = storage.create_match("rps", rps_state, mode="inline")
        rps_text, rps_markup = render_rps(rps_state, rps_id)
        results.append(
            InlineQueryResultArticle(
                id=f"rps_{uuid4().hex[:8]}",
                title="✂️ Rock Paper Scissors",
                description="Secret simultaneous choices until both lock in",
                input_message_content=InputTextMessageContent(rps_text, parse_mode="Markdown"),
                reply_markup=rps_markup,
            )
        )

    # 5. Live Mini App Arena Challenge Card
    bot_user = BOT_USERNAME or (context.bot.username or "")
    if WEBAPP_URL and bot_user and (not filter_text or "arena" in filter_text or "mini" in filter_text):
        room_code = secrets.token_hex(3).upper()
        arena_url = f"https://t.me/{bot_user}?startapp=room_{room_code}"
        results.append(
            InlineQueryResultArticle(
                id=f"arena_{uuid4().hex[:8]}",
                title="⚔️ Live Battle Arena (Mini App)",
                description=f"Invite friend to real-time timed battle room {room_code}",
                input_message_content=InputTextMessageContent(
                    f"⚔️ *Battle Arena Challenge!*\n\n"
                    f"*{uname}* challenged you to a real-time competitive match!\n"
                    f"Room Code: `{room_code}`",
                    parse_mode="Markdown",
                ),
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("🚀 Join Live Battle", url=arena_url)]]
                ),
            )
        )

    await inline_query.answer(results, cache_time=0, is_personal=True)
