import json
from urllib import error

import pytest

from gpt_tool import server


class _Response:
    def __init__(self, payload: object) -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def read(self, _limit: int = -1) -> bytes:
        return json.dumps(self.payload).encode()


class _Opener:
    def __init__(self, response: object, captured: dict) -> None:
        self.response = response
        self.captured = captured

    def open(self, req, timeout):
        self.captured.update(request=req, timeout=timeout)
        if isinstance(self.response, Exception):
            raise self.response
        return _Response(self.response)


def test_sub2api_import_posts_codex_contents_with_admin_key(monkeypatch) -> None:
    captured = {}
    response = {
        "code": 0,
        "message": "success",
        "data": {"items": [{"index": 1, "action": "created"}]},
    }
    monkeypatch.setattr(server.request, "build_opener", lambda *_args: _Opener(response, captured))
    bundle = [{"auth_mode": "chatgpt", "tokens": {"access_token": "synthetic-access"}}]

    result = server._import_sub2api(bundle, "https://sub2api.example.invalid/", "admin-key")

    sent = captured["request"]
    assert sent.full_url == "https://sub2api.example.invalid/api/v1/admin/accounts/import/codex-session"
    assert sent.get_header("X-api-key") == "admin-key"
    assert captured["timeout"] == 15
    payload = json.loads(sent.data)
    assert payload["update_existing"] is True
    assert json.loads(payload["contents"][0]) == bundle[0]
    assert result == response


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("sub2api.example.invalid", "http:// hoặc https://"),
        ("http://sub2api.example.invalid", "phải dùng HTTPS"),
        ("https://user:pass@sub2api.example.invalid", "không được chứa"),
        ("https://sub2api.example.invalid?key=secret", "không được chứa"),
    ],
)
def test_sub2api_url_validation_rejects_unsafe_destinations(url, message) -> None:
    with pytest.raises(ValueError, match=message):
        server._sub2api_import_endpoint(url)


def test_sub2api_sender_maps_one_based_results_and_hides_sensitive_payload() -> None:
    job_id = "sub2api-map"
    server._jobs[job_id] = {
        "sub2api": {"enabled": True, "sent": False, "count": 0, "failed": 0, "error": None},
        "results": [
            {"index": 3, "ok": True, "path": "/tmp/one.json", "sub2api_payload": {"tokens": {"access_token": "one"}}},
            {"index": 7, "ok": True, "path": "/tmp/two.json", "sub2api_payload": {"tokens": {"access_token": "two"}}},
        ],
    }
    original = server._import_sub2api
    try:
        server._import_sub2api = lambda *_args: {
            "code": 0,
            "data": {
                "items": [
                    {"index": 1, "action": "updated"},
                    {"index": 2, "action": "failed", "message": "upstream secret detail"},
                ]
            },
        }
        server._send_job_to_sub2api(job_id, "https://sub2api.example.invalid", "admin-secret")
        job = server._jobs[job_id]
        assert job["results"][0]["sub2api_sent"] is True
        assert job["results"][0]["sub2api_action"] == "updated"
        assert job["results"][1]["sub2api_error"] == "Không thể nhập tài khoản vào Sub2API"
        assert "secret" not in json.dumps(server._public_job(job))
        assert job["sub2api"] == {
            "enabled": True,
            "sent": True,
            "count": 1,
            "failed": 1,
            "error": "Sub2API: 1 tài khoản nhập thất bại",
        }
    finally:
        server._import_sub2api = original
        server._jobs.pop(job_id, None)


def test_sub2api_auth_error_is_safe(monkeypatch) -> None:
    captured = {}
    failure = error.HTTPError("https://sub2api.example.invalid", 401, "secret detail", {}, None)
    monkeypatch.setattr(server.request, "build_opener", lambda *_args: _Opener(failure, captured))

    with pytest.raises(RuntimeError, match="từ chối Admin API Key") as caught:
        server._import_sub2api([{"tokens": {"access_token": "secret-access"}}], "https://sub2api.example.invalid", "secret-key")

    assert "secret" not in str(caught.value)


@pytest.mark.parametrize("separator", ["\r", "\n", "\x00", "\x7f"])
def test_invalid_sub2api_key_never_reaches_transport_or_public_job(monkeypatch, separator) -> None:
    def unexpected_transport(*_args):
        pytest.fail("Invalid API key reached transport")

    monkeypatch.setattr(server.request, "build_opener", unexpected_transport)
    job_id = "sub2api-invalid-key"
    key = f"synthetic-private-key{separator}invalid"
    server._jobs[job_id] = {
        "sub2api": {"enabled": True, "sent": False},
        "results": [{"ok": True, "sub2api_payload": {"tokens": {"access_token": "synthetic-access"}}}],
    }
    try:
        server._send_job_to_sub2api(job_id, "https://sub2api.example.invalid", key)
        public = server._public_job(server._jobs[job_id])
        assert public["sub2api"]["error"] == "Admin API Key của Sub2API chứa ký tự không hợp lệ"
        assert "synthetic-private-key" not in json.dumps(public)
        assert public["sub2api"]["sent"] is False
    finally:
        server._jobs.pop(job_id, None)


def test_public_job_never_returns_sub2api_token_payload() -> None:
    public = server._public_job(
        {
            "results": [
                {
                    "ok": True,
                    "path": "/private/out/one.json",
                    "sub2api_payload": {"tokens": {"access_token": "secret-access"}},
                    "sub2api_sent": True,
                }
            ]
        }
    )

    assert "sub2api_payload" not in public["results"][0]
    assert public["results"][0]["sub2api_sent"] is True
