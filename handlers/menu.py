"""Main menu, commands, and callback router for all in-bot and Mini App entry points."""

from __future__ import annotations

from pathlib import Path
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
    rows = []
    if WEBAPP_URL and is_private_chat:
        rows.append(
            [InlineKeyboardButton("🚀 Launch Ghost Plays (Mini App)", web_app=WebAppInfo(url=WEBAPP_URL))]
        )
        rows.append(
            [InlineKeyboardButton("🚀 Play Aviator (Rocket Duel)", web_app=WebAppInfo(url=f"{WEBAPP_URL}?game=aviator"))]
        )
        rows.append(
            [InlineKeyboardButton("🪙 Star Coin Shop", web_app=WebAppInfo(url=f"{WEBAPP_URL}?tab=shop"))]
        )
    else:
        rows.append([InlineKeyboardButton("🚀 Launch Ghost Plays (Mini App)", callback_data="menu:arena")])
        rows.append([InlineKeyboardButton("🚀 Play Aviator", callback_data="menu:aviator")])
        rows.append([InlineKeyboardButton("🪙 Star Coin Shop", callback_data="menu:shop")])
    rows.append(
        [
            InlineKeyboardButton("🏆 Leaderboards", callback_data="menu:leaderboard"),
            InlineKeyboardButton("⚔️ Challenge Friend", switch_inline_query="challenge aviator"),
        ]
    )
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
        "🎮 *GHOST PLAYS • Gaming Hub*\n\n"
        "Welcome to the ultimate Telegram gaming arena!\n\n"
        "🔥 *30+ Retro & Arcade Games*\n"
        "🚀 *Aviator: High-Stakes Rocket Multiplier Duel*\n"
        "⚔️ *Real-Time PvP Arena (Chess, Connect 4, Othello)*\n"
        "🏆 *Global ELO Rankings & Player Profiles*\n\n"
        "Tap below to launch Ghost Plays in full screen!"
    )
    markup = _main_menu_markup(is_private_chat=is_private)
    if update.message:
        await update.message.reply_text(text, reply_markup=markup, parse_mode="Markdown")
    elif update.callback_query:
        await safe_edit_message(update.callback_query, text, markup, parse_mode="Markdown")


async def aviator_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Post promotional Aviator rocket duel card."""
    is_private = bool(update.effective_chat and update.effective_chat.type == "private")
    aviator_url = f"{WEBAPP_URL}?game=aviator" if WEBAPP_URL else None

    buttons = []
    if aviator_url and is_private:
        buttons.append(InlineKeyboardButton("🚀 Launch Aviator", web_app=WebAppInfo(url=aviator_url)))
    else:
        buttons.append(InlineKeyboardButton("🚀 Launch Aviator", callback_data="menu:arena"))
    buttons.append(InlineKeyboardButton("⚔️ Challenge Friend", switch_inline_query="challenge aviator"))
    markup = InlineKeyboardMarkup([buttons])

    caption = (
        "🚀 *AVIATOR • Rocket Multiplier Duel*\n\n"
        "Watch the rocket soar into the sky! Ride the multiplier curve, duel opponents live, and cash out before the sudden blast!\n\n"
        "• *Cryptographically Unpredictable Crash*\n"
        "• *Live Rocket Flight & Blast Effects*\n"
        "• *Daily Midnight Coin Refills & High-Stakes Duels*"
    )

    photo_path = Path(__file__).resolve().parent.parent / "webapp" / "static" / "bot_avatar.jpg"
    if update.message:
        if photo_path.exists():
            try:
                with open(photo_path, "rb") as photo:
                    await update.message.reply_photo(photo=photo, caption=caption, reply_markup=markup, parse_mode="Markdown")
                    return
            except Exception:
                pass
        await update.message.reply_text(caption, reply_markup=markup, parse_mode="Markdown")
    elif update.callback_query:
        await safe_edit_message(update.callback_query, caption, markup, parse_mode="Markdown")


# Backward-compatible alias
flipster_command = aviator_command


async def broadcast_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin command to broadcast announcements to all registered players: /broadcast <text>."""
    user = update.effective_user
    if not user:
        return
    if ADMIN_USER_IDS and str(user.id) not in ADMIN_USER_IDS:
        await update.message.reply_text("⛔ Admin only command.")
        return

    msg_text = " ".join(context.args or []).strip()
    if not msg_text:
        await update.message.reply_text("Usage: `/broadcast <announcement message>`", parse_mode="Markdown")
        return

    player_ids = storage.list_all_player_ids()
    if not player_ids:
        await update.message.reply_text("No registered players found.")
        return

    sent = 0
    failed = 0
    status_msg = await update.message.reply_text(f"📢 Broadcasting to {len(player_ids)} players...")

    for pid in player_ids:
        try:
            await context.bot.send_message(
                chat_id=int(pid),
                text=f"📢 *Ghost Plays Update*\n\n{msg_text}",
                parse_mode="Markdown",
            )
            sent += 1
        except Exception:
            failed += 1

    await status_msg.edit_text(f"✅ Broadcast complete!\nSent: `{sent}` | Failed/Blocked: `{failed}`", parse_mode="Markdown")


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


