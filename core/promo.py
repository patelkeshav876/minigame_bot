"""Promotional broadcast and Gamee-style visual challenge cards."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

BASE_DIR = Path(__file__).resolve().parent.parent
BANNERS_DIR = BASE_DIR / "webapp" / "static" / "banners"

# Catalog of featured games with rich Gamee-inspired promotional cards
PROMO_GAMES: dict[str, dict[str, Any]] = {
    "aviator": {
        "title": "🚀 AVIATOR ROCKET",
        "badge": "🔥 HOT CASINO MULTIPLIER",
        "headline": "Crash or Cash Out — Reach the 100x Galaxy!",
        "description": (
            "Watch the rocket climb higher and higher into deep space...\n"
            "📈 1.5x ... 3.8x ... 18.4x ... 89.2x!\n\n"
            "Will you cash out in time or risk it all for the cosmic jackpot?"
        ),
        "reward": "🪙 Win up to 50,000 Coins & climb the Global Hall of Fame!",
        "banner_filename": "aviator_promo.png",
        "game_id": "aviator",
        "button_label": "🚀 Play Aviator Rocket",
        "challenge_tag": "aviator",
    },
    "dino": {
        "title": "🦖 CYBER DINO RUNNER",
        "badge": "⚡ HIGH-SPEED ARCADE",
        "headline": "Dodge the Neon Cacti & Laser Pterodactyls!",
        "description": (
            "The classic desert runner reimagined in ultra-fast 60 FPS cyberpunk!\n"
            "Leap, duck, and chain speed boosts through the endless neon dunes.\n\n"
            "How long can you survive at supersonic speed?"
        ),
        "reward": "🏆 Daily Top 10 gets 5,000 Bonus Coins!",
        "banner_filename": "dino_promo.png",
        "game_id": "dino",
        "button_label": "🦖 Play Cyber Dino",
        "challenge_tag": "dino",
    },
    "chess": {
        "title": "♟️ GRANDMASTER CHESS",
        "badge": "⚔️ RANKED 1v1 STRATEGY",
        "headline": "Outthink Rivals on the 8x8 Battlefield!",
        "description": (
            "Classic chess with full legal move validation, en passant, and castling!\n"
            "Play with live 3-minute timers and climb the ELO Grandmaster ladder.\n\n"
            "Who has the sharper tactical vision? Challenge a friend now!"
        ),
        "reward": "🏆 Win ranked duels to reach Grandmaster (1600+ ELO)!",
        "banner_filename": "chess_promo.png",
        "game_id": "chess",
        "button_label": "♟️ Play Grandmaster Chess",
        "challenge_tag": "chess",
    },
    "connect4": {
        "title": "🔴 CONNECT 4 ROYALE",
        "badge": "🎯 TACTICAL DISC DROPS",
        "headline": "Line Up 4 Discs Before Your Opponent!",
        "description": (
            "The beloved head-to-head vertical grid strategy!\n"
            "Anticipate your opponent's moves, set up dual traps, and connect 4.\n\n"
            "One slip-up allows your opponent to drop the winning piece!"
        ),
        "reward": "🪙 3-Win Streak grants 3,000 Bonus Coins!",
        "banner_filename": "connect4_promo.png",
        "game_id": "connect4",
        "button_label": "🔴 Play Connect 4",
        "challenge_tag": "connect4",
    },
    "tetris": {
        "title": "🧩 RETRO TETRIS BLOCKS",
        "badge": "🏆 TOURNAMENT LIVE",
        "headline": "Clear Rows, Trigger Quad-Clears & Beat the Clock!",
        "description": (
            "The timeless arcade puzzle built for lightning reflexes!\n"
            "Stack the tetrominoes, set up massive four-line clears, and rack up combos.\n\n"
            "Challenge your friends to see who holds the line longest!"
        ),
        "reward": "⭐ Earn 2x Stars Rewards this week!",
        "banner_filename": "tetris_promo.png",
        "game_id": "tetris",
        "button_label": "🧩 Play Retro Tetris",
        "challenge_tag": "tetris",
    },
    "space_invaders": {
        "title": "👾 GALAXY DEFENDER",
        "badge": "💥 RETRO BULLET HELL",
        "headline": "Shield the Fleet & Repel Alien Waves!",
        "description": (
            "Alien armadas are descending upon the cosmos!\n"
            "Maneuver your starfighter, weave between plasma blasts, and destroy motherships.\n\n"
            "Do you have what it takes to defend Sector 7?"
        ),
        "reward": "🪙 High scores unlock exclusive starship skins!",
        "banner_filename": "space_promo.png",
        "game_id": "space_invaders",
        "button_label": "👾 Play Galaxy Defender",
        "challenge_tag": "space_invaders",
    },
    "knife_hit": {
        "title": "🗡️ KNIFE MASTER 3D",
        "badge": "🎯 PRECISION & REFLEXES",
        "headline": "Strike the Spinning Target — Never Hit a Blade!",
        "description": (
            "Throw your blades with surgical accuracy into rotating log targets!\n"
            "Slice juicy apples for bonus multiplier points and defeat boss targets.\n\n"
            "One slip and it's game over. Show your steel!"
        ),
        "reward": "🪙 10-Target Boss Clear gives instant 2,500 Coins!",
        "banner_filename": "knife_promo.png",
        "game_id": "knife_hit",
        "button_label": "🗡️ Play Knife Master",
        "challenge_tag": "knife",
    },
    "tictactoe": {
        "title": "❌ XO BLITZ ARENA ⭕",
        "badge": "⚔️ 1v1 HEAD-TO-HEAD",
        "headline": "Lightning Fast 3x3 Tactical Showdown!",
        "description": (
            "Outsmart rivals in 5-second per move blitz rounds!\n"
            "Every match updates your competitive ELO rating on the global board.\n\n"
            "Challenge anyone in this chat right now with one tap!"
        ),
        "reward": "🏆 Climb to Grandmaster Tier (1500+ ELO)!",
        "banner_filename": "xo_promo.png",
        "game_id": "tictactoe",
        "button_label": "❌ Play XO Blitz",
        "challenge_tag": "xo",
    },
    "2048": {
        "title": "🔢 2048 NEON MERGE",
        "badge": "🧠 BRAIN TEASER",
        "headline": "Merge the Tiles & Conquer the Legendary 2048!",
        "description": (
            "Swipe left, right, up, down. Combine matching tiles to double their value!\n"
            "2 ➔ 4 ➔ 8 ➔ 16 ... 1024 ➔ 2048!\n\n"
            "Can your brain solve the grid before space runs out?"
        ),
        "reward": "🪙 Reaching 2048 unlocks 10,000 Coins instantly!",
        "banner_filename": "puzzle2048_promo.png",
        "game_id": "2048",
        "button_label": "🔢 Play 2048 Neon",
        "challenge_tag": "2048",
    },
}


def get_promo_card(
    game_key: str,
    bot_username: str = "",
    webapp_url: str = "",
) -> tuple[str, Path | None, InlineKeyboardMarkup]:
    """Generate caption, banner path, and Gamee-style interactive keyboard for a game."""
    key = game_key.lower().strip()
    # Support aliases
    if key in ("flipster", "rocket"):
        key = "aviator"
    elif key in ("dinosaur", "runner"):
        key = "dino"
    elif key in ("blocks",):
        key = "tetris"
    elif key in ("space", "galaxy", "invaders"):
        key = "space_invaders"
    elif key in ("knife", "knives"):
        key = "knife_hit"
    elif key in ("xo", "ttt", "tic_tac_toe"):
        key = "tictactoe"

    info = PROMO_GAMES.get(key, PROMO_GAMES["aviator"])

    # Formulate Gamee-style promotional copy
    caption = (
        f"{info['title']}\n"
        f"*{info['badge']}*\n\n"
        f"✨ *{info['headline']}*\n\n"
        f"{info['description']}\n\n"
        f"🎁 {info['reward']}\n\n"
        f"👇 *Tap below to launch instantly inside Telegram!*"
    )

    # Locate banner image
    banner_file = BANNERS_DIR / info["banner_filename"]
    if not banner_file.exists():
        # Fallback to aviator banner or avatar if game-specific banner doesn't exist yet
        fallback_aviator = BANNERS_DIR / "aviator_promo.png"
        if fallback_aviator.exists():
            banner_file = fallback_aviator
        else:
            avatar = BASE_DIR / "webapp" / "static" / "bot_avatar.jpg"
            banner_file = avatar if avatar.exists() else None

    # Construct Gamee-style Inline Keyboard
    keyboard_rows: list[list[InlineKeyboardButton]] = []

    # Row 1: Direct Play in Mini App or Telegram deep link
    game_id = info["game_id"]
    if webapp_url:
        direct_url = f"{webapp_url}?game={game_id}"
        keyboard_rows.append([
            InlineKeyboardButton(info["button_label"], web_app=WebAppInfo(url=direct_url))
        ])
    elif bot_username:
        direct_url = f"https://t.me/{bot_username}?startapp=game_{game_id}"
        keyboard_rows.append([
            InlineKeyboardButton(info["button_label"], url=direct_url)
        ])
    else:
        keyboard_rows.append([
            InlineKeyboardButton(info["button_label"], callback_data=f"play_game:{game_id}")
        ])

    # Row 2: Challenge Friend (Inline Query) & Leaderboard
    row2 = [
        InlineKeyboardButton("⚔️ Challenge Friend", switch_inline_query=f"challenge {info['challenge_tag']}"),
        InlineKeyboardButton("🏆 Leaderboard", callback_data="menu:leaderboard"),
    ]
    keyboard_rows.append(row2)

    # Row 3: Daily Bonus & Stars Shop
    row3 = [
        InlineKeyboardButton("🎁 Daily Bonus", callback_data="menu:daily"),
        InlineKeyboardButton("⭐ Coin Shop", callback_data="menu:shop"),
    ]
    keyboard_rows.append(row3)

    return caption, (banner_file if banner_file and banner_file.exists() else None), InlineKeyboardMarkup(keyboard_rows)


def list_promo_keys() -> list[str]:
    """Return available promo game keys."""
    return list(PROMO_GAMES.keys())
