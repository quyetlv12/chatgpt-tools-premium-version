'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const staticDir = path.join(__dirname, '../change 2fa community/static');
const app = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
const between = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
assert.match(html, /id="change-selected"[^>]+title="Đổi 2FA rồi logout tất cả phiên[^\n]+#ti-route[^\n]+Đổi 2FA \+ Logout/);
assert.doesNotMatch(html + app, /bulk-change-confirm|confirmBulkChange|openSelectedChangeConfirmation/);
assert.match(app, /\$\('change-selected'\)\.addEventListener\('click', async \(\) => \{\s*try \{ await startSelectedCombined\(\);/);

function harness(ids = ['a', 'b']) {
  const state = {
    jobs: new Map(ids.map(id => [id, { id, email: `${id}@example.test`, mode: 'check_only', status: 'success', account_state: 'live', login_verified: true }])),
    selectedLogoutJobIds: new Set(ids), combinedOperations: new Map(), combinedStartingJobIds: new Set(),
    pendingRechecks: new Set(), pendingRowChangeResults: new Set(),
    settings: { 'twofa.max_concurrent': 2 }, bulkCombinedPending: false,
  };
  const calls = [], messages = [], polls = [];
  let archived = false;
  let respond = async id => ({ id: `op-${id}`, job_id: id, email: `${id}@example.test`, status: 'running' });
  const context = {
    state, render() {}, toast: (...args) => messages.push(args),
    isJournalView: () => archived,
    isLoggingOut: job => job.sessions_logging_out,
    isPasskeyPreparing: job => job.passkey_preparing,
    handleCombinedSnapshot: op => state.combinedOperations.set(op.id, op),
    scheduleCombinedPoll: id => polls.push(id),
    api: async (url, options) => {
      calls.push({ url, options });
      const match = url.match(/^\/api\/jobs\/([^/]+)\/combined\/start$/);
      assert.ok(match, 'only the existing combined start endpoint may be called');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { confirm: 'START_COMBINED' });
      return respond(decodeURIComponent(match[1]));
    },
  };
  vm.createContext(context);
  vm.runInContext(
    between('  function isBulkCombinedEligible', '  function pruneLogoutSelection')
    + between('  function isRowChangeEligible', '  function renderOutput')
    + between('  function combinedTerminal', '  function handleCombinedSnapshot')
    + between('  async function startCombined', '  async function stopCombined')
    + between('  async function runWithConcurrency', '  async function confirmLogoutSessions')
    + between('  async function startSelectedCombined', '  async function copyRaw'), context,
  );
  return { state, calls, messages, polls, run: () => context.startSelectedCombined(),
    respond: fn => { respond = fn; }, archive: () => { archived = true; } };
}

(async () => {
  const valid = harness();
  valid.state.jobs.set('unselected', { ...valid.state.jobs.get('a'), id: 'unselected' });
  await valid.run();
  assert.deepEqual(valid.calls.map(call => call.url), ['/api/jobs/a/combined/start', '/api/jobs/b/combined/start']);
  assert.equal(valid.state.selectedLogoutJobIds.size, 0);
  assert.equal(valid.state.bulkCombinedPending, false);
  assert.equal(valid.polls.length, 2);

  for (const flag of ['login_verified', 'rotated_pending_verify', 'usage_refreshing', 'chat_deleting', 'sessions_logging_out', 'passkey_preparing']) {
    const invalid = harness();
    invalid.state.jobs.get('b')[flag] = flag !== 'login_verified';
    await invalid.run();
    assert.equal(invalid.calls.length, 0, `${flag} must reject the whole selection before starting`);
  }
  for (const key of ['pendingRechecks', 'pendingRowChangeResults', 'combinedStartingJobIds']) {
    const invalid = harness();
    invalid.state[key].add('b');
    await invalid.run();
    assert.equal(invalid.calls.length, 0, key);
  }
  const busy = harness();
  busy.state.combinedOperations.set('existing', { id: 'existing', email: 'B@example.test', status: 'running' });
  await busy.run();
  assert.equal(busy.calls.length, 0, 'same email active under another job blocks batch');
  const missing = harness();
  missing.state.jobs.delete('b');
  await missing.run();
  assert.equal(missing.calls.length, 0, 'deleted job cannot silently produce a partial batch');
  const archive = harness();
  archive.archive();
  await archive.run();
  assert.equal(archive.calls.length, 0);
  const empty = harness([]);
  await empty.run();
  assert.equal(empty.calls.length, 0);

  const pending = harness(['a', 'b', 'c', 'd']);
  const releases = [];
  let active = 0, peak = 0;
  pending.respond(async id => {
    active += 1;
    peak = Math.max(peak, active);
    if (id === 'a' || id === 'b') await new Promise(resolve => releases.push(resolve));
    active -= 1;
    if (id === 'b') throw new Error('Synthetic rejected start');
    return { id: `op-${id}`, job_id: id, status: 'running' };
  });
  const first = pending.run();
  assert.equal(pending.calls.length, 2, 'honor configured concurrent start limit');
  await pending.run();
  assert.equal(pending.calls.length, 2, 'duplicate click cannot send another batch');
  releases.forEach(resolve => resolve());
  await first;
  assert.equal(peak, 2);
  assert.equal(pending.calls.length, 4, 'remaining accounts still start after one failure');
  assert.deepEqual([...pending.state.selectedLogoutJobIds], ['b'], 'retain failed selection, clear accepted starts');
  assert.equal(pending.state.bulkCombinedPending, false);
  assert.match(pending.messages.at(-1)[0], /3\/4/);
  assert.match(pending.messages.at(-1)[0], /không tự động thử lại/);

  const changed = harness();
  changed.state.settings['twofa.max_concurrent'] = 1;
  changed.respond(async id => {
    changed.state.jobs.get('b').usage_refreshing = true;
    return { id: `op-${id}`, job_id: id, status: 'running' };
  });
  await changed.run();
  assert.equal(changed.calls.length, 1, 'revalidate each job immediately before starting');
  assert.match(changed.messages.at(-1)[0], /1\/2/);
  console.log('selected combined flow: eligibility, direct start, duplicate guard, concurrency and partial failure passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
