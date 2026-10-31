import pytest
import yaml

from app.config import CONFIG_DIR, ConfigError, ModelConfig, load_model_config


def test_both_configs_load():
    assert load_model_config("development").default_for("chat")[0] == "nvidia"
    assert load_model_config("production").default_for("chat") == ("gemini", "gemini-3.8-flash")


def test_production_refuses_nvidia():
    # Acceptance test 12: adding NVIDIA to the production config must stop the server.
    raw = yaml.safe_load((CONFIG_DIR / "models.production.yaml").read_text())
    raw["allowed_providers"].append("nvidia")
    with pytest.raises(ConfigError):
        ModelConfig(raw, "production")


def test_force_fallback_moves_task_to_gemini():
    raw = yaml.safe_load((CONFIG_DIR / "models.development.yaml").read_text())
    raw["force_fallback_tasks"] = ["tagging"]
    cfg = ModelConfig(raw, "development")
    assert cfg.default_for("tagging") == ("gemini", "gemini-3.5-flash-lite")
    assert cfg.default_for("chat")[0] == "nvidia"
