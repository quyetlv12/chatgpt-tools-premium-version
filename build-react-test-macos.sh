#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$ROOT/.venv/bin/python}"
BUILD="$ROOT/build/react-test"
DIST="$ROOT/dist-react-test"
APP="$DIST/Shoptaikhoan React Test.app"
ENGINES="$APP/Contents/Resources/engines"

[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo "Build này dành cho Apple Silicon macOS." >&2; exit 1; }
"$PYTHON_BIN" -c 'import PyInstaller, playwright, pyotp, curl_cffi, fastapi'
command -v node >/dev/null
command -v bun >/dev/null
command -v xcrun >/dev/null

"$PYTHON_BIN" - "$ROOT/packaging/macos/ReactTest-Info.plist" <<'PY'
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
from PyInstaller.depend.bindepend import get_python_library_path

target = plistlib.loads(Path(sys.argv[1]).read_bytes())["LSMinimumSystemVersion"]
def version(value):
    return tuple((list(map(int, value.split("."))) + [0, 0])[:3])
for binary in (get_python_library_path(), shutil.which("node")):
    metadata = subprocess.check_output(["xcrun", "vtool", "-show-build", str(binary)], text=True)
    minima = re.findall(r"^\s*minos\s+(\d+(?:\.\d+)+)", metadata, re.MULTILINE)
    if not minima and "LC_VERSION_MIN_MACOSX" in metadata:
        minima = re.findall(r"^\s*version\s+(\d+(?:\.\d+)+)", metadata, re.MULTILINE)
    if not minima or any(version(value) > version(target) for value in minima):
        raise SystemExit(f"Runtime {binary} is incompatible with macOS {target}; choose a portable PYTHON_BIN/Node runtime.")
PY

# Separate output trees preserve the legacy build and installed applications.
rm -rf "$BUILD" "$DIST"
mkdir -p "$BUILD" "$DIST" "$APP/Contents/MacOS" "$APP/Contents/Resources/bin" "$ENGINES"

echo "[1/7] Building React frontend"
(cd "$ROOT/frontend" && bun run build)

echo "[2/7] Building 2FA and Export engines"
mkdir -p "$ROOT/modules/twofa/build/macos"
xcrun swiftc -parse-as-library -O -target arm64-apple-macos13.5 \
  "$ROOT/modules/twofa/packaging/macos/MenuBarApp.swift" \
  -o "$ROOT/modules/twofa/build/macos/ShoptaikhoanMenuBar"
"$PYTHON_BIN" -m PyInstaller --noconfirm --clean \
  --distpath "$BUILD/twofa-dist" --workpath "$BUILD/twofa-work" \
  "$ROOT/modules/twofa/ShoptaikhoanTool.spec"
ditto "$BUILD/twofa-dist/Shoptaikhoan Tool.app" "$ENGINES/TwoFA.app"
"$PYTHON_BIN" -m PyInstaller --noconfirm --clean \
  --distpath "$BUILD/export-dist" --workpath "$BUILD/export-work" \
  "$ROOT/modules/gpt-tool/gpt-tool.spec"
ditto "$BUILD/export-dist/GPT-Tool.app" "$ENGINES/GPT-Tool.app"

echo "[3/7] Building Browser engines and bundling Chromium"
BROWSER="$ENGINES/BrowserLogin.app/Contents"
mkdir -p "$BROWSER/MacOS" "$BROWSER/Resources/bin" "$BROWSER/Resources/ms-playwright"
"$PYTHON_BIN" -m PyInstaller --noconfirm --clean --onefile \
  --name shoptaikhoan-server \
  --paths "$ROOT/modules/browser-login" \
  --add-data "$ROOT/modules/browser-login/index.html:." \
  --distpath "$BROWSER/Resources/bin" --workpath "$BUILD/browser-work" --specpath "$BUILD/specs" \
  "$ROOT/modules/browser-login/server.py"
"$PYTHON_BIN" -m PyInstaller --noconfirm --clean --onefile \
  --name shoptaikhoan-auto-login --collect-all playwright --hidden-import pyotp \
  --paths "$ROOT/modules/browser-login" \
  --distpath "$BROWSER/Resources/bin" --workpath "$BUILD/login-work" --specpath "$BUILD/specs" \
  "$ROOT/modules/browser-login/auto_login.py"
