"""Sub2API settings in macOS Keychain; never fall back to a plaintext file."""

import ctypes as ct
from functools import lru_cache
import json
import os
import sys
import threading


class ConfigError(ValueError):
    pass


SUPPORTED = sys.platform == "darwin"
_SERVICE = os.environ.get("SHOPTAIKHOAN_KEYCHAIN_SERVICE", "com.shoptaikhoan.suite.sub2api").encode("utf-8")
_ACCOUNT = b"admin-config"
_lock = threading.Lock()
_NOT_FOUND = -25300


@lru_cache(maxsize=1)
def _frameworks():
    if not SUPPORTED:
        raise ConfigError("Lưu API Key hiện chỉ hỗ trợ macOS Keychain.")
    try:
        security = ct.CDLL("/System/Library/Frameworks/Security.framework/Security")
        core = ct.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        security.SecKeychainFindGenericPassword.argtypes = [
            ct.c_void_p, ct.c_uint32, ct.c_char_p, ct.c_uint32, ct.c_char_p,
            ct.POINTER(ct.c_uint32), ct.POINTER(ct.c_void_p), ct.POINTER(ct.c_void_p),
        ]
        security.SecKeychainAddGenericPassword.argtypes = [
            ct.c_void_p, ct.c_uint32, ct.c_char_p, ct.c_uint32, ct.c_char_p,
            ct.c_uint32, ct.c_void_p, ct.POINTER(ct.c_void_p),
        ]
        security.SecKeychainItemModifyAttributesAndData.argtypes = [ct.c_void_p, ct.c_void_p, ct.c_uint32, ct.c_void_p]
        security.SecKeychainItemDelete.argtypes = [ct.c_void_p]
        security.SecKeychainItemFreeContent.argtypes = [ct.c_void_p, ct.c_void_p]
        core.CFRelease.argtypes = [ct.c_void_p]
        core.CFRelease.restype = None
        return security, core
    except (OSError, AttributeError) as exc:
        raise ConfigError("Không mở được macOS Keychain.") from exc


def _access(action, config=None, *, service=_SERVICE):
    security, core = _frameworks()
    with _lock:
        length, data, item = ct.c_uint32(), ct.c_void_p(), ct.c_void_p()
        status = security.SecKeychainFindGenericPassword(
            None, len(service), service, len(_ACCOUNT), _ACCOUNT,
            ct.byref(length), ct.byref(data), ct.byref(item),
        )
        try:
            if status not in (0, _NOT_FOUND):
                raise ConfigError("Không truy cập được Keychain. Hãy mở khóa Keychain rồi thử lại.")
            if action == "read":
                if status == _NOT_FOUND:
                    return {}
                try:
                    value = json.loads(ct.string_at(data, length.value).decode("utf-8"))
                    if not isinstance(value, dict) or not all(isinstance(value.get(k), str) for k in ("url", "api_key")):
                        raise ValueError
                    return value
                except (ValueError, UnicodeError) as exc:
                    raise ConfigError("Cấu hình đã lưu không hợp lệ. Hãy lưu lại cấu hình.") from exc
            if action == "clear":
                result = security.SecKeychainItemDelete(item) if status == 0 else 0
            else:
                payload = json.dumps(config, ensure_ascii=False).encode("utf-8")
                if status == 0:
                    result = security.SecKeychainItemModifyAttributesAndData(item, None, len(payload), payload)
                else:
                    result = security.SecKeychainAddGenericPassword(
                        None, len(service), service, len(_ACCOUNT), _ACCOUNT, len(payload), payload, None,
                    )
            if result:
                raise ConfigError("Không lưu/xóa được cấu hình trong Keychain. Hãy thử lại.")
            return {}
        finally:
            if data.value:
                security.SecKeychainItemFreeContent(None, data)
            if item.value:
                core.CFRelease(item)


def load():
    return _access("read")


def save(url, api_key):
    _access("save", {"url": url, "api_key": api_key})


def clear():
    _access("clear")
