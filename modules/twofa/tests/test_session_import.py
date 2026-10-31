from __future__ import annotations

import base64
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "change 2fa community"
for path in (str(ROOT), str(APP_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from session_import import check_session_identity, parse_session  # noqa: E402
from service import TwoFAFlowError, TwoFAService  # noqa: E402


EMAIL = "owner@example.test"
TOKEN = "synthetic-chatgpt-web-token"


def session_payload(**overrides):
    value = {
        "accessToken": TOKEN,
        "user": {"email": EMAIL, "name": "Synthetic"},
        "accountId": "must-not-be-imported",
        "__cookies": [{"name": "session", "value": "must-not-be-imported"}],
        "refreshToken": "must-not-be-imported",
    }
    value.update(overrides)
    return value


def jwt_with_exp(exp: int) -> str:
    encoded = base64.urlsafe_b64encode(
        json.dumps({"exp": exp}).encode("utf-8")
    ).rstrip(b"=").decode("ascii")
    return f"header.{encoded}.signature"


class SessionParserTests(unittest.TestCase):
    def test_returns_minimal_web_session_and_normalizes_email(self) -> None:
        parsed = parse_session(json.dumps(session_payload()), "  OWNER@EXAMPLE.TEST ")

        self.assertEqual(
            parsed,
            {"accessToken": TOKEN, "user": {"email": EMAIL}},
        )

    def test_rejects_malformed_or_non_object_json(self) -> None:
        for raw in ("{", "[]", "null", '"text"'):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, "session JSON|object JSON"):
                    parse_session(raw, EMAIL)

    def test_rejects_email_mismatch_without_echoing_input(self) -> None:
        raw = json.dumps(session_payload(user={"email": "other@example.test"}))

        with self.assertRaisesRegex(ValueError, "Email trong session không khớp") as caught:
            parse_session(raw, EMAIL)

        self.assertNotIn(TOKEN, str(caught.exception))
        self.assertNotIn("other@example.test", str(caught.exception))

    def test_rejects_oversized_input_and_bad_token(self) -> None:
        with self.assertRaisesRegex(ValueError, "vượt giới hạn"):
            parse_session("x" * (128 * 1024 + 1), EMAIL)

        for token in ("", "token with spaces", "x" * 32769):
            with self.subTest(token=token[:20]):
                with self.assertRaisesRegex(ValueError, "accessToken"):
                    parse_session(json.dumps(session_payload(accessToken=token)), EMAIL)

    def test_rejects_expired_iso_and_jwt_sessions(self) -> None:
        for value in (
            {"expires": "2000-01-01T00:00:00+00:00"},
            {"accessToken": jwt_with_exp(1)},
        ):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "hết hạn"):
                    parse_session(json.dumps(session_payload(**value)), EMAIL)

    def test_rejects_invalid_jwt_claims_and_codex_oauth(self) -> None:
        for token in ("header.not-base64.signature", "header.eyJleHAiOiJub25lIn0.signature"):
            with self.subTest(token=token):
                with self.assertRaisesRegex(ValueError, "hết hạn"):
                    parse_session(json.dumps(session_payload(accessToken=token)), EMAIL)

        for marker in (
            {"type": "codex_oauth"},
            {"type": "provider_oauth"},
            {"provider": "codex"},
        ):
            with self.subTest(marker=marker):
                with self.assertRaisesRegex(ValueError, "Codex/9Router"):
                    parse_session(json.dumps(session_payload(**marker)), EMAIL)


class _Response:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _AsyncSession:
    response = _Response(200, {"email": EMAIL})
    calls: list[tuple[str, dict]] = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


class SessionIdentityTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_upstream_identity_mismatch_without_retry(self) -> None:
        _AsyncSession.calls = []
        _AsyncSession.response = _Response(200, {"email": "other@example.test"})
        try:
            with patch("curl_cffi.requests.AsyncSession", _AsyncSession):
                with self.assertRaisesRegex(ValueError, "chưa thực hiện đổi 2FA") as caught:
                    await check_session_identity({"accessToken": TOKEN}, EMAIL, timeout=5)
        finally:
            _AsyncSession.response = _Response(200, {"email": EMAIL})
        self.assertEqual(len(_AsyncSession.calls), 1)
        self.assertNotIn(TOKEN, str(caught.exception))
        self.assertNotIn("other@example.test", str(caught.exception))

    async def test_uses_one_fixed_no_redirect_read_only_request(self) -> None:
        _AsyncSession.calls = []
        with patch("curl_cffi.requests.AsyncSession", _AsyncSession):
            await check_session_identity(
                {"accessToken": TOKEN}, EMAIL, timeout=90
            )

        self.assertEqual(len(_AsyncSession.calls), 1)
        url, kwargs = _AsyncSession.calls[0]
        self.assertEqual(url, "https://chatgpt.com/backend-api/me")
        self.assertFalse(kwargs["allow_redirects"])
        self.assertEqual(kwargs["timeout"], 30)
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer " + TOKEN)

    async def test_failure_is_fixed_and_does_not_retry(self) -> None:
        _AsyncSession.calls = []
        _AsyncSession.response = _Response(401, {"email": EMAIL})
        try:
            with patch("curl_cffi.requests.AsyncSession", _AsyncSession):
                with self.assertRaisesRegex(ValueError, "chưa thực hiện đổi 2FA") as caught:
                    await check_session_identity(
                        {"accessToken": TOKEN}, EMAIL, timeout=5
                    )
        finally:
            _AsyncSession.response = _Response(200, {"email": EMAIL})

        self.assertEqual(len(_AsyncSession.calls), 1)
        self.assertNotIn(TOKEN, str(caught.exception))


class SessionServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_identity_marker_rotation_checkpoint_and_fresh_login_order(self) -> None:
        events = []
        logs = []

        async def identity(*_args):
            events.append("identity")

        async def marker():
            events.append("marker")

        async def rotate(**kwargs):
            self.assertEqual(kwargs["access_token"], TOKEN)
            self.assertIsNone(kwargs["cookies"])
            kwargs["log"]("upstream-sensitive-detail")
            events.append("rotate")
            return {"activated": True, "secret": "SYNTHETIC-NEW-SECRET"}

        async def checkpoint(secret):
            self.assertEqual(secret, "SYNTHETIC-NEW-SECRET")
            events.append("checkpoint")

        async def verify(**kwargs):
            self.assertEqual(kwargs["new_secret"], "SYNTHETIC-NEW-SECRET")
            events.append("fresh-login")

        service = TwoFAService(rotate_fn=rotate)
        with (
            patch("session_import.check_session_identity", identity),
            patch.object(service, "_inspect_account", AsyncMock(return_value=(None,) * 5)),
            patch.object(service, "_verify_login", verify),
        ):
            result = await service.rotate_session(
                session={"accessToken": TOKEN}, email=EMAIL,
                password="synthetic-password", timeout=5,
                checkpoint=checkpoint, before_mutation=marker, log=logs.append,
            )
        self.assertEqual(events, ["identity", "marker", "rotate", "checkpoint", "fresh-login"])
        self.assertTrue(result.login_verified)
        self.assertNotIn("upstream-sensitive-detail", " ".join(logs))

    async def test_identity_or_marker_failure_prevents_rotation(self) -> None:
        for failure in ("identity", "marker"):
            with self.subTest(failure=failure):
                rotate = AsyncMock()
                identity = AsyncMock(side_effect=ValueError(TOKEN) if failure == "identity" else None)
                marker = AsyncMock(side_effect=RuntimeError(TOKEN) if failure == "marker" else None)
                checkpoint = AsyncMock()
                service = TwoFAService(rotate_fn=rotate)
                with (
                    patch("session_import.check_session_identity", identity),
                    patch.object(service, "_inspect_account", AsyncMock(return_value=(None,) * 5)),
                    patch.object(service, "_verify_login", AsyncMock()) as verify,
                ):
                    with self.assertRaises(TwoFAFlowError) as caught:
                        await service.rotate_session(
                            session={"accessToken": TOKEN}, email=EMAIL,
                            password="synthetic-password", timeout=5,
                            checkpoint=checkpoint, before_mutation=marker, log=lambda _: None,
                        )
                rotate.assert_not_awaited()
                checkpoint.assert_not_awaited()
                verify.assert_not_awaited()
                self.assertNotIn(TOKEN, str(caught.exception))
                if failure == "identity":
                    marker.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
