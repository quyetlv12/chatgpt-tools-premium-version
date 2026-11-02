"""Packaged React test variant; reuse Suite engines with private local storage."""
import argparse
import os
from pathlib import Path
import signal
import sys

import suite

VARIANT = "com.shoptaikhoan.suite.react-test"
PORT = 5250
SUPPORT = Path.home() / "Library/Application Support/Shoptaikhoan React Test"
ROOT = Path(__file__).resolve().parent


def configure_environment(runtime, resources):
    runtime = Path(runtime).expanduser()
    if runtime.is_symlink():
        raise RuntimeError("Test runtime must not be a symlink")
    runtime = runtime.resolve()
    engines = Path(resources) / "engines"
    executables = {
        "TWOFA": "TwoFA.app/Contents/MacOS/Shoptaikhoan Tool",
        "EXPORT": "GPT-Tool.app/Contents/MacOS/GPT-Tool",
        "BROWSER": "BrowserLogin.app/Contents/Resources/bin/shoptaikhoan-server",
        "CHAT_BACKUP": "chat-backup-server",
    }
    for key, relative in executables.items():
        executable = engines / relative
        if not executable.is_file():
            raise RuntimeError(f"Missing bundled {key} engine")
        os.environ[f"SHOPTAIKHOAN_SUITE_{key}_EXECUTABLE"] = str(executable)
    os.environ["SHOPTAIKHOAN_SUITE_DATA_DIR"] = str(runtime)
    os.environ["SHOPTAIKHOAN_KEYCHAIN_SERVICE"] = VARIANT + ".sub2api"
    os.environ["NINE_ROUTER_DATA_DIR"] = str(runtime / "nine-router")
    os.environ["SHOPTAIKHOAN_AUTO_LOGIN_EXECUTABLE"] = str(engines / "BrowserLogin.app/Contents/Resources/bin/shoptaikhoan-auto-login")
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(engines / "BrowserLogin.app/Contents/Resources/ms-playwright")
    os.environ["SHOPTAIKHOAN_NO_MENU_BAR"] = "1"
    return runtime


def create_server(port, manager, web_root):
    server = suite.create_hub_server("127.0.0.1", port, manager, web_root)
    base_handler = server.RequestHandlerClass

    class TestHandler(base_handler):
        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path in {"/fonts/Inter-Variable.ttf", "/fonts/JetBrainsMono-Variable.ttf"}:
                font = web_root / path.lstrip("/")
                if font.is_file():
                    self._send(200, font.read_bytes(), "font/ttf")
                    return
            super().do_GET()

        def end_headers(self):
            self.send_header("X-Shoptaikhoan-Variant", VARIANT)
            super().end_headers()

    server.RequestHandlerClass = TestHandler
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--data-dir", type=Path, default=SUPPORT / "runtime")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    resources = Path(sys.executable).resolve().parent.parent
    configure_environment(args.data_dir, resources)
    web_root = ROOT / "frontend/dist"
    if not (web_root / "index.html").is_file():
        raise SystemExit("Missing bundled React frontend")
    manager = suite.SuiteManager(suite.build_modules(port=args.port))
    # Bind before touching sockets: a duplicate launch cannot stop the first app.
    server = create_server(args.port, manager, web_root)
    def terminate(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, terminate)
    try:
        manager.start()
        print(f"Shoptaikhoan React Test http://127.0.0.1:{args.port}/", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        # A second terminate signal must not interrupt socket/worker cleanup.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        server.server_close()
        manager.stop()


if __name__ == "__main__":
    main()
