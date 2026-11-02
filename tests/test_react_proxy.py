"""Same-origin module routing against synthetic local Unix backends."""
import http.client
import json
import socketserver
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import suite


ROOT = Path(__file__).resolve().parents[1]


class ThreadedUnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


class ReactProxyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="react-proxy-", dir="/tmp")
        self.requests = []
        self.release_stream = threading.Event()
        owner = self

        class Backend(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def respond(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                owner.requests.append({"method": self.command, "path": self.path,
                                       "headers": dict(self.headers), "body": body.decode()})
                if self.path == "/api/events":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.wfile.write(b"data: first\n\n")
                    self.wfile.flush()
                    owner.release_stream.wait(3)
                    self.wfile.write(b"data: second\n\n")
                    self.wfile.flush()
                    self.close_connection = True
                    return
                if self.path.startswith("/api/passkey/launch/"):
                    self.send_response(303)
                    self.send_header("Location", "https://example.invalid/synthetic-enrollment")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                payload = json.dumps(owner.requests[-1]).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            do_GET = do_POST = do_PUT = do_DELETE = do_OPTIONS = respond

            def log_message(self, *_args):
                pass

        socket_path = Path(self.temp.name) / "backend.sock"
        self.backend = ThreadedUnixServer(str(socket_path), Backend)
        self.backend_thread = threading.Thread(target=self.backend.serve_forever, daemon=True)
        self.backend_thread.start()
        modules = tuple(suite.Module(key, key, f"{key}.localhost", socket_path, ROOT,
                                    (sys.executable,), {}) for key in ("twofa", "export"))
        manager = suite.SuiteManager(modules, probe=lambda _socket: (True, "synthetic"))
        self.hub = suite.create_hub_server("127.0.0.1", 0, manager, ROOT / "web")
        self.hub_thread = suite.start_server_thread(self.hub)
        self.origin = f"http://127.0.0.1:{self.hub.server_port}"

    def tearDown(self):
        self.release_stream.set()
        self.hub.shutdown()
        self.hub.server_close()
        self.backend.shutdown()
        self.backend.server_close()
        self.hub_thread.join(timeout=2)
        self.backend_thread.join(timeout=2)
        self.temp.cleanup()

    def request(self, path, method="GET", headers=None, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.hub.server_port, timeout=2)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_strips_prefix_preserves_query_body_and_auth_token(self):
        status, _, body = self.request(
            "/modules/twofa/api/jobs?cursor=a%2Fb&limit=2", "POST",
            {"Origin": self.origin, "X-Auth-Token": "synthetic-token", "Content-Type": "application/json"},
            b'{"synthetic":true}',
        )
        self.assertEqual(status, 200)
        received = json.loads(body)
        self.assertEqual(received["path"], "/api/jobs?cursor=a%2Fb&limit=2")
        self.assertEqual(received["method"], "POST")
        self.assertEqual(received["headers"]["X-Auth-Token"], "synthetic-token")
        self.assertEqual(received["body"], '{"synthetic":true}')
        self.assertEqual(received["headers"]["Host"], "twofa.localhost")

    def test_validated_origin_maps_to_export_module_origin(self):
        for origin in (self.origin, f"http://localhost:{self.hub.server_port}", "http://127.0.0.1:5173"):
            with self.subTest(origin=origin):
                status, _, body = self.request("/modules/export/api/jobs", "POST", {"Origin": origin})
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body)["headers"]["Origin"],
                                 f"http://export.localhost:{self.hub.server_port}")

    def test_absent_origin_is_not_invented(self):
        status, _, body = self.request("/modules/export/api/jobs")
        self.assertEqual(status, 200)
        self.assertNotIn("Origin", json.loads(body)["headers"])

    def test_foreign_origins_or_hosts_never_reach_backend(self):
        for headers in ({"Origin": "https://foreign.invalid"}, {"Origin": "null"},
                        {"Origin": self.origin + ".foreign.invalid"}, {"Host": "foreign.invalid"}):
            with self.subTest(headers=headers):
                status, _, _ = self.request("/modules/export/api/jobs", "POST", headers)
                self.assertEqual(status, 403)
        self.assertEqual(self.requests, [])

    def test_only_known_module_api_paths_are_exposed(self):
        for path in ("/modules/missing/api/jobs", "/modules/twofa/", "/modules/twofa/static/app.js",
                     "/modules/twofa/api/../private", "/modules/twofa/api/./jobs",
                     "/modules/twofa/api/\\private"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.requests, [])

    def test_native_enrollment_redirect_and_legacy_host_are_preserved(self):
        for path, headers in (("/modules/twofa/api/passkey/launch/synthetic-one-use", {}),
                              ("/api/passkey/launch/synthetic-one-use", {"Host": "twofa.localhost"})):
            with self.subTest(path=path):
                status, response_headers, body = self.request(path, headers=headers)
                self.assertEqual(status, 303)
                self.assertEqual(response_headers["Location"], "https://example.invalid/synthetic-enrollment")
                self.assertEqual(body, b"")
                self.assertEqual(self.requests[-1]["path"], "/api/passkey/launch/synthetic-one-use")

    def test_sse_delivers_first_event_before_backend_finishes(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.hub.server_port, timeout=2)
        try:
            connection.request("GET", "/modules/twofa/api/events")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Content-Type"], "text/event-stream")
            self.assertEqual(response.readline(), b"data: first\n")
            self.assertEqual(response.readline(), b"\n")
            self.assertFalse(self.release_stream.is_set())
            self.release_stream.set()
            self.assertEqual(response.read(), b"data: second\n\n")
        finally:
            self.release_stream.set()
            connection.close()


if __name__ == "__main__":
    unittest.main()
