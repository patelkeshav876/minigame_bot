"""FastAPI server for the Telegram Mini App Competitive Battle Arena."""

from __future__ import annotations

from contextlib import asynccontextmanager
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import ADMIN_SECRET, ADMIN_USER_IDS, BOT_TOKEN, BOT_USERNAME
from core.storage import storage
from core.telegram_utils import verify_telegram_init_data, verify_user_chat_membership
from webapp.arena_manager import ArenaManager

STATIC_DIR = Path(__file__).resolve().parent / "static"
arena = ArenaManager(storage)


@asynccontextmanager
async def lifespan(_: FastAPI):
    arena.start_background_tasks()
    try:
        yield
    finally:
        await arena.stop_background_tasks()


import os

app = FastAPI(
    title="MiniGame Bot Battle Arena",
    lifespan=None if os.getenv("TESTING") == "1" else lifespan,
)


@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    p = request.url.path
    if p == "/" or p.endswith(".html") or p.endswith("app.js") or p.endswith("style.css"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class AuthRequest(BaseModel):
    init_data: str = ""
    guest_id: str = ""
    guest_name: str = "Player"


class RoomRequest(BaseModel):
    game_type: str = "chess"
    user_id: str
    name: str
    room_id: str | None = None
    quick_match: bool = False
    vs_ai: bool = False


class CustomGameRequest(BaseModel):
    title: str
    url: str
    icon: str = "🎮"
    description: str = ""
    image_url: str = ""
    user_id: str = ""
    admin_secret: str = ""


class PromoBannerRequest(BaseModel):
    title: str
    badge: str = ""
    badge2: str = ""
    description: str = ""
    image_url: str = ""
    game_url: str = ""
    game_title: str = ""
    game_icon: str = "🎮"
    bg_theme: str = "slide-aviator"
    order_idx: int = 0
    is_active: int = 1
    user_id: str = ""
    admin_secret: str = ""


class LogoUploadRequest(BaseModel):
    image_base64: str
    filename: str = "game_logo.png"
    user_id: str = ""
    admin_secret: str = ""


class StarInvoiceRequest(BaseModel):
    pack_id: str
    init_data: str = ""
    guest_id: str = ""


class UpiDepositRequest(BaseModel):
    pack_id: str
    utr_ref: str
    init_data: str = ""
    guest_id: str = ""
    guest_name: str = "Player"


INR_PACKS = {
    "pack_inr_49": {
        "id": "pack_inr_49",
        "title": "Starter Stash",
        "price_inr": 49,
        "coins": 5000,
        "badge": "STARTER",
        "icon": "🪙",
    },
    "pack_inr_99": {
        "id": "pack_inr_99",
        "title": "Pro Pilot Booster",
        "price_inr": 99,
        "coins": 18000,
        "badge": "MOST POPULAR",
        "icon": "🔥",
    },
    "pack_inr_299": {
        "id": "pack_inr_299",
        "title": "High Roller Vault",
        "price_inr": 299,
        "coins": 75000,
        "badge": "HIGH ROLLER",
        "icon": "💎",
    },
    "pack_inr_599": {
        "id": "pack_inr_599",
        "title": "VIP Legend Treasury",
        "price_inr": 599,
        "coins": 200000,
        "badge": "VIP LEGEND",
        "icon": "👑",
    },
}


STAR_PACKS = {
    "pack_50": {
        "id": "pack_50",
        "title": "Starter Coin Stash",
        "description": "5,000 Coins for Ghost Plays & Aviator rocket rounds",
        "stars": 1,
        "coins": 5000,
        "badge": "1 STAR PROMO",
        "icon": "🪙",
    },
    "pack_150": {
        "id": "pack_150",
        "title": "Pilot Booster (+20% Bonus)",
        "description": "18,000 Coins (+20% bonus) for longer duel streaks",
        "stars": 1,
        "coins": 18000,
        "badge": "MOST POPULAR",
        "icon": "🔥",
    },
    "pack_500": {
        "id": "pack_500",
        "title": "High Roller Vault (+50% Bonus)",
        "description": "75,000 Coins (+50% bonus) for high-stakes tables",
        "stars": 1,
        "coins": 75000,
        "badge": "HIGH ROLLER",
        "icon": "💎",
    },
    "pack_1000": {
        "id": "pack_1000",
        "title": "VIP Legend Treasury (+100% Bonus)",
        "description": "200,000 Coins (+100% bonus) & exclusive VIP glory",
        "stars": 1,
        "coins": 200000,
        "badge": "VIP LEGEND",
        "icon": "👑",
    },
}


def _get_star_packs() -> dict[str, dict[str, Any]]:
    raw = storage.get_setting("star_packs_json", "")
    if raw:
        try:
            items = json.loads(raw)
            if isinstance(items, list) and items:
                return {str(p["id"]): p for p in items if isinstance(p, dict) and p.get("id")}
        except Exception:
            pass
    return {k: dict(v) for k, v in STAR_PACKS.items()}


def _get_inr_packs() -> dict[str, dict[str, Any]]:
    raw = storage.get_setting("inr_packs_json", "")
    if raw:
        try:
            items = json.loads(raw)
            if isinstance(items, list) and items:
                return {str(p["id"]): p for p in items if isinstance(p, dict) and p.get("id")}
        except Exception:
            pass
    return {k: dict(v) for k, v in INR_PACKS.items()}


def _get_feature_pricing() -> dict[str, int]:
    return {
        "sticker_premium_stars": max(1, int(storage.get_setting("sticker_premium_stars", "1") or 1)),
        "sticker_premium_coins": max(0, int(storage.get_setting("sticker_premium_coins", "500") or 500)),
        "vip_pass_stars": max(1, int(storage.get_setting("vip_pass_stars", "1") or 1)),
    }


class PricingUpdateRequest(BaseModel):
    star_packs: list[dict[str, Any]] = []
    inr_packs: list[dict[str, Any]] = []
    sticker_premium_stars: int = 1
    sticker_premium_coins: int = 500
    vip_pass_stars: int = 1
    upi_id: str = ""
    user_id: str = ""
    admin_secret: str = ""


def _is_admin(user_id: str, admin_secret: str = "") -> bool:
    if admin_secret and admin_secret == ADMIN_SECRET:
        return True
    if user_id and str(user_id) in ADMIN_USER_IDS:
        return True
    return False


def _resolve_user(init_data: str, guest_id: str, guest_name: str) -> dict[str, Any]:
    tg_user = verify_telegram_init_data(init_data, BOT_TOKEN)
    if tg_user:
        uid = str(tg_user["id"])
        name = tg_user.get("first_name") or tg_user.get("username") or f"User {uid}"
        username = tg_user.get("username") or ""
        profile = storage.upsert_player(uid, name, username)
        return {"verified": True, "profile": profile}

    clean_id = (guest_id or "guest").strip()[:32]
    clean_name = (guest_name or "Guest").strip()[:32] or "Guest"
    profile = storage.upsert_player(clean_id, clean_name)
    return {"verified": False, "profile": profile}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/favicon.ico")
async def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "bot_avatar.jpg", media_type="image/jpeg")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth")
async def auth(req: AuthRequest) -> dict[str, Any]:
    result = _resolve_user(req.init_data, req.guest_id, req.guest_name)
    result["bot_username"] = BOT_USERNAME
    uid = result["profile"]["user_id"]
    result["is_admin"] = _is_admin(uid)
    return result


