"""Unified launcher that runs both the Telegram Bot and Mini App Arena server."""

from __future__ import annotations

import asyncio
import logging

import uvicorn

from bot import build_bot_application
from config import WEB_HOST, WEB_PORT
from webapp.server import app as fastapi_app

logger = logging.getLogger(__name__)


async def main() -> None:
    bot_app = build_bot_application()
    uvi_config = uvicorn.Config(
        fastapi_app,
        host=WEB_HOST,
        port=WEB_PORT,
        log_level="info",
    )
    server = uvicorn.Server(uvi_config)

    logger.info("Starting Mini App Arena at http://%s:%s", WEB_HOST, WEB_PORT)
    async with bot_app:
        await bot_app.start()
        if bot_app.updater:
            await bot_app.updater.start_polling()
        try:
            await server.serve()
        finally:
            if bot_app.updater and bot_app.updater.running:
                await bot_app.updater.stop()
            await bot_app.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
