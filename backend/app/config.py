"""Настройки приложения из переменных окружения и backend/.env."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    site_password_hash: str = ""
    site_password: str = ""
    session_secret: str = "dev-secret-change-me"
    session_days: int = 30
    cookie_secure: bool = False

    deepseek_api_key: str = ""
    deepseek_url: str = "https://api.deepseek.com/chat/completions"
    deepseek_model: str = "deepseek-chat"
    deepseek_timeout: float = 60.0

    price_in_usd: float = 0.27
    price_out_usd: float = 1.10
    usd_rub: float = 81.0
    default_limit_rub: float = 500.0

    app_db_path: str = "data/app.db"
    app_host: str = "127.0.0.1"
    app_port: int = 8010
    frontend_dist: str = "../frontend/dist"

    def db_file(self) -> Path:
        path = Path(self.app_db_path)
        return path if path.is_absolute() else (BASE_DIR / path)

    def dist_dir(self) -> Path:
        path = Path(self.frontend_dist)
        return path if path.is_absolute() else (BASE_DIR / path)


@lru_cache
def get_settings() -> Settings:
    return Settings()
