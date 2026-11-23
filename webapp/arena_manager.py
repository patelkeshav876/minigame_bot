"""Real-time multiplayer room manager, matchmaking, AI practice, spectators, and clocks."""

from __future__ import annotations

import asyncio
import os
import random
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

import chess
from fastapi import WebSocket

from core.storage import GameStorage
from webapp.ai import (
    pick_chess_move,
    pick_connect4_move,
    pick_othello_move,
    pick_tictactoe_move,
)

VALID_GAMES = {"chess", "othello", "connect4", "tictactoe", "knife_hit", "fruit_slice", "sheep_fight", "virus_breaker"}
INITIAL_CLOCKS = {
    "chess": 180.0,        # 3:00 blitz
    "othello": 120.0,      # 2:00 blitz
    "connect4": 90.0,      # 1:30 bank
    "tictactoe": 45.0,     # 0:45 speed blitz
    "knife_hit": 180.0,    # 3:00 tournament round
    "fruit_slice": 180.0,  # 3:00 tournament round
    "sheep_fight": 90.0,   # 1:30 battle round
    "virus_breaker": 180.0,# 3:00 blaster survival duel
}
OTHELLO_DIRS = [
    (-1, -1), (-1, 0), (-1, 1),
    (0, -1),           (0, 1),
    (1, -1),  (1, 0),  (1, 1),
]


@dataclass
class ArenaPlayer:
    user_id: str
    name: str
    elo: float = 1200.0
    wins: int = 0
    role: str = ""  # chess: w/b, othello: B/W, connect4: R/Y, tictactoe: X/O
    clock: float = 180.0
    is_ai: bool = False
    ws: WebSocket | None = None


@dataclass
class ArenaRoom:
    room_id: str
    game_type: str
    is_public: bool = False
    vs_ai: bool = False
    status: str = "waiting"  # waiting | active | finished
    players: list[ArenaPlayer] = field(default_factory=list)
    spectators: list[WebSocket] = field(default_factory=list)
    state: dict[str, Any] = field(default_factory=dict)
    turn_role: str = ""
    winner_role: str | None = None
    reason: str | None = None
    last_tick: float = field(default_factory=time.monotonic)
    created_at: float = field(default_factory=time.time)
    match_recorded: bool = False


def _init_othello_board() -> list[list[str]]:
    b = [["" for _ in range(8)] for _ in range(8)]
    b[3][3] = "W"
    b[3][4] = "B"
    b[4][3] = "B"
    b[4][4] = "W"
    return b


def othello_flips(board: list[list[str]], r: int, c: int, token: str) -> list[tuple[int, int]]:
    if board[r][c] != "":
        return []
    opp = "W" if token == "B" else "B"
    flips: list[tuple[int, int]] = []
    for dr, dc in OTHELLO_DIRS:
        nr, nc = r + dr, c + dc
        line: list[tuple[int, int]] = []
        while 0 <= nr < 8 and 0 <= nc < 8 and board[nr][nc] == opp:
            line.append((nr, nc))
            nr += dr
            nc += dc
        if line and 0 <= nr < 8 and 0 <= nc < 8 and board[nr][nc] == token:
            flips.extend(line)
    return flips


def othello_legal_moves(board: list[list[str]], token: str) -> list[tuple[int, int]]:
    return [
        (r, c)
        for r in range(8)
        for c in range(8)
        if board[r][c] == "" and othello_flips(board, r, c, token)
    ]


