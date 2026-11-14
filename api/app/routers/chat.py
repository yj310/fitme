"""/chat (SSE) and /chat/latest (F05–F07, F09)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agent import service
from app.deps import Ctx, get_ctx

router = APIRouter(tags=["chat"])


class Answer(BaseModel):
    ask_id: str
    value: str = Field(max_length=100)


class ChatReq(BaseModel):
    conversation_id: str | None = None
    message: str = Field("", max_length=1000)
    answer: Answer | None = None


@router.post("/chat")
async def chat(body: ChatReq, ctx: Ctx = Depends(get_ctx)):
    stream = service.chat_stream(ctx, body.conversation_id, body.message,
                                 body.answer.model_dump() if body.answer else None)
    return StreamingResponse(stream, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/chat/latest")
async def latest(ctx: Ctx = Depends(get_ctx)):
    return await service.latest_chat(ctx)
