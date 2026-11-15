"""Integration tests for GameStorage, Telegram initData auth, AI, spectators, and Mini App Arena."""

import asyncio
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import httpx

from config import ADMIN_SECRET
from core.storage import GameStorage
from core.telegram_utils import verify_telegram_init_data
from webapp import server as webapp_server
from webapp.arena_manager import ArenaManager


class FakeWebSocket:
    """Minimal async WebSocket test double matching FastAPI's WebSocket interface."""

    def __init__(self) -> None:
        self.accepted = False
        self.closed = False
        self.sent: list[dict] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def close(self) -> None:
        self.closed = True


def _signed_init_data(bot_token: str, auth_date: int) -> str:
    user_json = json.dumps({"id": 42, "first_name": "Tester", "username": "tester"})
    params = {"auth_date": str(auth_date), "query_id": "AAH", "user": user_json}
    data_check = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    sig = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    return urlencode({**params, "hash": sig})


def test_verify_telegram_init_data():
    bot_token = "123456:TEST_TOKEN"
    now = int(time.time())
    fresh = _signed_init_data(bot_token, now)
    parsed = verify_telegram_init_data(fresh, bot_token)
    assert parsed is not None
    assert parsed["id"] == 42
    assert verify_telegram_init_data(fresh + "tamper", bot_token) is None

    # Expired auth_date (>24h old) must be rejected
    expired = _signed_init_data(bot_token, now - 100000)
    assert verify_telegram_init_data(expired, bot_token) is None


def test_storage_per_game_elo_xp_and_history(tmp_path):
    db = GameStorage(tmp_path / "test.db")
    db.upsert_player(1, "Alice")
    db.upsert_player(2, "Bob")
    mid = db.create_match("chess", {"fen": "start"})

    res1 = db.record_two_player_result(mid, 1, 2, 1, game_type="chess", reason="Checkmate")
    assert res1 is not None
    assert res1["1"]["new_elo"] > 1200.0
    assert res1["2"]["new_elo"] < 1200.0

    # Calling a second time for the same match must be ignored
    assert db.record_two_player_result(mid, 1, 2, 1, game_type="chess") is None

    # Per-game ELO separation: Tic-Tac-Toe rating stays 1200 even after winning Chess
    assert db.get_game_elo(1, "chess") > 1200.0
    assert db.get_game_elo(1, "tictactoe") == 1200.0

    alice = db.get_player(1)
    assert alice is not None
    assert alice["xp"] == 50
    assert len(db.get_match_history(1)) == 1
    assert db.get_leaderboard(game_type="chess")[0]["display_name"] == "Alice"
    assert db.get_leaderboard(game_type="tictactoe") == []
    assert "1" in db.list_all_player_ids()
    assert "2" in db.list_all_player_ids()


def test_miniapp_http_routes(tmp_path, monkeypatch):
    test_db = GameStorage(tmp_path / "http.db")
    test_arena = ArenaManager(test_db)
    monkeypatch.setattr(webapp_server, "storage", test_db)
    monkeypatch.setattr(webapp_server, "arena", test_arena)

    async def run_http():
        client_kwargs = {"base_url": "http://test"}
        if hasattr(httpx, "ASGITransport"):
            client_kwargs["transport"] = httpx.ASGITransport(app=webapp_server.app)
        else:
            client_kwargs["app"] = webapp_server.app
        async with httpx.AsyncClient(**client_kwargs) as client:
            assert (await client.get("/api/health")).json() == {"status": "ok"}
            assert (await client.get("/")).status_code == 200

            auth_res = (
                await client.post(
                    "/api/auth",
                    json={"init_data": "", "guest_id": "u1", "guest_name": "Alice"},
                )
            ).json()
            assert auth_res["profile"]["display_name"] == "Alice"

            r1 = (
                await client.post(
                    "/api/rooms",
                    json={
                        "game_type": "othello",
                        "user_id": "u1",
                        "name": "Alice",
                        "quick_match": True,
                    },
                )
            ).json()["room"]
            r2 = (
                await client.post(
                    "/api/rooms",
                    json={
                        "game_type": "othello",
                        "user_id": "u2",
                        "name": "Bob",
                        "quick_match": True,
                    },
                )
            ).json()["room"]

            assert r1["room_id"] == r2["room_id"]
            assert r2["status"] == "active"
            assert (await client.get("/api/rooms")).json()["rooms"][0]["game_type"] == "othello"
            assert (await client.get("/api/profile/u1")).status_code == 200
            assert (await client.get("/api/leaderboard?game_type=othello")).json()["players"] == []
        await test_arena.stop()

    asyncio.run(run_http())


