import os

from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_database_url() -> str:
    # Neon / Vercel Postgres integrations expose DATABASE_URL or POSTGRES_URL.
    for name in ("DATABASE_URL", "POSTGRES_URL"):
        if os.environ.get(name):
            return os.environ[name]
    # Without a database, Vercel functions can only write to /tmp (data resets on cold start).
    if os.environ.get("VERCEL"):
        return "sqlite:////tmp/cmd.db"
    return "sqlite:///./cmd.db"


def normalize_database_url(url: str) -> str:
    """Use the psycopg 3 driver for plain postgres:// / postgresql:// URLs."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url.removeprefix(prefix)
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CMD_", env_file=".env", extra="ignore")

    database_url: str = ""
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Load the bundled demo structures into an empty database on startup.
    load_demo_data: bool = True

    @property
    def resolved_database_url(self) -> str:
        return normalize_database_url(self.database_url or _default_database_url())


settings = Settings()
