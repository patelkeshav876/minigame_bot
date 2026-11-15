"""Telegram Bot entry point (supports standalone bot polling)."""

from __future__ import annotations

import logging

from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    InlineQueryHandler,
    MessageHandler,
    PreCheckoutQueryHandler,
    filters,
)

from config import BOT_TOKEN
from handlers.inline import handle_inline_query
from handlers.menu import (
    addgame_command,
    arena_command,
    aviator_command,
    broadcast_command,
    flipster_command,
    handle_menu_callback,
    handle_pre_checkout_query,
    handle_successful_payment,
    leaderboard_command,
    play_command,
    setchannel_command,
    setupi_command,
    shop_command,
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
    app.add_handler(CommandHandler("aviator", aviator_command))
    app.add_handler(CommandHandler("flipster", flipster_command))
    app.add_handler(CommandHandler("shop", shop_command))
    app.add_handler(CommandHandler("stars", shop_command))
    app.add_handler(CommandHandler("setupi", setupi_command))
    app.add_handler(CommandHandler("upi", setupi_command))
    app.add_handler(CommandHandler("setchannel", setchannel_command))
    app.add_handler(CommandHandler("channel", setchannel_command))
    app.add_handler(CommandHandler("broadcast", broadcast_command))
    app.add_handler(CommandHandler("announce", broadcast_command))
    app.add_handler(CommandHandler("addgame", addgame_command))
    app.add_handler(PreCheckoutQueryHandler(handle_pre_checkout_query))
    app.add_handler(MessageHandler(filters.SUCCESSFUL_PAYMENT, handle_successful_payment))
    app.add_handler(InlineQueryHandler(handle_inline_query))
    app.add_handler(CallbackQueryHandler(handle_menu_callback))
    return app


if __name__ == "__main__":
    application = build_bot_application()
    application.run_polling()
