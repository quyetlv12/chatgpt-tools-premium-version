from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "change 2fa community"
for path in (str(ROOT), str(APP_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

import server  # noqa: E402


EMAIL = "session-owner@example.test"
TOKEN = "synthetic-session-token"
HEADERS = {"X-Auth-Token": server.auth_token}


class _ApiManager:
    def __init__(self, result=None):
        self.jobs = {}
        self.result = result or {
            "id": "session-job",
            "email": EMAIL,
            "status": "queued",
            "session_imported": True,
            "account_state": "unknown",
        }
        self.calls: list[tuple[str, str, dict]] = []
        self.error: Exception | None = None

    def add_session(self, email: str, password: str, session: dict):
        self.calls.append((email, password, session))
        if self.error:
            raise self.error
        return dict(self.result)


class _PasswordManager:
    jobs: dict = {}


class SessionApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_manager = server.manager
        self.original_password_manager = server.password_manager
        self.original_passkey_manager = server.passkey_manager
        self.manager = _ApiManager()
        server.manager = self.manager
        server.password_manager = _PasswordManager()
        server.passkey_manager = type(
            "PasskeyStub", (), {"is_busy": lambda _self, _email: False}
        )()
        self.client = TestClient(server.app)

    def tearDown(self) -> None:
        server.manager = self.original_manager
        server.password_manager = self.original_password_manager
        server.passkey_manager = self.original_passkey_manager

    def payload(self, **overrides):
        data = {
            "email": EMAIL,
            "password": "synthetic-password",
            "session_json": json.dumps({"accessToken": TOKEN, "user": {"email": EMAIL}}),
            "confirm": "CHANGE_2FA_FROM_SESSION",
        }
        data.update(overrides)
        return data

    def request(self, *, headers=HEADERS, **overrides):
        return self.client.post(
            "/api/session-jobs", headers=headers, json=self.payload(**overrides)
        )

    def test_requires_auth_and_confirmation_without_calling_manager(self) -> None:
        self.assertEqual(
            self.client.post("/api/session-jobs", json=self.payload()).status_code,
            401,
        )
        response = self.request(confirm="WRONG")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.manager.calls, [])

    def test_parser_errors_are_fixed_and_do_not_echo_session_values(self) -> None:
        response = self.request(session_json="{")
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(TOKEN, response.text)
        self.assertNotIn("synthetic-password", response.text)

        response = self.request(session_json=json.dumps({"user": {"email": EMAIL}}))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Session thiếu accessToken ChatGPT Web hợp lệ")
        self.assertNotIn(TOKEN, response.text)
        self.assertNotIn("synthetic-password", response.text)

    def test_conflict_and_persistence_errors_are_safe(self) -> None:
        self.manager.error = ValueError("busy account")
        response = self.request()
        self.assertEqual(response.status_code, 409)
        self.assertNotIn("busy account", response.text)

        self.manager.error = RuntimeError(f"database leaked {TOKEN}")
        response = self.request()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(TOKEN, response.text)

    def test_rejects_oversized_body_before_enqueuing(self) -> None:
        response = self.request(session_json="x" * (256 * 1024))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.manager.calls, [])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("synthetic-password", response.text)

    def test_success_returns_safe_snapshot_and_no_store_headers(self) -> None:
        response = self.request()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["job"]["id"], "session-job")
        self.assertNotIn(TOKEN, response.text)
        self.assertNotIn("synthetic-password", response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(self.manager.calls[0][0], EMAIL)
        self.assertEqual(self.manager.calls[0][2]["accessToken"], TOKEN)


if __name__ == "__main__":
    unittest.main()
