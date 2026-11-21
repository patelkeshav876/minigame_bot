"""Application configuration loaded from environment variables."""

import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

load_dotenv(BASE_DIR / ".env")

BOT_TOKEN: str = os.getenv("BOT_TOKEN", "").strip()
BOT_USERNAME: str = os.getenv("BOT_USERNAME", "").strip().lstrip("@")
WEBAPP_URL: str = os.getenv("WEBAPP_URL", "").strip().rstrip("/")
WEB_HOST: str = os.getenv("WEB_HOST", "0.0.0.0").strip()
WEB_PORT: int = int(os.getenv("PORT") or os.getenv("WEB_PORT", "8000"))
DB_PATH: Path = DATA_DIR / "minigame_bot.db"
DATABASE_URL: str = os.getenv("DATABASE_URL", "").strip()
CUSTOM_FIRE_EMOJI_ID: str = os.getenv("CUSTOM_FIRE_EMOJI_ID", "").strip()
DEFAULT_ADMINS: set[str] = {"1446312281"}
_env_admins = {x.strip() for x in os.getenv("ADMIN_USER_IDS", "").split(",") if x.strip()}
ADMIN_USER_IDS: set[str] = DEFAULT_ADMINS | _env_admins
ADMIN_SECRET: str = os.getenv("ADMIN_SECRET", "admin123").strip()
