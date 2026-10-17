from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CMD_", env_file=".env", extra="ignore")

    # SQLite is used when no DATABASE_URL is set, so the backend runs without Postgres.
    database_url: str = "sqlite:///./cmd.db"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    max_upload_mb: int = 20


settings = Settings()
