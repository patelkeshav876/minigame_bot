"""Telegram Bot entry point (supports standalone bot polling)."""

from __future__ import annotations

import logging

from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    InlineQueryHandler,
)

from config import BOT_TOKEN
from handlers.inline import handle_inline_query
from handlers.menu import (
    addgame_command,
    arena_command,
    handle_menu_callback,
    leaderboard_command,
    play_command,
)

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)


def build_bot_application() -> Application:
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN is not set. Add it to your .env file.")

    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", play_command))
    app.add_handler(CommandHandler("play", play_command))
    app.add_handler(CommandHandler("leaderboard", leaderboard_command))
    app.add_handler(CommandHandler("arena", arena_command))
    app.add_handler(CommandHandler("addgame", addgame_command))
    app.add_handler(InlineQueryHandler(handle_inline_query))
    app.add_handler(CallbackQueryHandler(handle_menu_callback))
    return app


if __name__ == "__main__":
    application = build_bot_application()
    application.run_polling()
