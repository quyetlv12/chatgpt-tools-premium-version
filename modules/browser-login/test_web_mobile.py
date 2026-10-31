"""Per-run DevTools device mode; synthetic accounts and local content only."""
import io
import json
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

import auto_login
import server


class WebMobileTests(unittest.TestCase):
    def test_api_validates_boolean_before_start_and_preserves_legacy_default(self):
        for value in (False, True, "true", 1, None, "missing"):
            with self.subTest(value=value):
                handler = server.Handler.__new__(server.Handler)
                handler.path = "/api/web-login/start"
                data = {"accounts": ["synthetic@example.invalid|synthetic|"], "workers": 1}
                if value != "missing":
                    data["mobileEnabled"] = value
                payload = json.dumps(data).encode()
                handler.headers = {"Content-Length": str(len(payload))}
                handler.rfile = io.BytesIO(payload)
                handler._json = mock.Mock()
                with mock.patch.object(server, "start_web_login", return_value=True) as start:
                    handler.do_POST()
                if type(value) is bool or value == "missing":
                    self.assertEqual(start.call_args.kwargs["mobile_enabled"], value is True)
                else:
                    start.assert_not_called()
                    self.assertEqual(handler._json.call_args.args[1], 400)

    def test_option_reaches_cli_and_queue_without_enabling_codex(self):
        for enabled in (False, True):
            with mock.patch.object(server, "AUTO_LOGIN_EXECUTABLE", "worker"):
                command = server.build_web_login_command("synthetic.txt", 1, mobile_enabled=enabled)
                codex = server.build_web_login_command("synthetic.txt", 1, codex_web=True, mobile_enabled=enabled)
            self.assertEqual("--mobile" in command, enabled)
            self.assertNotIn("--mobile", codex)
            with (
                mock.patch.object(auto_login.sys, "argv", command),
                mock.patch.object(auto_login.os.path, "exists", return_value=True),
                mock.patch.object(auto_login, "parse_accounts", return_value=[("synthetic@example.invalid", "synthetic", "")]),
                mock.patch.object(auto_login, "run_web_login_queue", return_value=[]) as run,
                mock.patch.object(auto_login.threading, "Thread"),
                mock.patch.object(auto_login, "_kept_browser_sessions", {}),
                mock.patch("builtins.open", mock.mock_open()),
                mock.patch("sys.stdout", new_callable=io.StringIO),
            ):
                auto_login.main()
            self.assertEqual(run.call_args.kwargs["mobile_enabled"], enabled)
        with (
            mock.patch.object(auto_login, "login_web_one_account", return_value={"status": "success"}) as login,
            mock.patch("sys.stdout", new_callable=io.StringIO),
        ):
            auto_login.run_web_login_queue([("synthetic@example.invalid", "synthetic", "")], 1, mobile_enabled=True)
        self.assertTrue(login.call_args.kwargs["mobile_enabled"])
        with (
            mock.patch.object(server, "_web_login_status", server.new_web_login_status(running=False)),
            mock.patch.object(server, "persist_web_login_status"),
            mock.patch.object(server.threading, "Thread") as thread,
        ):
            self.assertTrue(server.start_web_login(["synthetic@example.invalid|synthetic|"], mobile_enabled=True))
        self.assertTrue(thread.call_args.kwargs["kwargs"]["mobile_enabled"])

    def test_mobile_runs_after_login_before_secondary_and_failure_retains_session(self):
        for enabled, fails, codex in ((True, False, False), (False, False, False),
                                       (True, True, False), (True, False, True)):
            with self.subTest(enabled=enabled, fails=fails, codex=codex):
                pw = mock.Mock()
                browser = pw.chromium.launch.return_value
                context = browser.new_context.return_value
                page, secondary = mock.Mock(), mock.Mock()
                context.new_page.side_effect = [page, secondary]
                calls = mock.Mock()
                with (
                    mock.patch.object(auto_login, "sync_playwright") as start,
                    mock.patch.object(auto_login, "apply_browser_window_bounds", return_value=True),
                    mock.patch.object(auto_login, "login_chatgpt_web", return_value=(True, None)) as login,
                    mock.patch.object(auto_login, "login_codex_authorization", return_value=True),
                    mock.patch.object(auto_login, "open_web_devtools_device_mode") as mobile,
                    mock.patch.object(auto_login, "verify_personal_account_label", return_value=True),
                    mock.patch.object(auto_login, "_session_shutdown_event") as stop,
                    mock.patch.object(auto_login, "_kept_browser_sessions", {}) as sessions,
                    mock.patch("sys.stdout", new_callable=io.StringIO),
                ):
                    start.return_value.start.return_value = pw
                    stop.is_set.return_value = False
                    if fails:
                        mobile.side_effect = RuntimeError("synthetic transport failure")
                    for name, action in (("login", login), ("mobile", mobile), ("secondary", secondary.goto)):
                        calls.attach_mock(action, name)
                    result = auto_login.login_web_one_account(
                        1, 1, ("synthetic@example.invalid", "synthetic", ""),
                        open_link="https://secondary.invalid/", mobile_enabled=enabled, codex_web=codex,
                    )
                self.assertEqual(result["status"], "success")
                if enabled and not codex:
                    self.assertEqual([call[0] for call in calls.mock_calls],
                                     ["login", "mobile"] + ([] if fails else ["secondary"]))
                    mobile.assert_called_once_with(page)
                else:
                    mobile.assert_not_called()
                retained = next(iter(sessions.values()))
                self.assertIs(retained["page"], page)
                self.assertIs(retained["context"], context)
                self.assertIs(retained["browser"], browser)
                self.assertEqual(result["postLoginError"], "mobile_error" if fails else "")
                context.close.assert_not_called()
                browser.close.assert_not_called()
                page.reload.assert_not_called()

    def device_mode_page(self, reply=True):
        page = mock.Mock()
        target = page.context.new_cdp_session.return_value
        target.send.return_value = {"targetInfo": {"targetId": "main-tab"}}
        browser = page.context.browser.new_browser_cdp_session.return_value

        def send(method, params=None):
            if method == "Target.openDevTools":
                return {"targetId": "devtools-tab"}
            if method == "Target.attachToTarget":
                return {"sessionId": "devtools-session"}
            if method == "Target.sendMessageToTarget" and reply is not None:
                receive = browser.on.call_args.args[1]
                receive({"sessionId": "another-worker", "message": json.dumps({"id": 1, "error": {}})})
                receive({"sessionId": "devtools-session", "message": json.dumps({"id": 2, "error": {}})})
                receive({"sessionId": "devtools-session", "message": json.dumps({
                    "id": 1, "result": {"result": {"value": reply}},
                })})
            return {}

        browser.send.side_effect = send
        return page, target, browser

    def test_device_mode_targets_own_devtools_clicks_ui_and_detaches_without_closing(self):
        page, target, browser = self.device_mode_page()
        with mock.patch.object(auto_login.subprocess, "run") as native:
            self.assertTrue(auto_login.open_web_devtools_device_mode(page))
        native.assert_not_called()
        page.bring_to_front.assert_not_called()
        browser.send.assert_any_call("Target.openDevTools", {"targetId": "main-tab"})
        browser.send.assert_any_call("Target.attachToTarget", {"targetId": "devtools-tab", "flatten": False})
        request = next(call.args[1] for call in browser.send.call_args_list
                       if call.args[0] == "Target.sendMessageToTarget")
        self.assertEqual(request["sessionId"], "devtools-session")
        evaluation = json.loads(request["message"])
        self.assertEqual(evaluation["method"], "Runtime.evaluate")
        self.assertTrue(evaluation["params"]["awaitPromise"])
        self.assertIn("button.click()", evaluation["params"]["expression"])
        self.assertIn("action.toggled()", evaluation["params"]["expression"])
        self.assertNotIn("Emulation.setDeviceMetricsOverride", str(browser.mock_calls))
        page.wait_for_function.assert_called_once_with("navigator.maxTouchPoints > 0", timeout=3000)
        browser.send.assert_any_call("Target.detachFromTarget", {"sessionId": "devtools-session"})
        target.detach.assert_called_once_with()
        browser.detach.assert_called_once_with()
        page.close.assert_not_called()
        page.context.close.assert_not_called()
        page.context.browser.close.assert_not_called()

    def test_device_toolbar_failure_or_timeout_keeps_browser_and_cleans_up(self):
        for reply in (False, None):
            with self.subTest(reply=reply):
                page, target, browser = self.device_mode_page(reply)
                with mock.patch.object(auto_login.time, "monotonic", side_effect=[0, 13]):
                    with self.assertRaisesRegex(RuntimeError, "Không thể mở DevTools"):
                        auto_login.open_web_devtools_device_mode(page)
                target.detach.assert_called_once_with()
                browser.detach.assert_called_once_with()
                page.context.browser.close.assert_not_called()
                page.wait_for_function.assert_not_called()

    def test_unsupported_browser_does_not_fallback_to_global_shortcuts(self):
        page, target, browser = self.device_mode_page()
        browser.send.side_effect = RuntimeError("Target.openDevTools unavailable")
        with (
            mock.patch.object(auto_login.subprocess, "run") as native,
            self.assertRaisesRegex(RuntimeError, "Không thể mở DevTools"),
        ):
            auto_login.open_web_devtools_device_mode(page)
        native.assert_not_called()
        target.detach.assert_called_once_with()
        browser.detach.assert_called_once_with()


