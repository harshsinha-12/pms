from __future__ import annotations

from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables or ``api/.env``."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Portfolio Management System API"
    app_env: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_cors_origins: str = "http://localhost:5173"

    redis_url: str | None = None
    redis_username: str | None = None
    redis_password: str | None = None
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_ssl: bool = False
    redis_namespace: str = "pms"

    portfolio_id: str = "default"
    base_currency: str = "INR"
    portfolio_timezone: str = "Asia/Kolkata"
    quote_stale_seconds: int = Field(default=900, ge=30)
    market_data_timeout_seconds: float = Field(default=20.0, gt=0)
    demo_seed_enabled: bool = False

    @property
    def cors_origins(self) -> list[str]:
        return [item.strip() for item in self.api_cors_origins.split(",") if item.strip()]

    @property
    def effective_redis_url(self) -> str:
        if self.redis_url:
            return self.redis_url

        scheme = "rediss" if self.redis_ssl else "redis"
        credentials = ""
        if self.redis_username or self.redis_password:
            username = quote_plus(self.redis_username or "default")
            password = quote_plus(self.redis_password or "")
            credentials = f"{username}:{password}@"
        return f"{scheme}://{credentials}{self.redis_host}:{self.redis_port}/{self.redis_db}"


@lru_cache
def get_settings() -> Settings:
    return Settings()