def test_arena_othello_spectator_and_ai(tmp_path):
    test_db = GameStorage(tmp_path / "ws.db")

    async def run_arena():
        mgr = ArenaManager(test_db)
        # 1. PvP Othello with a spectator
        r1 = await mgr.quick_match("othello", "u1", "Alice")
        r2 = await mgr.quick_match("othello", "u2", "Bob")
        assert r1.room_id == r2.room_id

        ws1, ws2, spec = FakeWebSocket(), FakeWebSocket(), FakeWebSocket()
        room = await mgr.connect_ws(r1.room_id, "u1", "Alice", ws1)
        await mgr.connect_ws(r1.room_id, "u2", "Bob", ws2)
        await mgr.connect_ws(r1.room_id, "u3", "Watcher", spec)
        assert room is not None
        assert len(room.spectators) == 1

        # Spectator move must be ignored
        await mgr.handle_ws_message(room, "u3", {"type": "move", "row": 2, "col": 3})
        assert room.turn_role == "B"

        # Alice plays Black (2, 3), flipping (3, 3)
        await mgr.handle_ws_message(room, "u1", {"type": "move", "row": 2, "col": 3})
        assert room.state["board"][3][3] == "B"
        assert room.turn_role == "W"
        assert spec.sent[-1]["room"]["counts"]["B"] == 4

        # 2. Solo AI practice match in Tic-Tac-Toe
        ai_room = await mgr.create_or_join_room("tictactoe", "u1", "Alice", vs_ai=True)
        ai_ws = FakeWebSocket()
        await mgr.connect_ws(ai_room.room_id, "u1", "Alice", ai_ws)
        await mgr.handle_ws_message(ai_room, "u1", {"type": "move", "index": 0})
        # AI should have immediately made a counter-move
        assert sum(1 for c in ai_room.state["board"] if c != "") == 2
        # Human chess/ttt ELO stays untouched by AI matches
        assert test_db.get_game_elo("u1", "tictactoe") == 1200.0
        await mgr.stop()

    asyncio.run(run_arena())


def test_custom_games_admin_api(tmp_path, monkeypatch):
    test_db = GameStorage(tmp_path / "custom.db")
    monkeypatch.setattr(webapp_server, "storage", test_db)

    async def run_test():
        client_kwargs = {"base_url": "http://test"}
        if hasattr(httpx, "ASGITransport"):
            client_kwargs["transport"] = httpx.ASGITransport(app=webapp_server.app)
        else:
            client_kwargs["app"] = webapp_server.app
        async with httpx.AsyncClient(**client_kwargs) as client:
            # 1. Reject invalid non-https/non-localhost URLs
            bad = await client.post(
                "/api/admin/games",
                json={"title": "Bad", "url": "ftp://bad.com", "admin_secret": ADMIN_SECRET},
            )
            assert bad.status_code == 400

            # 2. Add valid custom game
            res = await client.post(
                "/api/admin/games",
                json={
                    "title": "Space Blaster",
                    "url": "https://games.example.com/space",
                    "icon": "🚀",
                    "description": "Retro space arcade",
                    "admin_secret": ADMIN_SECRET,
                },
            )
            assert res.status_code == 200
            game_id = res.json()["game"]["id"]

            # 3. List active custom games
            list_res = await client.get("/api/custom-games")
            assert list_res.status_code == 200
            games = list_res.json()["games"]
            assert any(g["title"] == "Space Blaster" for g in games)

            # 4. Delete custom game
            del_res = await client.delete(
                f"/api/admin/games/{game_id}?admin_secret={ADMIN_SECRET}"
            )
            assert del_res.status_code == 200

    asyncio.run(run_test())
