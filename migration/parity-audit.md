# React parity audit — 2026-11-01

## Scope and method

Compared the native React interfaces in this isolated copy against the original
`../chatgpt-tool` at `eba68ecdd29a7c712e9d96ddc4f4558efefe44dc`, including its
preexisting SSE lifecycle changes. Account, authentication and security engines
retain the original provider workflow with reviewed independent React-only
changes. The added 2FA recovery mechanism remains reverted; the original
new-secret checkpoint and fresh-login verification are preserved.
`session_phase.py` now aligns logout with direct login/MFA routing. Community `service.py` and
`jobs.py` now classify unsupported email challenges and allow manual pending
verification without repeating rotation, while blocking automatic retries for
credential/verification failures and rechecking delayed timers.
`source-baseline.json` remains immutable. In addition to Browser Login
isolation/OAuth-color and Sub2API Keychain-name exceptions,
`workflow-overrides.json` pins fourteen reviewed Account files: `mfa_phase.py`,
`session_phase.py`, Community `server.py`, `service.py`, `jobs.py`, `db/repositories.py`, `AGENTS.md`,
`docs/TOOL-FLOW.md`, `test_mysql_sync.py`, `test_twofa_history.py` and
`test_passkey_feature.py`, `test_combined_jobs.py`, `test_filtered_export.py` and
`test_filtered_export_api.py`. These also cover typed failed-row cleanup,
combined concurrency/order and separate safe login/logout failure messages.
`dashboard.css` retains its separate presentation exemption. The manifest pins
the reviewed deltas; the remaining copied workflow files stay under the isolation gate.

The current release ran browser scenarios against the real React application and real
Chromium with synthetic accounts and intercepted HTTP/SSE/clipboard/window actions. Unknown module APIs
and external origins are blocked. These scenarios verify controls, payloads,
state transitions, confirmations and error handling; they do not prove that an
upstream provider will accept a live operation.

## Feature matrix

| Area | Original behavior compared and exercised | Evidence |
| --- | --- | --- |
| Suite | Service failure/recovery, refresh, close-window request once, pending/error states, keyboard skip navigation | `frontend/tests/workspace-browser.cjs` |
| Account input | Chinese image labels, full-width digits, unambiguous `----` conversion, special password characters, exact submitted lines, settings limits | `frontend/tests/account-browser.cjs`, frontend unit tests |
| Account check | Check-only versus explicitly confirmed rotation, queue, retry/stop/delete, logs, usage refresh, copy email/raw, filters/export | Account browser suite, original 2FA backend tests |
| Security actions | Per-row 2FA result, combined selection, partial failure without automatic retry, logout and chat-delete confirmations, unchanged Session JSON | Account browser suite, original 2FA backend tests |
| History/journals | Save/close, load historical rows, historical copy, new run returns to current queue, 2FA history copy/export, preserve Live error rows during cleanup | Account browser suite, model tests |
| Passkey | Separate queue, launch confirmation and one-use local route, exactly-once automatic handoff, retry/stop/delete/logs, close windows, output | Account browser suite, account runtime/model tests |
| Password | Shared target settings, exact credential normalization, independent queue, retry/stop/delete, history search/copy, cleanup, close | Account browser suite, original password backend tests |
| Navigation/live data | Draft retention between Accounts/Passkey, account import without reload, removal events, page visibility/pagehide/pageshow, reject malformed/stale SSE callbacks | Workspace browser suite |
| Browser Login | ChatGPT/Codex controls, browser/worker/options, pause/resume/stop/focus/show/rearrange, progress/results/logs, OAuth, account list, session/file import and history | `frontend/tests/browser-login-browser.cjs`, Browser unit/backend suites |
| Export | Cockpit/9router/Sub2API format and auto-import combinations, worker limits, config save/clear/Keychain failure, convert, JSON copy, stop and fresh run, folder/shutdown request | `frontend/tests/export-backup-browser.cjs`, Export unit/backend suites |
| Chat Backup | Source/target/marker/limit/cleanup, scan before explicit selection, subset/all/none, stale run guard, failed selection retention, stale poll cancellation, stop/progress/checkpoint | Export/Backup browser suite, original Backup tests |
| Responsive shell | All five workspaces at 1440×1000 and 390×844, no horizontal document overflow or legacy iframe | Workspace browser suite |
| Isolation/transport | Original HEAD/status/226 hashes unchanged, immutable source baseline plus reviewed independent React overrides, local token/body transport, traversal/Origin/SSE guards, isolated runtime | `tests/test_react_*.py`, module API unit tests |

