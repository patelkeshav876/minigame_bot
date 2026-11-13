"""Telegram helper utilities for message editing, user formatting, and WebApp auth."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any
from urllib.parse import parse_qsl

from telegram import CallbackQuery, InlineKeyboardMarkup, User
from telegram.error import BadRequest


async def safe_edit_message(
    query: CallbackQuery,
    new_text: str,
    new_markup: InlineKeyboardMarkup | None = None,
    parse_mode: str | None = None,
) -> None:
    """Edit a chat or inline message safely, ignoring 'Message is not modified'."""
    try:
        await query.edit_message_text(
            text=new_text,
            reply_markup=new_markup,
            parse_mode=parse_mode,
        )
    except BadRequest as exc:
        if "message is not modified" in str(exc).lower():
            return
        raise


def player_display_name(user: User | None) -> str:
    """Return a readable name for a Telegram user."""
    if not user:
        return "Player"
    if user.first_name:
        return user.first_name
    if user.username:
        return f"@{user.username}"
    return f"User {user.id}"


def verify_telegram_init_data(
    init_data: str,
    bot_token: str,
    max_age_seconds: int | None = 86400,
) -> dict[str, Any] | None:
    """Verify Telegram Mini App initData signature using HMAC-SHA256.

    Returns parsed user dict if valid and fresh, or None if invalid/expired.
    """
    if not init_data or not bot_token:
        return None

    parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        return None

    if max_age_seconds is not None and "auth_date" in parsed:
        try:
            auth_date = int(parsed["auth_date"])
        except ValueError:
            return None
        if abs(time.time() - auth_date) > max_age_seconds:
            return None

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    expected_hash = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(received_hash, expected_hash):
        return None

    user_raw = parsed.get("user")
    if not user_raw:
        return None
    try:
        return json.loads(user_raw)
    except json.JSONDecodeError:
        return None
