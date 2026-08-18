from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Le .env vit à la racine du monorepo ; un backend/.env local peut le surcharger.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "postgresql+psycopg://clubjudge:clubjudge@localhost:5433/clubjudge"
    judge0_url: str = "http://localhost:2358"
    cors_origins: list[str] = ["http://localhost:5173"]
    secure_cookies: bool = False  # passer à True derrière TLS en prod
    content_dir: str = "../content"
    # Intervalle minimal entre deux soumissions d'un même utilisateur.
    submission_cooldown_s: int = 10
    # Webhook Discord du club pour les annonces (vide = annonces désactivées).
    discord_webhook_url: str = ""

    # Défense en profondeur HTTP / WebSocket. Le cooldown métier des soumissions
    # reste inchangé ; ces limites empêchent surtout la multiplication de comptes
    # ou de connexions depuis une même adresse.
    login_rate_limit_per_minute: int = 20
    register_rate_limit_per_hour: int = 30
    submit_ip_rate_limit_per_minute: int = 30
    run_ip_rate_limit_per_minute: int = 60
    lsp_connect_rate_limit_per_minute: int = 20
    lsp_max_sessions_per_user: int = 2
    lsp_max_sessions_global: int = 32
    lsp_session_ttl_s: int = 3600

    # Plusieurs consommateurs évitent qu'une panne Judge0 sur une soumission
    # bloque toute la file. Les retries sont replanifiés, pas attendus par un worker.
    judge_worker_concurrency: int = 2


@lru_cache
def get_settings() -> Settings:
    return Settings()
