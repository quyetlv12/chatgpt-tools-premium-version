"""Logout routing and failure boundaries; only synthetic credentials/local HTTP."""
import asyncio
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from curl_cffi.requests import AsyncSession

from test_mfa_transport import http_server, proxy_environment

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'change 2fa community'))
from service import TwoFAFlowError, TwoFAService
from session_phase import logout_all_sessions
from combined_jobs import CombinedWorkflowManager
from jobs import TwoFAJob, TwoFAJobManager


class LogoutTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_logout_ignores_inherited_proxy_and_posts_once(self):
        with http_server() as (origin, calls), http_server(blocked=True) as (proxy, proxy_calls):
            class LocalSession(AsyncSession):
                async def post(self, url, **kwargs):
                    # Keep the real curl configuration; prevent any provider request.
                    if url != 'https://chatgpt.com/backend-api/accounts/logout_all':
                        raise AssertionError('unexpected logout endpoint')
                    return await super().post(origin + '/backend-api/accounts/logout_all', **kwargs)

            with patch.dict('os.environ', proxy_environment(proxy)), \
                    patch('curl_cffi.requests.AsyncSession', LocalSession):
                await logout_all_sessions(access_token='fixture-token')
            self.assertEqual(proxy_calls, [])
            self.assertEqual(calls, [('POST', '/backend-api/accounts/logout_all', None)])


class LogoutFailureBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_combined_logout_failure_keeps_verified_new_secret_and_history(self):
        for failure in ('login', 'logout'):
            with self.subTest(failure=failure):
                login_secrets, history = [], []

                async def login(**kwargs):
                    login_secrets.append(kwargs['secret'])
                    if failure == 'login' and len(login_secrets) == 3:
                        raise RuntimeError('private-fixture-value')
                    return {'accessToken': 'fixture-token'}

                rotate = AsyncMock(return_value={'activated': True, 'secret': 'SYNTHETIC_NEW'})
                logout = AsyncMock(side_effect=TimeoutError('private-fixture-value'))
                service = TwoFAService(
                    login_fn=login, rotate_fn=rotate, logout_sessions_fn=logout,
                    entitlement_fn=AsyncMock(return_value={'plan': 'free'}), login_attempts=1,
                )
                repo = SimpleNamespace(
                    list_all=lambda: [], append_log=lambda *_: None,
                    update_status=lambda *_args, **_kwargs: None,
                    complete_twofa_success=lambda **kwargs: history.append(kwargs),
                )
                settings = SimpleNamespace(list=lambda *_: {
                    'twofa.max_concurrent': 1, 'twofa.read_usage': False,
                    'twofa.read_payment_methods': False,
                })
                manager = TwoFAJobManager(repo, settings, service=service)
                job = TwoFAJob(id='fixture', email='fixture@example.test', password='synthetic',
                               secret='SYNTHETIC_OLD', mode='check_only', status='success',
                               account_state='live', login_verified=True)
                manager.jobs[job.id] = job
                manager.order.append(job.id)
                manager.start()
                workflows = CombinedWorkflowManager(manager, wait_interval=0.001)
                try:
                    operation = await workflows.start(job.id)
                    await asyncio.wait_for(workflows._tasks[operation['id']], timeout=2)
                    result = workflows.snapshot(operation['id'])
                    self.assertEqual(result['status'], 'error')
                    self.assertIn('Chưa gửi logout' if failure == 'login' else 'Logout chưa xác nhận',
                                  result['error'])
                    self.assertNotIn('private-fixture-value', result['error'])
                    self.assertEqual(login_secrets, ['SYNTHETIC_OLD', 'SYNTHETIC_NEW', 'SYNTHETIC_NEW'])
                    rotate.assert_awaited_once()
                    self.assertEqual(logout.await_count, 0 if failure == 'login' else 1)
                    self.assertEqual(job.status, 'success')
                    self.assertTrue(job.login_verified)
                    self.assertFalse(job.rotated_pending_verify)
                    self.assertFalse(job.sessions_logging_out)
                    self.assertEqual(job.secret, 'SYNTHETIC_NEW')
                    self.assertEqual(len(history), 1)
                    self.assertEqual(history[0]['secret'], 'SYNTHETIC_NEW')
                    self.assertEqual(manager.output(), ['fixture@example.test|synthetic|SYNTHETIC_NEW'])
                    self.assertFalse(workflows.is_busy(job.email))
                finally:
                    await workflows.shutdown()
                    await manager.shutdown()

    async def test_login_failure_never_sends_logout_or_exposes_diagnostics(self):
        login = AsyncMock(side_effect=RuntimeError('private-fixture-value'))
        logout = AsyncMock()
        service = TwoFAService(login_fn=login, logout_sessions_fn=logout, login_attempts=1)
        with self.assertRaises(TwoFAFlowError) as error:
            await service.logout_all_sessions(
                email='fixture@example.test', password='synthetic', secret='SYNTHETIC_NEW',
                timeout=1, log=lambda _: None,
            )
        self.assertIn('Chưa gửi logout', str(error.exception))
        self.assertNotIn('private-fixture-value', str(error.exception))
        self.assertNotIn('SYNTHETIC_NEW', str(error.exception))
        login.assert_awaited_once()
        logout.assert_not_awaited()

    async def test_lost_logout_response_never_retries_or_logs_in_again(self):
        login = AsyncMock(return_value={'accessToken': 'fixture-token', '__cookies': []})
        logout = AsyncMock(side_effect=TimeoutError('private-fixture-value'))
        service = TwoFAService(login_fn=login, logout_sessions_fn=logout)
        with self.assertRaises(TwoFAFlowError) as error:
            await service.logout_all_sessions(
                email='fixture@example.test', password='synthetic', secret='SYNTHETIC_NEW',
                timeout=1, log=lambda _: None,
            )
        self.assertIn('Logout chưa xác nhận', str(error.exception))
        self.assertNotIn('private-fixture-value', str(error.exception))
        login.assert_awaited_once()
        logout.assert_awaited_once_with(access_token='fixture-token', cookies=[], timeout=1)

    async def test_cancel_during_login_never_sends_logout(self):
        logout = AsyncMock()
        service = TwoFAService(login_fn=AsyncMock(side_effect=asyncio.CancelledError),
                               logout_sessions_fn=logout)
        with self.assertRaises(asyncio.CancelledError):
            await service.logout_all_sessions(
                email='fixture@example.test', password='synthetic', secret='SYNTHETIC_NEW',
                timeout=1, log=lambda _: None,
            )
        logout.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