async def shop_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Displays the Telegram Stars Coin Shop in chat."""
    user = update.effective_user
    if not user:
        return
    bal = storage.get_player_coins(user.id)
    text = (
        f"🪙 *Ghost Plays Stars Coin Shop*\n\n"
        f"Your Current Balance: *{bal:,} Coins*\n\n"
        f"Select a Telegram Stars pack to refill your chips for Aviator and high-stakes duels:\n\n"
        f"⭐ *50 Stars* ➔ 5,000 Coins\n"
        f"⭐ *150 Stars* ➔ 18,000 Coins _(+20% Bonus)_\n"
        f"⭐ *500 Stars* ➔ 75,000 Coins _(+50% Bonus)_\n"
        f"⭐ *1,000 Stars* ➔ 200,000 Coins _(+100% VIP Mega)_\n"
    )
    is_private = bool(update.effective_chat and update.effective_chat.type == "private")
    rows = []
    if WEBAPP_URL and is_private:
        rows.append([InlineKeyboardButton("🛒 Open Stars Shop in Mini App", web_app=WebAppInfo(url=f"{WEBAPP_URL}?tab=shop"))])
    rows.append([
        InlineKeyboardButton("⭐ 50 XTR", callback_data="buy_stars:pack_50"),
        InlineKeyboardButton("⭐ 150 XTR", callback_data="buy_stars:pack_150"),
    ])
    rows.append([
        InlineKeyboardButton("⭐ 500 XTR", callback_data="buy_stars:pack_500"),
        InlineKeyboardButton("⭐ 1,000 XTR", callback_data="buy_stars:pack_1000"),
    ])
    rows.append([InlineKeyboardButton("🔙 Back to Main Menu", callback_data="menu:main")])
    await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(rows), parse_mode="Markdown")


async def handle_pre_checkout_query(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Responds to Telegram's pre-checkout query within 10 seconds."""
    query = update.pre_checkout_query
    if not query:
        return
    await query.answer(ok=True)


