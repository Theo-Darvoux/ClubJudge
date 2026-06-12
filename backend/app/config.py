from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Le .env vit à la racine du monorepo ; un backend/.env local peut le surcharger.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "postgresql+psycopg://clubjudge:clubjudge@localhost:5433/clubjudge"
    judge0_url: str = "http://localhost:2358"
    cors_origins: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
