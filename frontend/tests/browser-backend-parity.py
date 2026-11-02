"""Run original Browser Login tests with temporary data and fail-closed network guards.

From the project root: .venv/bin/python frontend/tests/browser-backend-parity.py
Set BROWSER_TEST_EXECUTABLE if Python Playwright's browser version is unavailable.
"""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from urllib.parse import urlparse

from playwright.sync_api import Browser, BrowserType


ROOT = Path(__file__).resolve().parents[2]
original_context = Browser.new_context
original_launch = BrowserType.launch
original_popen = subprocess.Popen
blocked_requests = []


def guarded_context(browser, *args, **kwargs):
    context = original_context(browser, *args, **kwargs)

    def intercept(route):
        if urlparse(route.request.url).hostname in ("127.0.0.1", "localhost"):
            return route.continue_()
        # Tests can register later routes for synthetic provider DOM fixtures.
        blocked_requests.append(urlparse(route.request.url).hostname)
        route.abort()

    context.route("**/*", intercept)
    return context


def guarded_launch(browser_type, *args, **kwargs):
    if kwargs.get("headless") is False:
        raise AssertionError("Headed browser forbidden in synthetic parity tests")
    executable = os.environ.get("BROWSER_TEST_EXECUTABLE")
    if executable:
        kwargs["executable_path"] = executable
    return original_launch(browser_type, *args, **kwargs)


def guarded_popen(command, *args, **kwargs):
    executable = command[0] if isinstance(command, (list, tuple)) else command
    if Path(str(executable)).name in ("osascript", "open", "killall"):
        raise AssertionError("Native system operation forbidden in parity tests")
    return original_popen(command, *args, **kwargs)


def main():
    os.environ.pop("BROWSER_VIEWPORT_TEST", None)
    os.environ.pop("BROWSER_MOBILE_TEST", None)
    sys.path.insert(0, str(ROOT / "modules/browser-login"))
    with tempfile.TemporaryDirectory(prefix="browser-parity-all-") as directory:
        os.environ["SHOPTAIKHOAN_DATA_DIR"] = directory
        with (
            mock.patch.object(socket.socket, "connect", side_effect=AssertionError("Python network forbidden")),
            mock.patch.object(Browser, "new_context", guarded_context),
            mock.patch.object(BrowserType, "launch", guarded_launch),
            mock.patch.object(subprocess, "Popen", guarded_popen),
        ):
            suite = unittest.defaultTestLoader.discover(str(ROOT / "modules/browser-login"), pattern="test*.py")
            result = unittest.TextTestRunner(verbosity=1).run(suite)
    print(f"Browser backend: {result.testsRun} run, {len(result.skipped)} skipped, {len(result.failures)} failures, {len(result.errors)} errors")
    print(f"Unexpected external browser requests: {len(blocked_requests)} (all blocked)")
    for test, reason in result.skipped:
        print(f"SKIP {test}: {reason}")
    return 0 if result.wasSuccessful() and not blocked_requests else 1


if __name__ == "__main__":
    raise SystemExit(main())
