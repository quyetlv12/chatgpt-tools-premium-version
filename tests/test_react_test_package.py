"""Isolation gates for the installable React Test variant."""
import importlib.util
import os
from pathlib import Path
import plistlib
import signal
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

import suite

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("react_test_launcher", ROOT / "run-react-test.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class ReactTestPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.resources = self.root / "Contents/Resources"
        self.runtime = self.root / "private-runtime"
        for relative in (
            "TwoFA.app/Contents/MacOS/Shoptaikhoan Tool",
            "GPT-Tool.app/Contents/MacOS/GPT-Tool",
            "BrowserLogin.app/Contents/Resources/bin/shoptaikhoan-server",
            "chat-backup-server",
        ):
            executable = self.resources / "engines" / relative
            executable.parent.mkdir(parents=True, exist_ok=True)
            executable.touch()
        (self.root / "frontend/dist").mkdir(parents=True)
        (self.root / "frontend/dist/index.html").write_text("<main>TEST</main>")

    def test_bundled_engines_override_inherited_paths_and_storage(self):
        inherited = {
            "SHOPTAIKHOAN_SUITE_DATA_DIR": "/original/runtime",
            "SHOPTAIKHOAN_SUITE_TWOFA_EXECUTABLE": "/original/engine",
            "SHOPTAIKHOAN_KEYCHAIN_SERVICE": "original.keychain",
            "NINE_ROUTER_DATA_DIR": "/original/nine-router",
        }
        with patch.dict(os.environ, inherited):
            launcher.configure_environment(self.runtime, self.resources)
            modules = suite.build_modules(ROOT, port=launcher.PORT)
            self.assertEqual(len(modules), 4)
            for module in modules:
                self.assertTrue(module.socket_path.is_relative_to(self.runtime))
                self.assertTrue(Path(module.command[0]).is_relative_to(self.resources))
                for key, value in module.env.items():
                    if key.endswith("DATA_DIR"):
                        self.assertTrue(Path(value).is_relative_to(self.runtime))
                    if value.startswith("http"):
                        self.assertIn(":5250", value)
            self.assertEqual(os.environ["SHOPTAIKHOAN_KEYCHAIN_SERVICE"], launcher.VARIANT + ".sub2api")
            self.assertEqual(os.environ["NINE_ROUTER_DATA_DIR"], str(self.runtime / "nine-router"))

    def test_runtime_symlink_and_missing_engine_fail_before_start(self):
        linked = self.root / "linked"
        linked.symlink_to(self.runtime, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            launcher.configure_environment(linked, self.resources)
        with self.assertRaises(RuntimeError):
            launcher.configure_environment(self.runtime, self.root / "missing")

    def test_duplicate_port_does_not_start_workers_or_touch_existing_socket(self):
        server = launcher.create_server(0, suite.SuiteManager(()), self.root / "frontend/dist")
        self.addCleanup(server.server_close)
        sentinel = self.runtime / "s/twofa.sock"
        sentinel.parent.mkdir(parents=True)
        sentinel.write_text("existing worker")
        with patch.dict(os.environ), patch.object(launcher, "ROOT", self.root), \
                patch.object(sys, "executable", str(self.resources / "bin/hub")), \
                patch.object(sys, "argv", ["run-react-test.py", "--port", str(server.server_port), "--data-dir", str(self.runtime)]), \
                patch.object(suite.SuiteManager, "start") as start:
            with self.assertRaises(OSError):
                launcher.main()
            start.assert_not_called()
        self.assertEqual(sentinel.read_text(), "existing worker")

    def test_health_identifies_the_variant_and_frontend(self):
        fonts = self.root / "frontend/dist/fonts"
        fonts.mkdir()
        for name in ("Inter-Variable.ttf", "JetBrainsMono-Variable.ttf"):
            (fonts / name).write_bytes(b"test-font")
        server = launcher.create_server(0, suite.SuiteManager(()), self.root / "frontend/dist")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urlopen(f"http://127.0.0.1:{server.server_port}/") as response:
                self.assertEqual(response.headers["X-Shoptaikhoan-Variant"], launcher.VARIANT)
                self.assertEqual(response.read(), b"<main>TEST</main>")
            for name in ("Inter-Variable.ttf", "JetBrainsMono-Variable.ttf"):
                with urlopen(f"http://127.0.0.1:{server.server_port}/fonts/{name}?v=1") as response:
                    self.assertEqual(response.headers["Content-Type"], "font/ttf")
                    self.assertEqual(response.read(), b"test-font")
            for path in ("/fonts/../index.html", "/fonts/%2e%2e/index.html", "/fonts/README.md"):
                with self.assertRaises(HTTPError) as error:
                    urlopen(f"http://127.0.0.1:{server.server_port}{path}")
                self.assertEqual(error.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_shutdown_finishes_cleanup_despite_repeated_termination(self):
        previous = signal.getsignal(signal.SIGTERM)
        self.addCleanup(signal.signal, signal.SIGTERM, previous)
        server = unittest.mock.Mock()
        server.serve_forever.side_effect = KeyboardInterrupt
        def stopped(manager):
            self.assertEqual(signal.getsignal(signal.SIGTERM), signal.SIG_IGN)
        with patch.dict(os.environ), patch.object(launcher, "ROOT", self.root), \
                patch.object(sys, "executable", str(self.resources / "bin/hub")), \
                patch.object(sys, "argv", ["run-react-test.py", "--data-dir", str(self.runtime)]), \
                patch.object(launcher, "create_server", return_value=server), \
                patch.object(suite.SuiteManager, "start"), \
                patch.object(suite.SuiteManager, "stop", stopped):
            launcher.main()
        server.server_close.assert_called_once()

    def test_native_identity_matches_hub_and_preserves_legacy_plist(self):
        with (ROOT / "packaging/macos/ReactTest-Info.plist").open("rb") as handle:
            info = plistlib.load(handle)
        with (ROOT / "packaging/macos/Info.plist").open("rb") as handle:
            legacy = plistlib.load(handle)
        self.assertEqual(info["CFBundleIdentifier"], launcher.VARIANT)
        self.assertEqual(info["SuiteHubPort"], launcher.PORT)
        self.assertNotIn(info["SuiteHubPort"], {5050, 5150, 5151, 5173})
        self.assertEqual(info["SuiteSupportName"], launcher.SUPPORT.name)
        self.assertTrue(info["SuiteReactMode"])
        self.assertEqual(legacy["CFBundleIdentifier"], "com.shoptaikhoan.suite")
        swift = (ROOT / "packaging/macos/ShoptaikhoanSuite.swift").read_text()
        self.assertIn(': "chat-backup"', swift)


if __name__ == "__main__":
    unittest.main()
