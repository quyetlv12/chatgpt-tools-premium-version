"""Strict, credential-private input boundary for ChatGPT Web session JSON."""
from __future__ import annotations

import base64
import json
import math
import time
from datetime import datetime

MAX_SESSION_BYTES = 128 * 1024


def parse_session(raw: str, expected_email: str) -> dict:
    try:
        size = len(raw.encode("utf-8")) if isinstance(raw, str) else MAX_SESSION_BYTES + 1
    except UnicodeError:
        raise ValueError("Nội dung không phải session JSON hợp lệ") from None
    if size > MAX_SESSION_BYTES:
        raise ValueError("Session JSON vượt giới hạn 128 KB")
    if not isinstance(expected_email, str):
        raise ValueError("Email tài khoản không hợp lệ")
    email = expected_email.strip().casefold()
    if not email or "@" not in email or len(email) > 320 or any(c.isspace() for c in email):
        raise ValueError("Email tài khoản không hợp lệ")
    try:
        data = json.loads(raw)
    except (ValueError, RecursionError):
        raise ValueError("Nội dung không phải session JSON hợp lệ") from None
    if not isinstance(data, dict):
        raise ValueError("Session phải là một object JSON của một tài khoản")
    if data.get("type") in ("codex_oauth", "provider_oauth") or data.get("provider") == "codex":
        raise ValueError("Đây là token Codex/9Router OAuth, không phải session ChatGPT Web để đổi 2FA")
    token = data.get("accessToken")
    if not isinstance(token, str) or not token or len(token) > 32768 or any(c.isspace() for c in token):
        raise ValueError("Session thiếu accessToken ChatGPT Web hợp lệ")
    user = data.get("user")
    if not isinstance(user, dict) or str(user.get("email", "")).strip().casefold() != email:
        raise ValueError("Email trong session không khớp tài khoản đã nhập")
    # Local claims are only expiry hints; identity is checked upstream before mutation.
    try:
        expiry = data.get("expires")
        if expiry is not None:
            expires = datetime.fromisoformat(str(expiry).replace("Z", "+00:00"))
            if expires.tzinfo is None or expires.timestamp() <= time.time():
                raise ValueError
        if token.count(".") == 2:
            part = token.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
            exp = float(claims.get("exp", 0)) if isinstance(claims, dict) else 0
            if not math.isfinite(exp) or exp <= time.time():
                raise ValueError
    except (ValueError, TypeError, OverflowError, RecursionError, UnicodeError):
        raise ValueError("Session hết hạn hoặc thông tin hạn dùng không hợp lệ; hãy lấy session mới") from None
    # Do not import arbitrary cookies, refresh tokens, account IDs or upstream URLs.
    return {"accessToken": token, "user": {"email": email}}


async def check_session_identity(session: dict, expected_email: str, timeout: float) -> None:
    """Read-only capability check on a fixed host; no redirect, refresh or retry."""
    from curl_cffi.requests import AsyncSession

    try:
        async with AsyncSession(impersonate="chrome") as client:
            response = await client.get(
                "https://chatgpt.com/backend-api/me",
                headers={"Authorization": "Bearer " + session["accessToken"], "Accept": "application/json"},
                timeout=min(timeout, 30), allow_redirects=False,
            )
            if response.status_code != 200:
                raise ValueError
            user = response.json()
            if not isinstance(user, dict) or str(user.get("email", "")).strip().casefold() != expected_email.strip().casefold():
                raise ValueError
    except Exception:
        raise ValueError("Không xác minh được session ChatGPT Web đúng tài khoản; chưa thực hiện đổi 2FA") from None
