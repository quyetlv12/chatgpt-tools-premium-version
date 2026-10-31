"""RAM-only ordered 2FA -> logout workflows."""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable


TERMINAL = {"success", "error", "cancelled"}
COMBINED_STEPS = ("twofa", "logout")


@dataclass(slots=True)
class CombinedJob:
    id: str
    source_job_id: str
    email: str
    steps: tuple[str, ...] = COMBINED_STEPS
    status: str = "queued"
    phase: str = "queued"
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "job_id": self.source_job_id,
            "email": self.email,
            "steps": list(self.steps),
            "status": self.status,
            "phase": self.phase,
            "error": self.error,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class CombinedWorkflowManager:
    """Coordinate one account at a time without persisting credentials/state."""

    def __init__(
        self,
        twofa_manager: Any,
        *,
        wait_interval: float = 0.1,
        wait_timeout: float = 900.0,
        on_change: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.twofa_manager = twofa_manager
        self.wait_interval = max(0.02, float(wait_interval))
        self.wait_timeout = max(30.0, float(wait_timeout))
        self.jobs: dict[str, CombinedJob] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._release_tasks: dict[str, asyncio.Task] = {}
        self._active_emails: set[str] = set()
        self._on_change = on_change

    @staticmethod
    def _email_key(email: str) -> str:
        return email.strip().casefold()

    def is_busy(self, email: str) -> bool:
        return self._email_key(email) in self._active_emails

    def _broadcast(self, job: CombinedJob) -> None:
        if self._on_change is not None:
            self._on_change(job.snapshot())

    def _source_is_active(self, operation: CombinedJob) -> bool:
        source = getattr(self.twofa_manager, "jobs", {}).get(operation.source_job_id)
        return source is not None and source.status in {"queued", "running"}

    def _cancel_source(self, operation: CombinedJob) -> None:
        """Request cancellation of a queued/running 2FA source job.

        The underlying request may already have reached the upstream service,
        so this is a cancellation request rather than a rollback guarantee.
        Keeping the email lock until the source is terminal prevents a second
        mutation from racing the cancellation.
        """
        if not self._source_is_active(operation):
            return
        try:
            self.twofa_manager.stop(operation.source_job_id)
        except (KeyError, ValueError, RuntimeError):
            # The worker can finish between the active check and stop().
            return

    def _release_when_safe(self, operation: CombinedJob) -> None:
        if not self._source_is_active(operation):
            self._active_emails.discard(self._email_key(operation.email))
            return
        if operation.id in self._release_tasks:
            return
        task = asyncio.create_task(self._wait_for_source_terminal(operation))
        self._release_tasks[operation.id] = task

        def clear(done: asyncio.Task) -> None:
            if self._release_tasks.get(operation.id) is done:
                self._release_tasks.pop(operation.id, None)

        task.add_done_callback(clear)

    async def _wait_for_source_terminal(self, operation: CombinedJob) -> None:
        while self._source_is_active(operation):
            await asyncio.sleep(self.wait_interval)
        self._active_emails.discard(self._email_key(operation.email))

    def _track_task(self, operation_id: str, task: asyncio.Task) -> None:
        self._tasks[operation_id] = task

        def clear(done: asyncio.Task) -> None:
            if self._tasks.get(operation_id) is done:
                self._tasks.pop(operation_id, None)

        task.add_done_callback(clear)

    def _require(self, operation_id: str) -> CombinedJob:
        try:
            return self.jobs[operation_id]
        except KeyError as exc:
            raise KeyError(operation_id) from exc

    @staticmethod
    def _validate_source(job: Any) -> None:
        if job.status != "success" or job.account_state != "live" or not job.login_verified:
            raise ValueError("Chỉ gộp tài khoản Live đã check và xác minh đăng nhập thành công")
        if job.mode != "check_only":
            raise ValueError("Tài khoản phải ở chế độ Chỉ check trước khi chạy luồng gộp")
        if getattr(job, "rotated_pending_verify", False):
            raise ValueError("Tài khoản còn chờ xác minh 2FA; chưa thể chạy luồng gộp")

    def _complete(self, operation: CombinedJob) -> None:
        operation.status = "success"
        operation.phase = "completed"
        operation.finished_at = time.time()
        self._broadcast(operation)
        self._release_when_safe(operation)

    async def start(self, job_id: str) -> dict[str, Any]:
        manager = self.twofa_manager
        job = manager.jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        self._validate_source(job)
        key = self._email_key(job.email)
        if key in self._active_emails:
            raise ValueError("Tài khoản đang chạy luồng gộp; vui lòng chờ")
        if any(
            other.email.strip().casefold() == key and other.status in {"queued", "running"}
            for other in getattr(manager, "jobs", {}).values()
            if other.id != job_id
        ):
            raise ValueError("Tài khoản còn thao tác 2FA đang chạy; vui lòng chờ")
        self._active_emails.add(key)
        operation = CombinedJob(
            id=uuid.uuid4().hex,
            source_job_id=job_id,
            email=job.email,
            status="running",
            phase="changing_2fa",
            started_at=time.time(),
        )
        self.jobs[operation.id] = operation
        self._broadcast(operation)
        task = asyncio.create_task(self._run(operation))
        self._track_task(operation.id, task)
        return operation.snapshot()

    async def _run(self, operation: CombinedJob) -> None:
        manager = self.twofa_manager
        source_enqueued = False
        try:
            manager.enqueue_change_2fa(operation.source_job_id)
            source_enqueued = True
            deadline = time.monotonic() + self.wait_timeout
            while True:
                source = manager.jobs[operation.source_job_id]
                if source.status not in {"queued", "running"}:
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError("Bước đổi 2FA quá thời gian chờ; logout chưa được gọi")
                await asyncio.sleep(self.wait_interval)
            source = manager.jobs[operation.source_job_id]
            if source.status != "success" or not source.login_verified or source.rotated_pending_verify:
                raise RuntimeError(
                    source.error or "Đổi 2FA hoặc xác minh 2FA mới thất bại; logout chưa được gọi"
                )
            operation.phase = "logging_out"
            self._broadcast(operation)
            await manager.logout_all_sessions(operation.source_job_id)
            self._complete(operation)
        except asyncio.CancelledError:
            if source_enqueued:
                self._cancel_source(operation)
            operation.status = "cancelled"
            operation.phase = "cancelled"
            operation.error = "Đã dừng bởi người dùng"
            operation.finished_at = time.time()
            self._broadcast(operation)
        except Exception as exc:
            if source_enqueued and self._source_is_active(operation):
                self._cancel_source(operation)
            operation.status = "error"
            operation.phase = "error"
            operation.error = (str(exc).strip() or type(exc).__name__)[:240]
            operation.finished_at = time.time()
            self._broadcast(operation)
        finally:
            if operation.status != "success":
                self._release_when_safe(operation)

    def snapshot(self, operation_id: str) -> dict[str, Any]:
        return self._require(operation_id).snapshot()

    def snapshots(self) -> list[dict[str, Any]]:
        return [self.jobs[key].snapshot() for key in self.jobs]

    def stop(self, operation_id: str) -> dict[str, Any]:
        operation = self._require(operation_id)
        if operation.status in TERMINAL:
            return operation.snapshot()
        task = self._tasks.get(operation_id)
        self._cancel_source(operation)
        operation.status = "cancelled"
        operation.phase = "cancelled"
        operation.error = "Đã dừng bởi người dùng"
        operation.finished_at = time.time()
        self._release_when_safe(operation)
        self._broadcast(operation)
        if task is not None and not task.done():
            task.cancel()
        return operation.snapshot()

    def stop_all(self) -> int:
        stopped = 0
        for operation in list(self.jobs.values()):
            if operation.status not in TERMINAL:
                self.stop(operation.id)
                stopped += 1
        return stopped

    def has_active(self) -> bool:
        return bool(self._active_emails)

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        release_tasks = list(self._release_tasks.values())
        for task in tasks:
            task.cancel()
        for task in release_tasks:
            task.cancel()
        if tasks or release_tasks:
            await asyncio.gather(*tasks, *release_tasks, return_exceptions=True)
        self._tasks.clear()
        self._release_tasks.clear()
        self._active_emails.clear()
