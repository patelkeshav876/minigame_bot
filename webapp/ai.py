"""Built-in AI opponents for solo practice in the Battle Arena."""

from __future__ import annotations

import math
import random
from typing import Iterable

import chess

# Reversi/Othello positional weights (corners highest, X/C-squares penalized)
OTHELLO_WEIGHTS = [
    [120, -20, 20, 5, 5, 20, -20, 120],
    [-20, -40, -5, -5, -5, -5, -40, -20],
    [20, -5, 15, 3, 3, 15, -5, 20],
    [5, -5, 3, 3, 3, 3, -5, 5],
    [5, -5, 3, 3, 3, 3, -5, 5],
    [20, -5, 15, 3, 3, 15, -5, 20],
    [-20, -40, -5, -5, -5, -5, -40, -20],
    [120, -20, 20, 5, 5, 20, -20, 120],
]

CHESS_PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000,
}


def pick_tictactoe_move(board: list[str], ai_role: str) -> int | None:
    human = "O" if ai_role == "X" else "X"
    wins = [
        (0, 1, 2), (3, 4, 5), (6, 7, 8),
        (0, 3, 6), (1, 4, 7), (2, 5, 8),
        (0, 4, 8), (2, 4, 6),
    ]

    def winner(b: list[str]) -> str | None:
        for a, b_i, c in wins:
            if b[a] == b[b_i] == b[c] != "":
                return b[a]
        return None

    def minimax(b: list[str], maximizing: bool, depth: int) -> int:
        w = winner(b)
        if w == ai_role:
            return 10 - depth
        if w == human:
            return depth - 10
        if "" not in b:
            return 0
        best = -99 if maximizing else 99
        token = ai_role if maximizing else human
        for i in range(9):
            if b[i] == "":
                b[i] = token
                score = minimax(b, not maximizing, depth + 1)
                b[i] = ""
                best = max(best, score) if maximizing else min(best, score)
        return best

    free = [i for i, v in enumerate(board) if v == ""]
    if not free:
        return None
    if len(free) == 9:
        return 4
    best_score = -99
    best_moves: list[int] = []
    for idx in free:
        board[idx] = ai_role
        sc = minimax(board, False, 0)
        board[idx] = ""
        if sc > best_score:
            best_score = sc
            best_moves = [idx]
        elif sc == best_score:
            best_moves.append(idx)
    return random.choice(best_moves)


def _c4_valid_cols(board: list[list[str]]) -> list[int]:
    order = [3, 2, 4, 1, 5, 0, 6]
    return [c for c in order if board[0][c] == ""]


def _c4_drop_row(board: list[list[str]], col: int) -> int:
    for r in range(5, -1, -1):
        if board[r][col] == "":
            return r
    return -1


def _c4_is_win(board: list[list[str]], token: str) -> bool:
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


def _c4_score_window(window: Iterable[str], ai_role: str, human: str) -> int:
    w = list(window)
    ai_cnt = w.count(ai_role)
    hu_cnt = w.count(human)
    em_cnt = w.count("")
    if ai_cnt == 4:
        return 10000
    if hu_cnt == 4:
        return -10000
    score = 0
    if ai_cnt == 3 and em_cnt == 1:
        score += 12
    elif ai_cnt == 2 and em_cnt == 2:
        score += 3
    if hu_cnt == 3 and em_cnt == 1:
        score -= 15
    return score


def _c4_evaluate(board: list[list[str]], ai_role: str, human: str) -> int:
    score = sum(1 for r in range(6) if board[r][3] == ai_role) * 4
    for r in range(6):
        for c in range(4):
            score += _c4_score_window(board[r][c : c + 4], ai_role, human)
    for c in range(7):
        for r in range(3):
            score += _c4_score_window([board[r + i][c] for i in range(4)], ai_role, human)
    for r in range(3):
        for c in range(4):
            score += _c4_score_window([board[r + i][c + i] for i in range(4)], ai_role, human)
            score += _c4_score_window([board[r + 3 - i][c + i] for i in range(4)], ai_role, human)
    return score


def pick_connect4_move(board: list[list[str]], ai_role: str, depth: int = 4) -> int | None:
    human = "Y" if ai_role == "R" else "R"

    def alphabeta(b: list[list[str]], d: int, alpha: float, beta: float, maximizing: bool) -> tuple[int | None, float]:
        cols = _c4_valid_cols(b)
        if _c4_is_win(b, ai_role):
            return None, 100000 + d
        if _c4_is_win(b, human):
            return None, -100000 - d
        if not cols:
            return None, 0
        if d == 0:
            return None, _c4_evaluate(b, ai_role, human)

        best_col = cols[0]
        if maximizing:
            val = -math.inf
            for col in cols:
                r = _c4_drop_row(b, col)
                b[r][col] = ai_role
                _, new_sc = alphabeta(b, d - 1, alpha, beta, False)
                b[r][col] = ""
                if new_sc > val:
                    val = new_sc
                    best_col = col
                alpha = max(alpha, val)
                if alpha >= beta:
                    break
            return best_col, val
        else:
            val = math.inf
            for col in cols:
                r = _c4_drop_row(b, col)
                b[r][col] = human
                _, new_sc = alphabeta(b, d - 1, alpha, beta, True)
                b[r][col] = ""
                if new_sc < val:
                    val = new_sc
                    best_col = col
                beta = min(beta, val)
                if alpha >= beta:
                    break
            return best_col, val

    col, _ = alphabeta(board, depth, -math.inf, math.inf, True)
    return col


def pick_othello_move(legal_moves: list[tuple[int, int]]) -> tuple[int, int] | None:
    if not legal_moves:
        return None
    best = max(legal_moves, key=lambda rc: OTHELLO_WEIGHTS[rc[0]][rc[1]])
    return best


def pick_chess_move(fen: str) -> str | None:
    board = chess.Board(fen)
    moves = list(board.legal_moves)
    if not moves:
        return None

    ai_color = board.turn

    def eval_board(b: chess.Board) -> int:
        if b.is_checkmate():
            return -999999 if b.turn == ai_color else 999999
        if b.is_stalemate() or b.is_insufficient_material():
            return 0
        score = 0
        for sq in chess.SQUARES:
            p = b.piece_at(sq)
            if p:
                val = CHESS_PIECE_VALUES[p.piece_type]
                if sq in (chess.D4, chess.E4, chess.D5, chess.E5):
                    val += 15
                score += val if p.color == ai_color else -val
        return score

    best_score = -math.inf
    best_moves: list[chess.Move] = []
    # Sample up to 30 moves prioritized by captures/checks for fast response
    moves.sort(key=lambda m: (board.is_capture(m), board.gives_check(m)), reverse=True)
    for move in moves[:30]:
        board.push(move)
        # 1-ply opponent reply check (worst-case opponent capture)
        opp_best = math.inf
        opp_moves = list(board.legal_moves)
        if not opp_moves:
            sc = eval_board(board)
        else:
            opp_moves.sort(key=lambda m: board.is_capture(m), reverse=True)
            for om in opp_moves[:12]:
                board.push(om)
                opp_best = min(opp_best, eval_board(board))
                board.pop()
            sc = opp_best
        board.pop()

        if sc > best_score:
            best_score = sc
            best_moves = [move]
        elif sc == best_score:
            best_moves.append(move)

    return random.choice(best_moves).uci() if best_moves else moves[0].uci()