async def handle_successful_payment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handles completed payment, credits user coins in storage, and congratulates the player."""
    payment = update.message.successful_payment
    user = update.effective_user
    if not payment or not user:
        return

    import json
    try:
        payload = json.loads(payment.invoice_payload)
        pack_id = payload.get("pack_id", "")
        coins = int(payload.get("coins", payment.total_amount * 100))
    except Exception:
        pack_id = "unknown"
        coins = payment.total_amount * 100

    rec = storage.record_star_payment(
        user_id=user.id,
        charge_id=payment.telegram_payment_charge_id,
        stars_amount=payment.total_amount,
        coins_credited=coins,
        pack_id=pack_id,
    )

    markup = None
    if WEBAPP_URL:
        markup = InlineKeyboardMarkup([
            [InlineKeyboardButton("🚀 Launch Ghost Plays", web_app=WebAppInfo(url=WEBAPP_URL))]
        ])

    await update.message.reply_text(
        f"🎉 *Payment Verified!*\n\n"
        f"⭐ *Paid:* `{payment.total_amount} Stars`\n"
        f"🪙 *Credited:* `+{coins:,} Coins`\n"
        f"💰 *New Balance:* `{rec['new_coins']:,} Coins`\n\n"
        f"Your coins are ready to use in Aviator and all arcade battle tables!",
        reply_markup=markup,
        parse_mode="Markdown",
    )


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


async def setupi_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin command to set or view the UPI ID for player deposits: /setupi <your_upi_id>."""
    user = update.effective_user
    if not user:
        return
    if ADMIN_USER_IDS and str(user.id) not in ADMIN_USER_IDS:
        await update.message.reply_text("⛔ Admin only command.")
        return

    args = context.args or []
    if not args:
        current_upi = storage.get_setting("upi_id", "Not configured")
        await update.message.reply_text(
            f"🇮🇳 *Current UPI ID for Deposits:*\n`{current_upi}`\n\n"
            f"To change it, run:\n`/setupi yourname@upi`",
            parse_mode="Markdown",
        )
        return

    new_upi = args[0].strip()
    storage.set_setting("upi_id", new_upi)
    await update.message.reply_text(
        f"✅ *UPI ID Successfully Updated!*\n\n"
        f"New receiving UPI ID: `{new_upi}`\n"
        f"All Mini App UPI deposit QR codes will now receive payments at this address.",
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

    # Admin approval for UPI deposits
    if data.startswith("dep_appr:") or data.startswith("dep_rejc:"):
        if ADMIN_USER_IDS and str(user.id) not in ADMIN_USER_IDS:
            await query.answer("⛔ Admin only action.", show_alert=True)
            return
        action, dep_id_str = data.split(":", 1)
        dep_id = int(dep_id_str)
        status = "approved" if action == "dep_appr" else "rejected"
        res = storage.resolve_pending_deposit(dep_id, status=status, admin_id=str(user.id))
        if not res:
            await query.answer("Deposit not found.", show_alert=True)
            return

        if status == "approved":
            await query.answer("✅ Deposit approved! Coins credited.", show_alert=True)
            await query.edit_message_text(
                f"✅ *UPI Deposit #{dep_id} APPROVED by @{user.username or user.first_name}*\n\n"
                f"👤 Player: `{res['username']}`\n"
                f"💰 Amount: `₹{res['amount']}`\n"
                f"🪙 Credited: `+{res['coins_to_credit']:,} Coins`\n"
                f"🔢 UTR: `{res['utr_ref']}`",
                parse_mode="Markdown",
            )
            try:
                await context.bot.send_message(
                    chat_id=int(res["user_id"]),
                    text=(
                        f"🎉 *UPI Deposit Confirmed!*\n\n"
                        f"₹{res['amount']} has been verified! `+{res['coins_to_credit']:,} Coins` have been credited to your Ghost Plays balance.\n\n"
                        f"Launch the Mini App now to play Aviator!"
                    ),
                    parse_mode="Markdown",
                )
            except Exception:
                pass
        else:
            await query.answer("❌ Deposit rejected.", show_alert=True)
            await query.edit_message_text(
                f"❌ *UPI Deposit #{dep_id} REJECTED by @{user.username or user.first_name}*\n\n"
                f"👤 Player: `{res['username']}`\n"
                f"🔢 UTR: `{res['utr_ref']}`",
                parse_mode="Markdown",
            )
            try:
                await context.bot.send_message(
                    chat_id=int(res["user_id"]),
                    text=f"⚠️ *UPI Deposit Notice*\nYour deposit request for UTR `{res['utr_ref']}` could not be verified.",
                    parse_mode="Markdown",
                )
            except Exception:
                pass
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
        elif section == "shop":
            bal = storage.get_player_coins(user.id)
            text = (
                f"🪙 *Ghost Plays Stars Coin Shop*\n\n"
                f"Your Current Balance: *{bal:,} Coins*\n\n"
                f"Select a Telegram Stars pack to refill your chips for Aviator and high-stakes duels:\n\n"
                f"⭐ *50 Stars* ➔ 5,000 Coins\n"
                f"⭐ *150 Stars* ➔ 18,000 Coins _(+20% Bonus)_\n"
                f"⭐ *500 Stars* ➔ 75,000 Coins _(+50% Bonus)_\n"
                f"⭐ *1,000 Stars* ➔ 200,000 Coins _(+100% VIP Mega)_\n"
            )
            rows = []
            if WEBAPP_URL and is_private:
                rows.append([InlineKeyboardButton("🛒 Open Stars Shop in Mini App", web_app=WebAppInfo(url=f"{WEBAPP_URL}?tab=shop"))])
            rows.append([
                InlineKeyboardButton("⭐ 50 XTR", callback_data="buy_stars:pack_50"),
                InlineKeyboardButton("⭐ 150 XTR", callback_data="buy_stars:pack_150"),
            ])
            rows.append([
                InlineKeyboardButton("⭐ 500 XTR", callback_data="buy_stars:pack_500"),
                InlineKeyboardButton("⭐ 1,000 XTR", callback_data="buy_stars:pack_1000"),
            ])
            rows.append([InlineKeyboardButton("⬅️ Main Menu", callback_data="menu:main")])
            await safe_edit_message(query, text, InlineKeyboardMarkup(rows), parse_mode="Markdown")
        elif section in ("aviator", "flipster"):
            await aviator_command(update, context)
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

    # Telegram Stars purchases directly via in-chat invoice
    if data.startswith("buy_stars:"):
        pack_id = data.split(":", 1)[1]
        from webapp.server import STAR_PACKS
        pack = STAR_PACKS.get(pack_id)
        if pack and query.message:
            import json
            from telegram import LabeledPrice
            await query.answer()
            payload = json.dumps({
                "user_id": str(user.id),
                "pack_id": pack["id"],
                "coins": pack["coins"],
                "stars": pack["stars"],
            })
            await context.bot.send_invoice(
                chat_id=query.message.chat_id,
                title=f"Ghost Plays: {pack['title']}",
                description=pack["description"],
                payload=payload,
                provider_token="",  # ALWAYS empty for Telegram Stars
                currency="XTR",     # Telegram Stars currency code
                prices=[LabeledPrice(label=pack["title"], amount=pack["stars"])],
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
