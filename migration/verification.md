# Native React verification

Verification evidence for the independent React Test release on 2026-11-01.
Current release results and historical coverage are labeled separately. See
[the feature matrix and repaired differences](parity-audit.md) for coverage.

## Automated gates

| Gate | Result |
| --- | --- |
| React unit/model/SSR tests | 33 passed, 187 assertions |
| React lint | 0 errors; 2 unused-variable warnings (`health` and `connected` in `TwoFAWorkspace`) |
| Vite production build | Passed, 2232 modules; chunk-size warning |
| Suite, isolation, original-preservation and proxy tests | 37 passed |
| Account/2FA/Passkey/Password Python tests | 290 tests, 0 failures/errors, 3 skipped |
| Pending verification and delayed-retry regressions | 7 passed (included in full backend run) |
| Required Account JavaScript gates | 5 suites and 5 syntax checks passed |
| Pure-request runtime dependencies and Python compilation | Passed |
| TOOL-FLOW diagrams (rollback audit) | 5 parsed with Mermaid v11 |
| Original Browser Login backend tests (prior audit) | 120 passed, 2 skipped |
| Original GPT Export backend tests (prior audit) | 63 passed, 3 skipped, 1 deselected |
| Original Chat Backup backend tests (prior audit) | 34 passed |
| Original Chat Backup and Suite UI scripts (prior audit) | Both passed |

Rows marked prior audit or rollback audit are historical coverage, not fresh
release results. Current production assets were rebuilt and packaged:
JavaScript 597.55 kB / 182.49 kB gzip; CSS 93.74 kB / 17.13 kB gzip.

Original HEAD, working-tree status and 226 source hashes match the recorded
baseline. Its two preexisting SSE lifecycle modifications remain untouched.
`source-baseline.json` remains immutable. The added recovery journal,
saved-enrollment resume branches and feature-only fixtures were removed.
The original durable new-secret checkpoint and fresh-login verification remain.
`session_phase.py` carries a direct logout routing repair; Community `service.py` and
`jobs.py` carry separately tested email-challenge classification and pending
verification retry changes. `workflow-overrides.json` pins fourteen reviewed files:
`mfa_phase.py`, `session_phase.py`, Community `server.py`, `service.py`, `jobs.py`,
`db/repositories.py`, `AGENTS.md`, `docs/TOOL-FLOW.md`, `test_mysql_sync.py`,
`test_twofa_history.py`, `test_passkey_feature.py`, `test_combined_jobs.py`,
`test_filtered_export.py` and `test_filtered_export_api.py`.
`dashboard.css` retains its separate presentation exemption. The remaining
copied workflow files stay under the isolation gate.

Current logs are retained in
[the release evidence directory](../.artifacts/react-release-20261101/).
Historical logs remain in
[the rollback evidence directory](../.artifacts/twofa-recovery-rollback-20261101/)
and [the prior audit directory](../.artifacts/parity-audit-2026-11-01/).
Before-edit source and removed recovery fixtures were backed up under
`build/rollback-twofa-recovery-20261101/`. The removed recovery mechanism has
not been reintroduced.

## Logout routing repair — 2026-11-02

- Compared combined orchestration against the original: rotation, durable
  checkpoint, fresh-login verification, reauthentication using the verified new
  secret, and one logout request remain in that order.
- A real curl client against local HTTP origin/proxy fixtures reproduces inherited
  proxy routing before the repair. Explicit empty HTTP/HTTPS proxy settings send
  exactly one logout POST to the origin and no request to the blocking proxy.
- Login failure now reports that logout was not sent; logout timeout/failure
  reports an unconfirmed outcome. Tests preserve the verified new secret,
  output/history and released locks, with no rerotation or automatic logout retry.
- Account Python: 300 tests, no failures/errors, 3 skipped. All 19 Account
  JavaScript scripts and five syntax checks passed. Runtime dependency and Python
  compilation checks passed. Suite/isolation/original-preservation gates: 37 tests
  passed. Independent focused review: 59 tests passed.
- Existing typed failed-row cleanup and synthetic 60-account combined-order
  regression were reviewed separately before refreshing their exact manifest pins.
  The original baseline remains immutable.
- This is local source-level evidence. It does not establish the cause of a
  historical provider failure, HTTPS/WAF behavior, or live session revocation.
  The running worker and installed app have not been restarted or rebuilt here.

## Real-browser contract scenarios

Four Chromium suites exercise the React application with synthetic accounts,
intercepted HTTP/SSE, clipboard and native-window actions. Unrecognized API
requests and external origins fail closed. They do not change real accounts.

| Suite | Scenarios |
| --- | ---: |
| Account check, 2FA, combined actions, Passkey, Password and history | 36 |
| Browser Login, OAuth, accounts, imports and retained state | 7 |
| Export and Chat Backup | 16 |
| Suite navigation, live-data lifecycle and responsive shell | 17 |

Current release: **76 scenarios passed, zero failures** across the four suites.
Account's latest installed-app run is `account-installed.log` (36/36).
The older `account-browser-final.log` contains a stale export-filename expectation
failure; the test was corrected at 19:38 and the installed-app run passed at
19:40. This is not an ignored failure. Browser Login reports 128 assertions
across its seven scenarios. Different test runners report different top-level
counts; those must not be confused with this scenario total.
Desktop 1440 × 1000, mobile 390 × 844 and 320px widths are covered; all five
workspaces render native React content with no legacy iframe or horizontal
document overflow.

