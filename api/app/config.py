"""Settings from environment + model config (spec 10, 18.1)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parents[1]
CONFIG_DIR = API_DIR / "config"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_DIR / ".env", extra="ignore")

    app_env: Literal["development", "production"] = "development"

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    allowed_origins: str = "http://localhost:3000"

    gemini_api_key: str = ""
    nvidia_api_key: str = ""
    ai_key_encryption_key: str = ""
    kma_service_key: str = ""

    free_daily_agent_runs: int = 20
    free_daily_tagging: int = 50
    rate_limit_per_minute: int = 30

    dev_test_password: str = ""

    # Tunables
    llm_timeout_s: float = 40.0
    weather_timeout_s: float = 5.0
    max_tool_calls: int = 12
    max_generation_retries: int = 2

    @property
    def is_dev(self) -> bool:
        return self.app_env == "development"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


class ConfigError(RuntimeError):
    pass


class ModelConfig:
    """Parsed config/models.{APP_ENV}.yaml."""

    def __init__(self, raw: dict[str, Any], app_env: str):
        self.raw = raw
        self.app_env = app_env
        self.allowed_providers: list[str] = list(raw.get("allowed_providers", []))
        self.defaults: dict[str, dict[str, str]] = raw.get("defaults", {})
        self.fallback: dict[str, str] | None = raw.get("fallback")
        self.force_fallback_tasks: list[str] = list(raw.get("force_fallback_tasks") or [])
        self.byok_choices: dict[str, dict[str, list[str]]] = raw.get("byok_choices", {})
        self.validate()

    def validate(self) -> None:
        if self.app_env == "production":
            text = yaml.safe_dump(self.raw).lower()
            if "nvidia" in text:
                # Spec 10.3: production must never load NVIDIA. Refuse to start.
                raise ConfigError("models.production.yaml must not reference 'nvidia'.")
        for task in ("chat", "tagging", "style"):
            d = self.defaults.get(task)
            if not d or "provider" not in d or "model" not in d:
                raise ConfigError(f"defaults.{task} needs provider and model")
            if d["provider"] not in self.allowed_providers:
                raise ConfigError(f"defaults.{task}.provider '{d['provider']}' is not allowed")

    def default_for(self, task: str) -> tuple[str, str]:
        if task in self.force_fallback_tasks and self.fallback:
            return self.fallback["provider"], self.fallback[task]
        d = self.defaults[task]
        return d["provider"], d["model"]

    def fallback_for(self, task: str) -> tuple[str, str] | None:
        if not self.fallback:
            return None
        return self.fallback["provider"], self.fallback[task]


def load_model_config(app_env: str, path: Path | None = None) -> ModelConfig:
    p = path or CONFIG_DIR / f"models.{app_env}.yaml"
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    return ModelConfig(raw, app_env)


class Pricing:
    def __init__(self, raw: dict[str, Any]):
        self.raw = raw

    def cost(self, provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
        p = (self.raw.get(provider) or {}).get(model) or (self.raw.get(provider) or {}).get("default")
        if not p:
            return 0.0
        return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_model_config() -> ModelConfig:
    return load_model_config(get_settings().app_env)


@lru_cache
def get_pricing() -> Pricing:
    raw = yaml.safe_load((CONFIG_DIR / "pricing.yaml").read_text(encoding="utf-8")) or {}
    return Pricing(raw)


def scoring_weights() -> dict[str, float]:
    raw = yaml.safe_load((CONFIG_DIR / "scoring.yaml").read_text(encoding="utf-8")) or {}
    return raw.get("weights", {"style": 0.35, "harmony": 0.25, "situation": 0.20, "preference": 0.20})