@unittest.skipUnless(os.environ.get("BROWSER_MOBILE_TEST") == "1", "requires headed browsers")
class NativeDeviceToolbarTests(unittest.TestCase):
    def test_parallel_workers_keep_mobile_on_own_main_tab_after_secondary_and_reload(self):
        for browser_id in ("brave", "chrome", "chromium"):
            try:
                options = {} if browser_id == "chromium" else auto_login.browser_launch_options(browser_id)
            except ValueError:
                continue
            barrier = threading.Barrier(3)

            def run_worker(index):
                with auto_login.sync_playwright() as playwright:
                    browser = playwright.chromium.launch(headless=False, args=["--incognito"], **options)
                    try:
                        context = browser.new_context(**auto_login.build_web_context_options({}))
                        context.route("**/*", lambda route: route.abort())
                        page = context.new_page()
                        bounds = auto_login.calculate_window_bounds(index + 1, 3)
                        self.assertTrue(auto_login.apply_browser_window_bounds(context, page, bounds))
                        url = 'data:text/html,<meta name="viewport" content="width=device-width"><h1>Synthetic mobile test</h1>'
                        page.goto(url)
                        barrier.wait(timeout=30)
                        self.assertTrue(auto_login.open_web_devtools_device_mode(page))
                        secondary = context.new_page()
                        secondary.goto('data:text/html,<h1>Synthetic secondary</h1>')
                        page.bring_to_front()
                        page.wait_for_timeout(500)
                        page.reload()
                        self.assertGreater(page.evaluate("navigator.maxTouchPoints"), 0)
                        self.assertEqual(secondary.evaluate("navigator.maxTouchPoints"), 0)
                        self.assertEqual(page.url, url)
                        # Reopening DevTools must not toggle an already-enabled toolbar off.
                        self.assertTrue(auto_login.open_web_devtools_device_mode(page))
                        self.assertGreater(page.evaluate("navigator.maxTouchPoints"), 0)
                        self.assertTrue(browser.is_connected())
                        return browser.version
                    finally:
                        browser.close()

            with self.subTest(browser=browser_id), ThreadPoolExecutor(max_workers=3) as executor:
                versions = list(executor.map(run_worker, range(3)))
                print("Device Toolbar: {} {} · 3 parallel workers OK".format(browser_id, versions[0]))


if __name__ == "__main__":
    unittest.main()