## Reproduce

From this project root:

```sh
.venv/bin/python -m unittest discover -s tests
cd frontend
bun run test
bun run lint
bun run build
```

With `run-react.py` serving the build at 5150, and Node/Playwright available:

```sh
REACT_TEST_URL=http://127.0.0.1:5150 \
REACT_TEST_BASE=http://127.0.0.1:5150 \
node --test tests/workspace-browser.cjs tests/account-browser.cjs \
  tests/browser-login-browser.cjs tests/export-backup-browser.cjs
```

Set `PLAYWRIGHT_CHROMIUM` to a compatible local Chromium executable if needed;
set `NODE_PATH` to the installed Playwright module directory if it is not local.
Browser Login backend tests have a temporary-data, network-blocking harness:

```sh
BROWSER_TEST_EXECUTABLE=/path/to/chromium-headless-shell \
  .venv/bin/python frontend/tests/browser-backend-parity.py
```

Original Account backend tests must run against a temporary data directory with
an existing empty `twofa.db` before module import, preventing legacy data import:

```sh
env -u TWOFA_BROWSER_TEST .venv/bin/python - <<'PY'
import os
import pathlib
import tempfile
import unittest

with tempfile.TemporaryDirectory(prefix='twofa-react-tests-') as directory:
    pathlib.Path(directory, 'twofa.db').touch()
    os.environ['SHOPTAIKHOAN_TWOFA_DATA_DIR'] = directory
    suite = unittest.defaultTestLoader.discover('modules/twofa/tests', pattern='test_*.py')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
PY

for test_file in modules/twofa/tests/test_*.js; do
  node "$test_file" || exit $?
done

PYTHONPATH=modules/gpt-tool .venv/bin/python -m pytest \
  modules/gpt-tool/tests -q -k 'not native_keychain'
PYTHONPATH=modules/chat-backup .venv/bin/python -m unittest \
  discover -s modules/chat-backup/tests -v
node modules/chat-backup/tests/test_ui.js
node tests/test_suite_ui.js
```

## Authorized live account evidence

- A rotation attempt activated and checkpointed a new secret, then stopped at
  fresh-login verification because of an upstream email challenge; a later
  verification attempt hit DNS failure. Neither was reported as rotation success.
- The earlier pending job is no longer present. A final read-only installed
  runtime snapshot records a newer job in `change_2fa` mode with `status=success`,
  Live Plus, `login_verified=true` and `rotated_pending_verify=false`. SQLite has
  one 2FA history row linked to that job; its completion time precedes the
  captured logout test. This establishes the recorded verified-rotation state,
  not the actor or full click-to-provider sequence, and does not reconcile the
  removed pending job. Safe metadata is retained in
  `live/installed-state-final.json`; no credentials or provider calls were
  included in that observation.
- One real UI logout on the installed app returned HTTP 200 after confirmation:
  exactly one logout POST, no other POSTs, no JavaScript errors, and unchanged
  stored credentials, job status and history. See
  `live/logout-installed-result.json`. The logout test and final read-only
  observation did not start an additional login or rotation.
- These observations do not establish a clean end-to-end combined rotation/logout
  acceptance run or successful native passkey enrollment.

## Packaged application

- Installed and opened `/Applications/Shoptaikhoan React Test.app`, with native
  React production assets and the new toolbox/wrench/key icon. Its independent
  runtime uses port 5250; source development remains on 5150, never 5173.
- All four engines were ready. Packaged smoke tests opened all five workspaces,
  found no JavaScript errors, failed HTTP requests or external frontend requests,
  and confirmed duplicate launch preserves the existing sockets.
- `dist-react-test/Shoptaikhoan-React-Test-macOS-arm64.zip` is 490251989 bytes,
  requires macOS 15+, and has SHA-256
  `8040de2e86215b67dc1cfc3aaaa1434df3b5086303e5880f5134c79c8a0109a8`.
- Archive frontend assets match the installed build; the packaged Account engine
  matches the final engine build. No runtime database, `auth.json` or `.env`
  files were included. See `package-final.log` and `packaged-smoke.log`.
- Original source, its preexisting changes, and original app processes were
  preserved by the release work.

## Skips and acceptance limits

- Three Account backend browser tests require explicit `TWOFA_BROWSER_TEST`
  opt-in. The synthetic React browser suites cover their React counterparts.
- The prior Browser Login audit skipped two native/headed cases; the prior GPT
  audit skipped three cases needing an unavailable Chromium revision and
  deselected native Keychain integration.
- Synthetic scenarios intercept OS clipboard/window/folder/shutdown actions.
  Completed passkey enrollment, live chat deletion, provider exports/imports
  and Keychain changes were not live accepted.
- Removed recovery tests are historical only: 16 focused tests and a Postman
  simulation with 6 scenarios plus 2 budget checks, observing 44 API and 43
  control requests. They do not establish current-release recovery behavior.
- Provider email challenges, WAF, DNS/network failures and non-atomic factor
  replacement can still fail. No automatic recovery to the old secret exists.
  The documented gap before the new-secret checkpoint remains.
- OAuth callback port 1455 remains shared. Avoid simultaneous OAuth attempts
  across copies; the remaining React runtime is isolated.

These results establish the covered UI/API contracts and distinguish current
release, historical and live-provider evidence. They do not establish a 100%
guarantee across provider states, operating-system dialogs, browsers or devices.
