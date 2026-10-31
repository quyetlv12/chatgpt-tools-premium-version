"""Run the real reload dialog against synthetic APIs, never real accounts."""
import json
from pathlib import Path
import unittest

from playwright.sync_api import sync_playwright


class ReloadDialogTests(unittest.TestCase):
    def test_run_confirmation_and_validation(self):
        html = Path(__file__).with_name("index.html").read_text()
        starts = []
        errors = []
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 900})
                page.on("pageerror", lambda error: errors.append(str(error)))

                def intercept(route):
                    path = route.request.url.split("ui.test")[-1]
                    if route.request.url == "http://ui.test/":
                        route.fulfill(content_type="text/html", body=html)
                        return
                    data, status = {}, 200
                    if path == "/api/health":
                        data = {"ok": True, "sqlite": False, "json": False}
                    elif path == "/api/web-login/browsers":
                        data = {"browsers": [{"id": "brave", "name": "Brave"}]}
                    elif path == "/api/web-login/status":
                        data = {"running": False, "webReady": False, "results": [], "logs": []}
                    elif path == "/api/web-login/history":
                        data = {"history": []}
                    elif path == "/api/web-login/start":
                        starts.append(route.request.post_data_json)
                        status, data = 400, {"error": "Synthetic response; no real login"}
                    elif "/api/" not in path:
                        route.fulfill(status=200, body="")
                        return
                    route.fulfill(status=status, content_type="application/json", body=json.dumps(data))

                page.route("**/*", intercept)
                page.goto("http://ui.test/")
                page.locator('.tab-btn[data-tab="web-login"]').click()
                page.wait_for_function("!document.getElementById('web-login-browser-select').disabled")
                dialog = page.locator("#web-login-reload-dialog")
                start = page.locator("#btn-web-login")
                accounts = page.locator("#web-login-accounts-input")
                toggle = page.locator("#web-login-reload-toggle")
                mobile = page.locator("#web-login-mobile-toggle")
                seconds = page.locator("#web-login-reload-seconds")
                self.assertFalse(dialog.is_visible())
                start.click()
                self.assertFalse(dialog.is_visible(), "invalid accounts must not open prompt")
                combo = "synthetic@example.invalid|synthetic|TEST"
                accounts.fill(combo)
                start.click()
                self.assertTrue(dialog.is_visible())
                self.assertFalse(toggle.is_checked())
                self.assertTrue(mobile.is_checked())
                self.assertTrue(seconds.is_disabled())
                self.assertEqual(page.evaluate("document.activeElement.id"), "web-login-reload-toggle")
                def assert_centered_buttons():
                    bounds = dialog.bounding_box()
                    cancel = dialog.locator('button[value="cancel"]').last.bounding_box()
                    submit = dialog.locator('button[value="start"]').bounding_box()
                    group_center = (cancel["x"] + submit["x"] + submit["width"]) / 2
                    self.assertAlmostEqual(group_center, bounds["x"] + bounds["width"] / 2, delta=1)

                assert_centered_buttons()
                track = dialog.locator('label[for="web-login-reload-toggle"] .toggle-track')
                self.assertEqual(track.bounding_box()["width"], 56)
                self.assertEqual(track.bounding_box()["height"], 32)
                self.assertGreaterEqual(dialog.locator('label.feature-toggle[for="web-login-reload-toggle"]').bounding_box()["height"], 44)
                self.assertEqual(page.locator("#tab-web-login .toggle-track").bounding_box()["width"], 36)
                self.assertEqual(dialog.locator("#web-login-reload-help").inner_text(), "Mặc định tắt. Chỉ áp dụng cho lần chạy này.")
                page.keyboard.press("Space")
                self.assertTrue(toggle.is_checked())
                self.assertFalse(seconds.is_disabled())
                page.keyboard.press("Space")
                self.assertFalse(toggle.is_checked())
                self.assertTrue(seconds.is_disabled())
                page.keyboard.press("Escape")
                self.assertFalse(dialog.is_visible())
                self.assertEqual(page.evaluate("document.activeElement.id"), "btn-web-login")
                start.click()
                dialog.locator('button[value="cancel"]').last.click()
                self.assertFalse(starts, "Cancel/Escape must not send start")
                self.assertEqual(accounts.input_value(), combo)

                def confirm():
                    with page.expect_response("**/api/web-login/start"):
                        dialog.locator('button[value="start"]').click()
                    page.locator("#web-login-msg").filter(has_text="Synthetic response").wait_for()
                    page.wait_for_function("!document.getElementById('btn-web-login').disabled")

                start.click()
                confirm()
                self.assertEqual(len(starts), 1)
                self.assertFalse(starts[-1]["reloadEnabled"])
                self.assertTrue(starts[-1]["mobileEnabled"])
                self.assertEqual(starts[-1]["reloadSeconds"], 10)
                self.assertEqual(starts[-1]["browser"], "brave")
                start.click()
                dialog.locator('label.feature-toggle[for="web-login-mobile-toggle"]').click()
                dialog.locator('label.feature-toggle[for="web-login-reload-toggle"]').click()
                for value in ("", "0", "-1", "1.5", "3601"):
                    seconds.fill(value)
                    dialog.locator('button[value="start"]').click()
                    self.assertTrue(dialog.is_visible(), value)
                    self.assertEqual(len(starts), 1, value)
                seconds.fill("37")
                confirm()
                self.assertEqual(len(starts), 2)
                self.assertTrue(starts[-1]["reloadEnabled"])
                self.assertFalse(starts[-1]["mobileEnabled"])
                self.assertEqual(starts[-1]["reloadSeconds"], 37)
                self.assertEqual(accounts.input_value(), combo)
                start.click()
                self.assertFalse(toggle.is_checked(), "next run must default off again")
                self.assertTrue(mobile.is_checked(), "next run must default mobile on again")
                self.assertTrue(seconds.is_disabled())
                page.keyboard.press("Escape")
                self.assertEqual(len(starts), 2)

                link = page.locator("#web-login-link-input")
                link.fill("https://chatgpt.com/k12-invite?inv_email=synthetic%40example.invalid&wId=11111111-1111-4111-8111-111111111111")
                start.click()
                self.assertTrue(toggle.is_checked(), "K12 invite must default reload on")
                self.assertTrue(mobile.is_checked())
                self.assertFalse(seconds.is_disabled())
                self.assertEqual(seconds.input_value(), "10", "K12 invite must not reuse the previous custom delay")
                self.assertIn("K12 invite", dialog.locator("#web-login-reload-help").inner_text())
                confirm()
                self.assertEqual(len(starts), 3)
                self.assertTrue(starts[-1]["reloadEnabled"])
                self.assertTrue(starts[-1]["mobileEnabled"])
                self.assertEqual(starts[-1]["reloadSeconds"], 10)
                self.assertEqual(starts[-1]["linkUrl"], link.input_value())
                start.click()
                dialog.locator('label.feature-toggle[for="web-login-reload-toggle"]').click()
                dialog.locator('label.feature-toggle[for="web-login-mobile-toggle"]').click()
                confirm()
                self.assertEqual(len(starts), 4)
                self.assertFalse(starts[-1]["reloadEnabled"], "user may override K12 defaults")
                self.assertFalse(starts[-1]["mobileEnabled"])
                start.click()
                self.assertTrue(toggle.is_checked(), "K12 defaults reset each run")
                self.assertTrue(mobile.is_checked())
                page.keyboard.press("Escape")
                self.assertEqual(len(starts), 4, "K12 invitation must not bypass confirmation")

                page.locator('label.feature-toggle[for="web-login-link-toggle"]').click()
                start.click()
                self.assertFalse(toggle.is_checked(), "disabled secondary URL must not trigger K12 defaults")
                self.assertTrue(mobile.is_checked())
                page.keyboard.press("Escape")
                page.locator('label.feature-toggle[for="web-login-link-toggle"]').click()
                link.fill("https://chatgpt.com/api/auth/session")
                start.click()
                self.assertFalse(toggle.is_checked(), "ordinary URL keeps the existing defaults")
                self.assertTrue(mobile.is_checked())
                self.assertTrue(seconds.is_disabled())
                self.assertEqual(dialog.locator("#web-login-reload-help").inner_text(), "Mặc định tắt. Chỉ áp dụng cho lần chạy này.")
                page.keyboard.press("Escape")
                self.assertEqual(len(starts), 4)

                page.set_viewport_size({"width": 390, "height": 844})
                start.click()
                bounds = dialog.bounding_box()
                self.assertGreaterEqual(bounds["x"], 0)
                self.assertLessEqual(bounds["x"] + bounds["width"], 390)
                self.assertGreaterEqual(bounds["y"], 0)
                self.assertLessEqual(bounds["y"] + bounds["height"], 844)
                assert_centered_buttons()
                self.assertFalse(errors)
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