@app.get("/api/custom-games")
async def get_custom_games() -> dict[str, Any]:
    return {"games": storage.list_custom_games()}


@app.post("/api/admin/games")
async def add_custom_game(req: CustomGameRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")

    clean_url = req.url.strip()
    if not (
        clean_url.startswith("https://")
        or clean_url.startswith("http://localhost")
        or clean_url.startswith("/static/")
    ):
        raise HTTPException(
            status_code=400,
            detail="Game URL must start with https://, /static/, or http://localhost",
        )

    game = storage.add_custom_game(
        title=req.title,
        url=clean_url,
        icon=req.icon or "🎮",
        description=req.description,
        image_url=req.image_url or "",
    )
    return {"game": game}


@app.post("/api/admin/upload-logo")
async def upload_game_logo(req: LogoUploadRequest) -> dict[str, str]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")

    import base64
    import re
    from uuid import uuid4

    data = req.image_base64
    if "," in data:
        data = data.split(",", 1)[1]

    try:
        raw_bytes = base64.b64decode(data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    clean_ext = ".png"
    mime_type = "image/png"
    if req.filename.lower().endswith(".jpg") or req.filename.lower().endswith(".jpeg"):
        clean_ext = ".jpg"
        mime_type = "image/jpeg"
    elif req.filename.lower().endswith(".webp"):
        clean_ext = ".webp"
        mime_type = "image/webp"

    try:
        safe_name = f"custom_logo_{uuid4().hex[:8]}{clean_ext}"
        dest_path = STATIC_DIR / "thumbnails" / safe_name
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "wb") as f:
            f.write(raw_bytes)
    except Exception:
        pass

    # Return persistent base64 Data URI so logos are saved in PostgreSQL/Supabase and survive Render redeploys
    persistent_data_url = f"data:{mime_type};base64,{data}"
    return {"image_url": persistent_data_url}


@app.put("/api/admin/games/{game_id}")
async def update_custom_game(game_id: int, req: CustomGameRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")

    clean_url = req.url.strip()
    if not (
        clean_url.startswith("https://")
        or clean_url.startswith("http://localhost")
        or clean_url.startswith("/static/")
    ):
        raise HTTPException(
            status_code=400,
            detail="Game URL must start with https://, /static/, or http://localhost",
        )

    game = storage.update_custom_game(
        game_id=game_id,
        title=req.title,
        url=clean_url,
        icon=req.icon or "🎮",
        description=req.description,
        image_url=req.image_url or "",
    )
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return {"game": game}


@app.delete("/api/admin/games/{game_id}")
async def delete_custom_game(
    game_id: int,
    user_id: str = Query(default=""),
    admin_secret: str = Query(default=""),
) -> dict[str, Any]:
    if not _is_admin(user_id, admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    success = storage.delete_custom_game(game_id)
    if not success:
        raise HTTPException(status_code=404, detail="Game not found")
    return {"status": "deleted", "game_id": game_id}


# --- Sliding Window / Hero Promo Banners API ---
@app.get("/api/promo-banners")
async def get_promo_banners() -> dict[str, Any]:
    return {"banners": storage.list_promo_banners(only_active=True)}


@app.get("/api/admin/promo-banners")
async def get_all_admin_promo_banners(
    user_id: str = Query(default=""),
    admin_secret: str = Query(default=""),
) -> dict[str, Any]:
    if not _is_admin(user_id, admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    return {"banners": storage.list_promo_banners(only_active=False)}


@app.post("/api/admin/promo-banners")
async def add_promo_banner(req: PromoBannerRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    banner = storage.add_promo_banner(
        title=req.title,
        badge=req.badge,
        badge2=req.badge2,
        description=req.description,
        image_url=req.image_url,
        game_url=req.game_url,
        game_title=req.game_title,
        game_icon=req.game_icon,
        bg_theme=req.bg_theme,
        order_idx=req.order_idx,
        is_active=req.is_active,
    )
    return {"banner": banner}


@app.put("/api/admin/promo-banners/{banner_id}")
async def update_promo_banner(banner_id: int, req: PromoBannerRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    banner = storage.update_promo_banner(
        banner_id=banner_id,
        title=req.title,
        badge=req.badge,
        badge2=req.badge2,
        description=req.description,
        image_url=req.image_url,
        game_url=req.game_url,
        game_title=req.game_title,
        game_icon=req.game_icon,
        bg_theme=req.bg_theme,
        order_idx=req.order_idx,
        is_active=req.is_active,
    )
    if not banner:
        raise HTTPException(status_code=404, detail="Banner not found")
    return {"banner": banner}


@app.delete("/api/admin/promo-banners/{banner_id}")
async def delete_promo_banner(
    banner_id: int,
    user_id: str = Query(default=""),
    admin_secret: str = Query(default=""),
) -> dict[str, Any]:
    if not _is_admin(user_id, admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    success = storage.delete_promo_banner(banner_id)
    if not success:
        raise HTTPException(status_code=404, detail="Banner not found")
    return {"status": "deleted", "banner_id": banner_id}


@app.get("/api/profile/{user_id}")
async def get_profile(user_id: str) -> dict[str, Any]:
    profile = storage.get_player(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Player not found")
    history = storage.get_match_history(user_id, limit=15)
    return {"profile": profile, "history": history}


@app.get("/api/leaderboard")
async def leaderboard(game_type: str = Query(default="overall")) -> dict[str, Any]:
    return {"game_type": game_type, "players": storage.get_leaderboard(limit=15, game_type=game_type)}


@app.get("/api/rooms")
async def list_live_rooms() -> dict[str, Any]:
    return {"rooms": arena.list_live_rooms()}


@app.post("/api/rooms")
async def create_or_join_room(req: RoomRequest) -> dict[str, Any]:
    if req.vs_ai:
        room = await arena.create_or_join_room(
            req.game_type, req.user_id, req.name, vs_ai=True
        )
    elif req.quick_match:
        room = await arena.quick_match(req.game_type, req.user_id, req.name)
    else:
        room = await arena.create_or_join_room(
            req.game_type, req.user_id, req.name, room_id=req.room_id
        )
    return {"room": arena.serialize_room(room)}


@app.get("/api/rooms/{room_id}")
async def get_room(room_id: str) -> dict[str, Any]:
    room = arena.rooms.get(room_id.upper())
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"room": arena.serialize_room(room)}


@app.get("/api/stars/packs")
async def get_star_packs() -> dict[str, Any]:
    return {"packs": list(_get_star_packs().values())}


@app.get("/api/shop/config")
async def get_shop_config() -> dict[str, Any]:
    configured_upi = storage.get_setting("upi_id", "patelkeshav@upi")
    return {
        "star_packs": list(_get_star_packs().values()),
        "inr_packs": list(_get_inr_packs().values()),
        "feature_pricing": _get_feature_pricing(),
        "upi_id": configured_upi,
        "upi_name": "Ghost Plays Arena",
        "crypto_contact": "@ghost_help_and_support_bot",
        "channel_url": storage.get_setting("channel_url", "https://t.me/ghost_help_and_support_bot"),
    }


@app.get("/api/admin/pricing")
async def get_admin_pricing(
    user_id: str = Query(default=""),
    admin_secret: str = Query(default=""),
) -> dict[str, Any]:
    if not _is_admin(user_id, admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    return {
        "star_packs": list(_get_star_packs().values()),
        "inr_packs": list(_get_inr_packs().values()),
        "feature_pricing": _get_feature_pricing(),
        "upi_id": storage.get_setting("upi_id", "patelkeshav@upi"),
    }


@app.put("/api/admin/pricing")
async def update_admin_pricing(req: PricingUpdateRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")

    if req.star_packs:
        cleaned_stars = []
        for p in req.star_packs:
            if not isinstance(p, dict) or not p.get("id"):
                continue
            cleaned_stars.append({
                "id": str(p["id"]),
                "title": str(p.get("title", "Coin Pack"))[:64],
                "description": str(p.get("description", ""))[:160],
                "stars": max(1, int(p.get("stars", 1))),
                "coins": max(1, int(p.get("coins", 1000))),
                "badge": str(p.get("badge", "PROMO"))[:24],
                "icon": str(p.get("icon", "🪙"))[:8],
            })
        if cleaned_stars:
            storage.set_setting("star_packs_json", json.dumps(cleaned_stars))

    if req.inr_packs:
        cleaned_inr = []
        for p in req.inr_packs:
            if not isinstance(p, dict) or not p.get("id"):
                continue
            cleaned_inr.append({
                "id": str(p["id"]),
                "title": str(p.get("title", "INR Pack"))[:64],
                "price_inr": max(1, int(p.get("price_inr", 49))),
                "coins": max(1, int(p.get("coins", 5000))),
                "badge": str(p.get("badge", "POPULAR"))[:24],
                "icon": str(p.get("icon", "🪙"))[:8],
            })
        if cleaned_inr:
            storage.set_setting("inr_packs_json", json.dumps(cleaned_inr))

    storage.set_setting("sticker_premium_stars", str(max(1, int(req.sticker_premium_stars))))
    storage.set_setting("sticker_premium_coins", str(max(0, int(req.sticker_premium_coins))))
    storage.set_setting("vip_pass_stars", str(max(1, int(req.vip_pass_stars))))
    if req.upi_id.strip():
        storage.set_setting("upi_id", req.upi_id.strip()[:120])

    return {
        "status": "updated",
        "star_packs": list(_get_star_packs().values()),
        "inr_packs": list(_get_inr_packs().values()),
        "feature_pricing": _get_feature_pricing(),
        "upi_id": storage.get_setting("upi_id", "patelkeshav@upi"),
    }


@app.post("/api/shop/submit-upi-deposit")
async def submit_upi_deposit(req: UpiDepositRequest) -> dict[str, Any]:
    pack = _get_inr_packs().get(req.pack_id)
    if not pack:
        raise HTTPException(status_code=400, detail="Invalid pack selected")

    utr = req.utr_ref.strip()
    if len(utr) < 6:
        raise HTTPException(status_code=400, detail="Please enter a valid 12-digit UPI Reference / UTR Number")

    user_info = _resolve_user(req.init_data, req.guest_id, req.guest_name)
    user_id = str(user_info["profile"]["user_id"])
    username = user_info["profile"].get("username") or user_info["profile"].get("display_name") or "Player"

    dep_id = storage.create_pending_deposit(
        user_id=user_id,
        username=username,
        method="upi",
        pack_id=pack["id"],
        amount=float(pack["price_inr"]),
        currency="INR",
        coins_to_credit=pack["coins"],
        utr_ref=utr,
    )

    if BOT_TOKEN and ADMIN_USER_IDS:
        try:
            from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup
            bot = Bot(token=BOT_TOKEN)
            text = (
                f"🔔 *New UPI Deposit Request!* (Deposit #{dep_id})\n\n"
                f"👤 *Player:* `{username}` (`ID: {user_id}`)\n"
                f"💰 *Amount:* `₹{pack['price_inr']}`\n"
                f"🪙 *Coins to Credit:* `+{pack['coins']:,} Coins`\n"
                f"🔢 *UTR / Ref ID:* `{utr}`\n\n"
                f"Check your PhonePe / GPay app to verify ₹{pack['price_inr']} received."
            )
            markup = InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("✅ Approve", callback_data=f"dep_appr:{dep_id}"),
                    InlineKeyboardButton("❌ Reject", callback_data=f"dep_rejc:{dep_id}"),
                ]
            ])
            for admin_id in ADMIN_USER_IDS:
                try:
                    await bot.send_message(chat_id=int(admin_id), text=text, reply_markup=markup, parse_mode="Markdown")
                except Exception:
                    pass
        except Exception:
            pass

    return {
        "status": "pending",
        "deposit_id": dep_id,
        "message": "Deposit submitted! Admin will verify and credit your coins shortly.",
    }


@app.post("/api/stars/create-invoice")
async def create_stars_invoice(req: StarInvoiceRequest) -> dict[str, Any]:
    if req.pack_id == "pack_sticker_premium":
        fp = _get_feature_pricing()
        pack = {
            "id": "pack_sticker_premium",
            "title": "All-Access Premium Stickers & VIP",
            "description": "Permanent access to all Premium Stickers & VIP features",
            "stars": fp["sticker_premium_stars"],
            "coins": 0,
            "badge": "ALL ACCESS",
            "icon": "💎",
        }
    else:
        pack = _get_star_packs().get(req.pack_id)
    if not pack:
        raise HTTPException(status_code=400, detail="Invalid star pack ID")

    user_info = _resolve_user(req.init_data, req.guest_id, "Player")
    user_id = str(user_info["profile"]["user_id"])

    if not BOT_TOKEN:
        return {
            "invoice_link": f"mock://stars_payment?pack={pack['id']}&user={user_id}&stars={pack['stars']}&coins={pack['coins']}",
            "pack": pack,
            "mock": True,
        }

    try:
        import json
        from telegram import Bot, LabeledPrice
        bot = Bot(token=BOT_TOKEN)
        payload = json.dumps({
            "user_id": user_id,
            "pack_id": pack["id"],
            "coins": pack["coins"],
            "stars": pack["stars"],
        })
        link = await bot.create_invoice_link(
            title=f"Ghost Plays: {pack['title']}",
            description=pack["description"],
            payload=payload,
            provider_token="",  # ALWAYS empty for Telegram Stars
            currency="XTR",     # Telegram Stars currency code
            prices=[LabeledPrice(label=pack["title"], amount=pack["stars"])],
        )
        return {"invoice_link": link, "pack": pack, "mock": False}
    except Exception as exc:
        return {
            "invoice_link": f"mock://stars_payment?pack={pack['id']}&user={user_id}&stars={pack['stars']}&coins={pack['coins']}",
            "pack": pack,
            "mock": True,
            "error_detail": str(exc),
        }


@app.get("/api/wallet/{user_id}")
async def get_user_wallet(user_id: str) -> dict[str, Any]:
    coins = storage.get_player_coins(user_id)
    profile = storage.get_player(user_id)
    return {
        "user_id": user_id,
        "coins": coins,
        "stars_spent": profile.get("stars_spent", 0) if profile else 0,
    }


@app.post("/api/stars/dev-credit")
async def dev_credit_coins(req: ClaimMockCoinsRequest) -> dict[str, Any]:
    new_bal = storage.add_player_coins(req.user_id, req.coins)
    return {"status": "ok", "user_id": req.user_id, "coins": new_bal}


# --- Advertisements & Promotion Products API ---
class PromoAdRequest(BaseModel):
    title: str
    description: str = ""
    ad_type: str = "banner_inline"
    media_url: str = ""
    target_url: str = ""
    cta_label: str = "Learn More"
    skip_seconds: int = 30
    reward_coins: int = 100
    is_active: int = 1
    user_id: str = ""
    admin_secret: str = ""


class ToggleSettingRequest(BaseModel):
    enabled: bool
    user_id: str = ""
    admin_secret: str = ""


class AdRewardClaimRequest(BaseModel):
    ad_id: int
    user_id: str = ""
    init_data: str = ""


class SubscribeTaskRequest(BaseModel):
    title: str
    chat_id: str
    invite_url: str
    kind: str = "channel"
    reward_coins: int = 200
    is_required: int = 1
    user_id: str = ""
    admin_secret: str = ""


class VerifySubscribeRequest(BaseModel):
    user_id: str = ""
    init_data: str = ""
    task_id: int | None = None


@app.get("/api/ads/config")
async def get_public_ads_config() -> dict[str, Any]:
    ads_enabled = storage.get_setting("ads_enabled", "1") == "1"
    ads = storage.list_promo_ads(only_active=True) if ads_enabled else []
    return {"ads_enabled": ads_enabled, "ads": ads}


@app.post("/api/ads/claim-reward")
async def claim_ad_reward(req: AdRewardClaimRequest) -> dict[str, Any]:
    if storage.get_setting("ads_enabled", "1") != "1":
        raise HTTPException(status_code=400, detail="Ads are currently disabled")
    ads = storage.list_promo_ads(only_active=True)
    ad = next((a for a in ads if int(a["id"]) == int(req.ad_id)), None)
    if not ad:
        raise HTTPException(status_code=404, detail="Active ad not found")
    user_info = _resolve_user(req.init_data, req.user_id, "Player")
    uid = str(user_info["profile"]["user_id"])
    reward = int(ad.get("reward_coins", 100))
    new_bal = storage.add_player_coins(uid, reward)
    return {"status": "credited", "coins_added": reward, "coins": new_bal}


@app.get("/api/admin/ads")
async def get_admin_ads(user_id: str = Query(default=""), admin_secret: str = Query(default="")) -> dict[str, Any]:
    if not _is_admin(user_id, admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    return {
        "ads_enabled": storage.get_setting("ads_enabled", "1") == "1",
        "ads": storage.list_promo_ads(only_active=False),
    }


@app.post("/api/admin/ads/toggle")
async def toggle_admin_ads(req: ToggleSettingRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    storage.set_setting("ads_enabled", "1" if req.enabled else "0")
    return {"ads_enabled": req.enabled}


@app.post("/api/admin/ads")
async def create_admin_ad(req: PromoAdRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    ad = storage.add_promo_ad(
        title=req.title,
        description=req.description,
        ad_type=req.ad_type,
        media_url=req.media_url,
        target_url=req.target_url,
        cta_label=req.cta_label,
        skip_seconds=req.skip_seconds,
        reward_coins=req.reward_coins,
        is_active=req.is_active,
    )
    return {"ad": ad}


@app.put("/api/admin/ads/{ad_id}")
async def update_admin_ad(ad_id: int, req: PromoAdRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    ad = storage.update_promo_ad(
        ad_id=ad_id,
        title=req.title,
        description=req.description,
        ad_type=req.ad_type,
        media_url=req.media_url,
        target_url=req.target_url,
        cta_label=req.cta_label,
        skip_seconds=req.skip_seconds,
        reward_coins=req.reward_coins,
        is_active=req.is_active,
    )
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")
    return {"ad": ad}


@app.delete("/api/admin/ads/{ad_id}")
async def delete_admin_ad(ad_id: int, user_id: str = Query(default=""), admin_secret: str = Query(default="")) -> dict[str, Any]:
    if not _is_admin(user_id, admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    if not storage.delete_promo_ad(ad_id):
        raise HTTPException(status_code=404, detail="Ad not found")
    return {"status": "deleted", "ad_id": ad_id}


# --- Channel & Group Subscribe Tasks Verification API ---
@app.get("/api/tasks/status")
async def get_user_tasks_status(user_id: str = Query(default="")) -> dict[str, Any]:
    force_sub = storage.get_setting("force_sub_enabled", "0") == "1"
    tasks = storage.list_subscribe_tasks(only_active=True)
    claimed_ids = storage.get_user_claimed_task_ids(user_id) if user_id else set()
    enriched = []
    for t in tasks:
        item = dict(t)
        item["claimed"] = int(t["id"]) in claimed_ids
        enriched.append(item)
    return {"force_sub_enabled": force_sub, "tasks": enriched}


@app.post("/api/tasks/verify")
async def verify_subscribe_tasks(req: VerifySubscribeRequest) -> dict[str, Any]:
    tg_user = verify_telegram_init_data(req.init_data, BOT_TOKEN)
    uid = str(tg_user["id"]) if tg_user else str(req.user_id or "").strip()

    tasks = storage.list_subscribe_tasks(only_active=True)
    if req.task_id is not None:
        tasks = [t for t in tasks if int(t["id"]) == int(req.task_id)]
    else:
        tasks = [t for t in tasks if t.get("is_required")]

    if not tasks:
        return {"verified": True, "missing": [], "coins_added": 0, "message": "No tasks to verify."}

    if not BOT_TOKEN:
        return {
            "verified": False,
            "missing": tasks,
            "coins_added": 0,
            "message": "Bot token not configured for Telegram channel verification.",
        }

    if not uid.isdigit():
        return {
            "verified": False,
            "missing": tasks,
            "coins_added": 0,
            "message": "Please open inside Telegram to verify your channel/group subscription!",
        }

    from telegram import Bot
    bot = Bot(token=BOT_TOKEN)
    missing = []
    joined = []
    for t in tasks:
        ok, status = await verify_user_chat_membership(bot, t["chat_id"], int(uid))
        if ok:
            joined.append(t)
        else:
            missing.append({**t, "reason": status})

    if missing:
        names = ", ".join(m["title"] for m in missing[:3])
        return {
            "verified": False,
            "missing": missing,
            "coins_added": 0,
            "message": f"❌ Not subscribed yet: {names}. Please join first — no reward granted!",
        }

    coins_added = 0
    claimed_ids = []
    for t in joined:
        if storage.claim_subscribe_task(uid, t["id"], t.get("reward_coins", 0)):
            coins_added += int(t.get("reward_coins", 0))
            claimed_ids.append(t["id"])

    return {
        "verified": True,
        "missing": [],
        "coins_added": coins_added,
        "claimed_task_ids": claimed_ids,
        "coins": storage.get_player_coins(uid),
        "message": f"✅ Verified! +{coins_added} 🪙 Coins credited!" if coins_added > 0 else "✅ All subscriptions verified!",
    }


@app.get("/api/admin/tasks")
async def get_admin_tasks(user_id: str = Query(default=""), admin_secret: str = Query(default="")) -> dict[str, Any]:
    if not _is_admin(user_id, admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    return {
        "force_sub_enabled": storage.get_setting("force_sub_enabled", "0") == "1",
        "tasks": storage.list_subscribe_tasks(only_active=False),
    }


@app.post("/api/admin/tasks/toggle")
async def toggle_admin_tasks(req: ToggleSettingRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    storage.set_setting("force_sub_enabled", "1" if req.enabled else "0")
    return {"force_sub_enabled": req.enabled}


@app.post("/api/admin/tasks")
async def create_admin_task(req: SubscribeTaskRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    task = storage.add_subscribe_task(
        title=req.title,
        chat_id=req.chat_id,
        invite_url=req.invite_url,
        kind=req.kind,
        reward_coins=req.reward_coins,
        is_required=req.is_required,
    )
    return {"task": task}


@app.delete("/api/admin/tasks/{task_id}")
async def delete_admin_task(task_id: int, user_id: str = Query(default=""), admin_secret: str = Query(default="")) -> dict[str, Any]:
    if not _is_admin(user_id, admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    if not storage.delete_subscribe_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "deleted", "task_id": task_id}


# ── Tournaments ──


class JoinTournamentRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    display_name: str = Field(default="Player", max_length=60)


class SubmitTournamentScoreRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    score: int = Field(..., ge=0)


class CreateTournamentRequest(BaseModel):
    user_id: str = Field(default="")
    admin_secret: str = Field(default="")
    title: str = Field(..., min_length=2, max_length=80)
    game_key: str = Field(..., min_length=1, max_length=80)
    game_title: str = Field(default="", max_length=80)
    icon: str = Field(default="🏆", max_length=10)
    badge: str = Field(default="LIVE", max_length=20)
    entry_fee: int = Field(default=0, ge=0)
    reward_1st: int = Field(default=1000, ge=0)
    reward_2nd: int = Field(default=500, ge=0)
    reward_3rd: int = Field(default=250, ge=0)
    description: str = Field(default="", max_length=300)
    duration_hours: int = Field(default=48, ge=1, le=720)


@app.get("/api/tournaments")
async def get_public_tournaments() -> dict[str, Any]:
    return {"tournaments": storage.list_tournaments(only_active=True)}


@app.get("/api/tournaments/{tournament_id}")
async def get_tournament_detail(tournament_id: int) -> dict[str, Any]:
    t = storage.get_tournament_details(tournament_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return {"tournament": t}


@app.post("/api/tournaments/{tournament_id}/join")
async def join_tournament_api(tournament_id: int, req: JoinTournamentRequest) -> dict[str, Any]:
    storage.ensure_player(req.user_id, req.display_name)
    res = storage.join_tournament(tournament_id, req.user_id, req.display_name)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Could not join tournament"))
    details = storage.get_tournament_details(tournament_id)
    return {
        "ok": True,
        "already_joined": bool(res.get("already_joined")),
        "coins": res.get("coins"),
        "tournament": details,
    }


@app.post("/api/tournaments/{tournament_id}/score")
async def submit_tournament_score_api(tournament_id: int, req: SubmitTournamentScoreRequest) -> dict[str, Any]:
    ok = storage.submit_tournament_score(tournament_id, req.user_id, req.score)
    if not ok:
        raise HTTPException(status_code=404, detail="Not joined in this tournament")
    return {"ok": True}


@app.get("/api/admin/tournaments")
async def get_admin_tournaments(user_id: str = Query(default=""), admin_secret: str = Query(default="")) -> dict[str, Any]:
    if not _is_admin(user_id, admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    return {"tournaments": storage.list_tournaments(only_active=False)}


@app.post("/api/admin/tournaments")
async def create_admin_tournament(req: CreateTournamentRequest) -> dict[str, Any]:
    if not _is_admin(req.user_id, req.admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    t = storage.create_tournament(
        title=req.title,
        game_key=req.game_key,
        game_title=req.game_title,
        icon=req.icon,
        badge=req.badge,
        entry_fee=req.entry_fee,
        reward_1st=req.reward_1st,
        reward_2nd=req.reward_2nd,
        reward_3rd=req.reward_3rd,
        description=req.description,
        duration_hours=req.duration_hours,
    )
    return {"tournament": t}


@app.delete("/api/admin/tournaments/{tournament_id}")
async def delete_admin_tournament(tournament_id: int, user_id: str = Query(default=""), admin_secret: str = Query(default="")) -> dict[str, Any]:
    if not _is_admin(user_id, admin_secret):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    if not storage.delete_tournament(tournament_id):
        raise HTTPException(status_code=404, detail="Tournament not found")
    return {"status": "deleted", "tournament_id": tournament_id}


@app.websocket("/ws/{room_id}")
async def room_websocket(websocket: WebSocket, room_id: str, user_id: str, name: str = "Player"):
    room = await arena.connect_ws(room_id, user_id, name, websocket)
    if not room:
        return
    try:
        while True:
            data = await websocket.receive_json()
            await arena.handle_ws_message(room, user_id, data)
    except WebSocketDisconnect:
        await arena.disconnect_ws(room, user_id, websocket)
    except Exception:
        await arena.disconnect_ws(room, user_id, websocket)
