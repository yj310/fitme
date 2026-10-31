"""FITME API entry point."""

from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import ConfigError, get_model_config, get_pricing, get_settings
from app.db.postgrest import PostgREST
from app.deps import AppServices, RateLimiter
from app.errors import ApiError
from app.routers import ai, chat, items, me, outfits, styles, system, weather
from app.services.weather import WeatherService


class RedactFilter(logging.Filter):
    """Belt and braces: scrub anything that looks like a key, token or signed URL from log lines."""

    PATTERNS = [
        re.compile(r"(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|nvapi-[A-Za-z0-9_-]{8,})"),
        re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
        re.compile(r"(token|serviceKey|apikey|key)=[^&\s]+", re.IGNORECASE),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        for p in self.PATTERNS:
            msg = p.sub("[REDACTED]", msg)
        record.msg, record.args = msg, ()
        return True


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    for h in logging.getLogger().handlers:
        h.addFilter(RedactFilter())
    # httpx logs full request URLs (which can include signed tokens) at INFO.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def create_app() -> FastAPI:
    setup_logging()
    settings = get_settings()
    cfg = get_model_config()  # raises ConfigError (server won't start) if production config has NVIDIA

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        http = httpx.AsyncClient(timeout=20.0)
        admin = PostgREST(http, settings.supabase_url, settings.supabase_service_role_key,
                          settings.supabase_service_role_key)
        app.state.services = AppServices(
            settings=settings, cfg=cfg, pricing=get_pricing(), http=http,
            weather=WeatherService(http, settings.kma_service_key, admin if settings.supabase_url else None,
                                   settings.weather_timeout_s),
            limiter=RateLimiter(settings.rate_limit_per_minute), admin=admin)
        yield
        await http.aclose()

    app = FastAPI(title="FITME API", version="0.1.0", lifespan=lifespan,
                  description="내 옷장으로 코디를 제안하는 AI 스타일링 에이전트 (P1)")
    app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=False,
                       allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
                       allow_headers=["Authorization", "Content-Type"])

    @app.exception_handler(ApiError)
    async def api_error(_: Request, e: ApiError):
        return JSONResponse(e.body(), status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        return JSONResponse({"error": {"code": "INVALID_REQUEST", "message": "입력값을 확인해 주세요."}},
                            status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, e: Exception):
        logging.getLogger("fitme").exception("unhandled error")
        return JSONResponse({"error": {"code": "INTERNAL", "message": "문제가 생겼어요. 잠시 후 다시 시도해 주세요."}},
                            status_code=500)

    prefix = "/api/v1"
    for r in (system.router, me.router, items.router, styles.router, weather.router, chat.router,
              outfits.router, ai.router):
        app.include_router(r, prefix=prefix)
    if settings.is_dev:
        app.include_router(system.dev_router, prefix=prefix)
    return app


try:
    app = create_app()
except ConfigError as e:  # acceptance test 12: refuse to start
    raise SystemExit(f"FITME config error: {e}") from e
