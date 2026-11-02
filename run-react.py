"""Run the React development copy without touching the installed Suite runtime."""

import os
from pathlib import Path
import signal

ROOT = Path(__file__).resolve().parent
PORT = 5150
RUNTIME = ROOT / "runtime-react"


def configure_environment():
    if RUNTIME.is_symlink() or RUNTIME.resolve() != ROOT / "runtime-react":
        raise RuntimeError("runtime-react must be a local directory, not a symlink")
    # Never inherit executable overrides or data paths from the installed app.
    for key in tuple(os.environ):
        if key.startswith("SHOPTAIKHOAN_SUITE_") and key.endswith("_EXECUTABLE"):
            os.environ.pop(key)
    os.environ.pop("SHOPTAIKHOAN_AUTO_LOGIN_EXECUTABLE", None)
    os.environ["SHOPTAIKHOAN_SUITE_DATA_DIR"] = str(RUNTIME)
    os.environ["SHOPTAIKHOAN_KEYCHAIN_SERVICE"] = "com.shoptaikhoan.react-dev.sub2api"
    os.environ["NINE_ROUTER_DATA_DIR"] = str(RUNTIME / "nine-router")


def main():
    configure_environment()
    web_root = ROOT / "frontend" / "dist"
    if not (web_root / "index.html").is_file():
        raise SystemExit("Build frontend first: cd frontend && bun install && bun run build")

    import suite

    manager = suite.SuiteManager(suite.build_modules(ROOT, port=PORT))
    # Bind first: a second launcher must fail before unlinking any worker sockets.
    server = suite.create_hub_server("127.0.0.1", PORT, manager, web_root)

    def terminate(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, terminate)
    try:
        manager.start()
        print(f"React copy: http://127.0.0.1:{PORT}", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        manager.stop()


if __name__ == "__main__":
    main()
