"""SQLite-backed match storage, per-game ELO ratings, XP/levels, and match history."""

from __future__ import annotations

import json
import logging
import re
import secrets
import sqlite3
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any

from config import DATABASE_URL, DB_PATH

logger = logging.getLogger(__name__)

RANK_TIERS = [
    (1800, "Master", "👑"),
    (1600, "Diamond", "💎"),
    (1450, "Platinum", "💠"),
    (1300, "Gold", "🥇"),
    (1150, "Silver", "🥈"),
    (0, "Bronze", "🥉"),
]


def get_rank_tier(elo: float) -> dict[str, str]:
    for threshold, name, icon in RANK_TIERS:
        if elo >= threshold:
            return {"name": name, "icon": icon}
    return {"name": "Bronze", "icon": "🥉"}


def xp_for_level(level: int) -> int:
    return 100 * level


def compute_level(xp: int) -> tuple[int, int, int]:
    """Return (level, xp_into_level, xp_needed_for_next)."""
    lvl = 1
    rem = max(0, xp)
    while rem >= xp_for_level(lvl):
        rem -= xp_for_level(lvl)
        lvl += 1
    return lvl, rem, xp_for_level(lvl)


DEFAULT_HTML5_GAMES: list[tuple[str, str, str, str, str]] = [
    # ⚡ High-Stakes Duel & Personal Wager
    ("Aviator Rocket", "/static/games/aviator/index.html", "🚀", "High-stakes rocket multiplier curve! Cash out before the blast", "/static/banners/aviator_promo.png"),

    # 🕹️ Arcade Classics (Self-Hosted & 100% Working)
    ("Neon Snake", "/static/games/snake/index.html", "🐍", "Classic retro snake with smooth controls", ""),
    ("Flappy Ghost", "/static/games/flappy/index.html", "👻", "Tap to flap and dodge obstacles", ""),
    ("Brick Breaker", "/static/games/breakout/index.html", "🧱", "Smash neon bricks with bouncing ball", ""),
    ("Retro Tetris", "/static/games/tetris/index.html", "🧩", "Falling tetromino block puzzle", "/static/banners/tetris_promo.png"),
    ("T-Rex Desert Run", "/static/games/dino/index.html", "🦖", "Endless runner cactus jumping challenge", "/static/banners/dino_promo.png"),
    ("Neon Pong", "/static/games/pong/index.html", "🏓", "Fast table tennis rally against AI", ""),
    ("Space Invaders", "/static/games/space_invaders/index.html", "👾", "Defend galaxy from alien waves", "/static/banners/space_promo.png"),
    ("Asteroid Blaster", "/static/games/asteroids/index.html", "🚀", "Space vector rock shooter with thrusters", ""),
    ("Fruit Slicer", "/static/games/fruit_slice/index.html", "🍉", "Slice flying fruits with swipe blades", "/static/thumbnails/fruit_thumb.png"),
    ("Knife Master", "/static/games/knife_hit/index.html", "🗡️", "Throw knives into rotating target log", "/static/thumbnails/knife_thumb.png"),
    ("Whack-a-Ghost", "/static/games/whack_a_mole/index.html", "🔨", "Test reaction time whacking popping ghosts", ""),
    ("Helix Drop", "/static/games/helix_jump/index.html", "🌀", "Bounce ball through gaps in rotating tower", ""),
    ("Tower Stack", "/static/games/tower_stack/index.html", "🏢", "Slice and stack tower blocks as high as you can", ""),
    ("Neon Pinball", "/static/games/pinball/index.html", "🪩", "Arcade pinball with flippers & bumpers", ""),
    ("Ghost Clicker", "/static/games/cookie_clicker/index.html", "🍪", "Idle tap clicker with auto-ghost upgrades", ""),
    ("Hextris Rotation", "/static/games/hextris/index.html", "🔷", "Hexagonal rotation match puzzle", ""),

    # 🧩 Puzzle & Brain (Self-Hosted)
    ("2048 Classic", "/static/games/2048/index.html", "🔢", "Slide tiles to merge and reach 2048!", "/static/banners/puzzle2048_promo.png"),
    ("Minesweeper Retro", "/static/games/minesweeper/index.html", "💣", "Clear the minefield without detonating bombs", ""),
    ("Wordle Guess", "/static/games/wordle/index.html", "🟩", "Guess secret 5-letter word in 6 attempts", ""),
    ("Sudoku Master", "/static/games/sudoku/index.html", "🧩", "Classic 9x9 number placement logic grid", ""),
    ("15-Puzzle Slider", "/static/games/sliding_puzzle/index.html", "🔲", "Classic sliding numbered block puzzle", ""),
    ("Color Flood", "/static/games/color_flood/index.html", "🎨", "Flood-fill the board with one color", ""),
    ("Emoji Memory", "/static/games/memory/index.html", "🧠", "Flip and match pairs of hidden cards", ""),
    ("Simon Memory", "/static/games/simon/index.html", "🔔", "Repeat growing sequence of lights & sounds", ""),

    # 🃏 Cards & Board Classics (Self-Hosted)
    ("8-Ball Billiards", "/static/games/billiards/index.html", "🎱", "Pocket balls with realistic pool physics", ""),
    ("Connect 4 Arena", "/static/games/connect4/index.html", "🔴", "Align 4 chips in a row against AI", "/static/thumbnails/connect4_thumb.png"),
    ("Checkers Classic", "/static/games/checkers/index.html", "⚪", "Jump and capture enemy checkers to king", ""),
    ("Neon Tic-Tac-Toe", "/static/games/tictactoe/index.html", "❌", "Glowing neon 3x3 XO against unbeatable AI", "/static/thumbnails/xo_thumb.png"),
    ("Klondike Solitaire", "/static/games/solitaire/index.html", "🃏", "World's most popular single-player card game", ""),
    ("Cyber Speed Typer", "/static/games/speed_typer/index.html", "⌨️", "Test and improve your words-per-minute typing", ""),
]


