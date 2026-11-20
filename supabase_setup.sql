-- ====================================================
-- Supabase Complete Setup Script for Ghost Plays
-- Run this once in Supabase SQL Editor
-- ====================================================

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

-- Seed All Default Games
INSERT INTO custom_games (title, url, icon, description, image_url, is_active, created_at) VALUES
    ('Aviator Rocket', '/static/games/aviator/index.html', '🚀', 'High-stakes rocket multiplier curve! Cash out before the blast', '/static/banners/aviator_promo.png', 1, 1795166669.9031487),
    ('Neon Snake', '/static/games/snake/index.html', '🐍', 'Classic retro snake with smooth controls', '', 1, 1795166669.9031487),
    ('Flappy Ghost', '/static/games/flappy/index.html', '👻', 'Tap to flap and dodge obstacles', '', 1, 1795166669.9031487),
    ('Brick Breaker', '/static/games/breakout/index.html', '🧱', 'Smash neon bricks with bouncing ball', '', 1, 1795166669.9031487),
    ('Retro Tetris', '/static/games/tetris/index.html', '🧩', 'Falling tetromino block puzzle', '/static/banners/tetris_promo.png', 1, 1795166669.9031487),
    ('T-Rex Desert Run', '/static/games/dino/index.html', '🦖', 'Endless runner cactus jumping challenge', '/static/banners/dino_promo.png', 1, 1795166669.9031487),
    ('Neon Pong', '/static/games/pong/index.html', '🏓', 'Fast table tennis rally against AI', '', 1, 1795166669.9031487),
    ('Space Invaders', '/static/games/space_invaders/index.html', '👾', 'Defend galaxy from alien waves', '/static/banners/space_promo.png', 1, 1795166669.9031487),
    ('Asteroid Blaster', '/static/games/asteroids/index.html', '🚀', 'Space vector rock shooter with thrusters', '', 1, 1795166669.9031487),
    ('Fruit Slicer', '/static/games/fruit_slice/index.html', '🍉', 'Slice flying fruits with swipe blades', '/static/thumbnails/fruit_thumb.png', 1, 1795166669.9031487),
    ('Knife Master', '/static/games/knife_hit/index.html', '🗡️', 'Throw knives into rotating target log', '/static/thumbnails/knife_thumb.png', 1, 1795166669.9031487),
    ('Whack-a-Ghost', '/static/games/whack_a_mole/index.html', '🔨', 'Test reaction time whacking popping ghosts', '', 1, 1795166669.9031487),
    ('Helix Drop', '/static/games/helix_jump/index.html', '🌀', 'Bounce ball through gaps in rotating tower', '', 1, 1795166669.9031487),
    ('Tower Stack', '/static/games/tower_stack/index.html', '🏢', 'Slice and stack tower blocks as high as you can', '', 1, 1795166669.9031487),
    ('Neon Pinball', '/static/games/pinball/index.html', '🪩', 'Arcade pinball with flippers & bumpers', '', 1, 1795166669.9031487),
    ('Ghost Clicker', '/static/games/cookie_clicker/index.html', '🍪', 'Idle tap clicker with auto-ghost upgrades', '', 1, 1795166669.9031487),
    ('Hextris Rotation', '/static/games/hextris/index.html', '🔷', 'Hexagonal rotation match puzzle', '', 1, 1795166669.9031487),
    ('2048 Classic', '/static/games/2048/index.html', '🔢', 'Slide tiles to merge and reach 2048!', '/static/banners/puzzle2048_promo.png', 1, 1795166669.9031487),
    ('Minesweeper Retro', '/static/games/minesweeper/index.html', '💣', 'Clear the minefield without detonating bombs', '', 1, 1795166669.9031487),
    ('Wordle Guess', '/static/games/wordle/index.html', '🟩', 'Guess secret 5-letter word in 6 attempts', '', 1, 1795166669.9031487),
    ('Sudoku Master', '/static/games/sudoku/index.html', '🧩', 'Classic 9x9 number placement logic grid', '', 1, 1795166669.9031487),
    ('15-Puzzle Slider', '/static/games/sliding_puzzle/index.html', '🔲', 'Classic sliding numbered block puzzle', '', 1, 1795166669.9031487),
    ('Color Flood', '/static/games/color_flood/index.html', '🎨', 'Flood-fill the board with one color', '', 1, 1795166669.9031487),
    ('Emoji Memory', '/static/games/memory/index.html', '🧠', 'Flip and match pairs of hidden cards', '', 1, 1795166669.9031487),
    ('Simon Memory', '/static/games/simon/index.html', '🔔', 'Repeat growing sequence of lights & sounds', '', 1, 1795166669.9031487),
    ('8-Ball Billiards', '/static/games/billiards/index.html', '🎱', 'Pocket balls with realistic pool physics', '', 1, 1795166669.9031487),
    ('Connect 4 Arena', '/static/games/connect4/index.html', '🔴', 'Align 4 chips in a row against AI', '/static/thumbnails/connect4_thumb.png', 1, 1795166669.9031487),
    ('Checkers Classic', '/static/games/checkers/index.html', '⚪', 'Jump and capture enemy checkers to king', '', 1, 1795166669.9031487),
    ('Neon Tic-Tac-Toe', '/static/games/tictactoe/index.html', '❌', 'Glowing neon 3x3 XO against unbeatable AI', '/static/thumbnails/xo_thumb.png', 1, 1795166669.9031487),
    ('Klondike Solitaire', '/static/games/solitaire/index.html', '🃏', 'World''s most popular single-player card game', '', 1, 1795166669.9031487),
    ('Cyber Speed Typer', '/static/games/speed_typer/index.html', '⌨️', 'Test and improve your words-per-minute typing', '', 1, 1795166669.9031487);