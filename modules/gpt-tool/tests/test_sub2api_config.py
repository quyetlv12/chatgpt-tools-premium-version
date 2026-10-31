import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import uuid

import pytest

from gpt_tool import server, sub2api_config


@pytest.fixture
def config_server(monkeypatch):
    stored = {}
    monkeypatch.setattr(server, "PUBLIC_URL", "")
    monkeypatch.setattr(sub2api_config, "SUPPORTED", True)
    monkeypatch.setattr(sub2api_config, "load", lambda: dict(stored))
    monkeypatch.setattr(sub2api_config, "save", lambda url, api_key: stored.update(url=url, api_key=api_key))
    monkeypatch.setattr(sub2api_config, "clear", stored.clear)
    httpd, _ = server._bind("127.0.0.1", 0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{httpd.server_address[1]}"

    def request(method="GET", body=None, path="/api/sub2api/config", headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
        try:
            conn.request(method, path, None if body is None else json.dumps(body), headers={
                "Origin": origin, "Content-Type": "application/json", **(headers or {}),
            })
            response = conn.getresponse()
            return response.status, json.loads(response.read()), response.getheader("Cache-Control")
        finally:
            conn.close()

    yield origin, stored, request
    httpd.shutdown()
    httpd.server_close()
    thread.join(timeout=2)


def test_config_roundtrip_redacted_validation_and_clear(config_server):
    _, stored, request = config_server
    status, data, cache = request()
    assert status == 200 and data == {"url": "", "has_api_key": False, "supported": True}
    assert cache == "no-store"
    payload = {"action": "save", "url": " https://sub2api.example.invalid/ ", "api_key": "synthetic-key"}
    status, data, _ = request("POST", payload)
    assert status == 200 and data["has_api_key"]
    assert stored == {"url": "https://sub2api.example.invalid", "api_key": "synthetic-key"}
    assert "synthetic-key" not in json.dumps(data)
    assert "synthetic-key" not in json.dumps(request()[1])
    for invalid in ([], {"action": "unknown"}, {**payload, "api_key": ""}, {**payload, "url": "http://remote.invalid"}):
        assert request("POST", invalid)[0] == 400
        assert stored["api_key"] == "synthetic-key"
    for headers in ({"Origin": "https://evil.invalid"}, {"Host": "evil.invalid"}, {"Content-Type": "text/plain"}):
        assert request("POST", {"action": "clear"}, headers=headers)[0] == 403
        assert stored
    assert request(headers={"Origin": "https://evil.invalid"})[0] == 403
    assert request("POST", {"action": "clear"})[1]["has_api_key"] is False
    assert not stored
    assert request("POST", {"action": "clear"})[0] == 200


def test_keychain_failure_is_safe_and_manual_export_still_available(config_server, monkeypatch):
    _, _, request = config_server

    def fail():
        raise sub2api_config.ConfigError("Keychain đang khóa")

    monkeypatch.setattr(sub2api_config, "load", fail)
    assert request()[0] == 503
    payload = {"format": "sub2api", "lines": "", "sub2api_import": True,
               "sub2api_url": "https://sub2api.example.invalid", "sub2api_use_saved": True}
    assert request("POST", payload, "/api/export")[0] == 400
    monkeypatch.setattr(server, "export_bulk", lambda *args, **kwargs: None)
    monkeypatch.setattr(server, "_send_job_to_sub2api", lambda *args: None)
    payload["sub2api_api_key"] = "synthetic-manual-key"
    assert request("POST", payload, "/api/export")[0] == 200


def test_suite_forwarded_host_and_origin(config_server, monkeypatch):
    _, _, request = config_server
    monkeypatch.setattr(server, "PUBLIC_URL", "http://export.localhost:5050")
    headers = {"Host": "export.localhost", "Origin": "http://export.localhost:5050"}
    assert request(headers=headers)[0] == 200
    assert request("POST", {"action": "save", "url": "http://127.0.0.1:18080", "api_key": "synthetic"}, headers=headers)[0] == 200
    assert request(headers={**headers, "Host": "evil.invalid"})[0] == 403
    assert request(headers={**headers, "Origin": "http://other.localhost:5050"})[0] == 403


@pytest.mark.parametrize("fmt, enabled", [("sub2api", False), ("cockpit", True), ("9router", True)])
def test_unrelated_exports_never_load_saved_key(config_server, monkeypatch, fmt, enabled):
    _, _, request = config_server

    def must_not_load():
        pytest.fail("Unrelated export read saved Sub2API key")

    monkeypatch.setattr(sub2api_config, "load", must_not_load)
    monkeypatch.setattr(server, "export_bulk", lambda *args, **kwargs: None)
    assert request("POST", {"format": fmt, "lines": "", "sub2api_import": enabled,
                            "sub2api_use_saved": True}, "/api/export")[0] == 200


def test_export_resolves_saved_key_only_for_matching_url(config_server, monkeypatch):
    _, stored, request = config_server
    stored.update(url="https://sub2api.example.invalid", api_key="synthetic-saved-key")
    seen = []
    done = threading.Event()
    monkeypatch.setattr(server, "export_bulk", lambda *args, **kwargs: None)

    def send(job_id, url, key):
        seen.append((url, key))
        done.set()

    monkeypatch.setattr(server, "_send_job_to_sub2api", send)
    payload = {"format": "sub2api", "lines": "", "sub2api_import": True,
               "sub2api_url": stored["url"] + "/", "sub2api_use_saved": True}
    status, data, _ = request("POST", payload, "/api/export")
    assert status == 200 and done.wait(2)
    assert seen == [(payload["sub2api_url"], "synthetic-saved-key")]
    assert "synthetic-saved-key" not in json.dumps(request(path=f'/api/jobs/{data["id"]}')[1])
    payload["sub2api_url"] = "https://other.example.invalid"
    assert request("POST", payload, "/api/export")[0] == 400
    assert len(seen) == 1
    payload["sub2api_api_key"] = "synthetic-manual-key"
    done.clear()
    assert request("POST", payload, "/api/export")[0] == 200 and done.wait(2)
    assert seen[-1][1] == "synthetic-manual-key"


def test_config_ui_save_reload_saved_export_changed_url_clear(config_server):
    sync_playwright = pytest.importorskip("playwright.sync_api").sync_playwright
    origin, stored, _ = config_server
    payloads, errors = [], []
    with sync_playwright() as playwright:
        if not Path(playwright.chromium.executable_path).is_file():
            pytest.skip("Playwright Chromium not installed")
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.route("**/api/export", lambda route: (payloads.append(route.request.post_data_json), route.fulfill(json={"id": "synthetic"})))
            page.route("**/api/jobs/synthetic", lambda route: route.fulfill(json={"done": True, "results": []}))
            page.goto(origin)
            page.locator('input[value="sub2api"]').check()
            page.locator("#sub2api-url").fill("https://sub2api.example.invalid")
            page.locator("#sub2api-api-key").fill("synthetic-ui-key")
            page.locator("#save-sub2api").click()
            page.wait_for_function("document.getElementById('sub2api-api-key').value === '' && !document.getElementById('clear-sub2api').disabled")
            assert stored["api_key"] == "synthetic-ui-key"
            page.reload()
            page.wait_for_function("document.getElementById('sub2api-api-key').placeholder.includes('Keychain')")
            assert page.locator("#sub2api-url").input_value() == stored["url"]
            assert page.locator("#sub2api-api-key").input_value() == ""
            assert "synthetic-ui-key" not in page.evaluate("JSON.stringify(localStorage)")
            assert "synthetic-ui-key" not in page.content()
            page.locator("#run-export").click()
            page.wait_for_function("document.getElementById('run-export').dataset.action === 'run'")
            assert payloads[-1]["sub2api_use_saved"] is True
            assert payloads[-1]["sub2api_api_key"] == ""
            page.locator("#sub2api-url").fill("https://other.example.invalid")
            page.locator("#run-export").click()
            assert len(payloads) == 1
            page.locator("#clear-sub2api").click()
            page.wait_for_function("document.getElementById('sub2api-config-status').textContent.includes('Đã xóa cấu hình')")
            page.reload()
            assert page.locator("#sub2api-url").input_value() == ""
            assert not stored and not errors
        finally:
            browser.close()


def test_export_only_does_not_wait_for_keychain_config(config_server):
    sync_playwright = pytest.importorskip("playwright.sync_api").sync_playwright
    origin, _, _ = config_server
    with sync_playwright() as playwright:
        if not Path(playwright.chromium.executable_path).is_file():
            pytest.skip("Playwright Chromium not installed")
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            pending_config = []
            page.route("**/api/sub2api/config", lambda route: pending_config.append(route))
            page.route("**/api/export", lambda route: route.fulfill(json={"id": "synthetic"}))
            page.route("**/api/jobs/synthetic", lambda route: route.fulfill(json={"done": True, "results": []}))
            page.goto(origin, wait_until="domcontentloaded")
            page.locator('input[value="sub2api"]').check()
            page.locator("#auto-import").uncheck()
            assert pending_config
            with page.expect_request("**/api/export", timeout=3000) as export:
                page.locator("#run-export").click()
            assert export.value.post_data_json["sub2api_import"] is False
        finally:
            browser.close()


@pytest.mark.skipif(sys.platform != "darwin" or os.environ.get("TEST_MACOS_KEYCHAIN") != "1", reason="Opt-in native Keychain test")
def test_native_keychain_persists_across_processes():
    service = ("com.shoptaikhoan.test." + uuid.uuid4().hex).encode()
    config = {"url": "https://synthetic.invalid", "api_key": "synthetic-test-key"}
    try:
        assert sub2api_config._access("read", service=service) == {}
        sub2api_config._access("save", config, service=service)
        script = "from gpt_tool.sub2api_config import _access; import sys; assert _access('read', service=sys.argv[1].encode()) == {'url': 'https://synthetic.invalid', 'api_key': 'synthetic-test-key'}"
        subprocess.run([sys.executable, "-c", script, service.decode()], check=True, timeout=15)
        config["api_key"] = "synthetic-updated-key"
        sub2api_config._access("save", config, service=service)
        assert sub2api_config._access("read", service=service) == config
    finally:
        sub2api_config._access("clear", service=service)
    assert sub2api_config._access("read", service=service) == {}
