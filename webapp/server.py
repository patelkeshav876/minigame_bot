"""FastAPI server for the Telegram Mini App Competitive Battle Arena."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import ADMIN_SECRET, ADMIN_USER_IDS, BOT_TOKEN, BOT_USERNAME
from core.storage import storage
from core.telegram_utils import verify_telegram_init_data
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


app = FastAPI(title="MiniGame Bot Battle Arena", lifespan=lifespan)
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
    user_id: str = ""
    admin_secret: str = ""


class StarInvoiceRequest(BaseModel):
    pack_id: str
    init_data: str = ""
    guest_id: str = ""


class ClaimMockCoinsRequest(BaseModel):
    user_id: str
    coins: int = 1000
    secret: str = ""


STAR_PACKS = {
    "pack_50": {
        "id": "pack_50",
        "title": "Starter Coin Stash",
        "description": "5,000 Coins for Ghost Plays & Aviator rocket rounds",
        "stars": 50,
        "coins": 5000,
        "badge": "STARTER",
        "icon": "🪙",
    },
    "pack_150": {
        "id": "pack_150",
        "title": "Pilot Booster (+20% Bonus)",
        "description": "18,000 Coins (+20% bonus) for longer duel streaks",
        "stars": 150,
        "coins": 18000,
        "badge": "MOST POPULAR",
        "icon": "🔥",
    },
    "pack_500": {
        "id": "pack_500",
        "title": "High Roller Vault (+50% Bonus)",
        "description": "75,000 Coins (+50% bonus) for high-stakes tables",
        "stars": 500,
        "coins": 75000,
        "badge": "HIGH ROLLER",
        "icon": "💎",
    },
    "pack_1000": {
        "id": "pack_1000",
        "title": "VIP Legend Treasury (+100% Bonus)",
        "description": "200,000 Coins (+100% bonus) & exclusive VIP glory",
        "stars": 1000,
        "coins": 200000,
        "badge": "VIP LEGEND",
        "icon": "👑",
    },
}


def _is_admin(user_id: str, admin_secret: str = "") -> bool:
    if admin_secret and admin_secret == ADMIN_SECRET:
        return True
    if user_id and str(user_id) in ADMIN_USER_IDS:
        return True
    # If no ADMIN_USER_IDS are configured, permit admin actions in local dev mode
    return len(ADMIN_USER_IDS) == 0


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
    return FileResponse(STATIC_DIR / "index.html")


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
    )
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
    return {"packs": list(STAR_PACKS.values())}


@app.post("/api/stars/create-invoice")
async def create_stars_invoice(req: StarInvoiceRequest) -> dict[str, Any]:
    pack = STAR_PACKS.get(req.pack_id)
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
