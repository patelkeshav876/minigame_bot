"""Unit tests for single-player and two-player in-bot game engines."""

from handlers.games.chess_game import (
    handle_chess_square_tap,
    init_chess_state,
    render_chess,
    resign_chess,
)
from handlers.games.connect4 import drop_connect4_disc, init_connect4_state, render_connect4
from handlers.games.dots_and_boxes import init_dots_state, make_dots_move, render_dots
from handlers.games.memory import flip_card, init_memory_game
from handlers.games.pacman import init_pacman_game, move_pacman
from handlers.games.pinball import init_pinball_game, launch_ball
from handlers.games.rock_paper_scissors import init_rps_state, make_rps_choice, render_rps
from handlers.games.snake import init_snake_game, move_snake, spawn_apple
from handlers.games.tic_tac_toe import init_tictactoe_state, make_tictactoe_move, render_tictactoe


def _assert_callback_limits(markup):
    for row in markup.inline_keyboard:
        assert len(row) <= 8
        for btn in row:
            if btn.callback_data:
                assert len(btn.callback_data.encode("utf-8")) <= 64
    total = sum(len(row) for row in markup.inline_keyboard)
    assert total <= 100


def test_snake_no_infinite_loop_on_full_board():
    full_snake = [(r, c) for r in range(5) for c in range(5)]
    assert spawn_apple(full_snake) is None


def test_snake_eat_and_reverse_guard():
    state = init_snake_game()
    state["apple"] = (2, 3)
    move_snake(state, "RIGHT")
    assert state["score"] == 1
    assert len(state["snake"]) == 2
    # Immediate 180-degree turn should be ignored
    move_snake(state, "LEFT")
    assert state["direction"] == "RIGHT"
    assert not state["game_over"]


def test_pacman_ghost_does_not_erase_dots():
    state = init_pacman_game()
    initial_dots = len(state["dots"])
    move_pacman(state, "DOWN")
    # Pacman ate 1 dot; ghost stepping across a tile must not delete any extra dots
    assert state["score"] == 1
    assert len(state["dots"]) == initial_dots - 1


def test_memory_keeps_mismatched_pair_visible_until_next_tap():
    state = init_memory_game()
    state["cards"] = ["🍎", "🍌", "🍎", "🍌"] + ["🍇", "🍇", "🍓", "🍓", "🍍", "🍍", "🍒", "🍒"]
    flip_card(state, 0)  # 🍎
    flip_card(state, 1)  # 🍌 mismatch
    assert state["flipped"] == [0, 1]
    assert state["pending_clear"] is True
    # Next tap clears old pair and flips new card
    flip_card(state, 2)
    assert state["flipped"] == [2]
    assert state["pending_clear"] is False


def test_pinball_drains():
    state = init_pinball_game()
    for _ in range(100):
        launch_ball(state)
        if state["game_over"]:
            break
    assert state["score"] >= 1


def test_tictactoe_flow_and_callback_limits():
    state = init_tictactoe_state(1, "Alice")
    # Alice cannot play O's turn
    assert make_tictactoe_move(state, 1, "Alice", 0)[0] is True
    assert make_tictactoe_move(state, 1, "Alice", 1)[0] is False
    assert make_tictactoe_move(state, 2, "Bob", 3)[0] is True
    make_tictactoe_move(state, 1, "Alice", 1)
    make_tictactoe_move(state, 2, "Bob", 4)
    make_tictactoe_move(state, 1, "Alice", 2)
    assert state["game_over"] is True
    assert state["winner"] == "X"
    _, markup = render_tictactoe(state, "abc12345")
    _assert_callback_limits(markup)


def test_rps_secret_choices():
    state = init_rps_state(1, "Alice")
    ok1, _ = make_rps_choice(state, 1, "Alice", "R")
    assert ok1 is True
    assert state["game_over"] is False
    # Alice cannot change move
    assert make_rps_choice(state, 1, "Alice", "P")[0] is False
    ok2, _ = make_rps_choice(state, 2, "Bob", "S")
    assert ok2 is True
    assert state["game_over"] is True
    assert state["winner"] == "p1"
    _, markup = render_rps(state, "abc12345")
    _assert_callback_limits(markup)


def test_connect4_vertical_win():
    state = init_connect4_state(1, "Alice")
    for _ in range(3):
        assert drop_connect4_disc(state, 1, "Alice", 0)[0] is True
        assert drop_connect4_disc(state, 2, "Bob", 1)[0] is True
    assert drop_connect4_disc(state, 1, "Alice", 0)[0] is True
    assert state["game_over"] is True
    assert state["winner"] == "R"
    _, markup = render_connect4(state, "abc12345")
    _assert_callback_limits(markup)


def test_chess_fools_mate_and_limits():
    state = init_chess_state(1, "Alice")
    _, markup = render_chess(state, "abc12345")
    _assert_callback_limits(markup)

    # 1. f3 e5 2. g4 Qh4#
    assert handle_chess_square_tap(state, 1, "Alice", "f2")[0] is True
    assert handle_chess_square_tap(state, 1, "Alice", "f3")[0] is True

    assert handle_chess_square_tap(state, 2, "Bob", "e7")[0] is True
    assert handle_chess_square_tap(state, 2, "Bob", "e5")[0] is True

    assert handle_chess_square_tap(state, 1, "Alice", "g2")[0] is True
    assert handle_chess_square_tap(state, 1, "Alice", "g4")[0] is True

    assert handle_chess_square_tap(state, 2, "Bob", "d8")[0] is True
    assert handle_chess_square_tap(state, 2, "Bob", "h4")[0] is True

    assert state["game_over"] is True
    assert state["winner"] == "b"
    assert state["reason"] == "Checkmate"


def test_chess_resign():
    state = init_chess_state(1, "Alice")
    handle_chess_square_tap(state, 1, "Alice", "e2")
    handle_chess_square_tap(state, 1, "Alice", "e4")
    handle_chess_square_tap(state, 2, "Bob", "e7")
    handle_chess_square_tap(state, 2, "Bob", "e5")
    ok, _ = resign_chess(state, 1)
    assert ok is True
    assert state["game_over"] is True
    assert state["winner"] == "b"


def test_dots_and_boxes_claim_keeps_turn_and_limits():
    state = init_dots_state(1, "Alice")
    # Draw 3 edges of top-left box (0, 0)
    assert make_dots_move(state, 1, "Alice", "h", 0, 0)[0] is True
    assert state["turn"] == "2"
    assert make_dots_move(state, 2, "Bob", "h", 1, 0)[0] is True
    assert state["turn"] == "1"
    assert make_dots_move(state, 1, "Alice", "v", 0, 0)[0] is True
    assert state["turn"] == "2"
    # Bob completes box (0, 0) and keeps turn
    ok, msg = make_dots_move(state, 2, "Bob", "v", 0, 1)
    assert ok is True
    assert "Claimed 1" in msg
    assert state["scores"]["2"] == 1
    assert state["turn"] == "2"
    _, markup = render_dots(state, "abc12345")
    _assert_callback_limits(markup)
