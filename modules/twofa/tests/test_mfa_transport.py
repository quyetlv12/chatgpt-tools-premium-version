"""Real curl transport against local MFA/proxy stand-ins; no provider accounts."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mfa_phase


@contextmanager
def http_server(*, blocked=False):
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            self.respond()

        def do_POST(self):
            self.respond()

        def respond(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            calls.append((self.command, self.path, json.loads(body) if body else None))
            status, payload = 200, {}
            if blocked:
                status = 403
            elif self.path.endswith('/mfa_info'):
                payload = {'mfa_enabled_v2': True, 'factors': [
                    {'id': 'old-fixture-factor', 'factor_type': 'totp'}]}
            elif self.path.endswith('/disable_in_house'):
                status = 204
            elif self.path == '/backend-api/accounts/logout_all':
                status = 204
            elif self.path.endswith('/enroll'):
                payload = {'secret': 'JBSWY3DPEHPK3PXP', 'session_id': 'fixture-session',
                           'factor': {'id': 'new-fixture-factor'}}
            elif not self.path.endswith('/activate_enrollment'):
                status = 501
            encoded = json.dumps(payload).encode() if status != 204 else b''
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def proxy_environment(url):
    return {key: url for key in ('http_proxy', 'https_proxy', 'all_proxy',
                                 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')} | {
        'no_proxy': '', 'NO_PROXY': ''}


class MfaTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_rotation_ignores_inherited_proxy_through_activation(self):
        with http_server() as (origin, calls), http_server(blocked=True) as (proxy, proxy_calls):
            with patch.dict('os.environ', proxy_environment(proxy)), \
                    patch.object(mfa_phase, '_BASE', origin + '/backend-api'):
                result = await mfa_phase.rotate_2fa(access_token='fixture-token', log=lambda *_: None)
            self.assertTrue(result['activated'])
            self.assertEqual(proxy_calls, [])
            self.assertEqual([path.rsplit('/', 1)[-1] for _, path, _ in calls], [
                'mfa_info', 'disable_in_house', 'enroll', 'activate_enrollment', 'mfa_info'])
            self.assertEqual(calls[1][2], {'factor_id': 'old-fixture-factor'})
            self.assertEqual(calls[2][2], {'factor_type': 'totp'})
            self.assertEqual(calls[3][2]['factor_id'], 'new-fixture-factor')

    async def test_explicit_proxy_is_still_used_and_discovery_failure_never_mutates(self):
        with http_server() as (origin, calls), http_server(blocked=True) as (proxy, proxy_calls):
            with patch.dict('os.environ', proxy_environment(proxy)), \
                    patch.object(mfa_phase, '_BASE', origin + '/backend-api'):
                with self.assertRaisesRegex(mfa_phase.MfaError, 'mfa_info failed HTTP 403'):
                    await mfa_phase.rotate_2fa(access_token='fixture-token', proxy=proxy, log=lambda *_: None)
            self.assertEqual(calls, [])
            self.assertEqual([method for method, _, _ in proxy_calls], ['GET'])

    async def test_enrollment_keeps_explicit_proxy(self):
        with http_server() as (origin, calls), http_server() as (proxy, proxy_calls):
            with patch.dict('os.environ', proxy_environment('http://127.0.0.1:1')), \
                    patch.object(mfa_phase, '_BASE', origin + '/backend-api'):
                result = await mfa_phase.enable_2fa(
                    access_token='fixture-token', proxy=proxy, log=lambda *_: None)
            self.assertTrue(result['activated'])
            self.assertEqual(calls, [])
            self.assertEqual([path.rsplit('/', 1)[-1] for _, path, _ in proxy_calls], [
                'enroll', 'activate_enrollment', 'mfa_info'])


if __name__ == '__main__':
    unittest.main()
