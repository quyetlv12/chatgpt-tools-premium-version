"""A saved rotation checkpoint retries verification, never another mutation."""
from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT / "change 2fa community"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from jobs import JOB_TYPE, TwoFAJob, TwoFAJobManager
from service import RotationResult, TwoFAFlowError, TwoFAService
from test_inspection_options import _JobRepo, _SettingsRepo

SECRET = "ABCDEFGHIJKLMNOP"


class PendingVerificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_recovered_credential_error_retries_only_saved_secret_verification(self):
        repo = _JobRepo([{
            "id": "saved-checkpoint", "job_type": JOB_TYPE, "status": "error",
            "email": "checkpoint@example.test", "password": "synthetic-password",
            "secret": SECRET,
            "account_check": json.dumps({
                "mode": "change_2fa", "rotated_pending_verify": True,
                "error_kind": "invalid_credentials", "login_verified": False,
            }),
        }])
        service = AsyncMock(spec=TwoFAService)
        service.verify.return_value = RotationResult(secret=SECRET, login_verified=True)
        manager = TwoFAJobManager(repo, _SettingsRepo(), service=service)
        try:
            job = manager.jobs["saved-checkpoint"]
            self.assertTrue(job.snapshot()["retryable"])
            manager.retry(job.id)
            self.assertEqual(manager._queue.get_nowait(), job.id)
            manager._queue.task_done()
            await manager._run(job)
            service.verify.assert_awaited_once()
            self.assertEqual(service.verify.call_args.kwargs["new_secret"], SECRET)
            service.rotate.assert_not_awaited()
            service.rotate_session.assert_not_awaited()
            self.assertEqual(job.secret, SECRET)
            self.assertEqual(job.status, "success")
            self.assertTrue(job.login_verified)
            self.assertFalse(job.rotated_pending_verify)
        finally:
            await manager.shutdown()

    async def test_pending_verification_does_not_override_account_die(self):
        manager = TwoFAJobManager(_JobRepo(), _SettingsRepo())
        job = TwoFAJob("die", "die@example.test", "synthetic", SECRET,
                       status="error", rotated_pending_verify=True, error_kind="account_die")
        manager.jobs[job.id] = job
        try:
            self.assertFalse(job.retryable)
            with self.assertRaisesRegex(ValueError, "tài khoản die"):
                manager.retry(job.id)
            self.assertTrue(manager._queue.empty())
        finally:
            await manager.shutdown()

    async def test_manual_checkpoint_retry_does_not_enable_automatic_credential_retry(self):
        manager = TwoFAJobManager(_JobRepo(), _SettingsRepo({"twofa.auto_retry": True}))
        try:
            for kind in ("invalid_credentials", "verification_required", "account_die"):
                with self.subTest(kind=kind):
                    job = TwoFAJob("pending", "test@example.test", "synthetic", SECRET,
                                   status="error", rotated_pending_verify=True, error_kind=kind)
                    self.assertEqual(job.retryable, kind != "account_die")
                    self.assertFalse(manager._should_auto_retry(job))
            job = TwoFAJob("transient", "test@example.test", "synthetic", SECRET,
                           status="error", error_kind="technical_error")
            self.assertTrue(manager._should_auto_retry(job))
            job.error_kind = "verification_required"
            self.assertFalse(job.retryable)
            self.assertFalse(manager._should_auto_retry(job))
        finally:
            await manager.shutdown()

    async def test_email_challenge_needs_verification_and_stops_after_one_login(self):
        login = AsyncMock(side_effect=RuntimeError(
            "account uses passwordless OTP login but no mail_provider available."
        ))
        service = TwoFAService(login_fn=login, login_attempts=3, retry_delay=0)
        with self.assertRaises(TwoFAFlowError) as raised:
            await service._login(email="test@example.test", password="synthetic",
                                 secret=SECRET, timeout=5, log=lambda _: None)
        self.assertEqual(raised.exception.error_kind, "verification_required")
        self.assertEqual(raised.exception.account_state, "unknown")
        self.assertNotIn("passwordless", str(raised.exception))
        login.assert_awaited_once()

    async def test_stale_retry_timer_rechecks_current_security_error(self):
        manager = TwoFAJobManager(_JobRepo(), _SettingsRepo({
            "twofa.auto_retry": True, "twofa.auto_retry_max": 2,
        }))
        try:
            for kind in ("invalid_credentials", "verification_required"):
                with self.subTest(kind=kind):
                    job = TwoFAJob("pending", "test@example.test", "synthetic", SECRET,
                                   status="error", rotated_pending_verify=True,
                                   retry_count=1, error_kind="technical_error")
                    manager.jobs[job.id] = job
                    self.assertTrue(manager._should_auto_retry(job))
                    timer = asyncio.create_task(manager._delayed_retry(job.id, 0))
                    await asyncio.sleep(0)
                    job.error_kind = kind
                    await timer
                    self.assertEqual(job.status, "error")
                    self.assertEqual(job.retry_count, 1)
                    self.assertTrue(manager._queue.empty())
        finally:
            await manager.shutdown()

    async def test_password_rejection_remains_fatal_invalid_credentials(self):
        login = AsyncMock(side_effect=RuntimeError("password verify failed: HTTP 401 - invalid credentials"))
        service = TwoFAService(login_fn=login, login_attempts=3, retry_delay=0)
        with self.assertRaises(TwoFAFlowError) as raised:
            await service._login(email="test@example.test", password="synthetic",
                                 secret=SECRET, timeout=5, log=lambda _: None)
        self.assertEqual(raised.exception.error_kind, "invalid_credentials")
        login.assert_awaited_once()

    def test_legacy_email_challenge_is_not_bad_credentials(self):
        self.assertEqual(
            TwoFAJobManager._legacy_error_metadata("no mail_provider available"),
            ("verification_required", "unknown"),
        )


if __name__ == "__main__":
    unittest.main()
