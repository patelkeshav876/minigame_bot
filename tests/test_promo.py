"""Unit tests for the Gamee-style promotional message engine."""

from core.promo import PROMO_GAMES, get_promo_card, list_promo_keys


def test_list_promo_keys():
    keys = list_promo_keys()
    assert "aviator" in keys
    assert "dino" in keys
    assert "tetris" in keys
    assert "space_invaders" in keys
    assert "knife_hit" in keys
    assert "fruit_slice" in keys
    assert "tictactoe" in keys
    assert "2048" in keys


def test_get_promo_card_fruit_slice():
    caption, banner, markup = get_promo_card("fruit_slice", bot_username="GhostPlaysBot", webapp_url="https://ghost.app")
    assert "FRUIT SLICE" in caption
    assert banner is not None
    assert banner.name == "fruit_promo.png"
    assert banner.exists()
    rows = markup.inline_keyboard
    assert len(rows) >= 3
    assert "https://ghost.app?game=fruit_slice" in rows[0][0].web_app.url


def test_get_promo_card_aviator():
    caption, banner, markup = get_promo_card("aviator", bot_username="GhostPlaysBot", webapp_url="https://ghost.app")
    assert "AVIATOR ROCKET" in caption
    assert "Crash or Cash Out" in caption
    assert banner is not None
    assert banner.name == "aviator_promo.png"
    assert banner.exists()

    # Buttons
    rows = markup.inline_keyboard
    assert len(rows) >= 3
    # Row 1: Direct launch
    assert rows[0][0].web_app is not None
    assert "https://ghost.app?game=aviator" in rows[0][0].web_app.url
    # Row 2: Challenge & Leaderboard
    assert rows[1][0].switch_inline_query == "challenge aviator"
    assert rows[1][1].callback_data == "menu:leaderboard"


def test_get_promo_card_dino():
    caption, banner, markup = get_promo_card("dino", bot_username="GhostPlaysBot", webapp_url="https://ghost.app")
    assert "CYBER DINO" in caption
    assert banner is not None
    assert banner.name == "dino_promo.png"
    assert banner.exists()
    rows = markup.inline_keyboard
    assert len(rows) >= 3
    assert "https://ghost.app?game=dino" in rows[0][0].web_app.url


def test_get_promo_card_aliases():
    # 'flipster' should map to aviator
    cap_flip, banner_flip, _ = get_promo_card("flipster")
    assert "AVIATOR ROCKET" in cap_flip

    # 'runner' should map to dino
    cap_run, banner_run, _ = get_promo_card("runner")
    assert "CYBER DINO" in cap_run

    # 'xo' should map to tictactoe
    cap_xo, banner_xo, _ = get_promo_card("xo")
    assert "XO BLITZ" in cap_xo


def test_fallback_when_no_webapp_url():
    caption, banner, markup = get_promo_card("tetris", bot_username="GhostPlaysBot", webapp_url="")
    rows = markup.inline_keyboard
    # Deep link when webapp_url is empty
    assert rows[0][0].url == "https://t.me/GhostPlaysBot?startapp=game_tetris"


def test_promo_banners_storage_crud():
    from core.storage import storage

    banners = storage.list_promo_banners()
    assert len(banners) >= 4
    # Check default seeded banners exist
    titles = [b["title"] for b in banners]
    assert "AVIATOR" in titles
    assert "DESERT RUNNER" in titles

    # Add a custom promo banner
    new_b = storage.add_promo_banner(
        title="SHEEP FIGHT 3D",
        badge="🔥 NEW RELEASE",
        badge2="● LIVE DUEL",
        description="Push opponent rams into their barn to win!",
        image_url="/static/thumbnails/sheep_thumb.png",
        game_url="/static/games/sheep_fight/index.html",
        game_title="Sheep Fight Royale",
        game_icon="🐑",
        bg_theme="slide-gold",
    )
    assert new_b["id"] is not None
    assert new_b["title"] == "SHEEP FIGHT 3D"

    # Verify update
    updated = storage.update_promo_banner(
        new_b["id"],
        title="SHEEP FIGHT ROYALE",
        badge="🏆 TOURNAMENT",
        description="Updated description",
        image_url="/static/thumbnails/sheep_thumb.png",
        game_url="/static/games/sheep_fight/index.html",
        game_title="Sheep Fight Royale",
        game_icon="🐑",
        bg_theme="slide-cyan",
    )
    assert updated["title"] == "SHEEP FIGHT ROYALE"
    assert updated["bg_theme"] == "slide-cyan"

    # Delete
    deleted = storage.delete_promo_banner(new_b["id"])
    assert deleted is True