cp "$ROOT/modules/browser-login/macos/Info.plist" "$BROWSER/Info.plist"
xcrun swiftc -O -target arm64-apple-macos13.5 \
  "$ROOT/modules/browser-login/macos/ShopTaiKhoanApp.swift" -o "$BROWSER/MacOS/ShopTaiKhoanAutoTool"
env -u PLAYWRIGHT_BROWSERS_PATH "$PYTHON_BIN" - "$BROWSER/Resources/ms-playwright" <<'PY'
import json
from pathlib import Path
import subprocess
import sys
import playwright
from playwright.sync_api import sync_playwright

with sync_playwright() as engine:
    executable = Path(engine.chromium.executable_path)
if not executable.is_file():
    raise SystemExit("Install matching Chromium first: python -m playwright install chromium")
chromium = next(parent for parent in executable.parents if parent.name.startswith("chromium-"))
metadata = Path(playwright.__file__).parent / "driver/package/browsers.json"
for browser in json.loads(metadata.read_text())["browsers"]:
    if browser["name"] not in {"chromium", "chromium-headless-shell", "ffmpeg"}:
        continue
    source = chromium if browser["name"] == "chromium" else chromium.parent / (browser["name"].replace("-", "_") + "-" + browser["revision"])
    if not source.is_dir():
        raise SystemExit(f"Missing Playwright runtime: {source.name}")
    subprocess.run(["ditto", str(source), str(Path(sys.argv[1]) / source.name)], check=True)
PY

echo "[4/7] Building Backup engine and React hub"
"$PYTHON_BIN" -m PyInstaller --noconfirm --clean --onedir --contents-directory chat-backup-runtime \
  --name chat-backup-server --paths "$ROOT/modules/chat-backup" \
  --add-data "$ROOT/modules/chat-backup/web:web" --collect-all playwright --hidden-import pyotp \
  --distpath "$BUILD/backup-dist" --workpath "$BUILD/backup-work" --specpath "$BUILD/specs" \
  "$ROOT/modules/chat-backup/run.py"
ditto "$BUILD/backup-dist/chat-backup-server" "$ENGINES"
"$PYTHON_BIN" -m PyInstaller --noconfirm --clean --onedir --contents-directory hub-runtime \
  --name shoptaikhoan-suite-hub --paths "$ROOT" \
  --add-data "$ROOT/frontend/dist:frontend/dist" \
  --distpath "$BUILD/hub-dist" --workpath "$BUILD/hub-work" --specpath "$BUILD/specs" \
  "$ROOT/run-react-test.py"
ditto "$BUILD/hub-dist/shoptaikhoan-suite-hub" "$APP/Contents/Resources/bin"

echo "[5/7] Creating TEST launcher and icon"
cp "$ROOT/packaging/macos/ReactTest-Info.plist" "$APP/Contents/Info.plist"
ICON_WORK="$BUILD/icon"
mkdir -p "$ICON_WORK/AppIcon.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ROOT/packaging/macos/ReactTestIcon.png" --out "$ICON_WORK/AppIcon.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ROOT/packaging/macos/ReactTestIcon.png" --out "$ICON_WORK/AppIcon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICON_WORK/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"
cp "$ROOT/packaging/macos/MenuBarTemplate.svg" "$APP/Contents/Resources/MenuBarTemplate.svg"
xcrun swiftc -parse-as-library -O -target arm64-apple-macos13.5 \
  "$ROOT/packaging/macos/ShoptaikhoanSuite.swift" -o "$APP/Contents/MacOS/ShoptaikhoanSuite"

echo "[6/7] Checking dependencies and signing"
env PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  "$ENGINES/TwoFA.app/Contents/MacOS/Shoptaikhoan Tool" --check-runtime-dependencies
codesign --force --deep --sign - --timestamp=none "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
plutil -lint "$APP/Contents/Info.plist"

echo "[7/7] Creating ZIP"
cp "$ROOT/packaging/macos/ReactTest-README.txt" "$DIST/HUONG-DAN-CAI-DAT.txt"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$DIST/Shoptaikhoan-React-Test-macOS-arm64.zip"
shasum -a 256 "$DIST/Shoptaikhoan-React-Test-macOS-arm64.zip" > "$DIST/SHA256SUMS.txt"
echo "Built: $APP"