class ArenaManager:
    """Manages live WebSocket battle rooms, spectators, clocks, AI, and ELO updates."""

    def __init__(self, storage: GameStorage) -> None:
        self.storage = storage
        self.rooms: dict[str, ArenaRoom] = {}
        self._raw_lock: asyncio.Lock | None = None
        self._clock_task: asyncio.Task[None] | None = None

    @property
    def _lock(self) -> asyncio.Lock:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if self._raw_lock is None or getattr(self._raw_lock, "_loop", None) is not loop:
            self._raw_lock = asyncio.Lock()
        return self._raw_lock

    def start_background_tasks(self) -> None:
        if os.getenv("TESTING") == "1":
            return
        if self._clock_task is None or self._clock_task.done():
            self._clock_task = asyncio.create_task(self._clock_loop())

    async def stop_background_tasks(self) -> None:
        if self._clock_task and not self._clock_task.done():
            self._clock_task.cancel()
            try:
                await self._clock_task
            except asyncio.CancelledError:
                pass

    async def stop(self) -> None:
        await self.stop_background_tasks()

    def _init_game_state(self, game_type: str) -> tuple[dict[str, Any], str]:
        if game_type == "chess":
            return {"fen": chess.STARTING_FEN, "last_move": None, "last_squares": []}, "w"
        if game_type == "othello":
            return {"board": _init_othello_board(), "last_move": None}, "B"
        if game_type == "connect4":
            return {"board": [["" for _ in range(7)] for _ in range(6)], "last_col": None}, "R"
        if game_type in ("knife_hit", "fruit_slice", "sheep_fight", "virus_breaker"):
            return {
                "p1_score": 0, "p2_score": 0,
                "p1_level": 1, "p2_level": 1,
                "p1_status": "playing", "p2_status": "playing"
            }, "P1"
        return {"board": [""] * 9}, "X"

    def _roles_for(self, game_type: str) -> tuple[str, str]:
        if game_type == "chess":
            return ("w", "b")
        if game_type == "othello":
            return ("B", "W")
        if game_type == "connect4":
            return ("R", "Y")
        if game_type in ("knife_hit", "fruit_slice", "sheep_fight", "virus_breaker"):
            return ("P1", "P2")
        return ("X", "O")

    async def create_or_join_room(
        self,
        game_type: str,
        user_id: str,
        name: str,
        room_id: str | None = None,
        is_public: bool = False,
        vs_ai: bool = False,
    ) -> ArenaRoom:
        if game_type not in VALID_GAMES:
            game_type = "chess"

        self.storage.upsert_player(user_id, name)
        elo = self.storage.get_game_elo(user_id, game_type)
        wins = self.storage.get_game_wins(user_id, game_type)

        async with self._lock:
            if room_id and not vs_ai:
                clean_id = room_id.upper().strip()
                room = self.rooms.get(clean_id)
                if room:
                    return self._attach_player(room, user_id, name, elo, wins=wins)
            else:
                clean_id = secrets.token_hex(3).upper()

            state, first_role = self._init_game_state(game_type)
            room = ArenaRoom(
                room_id=clean_id,
                game_type=game_type,
                is_public=is_public,
                vs_ai=vs_ai,
                status="waiting",
                state=state,
                turn_role=first_role,
            )
            self.rooms[clean_id] = room
            self._attach_player(room, user_id, name, elo, wins=wins)
            if vs_ai:
                roles = self._roles_for(game_type)
                room.players.append(
                    ArenaPlayer(
                        user_id=f"ai_{game_type}",
                        name="🤖 Arena AI",
                        elo=1200.0,
                        role=roles[1],
                        clock=INITIAL_CLOCKS[game_type],
                        is_ai=True,
                    )
                )
                room.status = "active"
                room.last_tick = time.monotonic()
            return room

    async def quick_match(self, game_type: str, user_id: str, name: str) -> ArenaRoom:
        if game_type not in VALID_GAMES:
            game_type = "chess"

        self.storage.upsert_player(user_id, name)
        elo = self.storage.get_game_elo(user_id, game_type)
        wins = self.storage.get_game_wins(user_id, game_type)

        async with self._lock:
            for room in self.rooms.values():
                if (
                    room.is_public
                    and not room.vs_ai
                    and room.game_type == game_type
                    and room.status == "waiting"
                    and len(room.players) == 1
                    and room.players[0].user_id != user_id
                ):
                    return self._attach_player(room, user_id, name, elo, wins=wins)

            room_id = secrets.token_hex(3).upper()
            state, first_role = self._init_game_state(game_type)
            room = ArenaRoom(
                room_id=room_id,
                game_type=game_type,
                is_public=True,
                status="waiting",
                state=state,
                turn_role=first_role,
            )
            self.rooms[room_id] = room
            return self._attach_player(room, user_id, name, elo, wins=wins)

    def _attach_player(self, room: ArenaRoom, user_id: str, name: str, elo: float, wins: int = 0) -> ArenaRoom:
        for p in room.players:
            if p.user_id == user_id:
                p.name = name
                p.elo = elo
                p.wins = wins
                return room

        if len(room.players) >= 2:
            # Room already has 2 players; caller will join as spectator on WS connect
            return room

        roles = self._roles_for(room.game_type)
        role = roles[len(room.players)]
        room.players.append(
            ArenaPlayer(
                user_id=user_id,
                name=name,
                elo=elo,
                wins=wins,
                role=role,
                clock=INITIAL_CLOCKS[room.game_type],
            )
        )
        if len(room.players) == 2 and room.status == "waiting":
            room.status = "active"
            room.last_tick = time.monotonic()
        return room

    def list_live_rooms(self) -> list[dict[str, Any]]:
        out = []
        for room in self.rooms.values():
            if room.status == "active" and not room.vs_ai:
                out.append(
                    {
                        "room_id": room.room_id,
                        "game_type": room.game_type,
                        "players": [p.name for p in room.players],
                        "spectators": len(room.spectators),
                    }
                )
        return out[:20]

    def serialize_room(self, room: ArenaRoom) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "room_id": room.room_id,
            "game_type": room.game_type,
            "vs_ai": room.vs_ai,
            "status": room.status,
            "turn_role": room.turn_role,
            "winner_role": room.winner_role,
            "reason": room.reason,
            "state": room.state,
            "spectators": len(room.spectators),
            "players": [
                {
                    "user_id": p.user_id,
                    "name": p.name,
                    "elo": round(p.elo),
                    "wins": getattr(p, "wins", 0),
                    "role": p.role,
                    "clock": round(max(0.0, p.clock), 1),
                    "is_ai": p.is_ai,
                    "connected": p.is_ai or (p.ws is not None),
                }
                for p in room.players
            ],
        }
        if room.game_type == "chess":
            board = chess.Board(room.state["fen"])
            payload["legal_moves"] = (
                [m.uci() for m in board.legal_moves] if room.status == "active" else []
            )
            payload["in_check"] = board.is_check()
        elif room.game_type == "othello":
            board = room.state["board"]
            payload["legal_moves"] = (
                othello_legal_moves(board, room.turn_role)
                if room.status == "active"
                else []
            )
            payload["counts"] = {
                "B": sum(cell == "B" for row in board for cell in row),
                "W": sum(cell == "W" for row in board for cell in row),
            }
        return payload

    async def connect_ws(self, room_id: str, user_id: str, name: str, ws: WebSocket) -> ArenaRoom | None:
        await ws.accept()
        async with self._lock:
            room = self.rooms.get(room_id.upper())
            if not room:
                await ws.send_json({"type": "error", "message": "Room not found."})
                await ws.close()
                return None

            self.storage.upsert_player(user_id, name)
            elo = self.storage.get_game_elo(user_id, room.game_type)
            wins = self.storage.get_game_wins(user_id, room.game_type)
            self._attach_player(room, user_id, name, elo, wins=wins)
            player = next((p for p in room.players if p.user_id == user_id), None)
            if player:
                player.ws = ws
            else:
                room.spectators.append(ws)

        await self.broadcast_room(room)
        return room

    async def disconnect_ws(self, room: ArenaRoom, user_id: str, ws: WebSocket) -> None:
        async with self._lock:
            for p in room.players:
                if p.user_id == user_id and p.ws is ws:
                    p.ws = None
            if ws in room.spectators:
                room.spectators.remove(ws)
        await self.broadcast_room(room)

    async def broadcast_room(self, room: ArenaRoom) -> None:
        snapshot = {"type": "state", "room": self.serialize_room(room)}
        for p in list(room.players):
            if p.ws is not None:
                try:
                    await p.ws.send_json(snapshot)
                except Exception:
                    p.ws = None
        for spec_ws in list(room.spectators):
            try:
                await spec_ws.send_json(snapshot)
            except Exception:
                if spec_ws in room.spectators:
                    room.spectators.remove(spec_ws)

    def _update_clock(self, room: ArenaRoom) -> bool:
        if room.status != "active" or len(room.players) < 2:
            return False
        now = time.monotonic()
        elapsed = now - room.last_tick
        room.last_tick = now

        if room.game_type in ("knife_hit", "fruit_slice", "sheep_fight", "virus_breaker"):
            for p in room.players:
                p.clock = max(0.0, p.clock - elapsed)
            if room.players[0].clock <= 0.0:
                p1_s = room.state.get("p1_score", 0)
                p2_s = room.state.get("p2_score", 0)
                winner = "P1" if p1_s > p2_s else ("P2" if p2_s > p1_s else "Draw")
                self._finish_room(room, winner, f"Time Expired! Score: {p1_s} vs {p2_s}")
                return True
            return False

        for p in room.players:
            if p.role == room.turn_role:
                if p.is_ai:
                    return False
                p.clock = max(0.0, p.clock - elapsed)
                if p.clock <= 0.0:
                    other = next(op for op in room.players if op.role != p.role)
                    self._finish_room(room, other.role, f"{p.name} ran out of time")
                    return True
        return False

    def _finish_room(self, room: ArenaRoom, winner_role: str | None, reason: str) -> None:
        room.status = "finished"
        room.winner_role = winner_role or "Draw"
        room.reason = reason

        if not room.match_recorded and len(room.players) == 2:
            room.match_recorded = True
            p1, p2 = room.players[0], room.players[1]
            if room.vs_ai:
                human = next((p for p in room.players if not p.is_ai), None)
                if human:
                    xp = 25 if winner_role == human.role else 10
                    self.storage.award_xp(human.user_id, xp)
                return

            winner_id = None
            if winner_role and winner_role != "Draw":
                win_p = next((p for p in room.players if p.role == winner_role), None)
                winner_id = win_p.user_id if win_p else None
            match_key = f"arena_{room.room_id}_{int(room.created_at)}"
            self.storage.create_match(
                room.game_type,
                room.state,
                mode="arena",
                status="finished",
                match_id=match_key,
            )
            elo_res = self.storage.record_two_player_result(
                match_key,
                p1.user_id,
                p2.user_id,
                winner_id,
                game_type=room.game_type,
                mode="arena",
                reason=reason,
            )
            if elo_res:
                for p in room.players:
                    if p.user_id in elo_res:
                        p.elo = elo_res[p.user_id]["new_elo"]

    async def handle_ws_message(self, room: ArenaRoom, user_id: str, data: dict[str, Any]) -> None:
        msg_type = data.get("type")
        is_player = any(p.user_id == user_id for p in room.players)
        if not is_player:
            return

        ai_should_move = False
        async with self._lock:
            if msg_type == "ping":
                return

            if msg_type == "rematch" and room.status == "finished" and len(room.players) == 2:
                room.players.reverse()
                roles = self._roles_for(room.game_type)
                for idx, p in enumerate(room.players):
                    p.role = roles[idx]
                    p.clock = INITIAL_CLOCKS[room.game_type]
                room.state, room.turn_role = self._init_game_state(room.game_type)
                room.status = "active"
                room.winner_role = None
                room.reason = None
                room.match_recorded = False
                room.created_at = time.time()
                room.last_tick = time.monotonic()
            elif msg_type == "resign" and room.status == "active":
                player = next((p for p in room.players if p.user_id == user_id), None)
                other = next((p for p in room.players if p.user_id != user_id), None)
                if player and other:
                    self._finish_room(room, other.role, f"{player.name} resigned")
            elif msg_type == "move" and room.status == "active":
                if not self._update_clock(room):
                    self._apply_move(room, user_id, data)
            elif msg_type == "score_update" and room.status == "active" and room.game_type in ("knife_hit", "fruit_slice", "sheep_fight", "virus_breaker"):
                player = next((p for p in room.players if p.user_id == user_id), None)
                if player:
                    p_prefix = "p1" if player.role == "P1" else "p2"
                    room.state[f"{p_prefix}_score"] = int(data.get("score", 0))
                    room.state[f"{p_prefix}_level"] = int(data.get("level", data.get("stage", 1)))
                    if "lives" in data:
                        room.state[f"{p_prefix}_lives"] = int(data.get("lives", 3))
                    if data.get("status") == "game_over":
                        room.state[f"{p_prefix}_status"] = "game_over"

                    # If playing against AI, make AI gain score proportionally
                    if room.vs_ai:
                        p2_curr = room.state.get("p2_score", 0)
                        room.state["p2_score"] = p2_curr + 12
                        if p2_curr > room.state.get("p2_level", 1) * 120:
                            room.state["p2_level"] = room.state.get("p2_level", 1) + 1

                    if room.state.get("p1_status") == "game_over" and (room.vs_ai or room.state.get("p2_status") == "game_over"):
                        p1_s = room.state.get("p1_score", 0)
                        p2_s = room.state.get("p2_score", 0)
                        winner = "P1" if p1_s > p2_s else ("P2" if p2_s > p1_s else "Draw")
                        self._finish_room(room, winner, f"Match Completed! Final Score: {p1_s} vs {p2_s}")
            elif msg_type == "chat":
                text = str(data.get("text", "")).strip()[:140]
                if text:
                    player = next((p for p in room.players if p.user_id == user_id), None)
                    sender_name = player.name if player else "Player"
                    sender_role = player.role if player else ""
                    chat_payload = {
                        "type": "chat",
                        "sender_id": user_id,
                        "sender_name": sender_name,
                        "sender_role": sender_role,
                        "text": text,
                        "timestamp": time.time(),
                    }
                    # Send chat immediately to all sockets
                    for p in list(room.players):
                        if p.ws is not None:
                            try:
                                await p.ws.send_json(chat_payload)
                            except Exception:
                                pass
                    for spec_ws in list(room.spectators):
                        try:
                            await spec_ws.send_json(chat_payload)
                        except Exception:
                            pass

                    # If playing against AI, reply with a courteous message after a short pause
                    if room.vs_ai:
                        ai_replies = [
                            "Good game! 🤝",
                            "Nice move! 🔥",
                            "Let's see how this unfolds...",
                            "Well played!",
                            "Thinking through my tactics... 🤔",
                            "May the best player win! ⚔️",
                            "Impressive strategy!",
                        ]
                        async def _ai_chat_response():
                            await asyncio.sleep(1.2)
                            ai_player = next((p for p in room.players if p.is_ai), None)
                            if ai_player:
                                ai_msg = {
                                    "type": "chat",
                                    "sender_id": ai_player.user_id,
                                    "sender_name": ai_player.name,
                                    "sender_role": ai_player.role,
                                    "text": random.choice(ai_replies),
                                    "timestamp": time.time(),
                                }
                                for p in list(room.players):
                                    if p.ws is not None:
                                        try:
                                            await p.ws.send_json(ai_msg)
                                        except Exception:
                                            pass
                        asyncio.create_task(_ai_chat_response())
                    return

            if room.vs_ai and room.status == "active":
                ai_player = next((p for p in room.players if p.is_ai), None)
                if ai_player and ai_player.role == room.turn_role:
                    ai_should_move = True

        await self.broadcast_room(room)

        if ai_should_move:
            # Deliberate AI thinking delay (750ms) so human player has time to see their move and AI's turn
            await asyncio.sleep(0.75)
            async with self._lock:
                self._perform_ai_turn(room)
            await self.broadcast_room(room)

    def _perform_ai_turn(self, room: ArenaRoom) -> None:
        while room.vs_ai and room.status == "active":
            ai_player = next((p for p in room.players if p.is_ai), None)
            if not ai_player or ai_player.role != room.turn_role:
                break

            move_payload: dict[str, Any] | None = None
            if room.game_type == "tictactoe":
                idx = pick_tictactoe_move(list(room.state["board"]), ai_player.role)
                if idx is not None:
                    move_payload = {"index": idx}
            elif room.game_type == "connect4":
                board_copy = [list(r) for r in room.state["board"]]
                col = pick_connect4_move(board_copy, ai_player.role)
                if col is not None:
                    move_payload = {"col": col}
            elif room.game_type == "othello":
                legal = othello_legal_moves(room.state["board"], ai_player.role)
                rc = pick_othello_move(legal)
                if rc is not None:
                    move_payload = {"row": rc[0], "col": rc[1]}
            elif room.game_type == "chess":
                uci = pick_chess_move(room.state["fen"])
                if uci:
                    move_payload = {"uci": uci}

            if not move_payload:
                break
            self._apply_move(room, ai_player.user_id, move_payload)

    def _apply_move(self, room: ArenaRoom, user_id: str, data: dict[str, Any]) -> None:
        player = next((p for p in room.players if p.user_id == user_id), None)
        if not player or player.role != room.turn_role:
            return

        if room.game_type == "chess":
            uci = str(data.get("uci", ""))
            board = chess.Board(room.state["fen"])
            try:
                move = chess.Move.from_uci(uci)
            except ValueError:
                return
            piece = board.piece_at(move.from_square)
            if (
                piece
                and piece.piece_type == chess.PAWN
                and chess.square_rank(move.to_square) in (0, 7)
                and move.promotion is None
            ):
                move = chess.Move(move.from_square, move.to_square, promotion=chess.QUEEN)
            if move not in board.legal_moves:
                return

            san = board.san(move)
            from_sq = chess.square_name(move.from_square)
            to_sq = chess.square_name(move.to_square)
            board.push(move)
            room.state["fen"] = board.fen()
            room.state["last_move"] = san
            room.state["last_squares"] = [from_sq, to_sq]

            if board.is_checkmate():
                self._finish_room(room, player.role, "Checkmate")
            elif (
                board.is_stalemate()
                or board.is_insufficient_material()
                or board.can_claim_threefold_repetition()
                or board.is_fifty_moves()
            ):
                self._finish_room(room, "Draw", "Draw")
            else:
                room.turn_role = "b" if room.turn_role == "w" else "w"

        elif room.game_type == "othello":
            r = data.get("row")
            c = data.get("col")
            if not isinstance(r, int) or not isinstance(c, int):
                return
            if not (0 <= r < 8 and 0 <= c < 8):
                return
            board = room.state["board"]
            flips = othello_flips(board, r, c, player.role)
            if not flips:
                return
            board[r][c] = player.role
            for fr, fc in flips:
                board[fr][fc] = player.role
            room.state["last_move"] = [r, c]

            other_role = "W" if player.role == "B" else "B"
            if othello_legal_moves(board, other_role):
                room.turn_role = other_role
            elif othello_legal_moves(board, player.role):
                # Opponent has no legal moves; same player continues
                room.turn_role = player.role
            else:
                b_cnt = sum(cell == "B" for row in board for cell in row)
                w_cnt = sum(cell == "W" for row in board for cell in row)
                if b_cnt > w_cnt:
                    self._finish_room(room, "B", f"Score {b_cnt}-{w_cnt}")
                elif w_cnt > b_cnt:
                    self._finish_room(room, "W", f"Score {w_cnt}-{b_cnt}")
                else:
                    self._finish_room(room, "Draw", f"Tied {b_cnt}-{w_cnt}")

        elif room.game_type == "connect4":
            col = data.get("col")
            if not isinstance(col, int) or not (0 <= col < 7):
                return
            board = room.state["board"]
            target_r = next((r for r in range(5, -1, -1) if board[r][col] == ""), None)
            if target_r is None:
                return
            board[target_r][col] = player.role
            room.state["last_col"] = col
            if self._check_c4(board, player.role):
                self._finish_room(room, player.role, "Connect 4!")
            elif all(board[0][c] != "" for c in range(7)):
                self._finish_room(room, "Draw", "Board full — Draw")
            else:
                room.turn_role = "Y" if room.turn_role == "R" else "R"

        elif room.game_type == "tictactoe":
            idx = data.get("index")
            if not isinstance(idx, int) or not (0 <= idx < 9):
                return
            board = room.state["board"]
            if board[idx] != "":
                return
            board[idx] = player.role
            if self._check_ttt(board, player.role):
                self._finish_room(room, player.role, "3 in a row!")
            elif "" not in board:
                self._finish_room(room, "Draw", "Draw")
            else:
                room.turn_role = "O" if room.turn_role == "X" else "X"

    @staticmethod
    def _check_c4(board: list[list[str]], token: str) -> bool:
        for r in range(6):
            for c in range(7):
                if board[r][c] != token:
                    continue
                for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
                    if all(
                        0 <= r + i * dr < 6
                        and 0 <= c + i * dc < 7
                        and board[r + i * dr][c + i * dc] == token
                        for i in range(4)
                    ):
                        return True
        return False

    @staticmethod
    def _check_ttt(board: list[str], token: str) -> bool:
        wins = [
            (0, 1, 2), (3, 4, 5), (6, 7, 8),
            (0, 3, 6), (1, 4, 7), (2, 5, 8),
            (0, 4, 8), (2, 4, 6),
        ]
        return any(board[a] == board[b] == board[c] == token for a, b, c in wins)

    async def _clock_loop(self) -> None:
        while True:
            await asyncio.sleep(1.0)
            changed_rooms: list[ArenaRoom] = []
            async with self._lock:
                for room in list(self.rooms.values()):
                    if room.status == "active" and len(room.players) == 2:
                        if self._update_clock(room):
                            changed_rooms.append(room)
            for room in changed_rooms:
                await self.broadcast_room(room)
