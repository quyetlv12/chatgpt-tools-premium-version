# Native React migration

## Scope

This is an independent working-tree copy of `../chatgpt-tool`, based on HEAD
`eba68ecdd29a7c712e9d96ddc4f4558efefe44dc`. `source-baseline.json` records 226
source file hashes and the two pending SSE lifecycle changes present at copy time.
The original checkout, runtime and credentials are not modified or imported.

The application uses React JavaScript, Vite, Tailwind CSS, shadcn/Radix,
TanStack Query, React Router and Lucide. Native React components render:

- Account check / 2FA, results, selection actions, settings and history.
- Passkey input, queue and authenticated-account handoff.
- Password-change dialog.
- Codex Export and JSON conversion.
- Browser Login, sessions, imports and account history.
- Chat Backup and conversation selection.

These routes do not embed legacy HTML or iframes. Copied legacy assets remain
for provenance and existing backend routes. Backend provider operations remain
in the copied Python modules. `/modules/{key}/api/...` forwards allowed local
API requests, tokens and SSE streams through the Suite origin. Export's trusted
local Origin is translated to the module origin. This is a frontend migration,
not a replacement for provider authentication or security-operation order.

The MFA adapter includes a scoped transport repair: without an explicitly supplied
proxy, discovery and enrollment disable inherited HTTP/HTTPS proxies, matching
the login adapter. Logout uses the same direct route. The added 2FA recovery
mechanism remains reverted. Community `service.py` and
`jobs.py` classify unsupported email challenges and allow manual pending
verification without rotating again; automatic credential/verification retries
are blocked and delayed timers recheck eligibility. The original new-secret
checkpoint and fresh-login verification remain.
`workflow-overrides.json` pins fourteen reviewed independent files:
`mfa_phase.py` (proxy repair and private activation log), Community `server.py`
(native Passkey windows and typed failed-row cleanup), Community `service.py`
(retry guards and safe logout errors), `jobs.py` (retry guards and typed cleanup),
`session_phase.py` (direct logout routing),
`db/repositories.py` (repeated-rotation history),
`AGENTS.md`, `docs/TOOL-FLOW.md`, and the six regression tests
`test_mysql_sync.py`, `test_twofa_history.py`, `test_passkey_feature.py`,
`test_combined_jobs.py`, `test_filtered_export.py` and `test_filtered_export_api.py`.
`dashboard.css` retains its separate presentation exemption. The isolation gate
protects the remaining copied workflow files and verifies the original checkout
remains unchanged. `source-baseline.json` is immutable.

Visited workspaces stay mounted when switching routes, preserving input drafts,
SSE listeners and the Passkey-to-account-list bridge. Mounting a workspace does
not start account mutations. Frontend mutation submissions are not automatically
replayed. The removed recovery journal and saved-enrollment resume path are no
longer part of the React backend.

## Run

From `chatgpt-tool-react`:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd frontend
bun install --frozen-lockfile
bun run build
cd ..
.venv/bin/python run-react.py
```

Open <http://127.0.0.1:5150>. Node must be on PATH for Vite.
For HMR, keep that backend running and run `bun run dev` inside `frontend`;
open <http://127.0.0.1:5151>. Vite proxies `/api` and `/modules` to 5150.
`bun run preview` uses port 4173 with the same backend.

## Isolation and limits

- `run-react.py` forces `runtime-react/`, source engines, port 5150 and a
  separate Sub2API Keychain service.
- Browser storage discovery and Export CLI auth use `runtime-react/nine-router/`;
  existing system 9Router databases are not imported. No accounts are preloaded.
- Provider OAuth callback port **1455** remains shared across copies; avoid
  simultaneous OAuth login sessions.
- The independent macOS app is installed as
  `/Applications/Shoptaikhoan React Test.app` on port **5250**, with its own
  bundle identifier, runtime and tool icon. Its release archive is
  `dist-react-test/Shoptaikhoan-React-Test-macOS-arm64.zip` (macOS 15+, arm64).
- Release tests cover 76 synthetic browser scenarios, 290 Account backend tests
  (3 skipped), 37 Suite/isolation tests and 33 React tests/187 assertions.
  The installed runtime records a verified successful rotation with one linked
  history row; one captured real UI logout succeeded. A complete captured
  combined rotation/logout run and native passkey enrollment remain unverified.
  See [verification.md](verification.md) for the separate live evidence and limits.
- This folder is published on the `react` branch; `main` retains the original Suite.

## Checks

```sh
.venv/bin/python -m unittest discover -s tests -p test_suite.py
.venv/bin/python -m unittest discover -s tests -p 'test_react_*.py'
cd frontend
bun run test
bun run lint
bun run build
```

The current frontend and final Account engine were rebuilt, packaged, installed
and smoke-tested. All four engines were ready and all five workspaces opened
without JavaScript or HTTP errors in the packaged smoke test.

See [verification.md](verification.md) for results and remaining limitations,
and [parity-audit.md](parity-audit.md) for the feature matrix and repaired differences.
