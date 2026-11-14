"""AES-256-GCM for user AI keys (spec 10.5). Key lives only in AI_KEY_ENCRYPTION_KEY."""

from __future__ import annotations

import base64
import binascii
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.errors import ApiError

_AAD = b"fitme.ai_connections.v1"


def _key(raw: str) -> bytes:
    raw = (raw or "").strip()
    for decode in (base64.b64decode, bytes.fromhex):
        try:
            k = decode(raw)
            if len(k) == 32:
                return k
        except (binascii.Error, ValueError):
            continue
    raise ApiError("SERVER_MISCONFIGURED", "AI 키 저장 기능이 아직 설정되지 않았어요.", 503)


def encrypt(plaintext: str, key_material: str) -> bytes:
    nonce = os.urandom(12)
    return nonce + AESGCM(_key(key_material)).encrypt(nonce, plaintext.encode(), _AAD)


def decrypt(blob: bytes, key_material: str) -> str:
    return AESGCM(_key(key_material)).decrypt(blob[:12], blob[12:], _AAD).decode()
