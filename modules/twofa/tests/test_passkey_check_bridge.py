"""Passkey-to-Check integration using synthetic login data and a temporary SQLite DB."""
import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "change 2fa community")]

from db.engine import DatabaseEngine
from db.repositories import JobRepository, SettingsRepository
from jobs import TwoFAJob, TwoFAJobManager
from passkey_jobs import PasskeyJobManager
from service import TwoFAService

EMAIL = "bridge@example.test"
PASSWORD = "synthetic-password"
SECRET = "SYNTHETICTOTP"
TOKEN = "private-synthetic-bearer"
COOKIE = "private-synthetic-cookie"
URL = "https://auth.openai.com/passkey-enroll?mfa_token=private-synthetic-handoff"


class PasskeyCheckBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = DatabaseEngine(Path(self.temp.name) / "test.db")
        self.repo = JobRepository(self.engine)
        self.session = {
            "accessToken": TOKEN, "user": {"email": EMAIL},
            "__cookies": [{"name": "session", "value": COOKIE}],
        }
        self.login = AsyncMock(return_value=self.session)
        self.rotate = AsyncMock(side_effect=AssertionError("must not rotate"))
        self.logout = AsyncMock(side_effect=AssertionError("must not logout"))
        self.entitlement = AsyncMock(return_value={"plan": "plus", "payment_date": "2026-11-01"})
        self.usage = AsyncMock(return_value={"used_percent": 15, "remaining_percent": 85})
        self.payments = AsyncMock(return_value=[])
        self.service = TwoFAService(
            login_fn=self.login, rotate_fn=self.rotate, logout_sessions_fn=self.logout,
            entitlement_fn=self.entitlement, usage_fn=self.usage,
            payment_methods_fn=self.payments, login_attempts=1,
        )
        self.main = TwoFAJobManager(self.repo, SettingsRepository(self.engine), self.service)
        self.bulk = PasskeyJobManager(service=self.service, on_authenticated=self.main.add_authenticated_check)

    async def asyncTearDown(self):
        await self.bulk.shutdown()
        await self.main.shutdown()
        self.engine.close()
        self.temp.cleanup()

    async def run_passkey(self, *, handoff=None):
        created = self.bulk.add([f"{EMAIL}|{PASSWORD}|{SECRET}"])
        job = self.bulk.jobs[created[0]["id"]]
        with patch("passkey_service.prepare_passkey_url", new=handoff or AsyncMock(return_value=URL)):
            await self.bulk._run(job)
        return job

    async def test_one_login_populates_live_check_and_recovers_without_queueing(self):
        events = self.main.subscribe()
        job = await self.run_passkey()
        self.assertEqual(job.status, "success")
        self.login.assert_awaited_once()
        self.rotate.assert_not_awaited()
        self.logout.assert_not_awaited()
        self.assertEqual(len(self.main.jobs), 1)
        row = next(iter(self.main.jobs.values()))
        self.assertEqual((row.mode, row.status, row.account_state), ("check_only", "success", "live"))
        self.assertEqual((row.email, row.password, row.secret), (EMAIL, PASSWORD, SECRET))
        self.assertTrue(row.login_verified)
        self.assertFalse(row.session_imported)
        self.assertEqual(row.plan, "plus")
        self.assertEqual(row.usage["used_percent"], 15)
        self.assertEqual(row.billing_date, "2026-11-01")
        self.assertIsNotNone(row.finished_at)
        for endpoint in (self.entitlement, self.usage, self.payments):
            self.assertEqual(endpoint.await_args.kwargs["access_token"], TOKEN)
            self.assertIs(endpoint.await_args.kwargs["cookies"], self.session["__cookies"])
        self.assertTrue(self.main._queue.empty())
        self.assertEqual(self.main.output(), [])
        self.assertEqual(self.repo.list_twofa_history(), [])
        stored = self.repo.list_all()
        self.assertEqual(len(stored), 1)
        persisted = json.dumps(stored)
        public = json.dumps([self.main.snapshots(), self.bulk.snapshots(), events.get_nowait()])
        for private in (TOKEN, COOKIE, "accessToken", "__cookies", "private-synthetic-handoff"):
            self.assertNotIn(private, persisted + public)
        for private in (PASSWORD, SECRET):
            self.assertNotIn(private, public)
        recovered = TwoFAJobManager(self.repo, SettingsRepository(self.engine), self.service)
        self.assertEqual(recovered.jobs[row.id].status, "success")
        self.assertTrue(recovered.jobs[row.id].login_verified)
        self.assertTrue(recovered._queue.empty())
        self.assertEqual(self.repo.list_twofa_history(), [])

    async def test_handoff_failure_still_adds_check_after_successful_login(self):
        job = await self.run_passkey(handoff=AsyncMock(side_effect=RuntimeError(TOKEN)))
        self.assertEqual(job.status, "error")
        self.assertEqual(len(self.main.jobs), 1)
        self.login.assert_awaited_once()
        self.assertNotIn(TOKEN, json.dumps(self.bulk.snapshots()))

    async def test_failed_login_does_not_add_check(self):
        self.login.side_effect = RuntimeError(TOKEN)
        handoff = AsyncMock(return_value=URL)
        job = await self.run_passkey(handoff=handoff)
        self.assertEqual(job.status, "error")
        handoff.assert_not_awaited()
        self.assertEqual(self.main.jobs, {})
        self.assertEqual(self.repo.list_all(), [])

    async def test_mismatched_identity_and_persistence_failure_do_not_break_handoff(self):
        for failure in ("identity", "storage"):
            with self.subTest(failure=failure):
                self.session["user"]["email"] = "other@example.test" if failure == "identity" else EMAIL
                with patch.object(self.repo, "create", side_effect=RuntimeError(TOKEN)) as create:
                    job = await self.run_passkey()
                self.assertEqual(job.status, "success")
                self.assertEqual(self.main.jobs, {})
                self.assertEqual(self.repo.list_all(), [])
                if failure == "identity":
                    create.assert_not_called()
                self.assertTrue(any("Chưa thêm được" in line for line in job.logs))
                self.assertNotIn(TOKEN, json.dumps(self.bulk.snapshots()))

    async def test_inspection_options_and_internal_session_without_email(self):
        self.session.pop("user")
        self.main.settings["twofa.read_usage"] = False
        self.main.settings["twofa.read_payment_methods"] = False
        await self.run_passkey()
        self.login.assert_awaited_once()
        self.usage.assert_not_awaited()
        self.payments.assert_not_awaited()
        row = next(iter(self.main.jobs.values()))
        self.assertEqual((row.usage_enabled, row.payment_methods_enabled), (False, False))

    async def test_existing_rotated_row_is_preserved_and_manual_actions_stay_manual(self):
        old = TwoFAJob(id="old", email=EMAIL, password=PASSWORD, secret="NEWERSECRET",
                       status="success", rotated_pending_verify=True)
        self.main.jobs[old.id] = old
        self.main.order.append(old.id)
        await self.run_passkey()
        self.assertEqual(len(self.main.jobs), 2)
        self.assertIs(self.main.jobs[old.id], old)
        self.assertEqual(old.secret, "NEWERSECRET")
        self.rotate.assert_not_awaited()
        self.logout.assert_not_awaited()

    async def test_clear_during_inspection_discards_result_even_when_list_was_empty(self):
        entered, release = asyncio.Event(), asyncio.Event()

        async def inspect(**_kwargs):
            entered.set()
            await release.wait()
            return "plus", "session", None, None, None

        with patch.object(self.service, "_inspect_account", new=inspect):
            task = asyncio.create_task(self.run_passkey())
            await asyncio.wait_for(entered.wait(), 1)
            self.assertEqual(await self.main.clear_async(), 0)
            release.set()
            job = await task
        self.assertEqual(job.status, "success")
        self.assertEqual(self.main.jobs, {})
        self.assertEqual(self.repo.list_all(), [])

    async def test_busy_account_rejected_before_and_after_inspection(self):
        old = TwoFAJob(id="busy", email=EMAIL, password=PASSWORD, secret=SECRET,
                       status="running")
        self.main.jobs[old.id] = old
        self.main.order.append(old.id)
        job = await self.run_passkey()
        self.entitlement.assert_not_awaited()
        self.assertEqual(job.status, "success")
        old.status = "success"

        async def inspect(**_kwargs):
            old.sessions_logging_out = True
            return None, None, None, None, None

        with patch.object(self.service, "_inspect_account", new=inspect):
            job = await self.run_passkey()
        old.sessions_logging_out = False
        self.assertEqual(job.status, "success")
        self.assertEqual(list(self.main.jobs), [old.id])
        self.assertEqual(self.repo.list_all(), [])

    async def test_cancel_during_login_or_inspection_never_persists_partial_check(self):
        for phase in ("login", "inspection"):
            with self.subTest(phase=phase):
                entered, release = asyncio.Event(), asyncio.Event()

                async def pause(**_kwargs):
                    entered.set()
                    await release.wait()
                    return self.session

                target = "_login" if phase == "login" else "_inspect_account"
                with patch.object(self.service, target, new=pause):
                    task = asyncio.create_task(self.run_passkey())
                    await asyncio.wait_for(entered.wait(), 1)
                    task.cancel()
                    release.set()
                    job = await asyncio.wait_for(task, 1)
                self.assertEqual(job.status, "cancelled")
                self.assertEqual(self.repo.list_all(), [])

    async def test_inspection_does_not_consume_handoff_deadline(self):
        self.bulk.job_timeout = 0.01

        async def inspect(**_kwargs):
            await asyncio.sleep(0.02)
            return "plus", "session", None, None, None

        with patch.object(self.service, "_inspect_account", new=inspect):
            job = await self.run_passkey()
        self.assertEqual(job.status, "success")
        self.assertEqual(len(self.main.jobs), 1)
        self.login.assert_awaited_once()

    async def test_regular_check_still_logs_in_once(self):
        result = await self.service.check(email=EMAIL, password=PASSWORD, secret=SECRET,
                                          timeout=30, log=lambda _: None)
        self.login.assert_awaited_once()
        self.assertTrue(result.login_verified)
        self.rotate.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