class PostgresCursorWrapper:
    def __init__(self, raw_cursor: Any) -> None:
        self.cursor = raw_cursor
        self.lastrowid: int | None = None

    def execute(self, sql: str, params: tuple = ()) -> PostgresCursorWrapper:
        adapted_sql = sql.replace("?", "%s")
        adapted_sql = re.sub(r'INSERT\s+OR\s+IGNORE\s+INTO\s+game_ratings', 'INSERT INTO game_ratings', adapted_sql, flags=re.I)
        if "ON CONFLICT" not in adapted_sql and "INSERT INTO game_ratings" in adapted_sql:
            adapted_sql += " ON CONFLICT (user_id, game_type) DO NOTHING"

        needs_returning = False
        upper = adapted_sql.strip().upper()
        if upper.startswith("INSERT INTO") and "RETURNING" not in upper:
            for table in ("custom_games", "pending_deposits", "match_history", "star_payments"):
                if f"INSERT INTO {table}" in adapted_sql or f"insert into {table}" in adapted_sql:
                    adapted_sql += " RETURNING id"
                    needs_returning = True
                    break

        self.cursor.execute(adapted_sql, params)
        if needs_returning:
            row = self.cursor.fetchone()
            if row:
                self.lastrowid = row["id"] if (isinstance(row, dict) or hasattr(row, "__getitem__")) else row[0]
        return self

    def fetchone(self) -> Any:
        return self.cursor.fetchone()

    def fetchall(self) -> list[Any]:
        return self.cursor.fetchall()


class PostgresConnectionWrapper:
    def __init__(self, raw_conn: Any) -> None:
        self.conn = raw_conn

    def __enter__(self) -> PostgresConnectionWrapper:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if exc_type is None:
            self.conn.commit()
        else:
            self.conn.rollback()
        self.conn.close()

    def execute(self, sql: str, params: tuple = ()) -> PostgresCursorWrapper:
        cur = self.conn.cursor()
        wrapper = PostgresCursorWrapper(cur)
        return wrapper.execute(sql, params)

    def executescript(self, script: str) -> None:
        cur = self.conn.cursor()
        cur.execute(script)

    def commit(self) -> None:
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()


def _parse_postgres_kwargs(url: str) -> dict[str, Any]:
    clean_url = (url or "").strip()
    if not clean_url.startswith(("postgres://", "postgresql://")):
        return {"dsn": clean_url}

    protocol, rest = clean_url.split("://", 1)
    sslmode = "require"
    if "?" in rest:
        rest, query_str = rest.split("?", 1)
        params = urllib.parse.parse_qs(query_str)
        if "sslmode" in params and params["sslmode"]:
            sslmode = params["sslmode"][0]

    if "@" not in rest:
        return {"dsn": clean_url}

    auth_part, host_db_part = rest.rsplit("@", 1)
    if ":" in auth_part:
        user, password = auth_part.split(":", 1)
    else:
        user, password = auth_part, ""

    if "/" in host_db_part:
        host_part, dbname = host_db_part.split("/", 1)
    else:
        host_part, dbname = host_db_part, "postgres"

    if ":" in host_part:
        host, port = host_part.split(":", 1)
    else:
        host, port = host_part, "5432"

    try:
        raw_password = urllib.parse.unquote(password)
    except Exception:
        raw_password = password

    return {
        "host": host,
        "port": int(port) if port.isdigit() else 5432,
        "user": user,
        "password": raw_password,
        "dbname": dbname,
        "sslmode": sslmode,
        "connect_timeout": 10,
    }


