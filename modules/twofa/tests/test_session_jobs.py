from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "change 2fa community"
for path in (str(ROOT), str(APP_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from jobs import TwoFAJobManager  # noqa: E402
from service import RotationResult  # noqa: E402


EMAIL = "session-owner@example.test"
TOKEN = "synthetic-session-token"


def session_data(email: str = EMAIL) -> dict:
    return {"accessToken": TOKEN, "user": {"email": email}}


class _SettingsRepo:
    def list(self, _prefix=None):
        return {}


class _JobRepo:
    def __init__(self, rows=None):
        self.rows: dict[str, dict] = {
            row["id"]: dict(row) for row in (rows or [])
        }
        self.updates: list[tuple[str, str, dict]] = []
        self.fail_marker = False
        self.fail_checkpoint = False
        self.fail_checkpoint_once = False
        self.fail_completion_once = False

    def list_all(self):
        return [dict(row) for row in self.rows.values()]

    def get_logs(self, _job_id: str):
        return []

    def create(self, row):
        self.rows[row["id"]] = dict(row)
        return row["id"]

    def update_status(self, job_id: str, status: str, **kwargs) -> None:
        state = kwargs.get("account_check", "")
        if self.fail_marker and '"session_mutation_started": true' in state:
            raise RuntimeError("marker persistence failure")
        if self.fail_checkpoint and '"rotated_pending_verify": true' in state:
            if self.fail_checkpoint_once:
                self.fail_checkpoint_once = False
                raise RuntimeError("checkpoint persistence failure")
            raise RuntimeError("checkpoint persistence failure")
        self.updates.append((job_id, status, dict(kwargs)))
        self.rows.setdefault(job_id, {}).update({"id": job_id, "status": status, **kwargs})

    def append_log(self, _job_id: str, _line: str) -> None:
        raise AssertionError("imported session logs must stay suppressed")

    def complete_twofa_success(self, **kwargs):
        if self.fail_completion_once:
            self.fail_completion_once = False
            raise RuntimeError("completion persistence failure")
        self.update_status(kwargs["job_id"], "success", secret=kwargs["secret"], account_check=kwargs["account_check"])


class _SessionService:
    def __init__(self):
        self.rotate_session_calls = 0
        self.verify_calls = 0
        self.events: list[str] = []

    async def rotate_session(self, **kwargs):
        self.rotate_session_calls += 1
        self.events.append("service.rotate_session")
        await kwargs["before_mutation"]()
        self.events.append("upstream.rotate")
        await kwargs["checkpoint"]("NEW-SYNTHETIC-SECRET")
        self.events.append("fresh-login")
        return RotationResult(
            secret="NEW-SYNTHETIC-SECRET", login_verified=True, account_state="live"
        )

    async def verify(self, **kwargs):
        self.verify_calls += 1
        self.events.append("service.verify")
        return RotationResult(
            secret=kwargs["new_secret"], login_verified=True, account_state="live"
        )


async def _run_to_terminal(manager: TwoFAJobManager, job_id: str) -> None:
    await manager._run(manager.jobs[job_id])


class SessionJobRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.repo = _JobRepo()
        self.service = _SessionService()
        self.manager = TwoFAJobManager(self.repo, _SettingsRepo(), service=self.service)

    async def asyncTearDown(self) -> None:
        await self.manager.shutdown()

    def _add(self) -> dict:
        return self.manager.add_session(EMAIL, "synthetic-password", session_data())

    async def test_marker_is_durable_before_mutation_and_blocks_rotate_on_failure(self) -> None:
        created = self._add()
        self.repo.fail_marker = True

        await _run_to_terminal(self.manager, created["id"])

        job = self.manager.jobs[created["id"]]
        self.assertEqual(job.status, "error")
        self.assertTrue(job.session_mutation_started)
        self.assertEqual(self.service.events, ["service.rotate_session"])
        self.assertNotIn("upstream.rotate", self.service.events)
        self.assertNotIn(TOKEN, json.dumps(self.repo.rows))

    async def test_checkpoint_failure_is_retryable_as_verify_only(self) -> None:
        created = self._add()
        self.repo.fail_checkpoint = True
        self.repo.fail_checkpoint_once = True

        await _run_to_terminal(self.manager, created["id"])

        job = self.manager.jobs[created["id"]]
        self.assertEqual(job.status, "error")
        self.assertTrue(job.rotated_pending_verify)
        self.assertEqual(job.secret, "NEW-SYNTHETIC-SECRET")
        self.assertTrue(job.retryable)
        self.assertEqual(self.service.rotate_session_calls, 1)

        self.repo.fail_checkpoint = False
        self.manager.retry(job.id)
        self.assertEqual(self.manager._queue.get_nowait(), job.id)
        self.manager._queue.task_done()
        await _run_to_terminal(self.manager, job.id)

        self.assertEqual(self.service.rotate_session_calls, 1)
        self.assertEqual(self.service.verify_calls, 1)
        self.assertEqual(job.status, "success")
        self.assertFalse(job.rotated_pending_verify)

    async def test_final_persistence_failure_preserves_verify_checkpoint(self) -> None:
        created = self._add()
        self.repo.fail_completion_once = True

        await _run_to_terminal(self.manager, created["id"])

        job = self.manager.jobs[created["id"]]
        self.assertEqual(job.status, "error")
        self.assertTrue(job.rotated_pending_verify)
        self.assertIn("Khóa mới đã lưu", job.error)
        self.assertTrue(job.retryable)

    async def test_missing_ram_session_after_recovery_fails_closed(self) -> None:
        created = self._add()
        self.manager._sessions.pop(created["id"])

        await _run_to_terminal(self.manager, created["id"])

        self.assertEqual(self.service.rotate_session_calls, 0)
        self.assertEqual(self.manager.jobs[created["id"]].status, "error")
        self.assertIn("Session đã xóa khỏi RAM", self.manager.jobs[created["id"]].error)

    async def test_recovered_session_row_never_replays_without_ram_token(self) -> None:
        created = self._add()
        row = self.repo.rows[created["id"]]
        recovered = TwoFAJobManager(self.repo, _SettingsRepo(), service=self.service)
        try:
            await _run_to_terminal(recovered, created["id"])
        finally:
            await recovered.shutdown()

        self.assertEqual(self.service.rotate_session_calls, 0)
        self.assertEqual(recovered.jobs[created["id"]].status, "error")
        self.assertEqual(row["secret"], "")

    async def test_other_account_can_queue_while_imported_account_is_busy(self) -> None:
        first = self._add()
        other = self.manager.add(
            ["other@example.test|synthetic-password|ABCDEFGHIJKLMNOP"],
            "check_only",
        )[0]

        self.assertEqual(self.manager.jobs[first["id"]].email, EMAIL)
        self.assertEqual(self.manager.jobs[other["id"]].email, "other@example.test")
        with self.assertRaisesRegex(ValueError, "đang đổi 2FA bằng session"):
            self.manager.add_session(EMAIL, "synthetic-password", session_data())

    async def test_snapshot_and_imported_job_logs_never_expose_token(self) -> None:
        created = self._add()
        snapshot = self.manager.jobs[created["id"]].snapshot()

        self.assertNotIn(TOKEN, json.dumps(snapshot))
        self.assertNotIn("synthetic-password", json.dumps(snapshot))
        self.assertEqual(self.manager.jobs[created["id"]].logs, [])


if __name__ == "__main__":
    unittest.main()
