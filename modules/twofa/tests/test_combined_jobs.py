from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "change 2fa community"
for path in (str(ROOT), str(APP_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from combined_jobs import CombinedWorkflowManager  # noqa: E402
from jobs import TwoFAJob, TwoFAJobManager  # noqa: E402
from service import TwoFAService  # noqa: E402
import server  # noqa: E402


class _Manager:
    def __init__(self, *, enqueue_result: str = "success") -> None:
        self.source = SimpleNamespace(
            id="source-1",
            email="account@example.com",
            status="success",
            account_state="live",
            login_verified=True,
            mode="check_only",
            rotated_pending_verify=False,
            error=None,
        )
        self.jobs = {self.source.id: self.source}
        self.enqueue_result = enqueue_result
        self.enqueue_calls = 0
        self.stop_calls = 0
        self.logout_calls = 0
        self.events: list[str] = []

    def enqueue_change_2fa(self, _job_id: str) -> None:
        self.enqueue_calls += 1
        self.events.append("twofa")
        if self.enqueue_result == "success":
            self.source.status = "success"
            self.source.login_verified = True
            self.source.rotated_pending_verify = False
        elif self.enqueue_result == "unverified":
            self.source.status = "success"
            self.source.login_verified = False
            self.source.rotated_pending_verify = True
        elif self.enqueue_result == "cancelled":
            self.source.status = "cancelled"
        elif self.enqueue_result == "error":
            self.source.status = "error"
            self.source.error = "synthetic 2FA failure"
        else:
            self.source.status = "running"

    async def logout_all_sessions(self, _job_id: str) -> None:
        self.logout_calls += 1
        self.events.append("logout")

    def stop(self, _job_id: str) -> dict:
        self.stop_calls += 1
        self.source.status = "cancelled"
        return {"id": self.source.id, "status": self.source.status}


async def _wait_for(predicate, timeout: float = 1.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() >= deadline:
            raise AssertionError("timed out waiting for combined workflow")
        await asyncio.sleep(0.005)


class CombinedWorkflowTests(IsolatedAsyncioTestCase):
    async def test_bulk_live_rows_rotate_once_before_logout_with_real_workers(self) -> None:
        events: dict[str, list[str]] = {}
        persisted: dict[str, dict] = {}
        active = peak = 0
        check_calls = 0

        def update_status(job_id, status, **kwargs):
            state = json.loads(kwargs["account_check"])
            persisted[job_id] = {"status": status, **kwargs, **state}
            if state["rotated_pending_verify"]:
                self.assertFalse(state["login_verified"])
                events[job_id].append("checkpoint")

        def complete_success(**kwargs):
            job_id = kwargs["job_id"]
            state = json.loads(kwargs["account_check"])
            self.assertTrue(state["login_verified"])
            self.assertFalse(state["rotated_pending_verify"])
            self.assertEqual(events[job_id][-1], "verify")
            persisted[job_id] = {"status": "success", **kwargs, **state}
            events[job_id].append("complete")

        async def login(**kwargs):
            email = kwargs["email"]
            if kwargs["secret"] == "SYNTHETIC_OLD":
                events[email].append("login")
            else:
                self.assertEqual(kwargs["secret"], f"SYNTHETIC_NEW_{email}")
                self.assertEqual(persisted[email]["secret"], kwargs["secret"])
                if "verify" not in events[email]:
                    self.assertTrue(persisted[email]["rotated_pending_verify"])
                    self.assertEqual(events[email][-1], "checkpoint")
                    events[email].append("verify")
                else:
                    self.assertEqual(persisted[email]["status"], "success")
                    events[email].append("logout_login")
            return {"accessToken": email}

        async def rotate(**kwargs):
            nonlocal active, peak
            email = kwargs["access_token"]
            events[email].append("rotate")
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.001)
            active -= 1
            return {"activated": True, "secret": f"SYNTHETIC_NEW_{email}"}

        async def entitlement(**_kwargs):
            return {"plan": "free"}

        async def logout(**kwargs):
            email = kwargs["access_token"]
            self.assertEqual(events[email][-2:], ["complete", "logout_login"])
            events[email].append("logout")

        service = TwoFAService(
            login_fn=login, rotate_fn=rotate, entitlement_fn=entitlement,
            logout_sessions_fn=logout, login_attempts=1,
        )
        original_check = service.check

        async def record_check(**kwargs):
            nonlocal check_calls
            check_calls += 1
            return await original_check(**kwargs)

        service.check = record_check
        repo = SimpleNamespace(
            list_all=lambda: [], append_log=lambda *_args: None,
            update_status=update_status, complete_twofa_success=complete_success,
        )
        settings = SimpleNamespace(list=lambda *_args: {
            "twofa.max_concurrent": 3, "twofa.change_enabled": False,
            "twofa.read_usage": False, "twofa.read_payment_methods": False,
        })
        manager = TwoFAJobManager(repo, settings, service=service)
        for index in range(60):
            email = f"synthetic-{index}@example.test"
            events[email] = []
            job = TwoFAJob(
                id=email, email=email, password="synthetic", secret="SYNTHETIC_OLD",
                mode="check_only", status="success", account_state="live",
                login_verified=True,
            )
            manager.jobs[job.id] = job
            manager.order.append(job.id)
        manager.start()
        workflows = CombinedWorkflowManager(manager, wait_interval=0.02)
        try:
            await asyncio.gather(*(workflows.start(job_id) for job_id in manager.order))
            await _wait_for(
                lambda: all(op.status in {"success", "error", "cancelled"}
                            for op in workflows.jobs.values()),
                timeout=5.0,
            )
            self.assertEqual(len(workflows.jobs), 60)
            self.assertTrue(all(op.status == "success" for op in workflows.jobs.values()))
            self.assertEqual(check_calls, 0)
            self.assertEqual(peak, 3)
            self.assertFalse(manager.settings["twofa.change_enabled"])
            self.assertEqual({job.mode for job in manager.jobs.values()}, {"change_2fa"})
            self.assertEqual(len(manager.output()), 60)
            for email, account_events in events.items():
                with self.subTest(email=email):
                    self.assertEqual(account_events, [
                        "login", "rotate", "checkpoint", "verify", "complete",
                        "logout_login", "logout",
                    ])
        finally:
            await workflows.shutdown()
            await manager.shutdown()

    async def test_start_runs_fixed_twofa_then_logout_without_confirmation(self) -> None:
        source = _Manager()
        workflows = CombinedWorkflowManager(source, wait_interval=0.001)
        try:
            operation = await workflows.start("source-1")
            await _wait_for(lambda: workflows.jobs[operation["id"]].status == "success")
            self.assertEqual(operation["steps"], ["twofa", "logout"])
            self.assertEqual(source.events, ["twofa", "logout"])
            self.assertEqual(workflows.snapshot(operation["id"])["phase"], "completed")
        finally:
            await workflows.shutdown()

    async def test_failed_cancelled_or_unverified_2fa_never_calls_logout(self) -> None:
        for result in ("error", "cancelled", "unverified"):
            with self.subTest(result=result):
                source = _Manager(enqueue_result=result)
                workflows = CombinedWorkflowManager(source, wait_interval=0.001)
                try:
                    operation = await workflows.start("source-1")
                    await _wait_for(lambda: workflows.jobs[operation["id"]].status == "error")
                    self.assertEqual(source.events, ["twofa"])
                    self.assertEqual(source.logout_calls, 0)
                finally:
                    await workflows.shutdown()

    async def test_stop_cancels_active_source_and_skips_logout(self) -> None:
        source = _Manager(enqueue_result="running")
        workflows = CombinedWorkflowManager(source, wait_interval=0.001)
        try:
            operation = await workflows.start("source-1")
            await _wait_for(lambda: source.enqueue_calls == 1)
            stopped = workflows.stop(operation["id"])
            self.assertEqual(stopped["status"], "cancelled")
            await asyncio.sleep(0.03)
            self.assertEqual(source.stop_calls, 1)
            self.assertEqual(source.logout_calls, 0)
            self.assertFalse(workflows.is_busy(source.source.email))
        finally:
            await workflows.shutdown()

    async def test_timeout_cancels_source_before_releasing_lock(self) -> None:
        source = _Manager(enqueue_result="running")
        workflows = CombinedWorkflowManager(source, wait_interval=0.001)
        workflows.wait_timeout = 0.01
        try:
            operation = await workflows.start("source-1")
            await _wait_for(lambda: workflows.jobs[operation["id"]].status == "error")
            self.assertEqual(source.stop_calls, 1)
            self.assertEqual(source.logout_calls, 0)
            self.assertFalse(workflows.is_busy(source.source.email))
        finally:
            await workflows.shutdown()


class _CombinedApiManager:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def start(self, job_id: str) -> dict:
        self.calls.append(job_id)
        return {
            "id": "combined-api-test",
            "job_id": job_id,
            "email": "account@example.com",
            "steps": ["twofa", "logout"],
            "status": "running",
            "phase": "changing_2fa",
        }


class CombinedWorkflowApiTests(TestCase):
    def setUp(self) -> None:
        self.original_manager = server.manager
        self.original_combined_manager = server.combined_manager
        self.original_passkey_manager = server.passkey_manager
        self.original_password_manager = server.password_manager
        server.manager = SimpleNamespace(
            jobs={"source-1": SimpleNamespace(email="account@example.com")}
        )
        self.combined_manager = _CombinedApiManager()
        server.combined_manager = self.combined_manager
        server.passkey_manager = SimpleNamespace(is_busy=lambda _email: False)
        server.password_manager = SimpleNamespace(jobs={})
        self.client = TestClient(server.app)
        self.headers = {"X-Auth-Token": server.auth_token}

    def tearDown(self) -> None:
        server.manager = self.original_manager
        server.combined_manager = self.original_combined_manager
        server.passkey_manager = self.original_passkey_manager
        server.password_manager = self.original_password_manager

    def test_start_api_runs_fixed_workflow_without_steps(self) -> None:
        response = self.client.post(
            "/api/jobs/source-1/combined/start",
            headers=self.headers,
            json={"confirm": "START_COMBINED"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.combined_manager.calls, ["source-1"])
        self.assertEqual(response.json()["steps"], ["twofa", "logout"])

    def test_start_api_rejects_client_selected_steps(self) -> None:
        response = self.client.post(
            "/api/jobs/source-1/combined/start",
            headers=self.headers,
            json={"confirm": "START_COMBINED", "steps": ["twofa"]},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.combined_manager.calls, [])

    def test_start_api_rejects_active_password_job_for_same_email(self) -> None:
        server.password_manager.jobs = {
            "password-1": SimpleNamespace(email="ACCOUNT@example.com", status="running")
        }

        response = self.client.post(
            "/api/jobs/source-1/combined/start",
            headers=self.headers,
            json={"confirm": "START_COMBINED"},
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "Tài khoản đang đổi mật khẩu; vui lòng chờ")
        self.assertEqual(self.combined_manager.calls, [])

    def test_passkey_confirmation_route_was_removed(self) -> None:
        response = self.client.post(
            "/api/combined/combined-api-test/confirm-passkey",
            headers=self.headers,
            json={"confirm": "CONFIRM_PASSKEY"},
        )
        self.assertEqual(response.status_code, 404)