class GameStorage:
    """Thread-safe storage supporting both SQLite and PostgreSQL (Supabase)."""

    def __init__(self, db_path: Path | str = DB_PATH) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._use_postgres = bool(DATABASE_URL)
        self._init_schema()

    @property
    def is_postgres(self) -> bool:
        return bool(self._use_postgres and DATABASE_URL)

    def _connect(self) -> Any:
        if self.is_postgres:
            try:
                import psycopg2
                from psycopg2.extras import RealDictCursor

                kwargs = _parse_postgres_kwargs(DATABASE_URL)
                raw = psycopg2.connect(**kwargs, cursor_factory=RealDictCursor)
                return PostgresConnectionWrapper(raw)
            except Exception as e:
                logger.warning(
                    "PostgreSQL connection to Supabase failed (%s). Falling back to SQLite local storage.",
                    e,
                )
                self._use_postgres = False

        conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._lock:
            if self.is_postgres:
                try:
                    with self._connect() as conn:
                        if not self.is_postgres:
                            raise RuntimeError("PostgreSQL connection downgraded to SQLite")
                        conn.executescript(
                            """
                            CREATE TABLE IF NOT EXISTS players (
                                user_id TEXT PRIMARY KEY,
                                username TEXT NOT NULL DEFAULT '',
                                display_name TEXT NOT NULL DEFAULT 'Player',
                                elo REAL NOT NULL DEFAULT 1200.0,
                                xp INTEGER NOT NULL DEFAULT 0,
                                coins INTEGER NOT NULL DEFAULT 1000,
                                stars_spent INTEGER NOT NULL DEFAULT 0,
                                wins INTEGER NOT NULL DEFAULT 0,
                                losses INTEGER NOT NULL DEFAULT 0,
                                draws INTEGER NOT NULL DEFAULT 0,
                                updated_at REAL NOT NULL
                            );

                            CREATE TABLE IF NOT EXISTS game_ratings (
                                user_id TEXT NOT NULL,
                                game_type TEXT NOT NULL,
                                elo REAL NOT NULL DEFAULT 1200.0,
                                wins INTEGER NOT NULL DEFAULT 0,
                                losses INTEGER NOT NULL DEFAULT 0,
                                draws INTEGER NOT NULL DEFAULT 0,
                                updated_at REAL NOT NULL,
                                PRIMARY KEY (user_id, game_type)
                            );

                            CREATE TABLE IF NOT EXISTS match_history (
                                id SERIAL PRIMARY KEY,
                                match_id TEXT NOT NULL,
                                game_type TEXT NOT NULL,
                                mode TEXT NOT NULL,
                                player1_id TEXT NOT NULL,
                                player1_name TEXT NOT NULL,
                                player2_id TEXT NOT NULL,
                                player2_name TEXT NOT NULL,
                                winner_id TEXT,
                                reason TEXT NOT NULL DEFAULT '',
                                p1_elo_delta REAL NOT NULL DEFAULT 0.0,
                                p2_elo_delta REAL NOT NULL DEFAULT 0.0,
                                created_at REAL NOT NULL
                            );

                            CREATE TABLE IF NOT EXISTS matches (
                                match_id TEXT PRIMARY KEY,
                                game_type TEXT NOT NULL,
                                mode TEXT NOT NULL,
                                status TEXT NOT NULL,
                                state_json TEXT NOT NULL,
                                winner_id TEXT,
                                result_recorded INTEGER NOT NULL DEFAULT 0,
                                created_at REAL NOT NULL,
                                updated_at REAL NOT NULL
                            );

                            CREATE TABLE IF NOT EXISTS custom_games (
                                id SERIAL PRIMARY KEY,
                                title TEXT NOT NULL,
                                url TEXT NOT NULL,
                                icon TEXT NOT NULL DEFAULT '🎮',
                                description TEXT NOT NULL DEFAULT '',
                                image_url TEXT NOT NULL DEFAULT '',
                                is_active INTEGER NOT NULL DEFAULT 1,
                                created_at REAL NOT NULL
                            );

                            CREATE TABLE IF NOT EXISTS star_payments (
                                id SERIAL PRIMARY KEY,
                                user_id TEXT NOT NULL,
                                charge_id TEXT NOT NULL,
                                stars_amount INTEGER NOT NULL,
                                coins_credited INTEGER NOT NULL,
                                pack_id TEXT NOT NULL DEFAULT '',
                                created_at REAL NOT NULL
                            );

                            CREATE TABLE IF NOT EXISTS app_settings (
                                key TEXT PRIMARY KEY,
                                value TEXT NOT NULL,
                                updated_at REAL NOT NULL
                            );

                            CREATE TABLE IF NOT EXISTS pending_deposits (
                                id SERIAL PRIMARY KEY,
                                user_id TEXT NOT NULL,
                                username TEXT NOT NULL DEFAULT '',
                                method TEXT NOT NULL DEFAULT 'upi',
                                pack_id TEXT NOT NULL,
                                amount REAL NOT NULL,
                                currency TEXT NOT NULL DEFAULT 'INR',
                                coins_to_credit INTEGER NOT NULL,
                                utr_ref TEXT NOT NULL,
                                status TEXT NOT NULL DEFAULT 'pending',
                                admin_id TEXT NOT NULL DEFAULT '',
                                created_at REAL NOT NULL,
                                updated_at REAL NOT NULL
                            );
                            """
                        )
                        count = conn.execute("SELECT COUNT(*) AS c FROM custom_games").fetchone()["c"]
                        if count == 0:
                            self._seed_default_custom_games(conn)
                        else:
                            self._sync_games(conn)
                        conn.commit()
                        return
                except Exception as e:
                    logger.warning("Failed to initialize PostgreSQL schema (%s). Falling back to SQLite.", e)
                    self._use_postgres = False

            with self._connect() as conn:
                conn.executescript(
                    """
                    PRAGMA journal_mode=WAL;
                    PRAGMA busy_timeout=5000;

                    CREATE TABLE IF NOT EXISTS players (
                        user_id TEXT PRIMARY KEY,
                        username TEXT NOT NULL DEFAULT '',
                        display_name TEXT NOT NULL DEFAULT 'Player',
                        elo REAL NOT NULL DEFAULT 1200.0,
                        xp INTEGER NOT NULL DEFAULT 0,
                        wins INTEGER NOT NULL DEFAULT 0,
                        losses INTEGER NOT NULL DEFAULT 0,
                        draws INTEGER NOT NULL DEFAULT 0,
                        updated_at REAL NOT NULL
                    );

                CREATE TABLE IF NOT EXISTS game_ratings (
                    user_id TEXT NOT NULL,
                    game_type TEXT NOT NULL,
                    elo REAL NOT NULL DEFAULT 1200.0,
                    wins INTEGER NOT NULL DEFAULT 0,
                    losses INTEGER NOT NULL DEFAULT 0,
                    draws INTEGER NOT NULL DEFAULT 0,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (user_id, game_type)
                );

                CREATE TABLE IF NOT EXISTS match_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    match_id TEXT NOT NULL,
                    game_type TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    player1_id TEXT NOT NULL,
                    player1_name TEXT NOT NULL,
                    player2_id TEXT NOT NULL,
                    player2_name TEXT NOT NULL,
                    winner_id TEXT,
                    reason TEXT NOT NULL DEFAULT '',
                    p1_elo_delta REAL NOT NULL DEFAULT 0.0,
                    p2_elo_delta REAL NOT NULL DEFAULT 0.0,
                    created_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS matches (
                    match_id TEXT PRIMARY KEY,
                    game_type TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    status TEXT NOT NULL,
                    state_json TEXT NOT NULL,
                    winner_id TEXT,
                    result_recorded INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS custom_games (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    icon TEXT NOT NULL DEFAULT '🎮',
                    description TEXT NOT NULL DEFAULT '',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS star_payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    charge_id TEXT NOT NULL,
                    stars_amount INTEGER NOT NULL,
                    coins_credited INTEGER NOT NULL,
                    pack_id TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS pending_deposits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    username TEXT NOT NULL DEFAULT '',
                    method TEXT NOT NULL DEFAULT 'upi',
                    pack_id TEXT NOT NULL,
                    amount REAL NOT NULL,
                    currency TEXT NOT NULL DEFAULT 'INR',
                    coins_to_credit INTEGER NOT NULL,
                    utr_ref TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    admin_id TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                """
            )
            cols = {
                r["name"] for r in conn.execute("PRAGMA table_info(players)").fetchall()
            }
            if "xp" not in cols:
                conn.execute("ALTER TABLE players ADD COLUMN xp INTEGER NOT NULL DEFAULT 0")
            if "coins" not in cols:
                conn.execute("ALTER TABLE players ADD COLUMN coins INTEGER NOT NULL DEFAULT 1000")
            if "stars_spent" not in cols:
                conn.execute("ALTER TABLE players ADD COLUMN stars_spent INTEGER NOT NULL DEFAULT 0")

            cg_cols = {
                r["name"] for r in conn.execute("PRAGMA table_info(custom_games)").fetchall()
            }
            if "image_url" not in cg_cols:
                conn.execute("ALTER TABLE custom_games ADD COLUMN image_url TEXT NOT NULL DEFAULT ''")

            count = conn.execute("SELECT COUNT(*) AS c FROM custom_games").fetchone()["c"]
            if count == 0:
                self._seed_default_custom_games(conn)
            else:
                self._sync_games(conn)

            conn.commit()

    def _sync_games(self, conn: sqlite3.Connection) -> None:
        now = time.time()
        for entry in DEFAULT_HTML5_GAMES:
            title, url, icon, desc = entry[0], entry[1], entry[2], entry[3]
            img = entry[4] if len(entry) > 4 else ""
            row = conn.execute("SELECT id, image_url FROM custom_games WHERE title = ? OR url = ?", (title, url)).fetchone()
            if row:
                current_img = row["image_url"] if (row["image_url"] and row["image_url"].strip()) else img
                conn.execute(
                    "UPDATE custom_games SET url = ?, icon = ?, description = ?, image_url = ? WHERE id = ?",
                    (url, icon, desc, current_img, row["id"]),
                )
            else:
                conn.execute(
                    "INSERT INTO custom_games (title, url, icon, description, image_url, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
                    (title, url, icon, desc, img, now),
                )
        broken = ["helixjump2", "canvaspool", "cardgames.io", "funhtml5games", "fruitninjafree", "monkeytype", "playtictactoe", "playsnake", "orteil.dashnet"]
        for b in broken:
            conn.execute("DELETE FROM custom_games WHERE url LIKE ?", (f"%{b}%",))

    def _seed_default_custom_games(self, conn: sqlite3.Connection) -> None:
        now = time.time()
        for entry in DEFAULT_HTML5_GAMES:
            title, url, icon, desc = entry[0], entry[1], entry[2], entry[3]
            img = entry[4] if len(entry) > 4 else ""
            conn.execute(
                """
                INSERT INTO custom_games (title, url, icon, description, image_url, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                """,
                (title, url, icon, desc, img, now),
            )

    def _enrich_player(self, conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        lvl, xp_in, xp_need = compute_level(int(data.get("xp", 0)))
        data["level"] = lvl
        data["xp_progress"] = xp_in
        data["xp_next"] = xp_need
        data["tier"] = get_rank_tier(float(data["elo"]))
        data["coins"] = int(data.get("coins", 1000) if data.get("coins") is not None else 1000)
        data["stars_spent"] = int(data.get("stars_spent", 0) if data.get("stars_spent") is not None else 0)
        ratings = conn.execute(
            "SELECT game_type, elo, wins, losses, draws FROM game_ratings WHERE user_id = ?",
            (data["user_id"],),
        ).fetchall()
        data["game_ratings"] = {
            r["game_type"]: {
                **dict(r),
                "tier": get_rank_tier(float(r["elo"])),
            }
            for r in ratings
        }
        return data

    def upsert_player(
        self,
        user_id: int | str,
        display_name: str,
        username: str = "",
    ) -> dict[str, Any]:
        uid = str(user_id)
        now = time.time()
        clean_name = (display_name or "Player").strip()[:48] or "Player"
        clean_user = (username or "").strip().lstrip("@")[:48]
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO players (user_id, username, display_name, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    username = CASE WHEN excluded.username != '' THEN excluded.username ELSE players.username END,
                    display_name = excluded.display_name,
                    updated_at = excluded.updated_at
                """,
                (uid, clean_user, clean_name, now),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM players WHERE user_id = ?", (uid,)
            ).fetchone()
            return self._enrich_player(conn, row)

    def get_player(self, user_id: int | str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM players WHERE user_id = ?", (str(user_id),)
            ).fetchone()
            return self._enrich_player(conn, row) if row else None

    def add_player_coins(self, user_id: int | str, amount: int) -> int:
        uid = str(user_id)
        now = time.time()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO players (user_id, updated_at, coins)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    coins = MAX(0, players.coins + ?),
                    updated_at = ?
                """,
                (uid, now, max(0, 1000 + amount), amount, now),
            )
            conn.commit()
            row = conn.execute("SELECT coins FROM players WHERE user_id = ?", (uid,)).fetchone()
            return int(row["coins"]) if row and row["coins"] is not None else 1000

    def get_player_coins(self, user_id: int | str) -> int:
        uid = str(user_id)
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT coins FROM players WHERE user_id = ?", (uid,)).fetchone()
            if row and row["coins"] is not None:
                return int(row["coins"])
            return 1000

    def record_star_payment(
        self,
        user_id: int | str,
        charge_id: str,
        stars_amount: int,
        coins_credited: int,
        pack_id: str = "",
    ) -> dict[str, Any]:
        uid = str(user_id)
        now = time.time()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO star_payments (user_id, charge_id, stars_amount, coins_credited, pack_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (uid, charge_id, stars_amount, coins_credited, pack_id, now),
            )
            conn.execute(
                """
                UPDATE players
                SET coins = coins + ?,
                    stars_spent = stars_spent + ?,
                    updated_at = ?
                WHERE user_id = ?
                """,
                (coins_credited, stars_amount, now, uid),
            )
            conn.commit()
            row = conn.execute("SELECT coins, stars_spent FROM players WHERE user_id = ?", (uid,)).fetchone()
            new_coins = int(row["coins"]) if row and row["coins"] is not None else coins_credited
            return {
                "user_id": uid,
                "charge_id": charge_id,
                "stars_amount": stars_amount,
                "coins_credited": coins_credited,
                "pack_id": pack_id,
                "new_coins": new_coins,
                "created_at": now,
            }

    def get_setting(self, key: str, default: str = "") -> str:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
            return str(row["value"]) if row else default

    def set_setting(self, key: str, value: str) -> None:
        now = time.time()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, str(value), now),
            )
            conn.commit()

    def create_pending_deposit(
        self,
        user_id: int | str,
        username: str,
        method: str,
        pack_id: str,
        amount: float,
        currency: str,
        coins_to_credit: int,
        utr_ref: str,
    ) -> int:
        now = time.time()
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO pending_deposits (
                    user_id, username, method, pack_id, amount, currency, coins_to_credit, utr_ref, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
                """,
                (str(user_id), username, method, pack_id, amount, currency, coins_to_credit, utr_ref.strip(), now, now),
            )
            conn.commit()
            return int(cur.lastrowid)

    def get_pending_deposit(self, deposit_id: int) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM pending_deposits WHERE id = ?", (deposit_id,)).fetchone()
            return dict(row) if row else None

    def list_pending_deposits(self, status: str = "pending", limit: int = 20) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM pending_deposits WHERE status = ? ORDER BY id DESC LIMIT ?",
                (status, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def resolve_pending_deposit(self, deposit_id: int, status: str, admin_id: str = "") -> dict[str, Any] | None:
        now = time.time()
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM pending_deposits WHERE id = ?", (deposit_id,)).fetchone()
            if not row:
                return None
            dep = dict(row)
            if dep["status"] != "pending":
                return dep

            conn.execute(
                "UPDATE pending_deposits SET status = ?, admin_id = ?, updated_at = ? WHERE id = ?",
                (status, str(admin_id), now, deposit_id),
            )
            if status == "approved":
                conn.execute(
                    """
                    INSERT INTO players (user_id, updated_at, coins)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        coins = players.coins + ?,
                        updated_at = ?
                    """,
                    (dep["user_id"], now, 1000 + dep["coins_to_credit"], dep["coins_to_credit"], now),
                )
            conn.commit()
            updated_row = conn.execute("SELECT * FROM pending_deposits WHERE id = ?", (deposit_id,)).fetchone()
            return dict(updated_row) if updated_row else None

    def get_game_elo(self, user_id: int | str, game_type: str) -> float:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT elo FROM game_ratings WHERE user_id = ? AND game_type = ?",
                (str(user_id), game_type),
            ).fetchone()
            return float(row["elo"]) if row else 1200.0

    def list_all_player_ids(self) -> list[str]:
        with self._lock, self._connect() as conn:
            rows = conn.execute("SELECT user_id FROM players").fetchall()
            return [str(r["user_id"]) for r in rows if str(r["user_id"]).isdigit()]

    def award_xp(self, user_id: int | str, amount: int) -> dict[str, Any] | None:
        uid = str(user_id)
        now = time.time()
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE players SET xp = xp + ?, updated_at = ? WHERE user_id = ?",
                (max(0, int(amount)), now, uid),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM players WHERE user_id = ?", (uid,)).fetchone()
            return self._enrich_player(conn, row) if row else None

    def create_match(
        self,
        game_type: str,
        state: dict[str, Any],
        mode: str = "chat",
        status: str = "active",
        match_id: str | None = None,
    ) -> str:
        mid = match_id or secrets.token_hex(4)
        now = time.time()
        payload = json.dumps(state)
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO matches (match_id, game_type, mode, status, state_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (mid, game_type, mode, status, payload, now, now),
            )
            conn.commit()
        return mid

    def get_match(self, match_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM matches WHERE match_id = ?", (match_id,)
            ).fetchone()
            if not row:
                return None
            record = dict(row)
            record["state"] = json.loads(record.pop("state_json"))
            return record

    def save_match(
        self,
        match_id: str,
        state: dict[str, Any],
        status: str | None = None,
        winner_id: int | str | None = None,
    ) -> None:
        now = time.time()
        payload = json.dumps(state)
        with self._lock, self._connect() as conn:
            if status is None:
                conn.execute(
                    """
                    UPDATE matches
                    SET state_json = ?, winner_id = ?, updated_at = ?
                    WHERE match_id = ?
                    """,
                    (payload, str(winner_id) if winner_id is not None else None, now, match_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE matches
                    SET state_json = ?, status = ?, winner_id = ?, updated_at = ?
                    WHERE match_id = ?
                    """,
                    (payload, status, str(winner_id) if winner_id is not None else None, now, match_id),
                )
            conn.commit()

    def record_two_player_result(
        self,
        match_id: str,
        player1_id: int | str,
        player2_id: int | str,
        winner_id: int | str | None,
        game_type: str | None = None,
        mode: str = "chat",
        reason: str = "",
    ) -> dict[str, Any] | None:
        """Update per-game ELO, global ELO, XP, W/L/D counters, and match history once per match."""
        p1 = str(player1_id)
        p2 = str(player2_id)
        if p1 == p2 or p1.startswith("ai_") or p2.startswith("ai_"):
            return None

        with self._lock, self._connect() as conn:
            match_row = conn.execute(
                "SELECT game_type, mode, result_recorded FROM matches WHERE match_id = ?",
                (match_id,),
            ).fetchone()
            if match_row and match_row["result_recorded"]:
                return None

            resolved_game = game_type or (match_row["game_type"] if match_row else "general")
            resolved_mode = match_row["mode"] if match_row else mode

            row1 = conn.execute("SELECT * FROM players WHERE user_id = ?", (p1,)).fetchone()
            row2 = conn.execute("SELECT * FROM players WHERE user_id = ?", (p2,)).fetchone()
            if not row1 or not row2:
                return None

            now = time.time()
            # Ensure per-game rating rows exist
            for uid in (p1, p2):
                conn.execute(
                    """
                    INSERT OR IGNORE INTO game_ratings (user_id, game_type, elo, wins, losses, draws, updated_at)
                    VALUES (?, ?, 1200.0, 0, 0, 0, ?)
                    """,
                    (uid, resolved_game, now),
                )

            gr1 = conn.execute(
                "SELECT elo FROM game_ratings WHERE user_id = ? AND game_type = ?",
                (p1, resolved_game),
            ).fetchone()
            gr2 = conn.execute(
                "SELECT elo FROM game_ratings WHERE user_id = ? AND game_type = ?",
                (p2, resolved_game),
            ).fetchone()

            r1_game = float(gr1["elo"])
            r2_game = float(gr2["elo"])
            r1_global = float(row1["elo"])
            r2_global = float(row2["elo"])

            def _calc_elo(ra: float, rb: float, sa: float, sb: float) -> tuple[float, float]:
                ea = 1.0 / (1.0 + 10.0 ** ((rb - ra) / 400.0))
                eb = 1.0 - ea
                k = 32.0
                return round(ra + k * (sa - ea), 1), round(rb + k * (sb - eb), 1)

            if winner_id is None:
                s1, s2 = 0.5, 0.5
                w1, l1, d1 = 0, 0, 1
                w2, l2, d2 = 0, 0, 1
                xp1, xp2 = 25, 25
            elif str(winner_id) == p1:
                s1, s2 = 1.0, 0.0
                w1, l1, d1 = 1, 0, 0
                w2, l2, d2 = 0, 1, 0
                xp1, xp2 = 50, 15
            else:
                s1, s2 = 0.0, 1.0
                w1, l1, d1 = 0, 1, 0
                w2, l2, d2 = 1, 0, 0
                xp1, xp2 = 15, 50

            new_r1_game, new_r2_game = _calc_elo(r1_game, r2_game, s1, s2)
            new_r1_global, new_r2_global = _calc_elo(r1_global, r2_global, s1, s2)

            conn.execute(
                """
                UPDATE game_ratings
                SET elo = ?, wins = wins + ?, losses = losses + ?, draws = draws + ?, updated_at = ?
                WHERE user_id = ? AND game_type = ?
                """,
                (new_r1_game, w1, l1, d1, now, p1, resolved_game),
            )
            conn.execute(
                """
                UPDATE game_ratings
                SET elo = ?, wins = wins + ?, losses = losses + ?, draws = draws + ?, updated_at = ?
                WHERE user_id = ? AND game_type = ?
                """,
                (new_r2_game, w2, l2, d2, now, p2, resolved_game),
            )

            conn.execute(
                """
                UPDATE players
                SET elo = ?, xp = xp + ?, wins = wins + ?, losses = losses + ?, draws = draws + ?, updated_at = ?
                WHERE user_id = ?
                """,
                (new_r1_global, xp1, w1, l1, d1, now, p1),
            )
            conn.execute(
                """
                UPDATE players
                SET elo = ?, xp = xp + ?, wins = wins + ?, losses = losses + ?, draws = draws + ?, updated_at = ?
                WHERE user_id = ?
                """,
                (new_r2_global, xp2, w2, l2, d2, now, p2),
            )

            conn.execute(
                """
                INSERT INTO match_history (
                    match_id, game_type, mode, player1_id, player1_name,
                    player2_id, player2_name, winner_id, reason,
                    p1_elo_delta, p2_elo_delta, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    match_id,
                    resolved_game,
                    resolved_mode,
                    p1,
                    row1["display_name"],
                    p2,
                    row2["display_name"],
                    str(winner_id) if winner_id is not None else None,
                    reason,
                    round(new_r1_game - r1_game, 1),
                    round(new_r2_game - r2_game, 1),
                    now,
                ),
            )

            if match_row:
                conn.execute(
                    "UPDATE matches SET result_recorded = 1, updated_at = ? WHERE match_id = ?",
                    (now, match_id),
                )
            conn.commit()
            return {
                p1: {
                    "old_elo": r1_game,
                    "new_elo": new_r1_game,
                    "delta": round(new_r1_game - r1_game, 1),
                    "xp_gained": xp1,
                },
                p2: {
                    "old_elo": r2_game,
                    "new_elo": new_r2_game,
                    "delta": round(new_r2_game - r2_game, 1),
                    "xp_gained": xp2,
                },
            }

    def get_leaderboard(self, limit: int = 10, game_type: str | None = None) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            if game_type and game_type != "overall":
                rows = conn.execute(
                    """
                    SELECT p.user_id, p.username, p.display_name, p.xp,
                           gr.elo, gr.wins, gr.losses, gr.draws
                    FROM game_ratings gr
                    JOIN players p ON p.user_id = gr.user_id
                    WHERE gr.game_type = ? AND (gr.wins + gr.losses + gr.draws) > 0
                    ORDER BY gr.elo DESC, gr.wins DESC
                    LIMIT ?
                    """,
                    (game_type, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT user_id, username, display_name, elo, xp, wins, losses, draws
                    FROM players
                    WHERE (wins + losses + draws) > 0
                    ORDER BY elo DESC, wins DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()

            result = []
            for r in rows:
                item = dict(r)
                lvl, _, _ = compute_level(int(item.get("xp", 0)))
                item["level"] = lvl
                item["tier"] = get_rank_tier(float(item["elo"]))
                result.append(item)
            return result

    def get_match_history(self, user_id: int | str, limit: int = 15) -> list[dict[str, Any]]:
        uid = str(user_id)
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM match_history
                WHERE player1_id = ? OR player2_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (uid, uid, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def add_custom_game(
        self,
        title: str,
        url: str,
        icon: str = "🎮",
        description: str = "",
        image_url: str = "",
    ) -> dict[str, Any]:
        now = time.time()
        clean_title = (title or "Custom Game").strip()[:64]
        clean_url = (url or "").strip()
        clean_icon = (icon or "🎮").strip()[:8]
        clean_desc = (description or "").strip()[:200]
        clean_img = (image_url or "").strip()
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO custom_games (title, url, icon, description, image_url, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                """,
                (clean_title, clean_url, clean_icon, clean_desc, clean_img, now),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM custom_games WHERE id = ?", (cur.lastrowid,)).fetchone()
            return dict(row)

    def list_custom_games(self, only_active: bool = True) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            query = "SELECT * FROM custom_games"
            if only_active:
                query += " WHERE is_active = 1"
            query += " ORDER BY id DESC"
            rows = conn.execute(query).fetchall()
            if not rows:
                self._seed_default_custom_games(conn)
                conn.commit()
                rows = conn.execute(query).fetchall()
            return [dict(r) for r in rows]

    def delete_custom_game(self, game_id: int | str) -> bool:
        with self._lock, self._connect() as conn:
            cur = conn.execute("DELETE FROM custom_games WHERE id = ?", (int(game_id),))
            conn.commit()
            return cur.rowcount > 0

    def get_custom_game(self, game_id: int | str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM custom_games WHERE id = ?", (int(game_id),)).fetchone()
            return dict(row) if row else None


storage = GameStorage()