## Demonstrated regressions repaired

- Account stream now closes on `pagehide` and ignores callbacks from closed sources.
- Successful single-row 2FA changes show the fresh credential result; closing the
  dialog invalidates late raw responses.
- Saving a Live journal closes its dialog; starting a new batch leaves historical
  journal view and displays the current queue.
- Failed-row cleanup eligibility preserves Live rows as in the original.
- Filtered account exports retain the original canonical filenames.
- Browser OAuth completion and activation of Accounts refresh the connection list.
- OAuth history retains the latest result for each email and displays timing.
- Export stop notices no longer mask terminal cancellation/error/import results.

Only React copy files and copied archival configuration were changed. Legacy
`web/index.html` port strings and three GPT archival CSS text tokens were restored
to the original values to satisfy unchanged legacy tests. React serves
`frontend/dist` on 5150 and does not import those archival styles.

## Verification results

Current commands, log names and evidence boundaries are recorded in
`verification.md`. The release passed 76 synthetic Chromium scenarios:
Account 36, Browser Login 7 (128 assertions), Export/Backup 16 and Suite 17.
The installed Account run supersedes the earlier filename-expectation failure.
The backend completed 290 tests with zero failures/errors and 3 skipped;
Suite/isolation completed 37 tests; React completed 33 tests/187 assertions.
Required Account JavaScript gates, runtime dependencies and compilation passed.
Lint has zero errors and two existing unused-variable warnings. Production
assets were rebuilt (2232 modules): JavaScript 597.55 kB / 182.49 kB gzip and
CSS 93.74 kB / 17.13 kB gzip, with a chunk-size warning.

## Acceptance limits

- Synthetic scenarios establish payload, state, confirmation and retry contracts;
  they do not accept real provider chat deletion, exports/imports, Keychain,
  completed passkey enrollment or every OS action.
- A live rotation attempt checkpointed a new secret but verification encountered
  an upstream email challenge and later DNS failure. The pending job was later
  removed outside this sequence. A final read-only runtime snapshot records a
  newer `change_2fa` job as successful and Live Plus, with `login_verified=true`,
  no pending verification and one linked 2FA history row. That job completed
  before the captured logout. See `live/installed-state-final.json` in the
  release evidence. This records verified-rotation state, not a captured full
  sequence or reconciliation of the removed pending job.
- One real installed-app UI logout succeeded with HTTP 200 and exactly one
  logout POST, without other POSTs, JavaScript errors or credential/history
  changes. The logout test and final observation started no additional login
  or rotation. A complete captured combined rotation/logout acceptance run
  is not established by these separate observations.
- The removed recovery mechanism has not been restored. Rotation remains
  non-atomic, and failure before the new-secret checkpoint can require manual
  account recovery; see `modules/twofa/docs/TOOL-FLOW.md` section 24.
- React production assets and the final Account engine were packaged in the
  independent React Test app, installed/opened on port 5250 with a new tool icon.
  Archive/build/install asset checks and the four-engine smoke test passed.
  OAuth callback port 1455 remains shared; avoid simultaneous OAuth attempts.
- Original source and its preexisting changes were preserved. Passing this
  matrix is not a guarantee of 100% behavior across all provider states,
  operating-system dialogs, browsers or devices.
