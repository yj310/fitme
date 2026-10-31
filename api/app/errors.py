"""API error type. Response shape: {"error": {"code", "message"}} (spec 13)."""

from __future__ import annotations


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.status = status

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message}}


QUOTA_MESSAGE = "오늘 무료 사용량을 다 썼어요. 내일 다시 쓰거나 내 AI 키를 연결하세요."


def quota_exceeded() -> ApiError:
    return ApiError("FREE_QUOTA_EXCEEDED", QUOTA_MESSAGE, 429)


def not_found(what: str = "항목") -> ApiError:
    return ApiError("NOT_FOUND", f"{what}을(를) 찾을 수 없어요.", 404)
