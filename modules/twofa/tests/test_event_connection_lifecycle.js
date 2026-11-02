'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'change 2fa community/static/app.js'), 'utf8');
const passwordSource = fs.readFileSync(path.join(root, 'change 2fa community/static/password-ui.js'), 'utf8');
const passwordInitStart = passwordSource.indexOf('  async function init()');
const passwordInitEnd = passwordSource.indexOf('  function closeWorkspace()', passwordInitStart);
const passwordInitSource = passwordSource.slice(passwordInitStart, passwordInitEnd);

// Chromium permits only a small HTTP/1.1 connection pool per origin. A page
// must not keep both SSE streams alive in every background tab, otherwise
// several open tool tabs can consume the pool and make reload wait forever.
assert.match(appSource, /function disconnectEvents\(\)[\s\S]*?state\.events\?\.close\(\)[\s\S]*?state\.events = null/);
assert.match(appSource, /function syncEventVisibility\(\)[\s\S]*?document\.visibilityState === 'hidden'[\s\S]*?disconnectEvents\(\)/);
assert.match(appSource, /document\.addEventListener\('visibilitychange', syncEventVisibility\)/);
assert.match(appSource, /window\.addEventListener\('pagehide', disconnectEvents\)/);

assert.match(passwordSource, /function disconnectEvents\(\)[\s\S]*?state\.events\?\.close\(\)[\s\S]*?state\.events = null/);
assert.match(passwordSource, /function shouldConnectEvents\(\)[\s\S]*?document\.visibilityState !== 'hidden'[\s\S]*?password-workspace'\)\.open/);
assert.match(passwordSource, /function syncEventVisibility\(\)[\s\S]*?shouldConnectEvents\(\)[\s\S]*?disconnectEvents\(\)/);
assert.match(passwordSource, /async function openWorkspace\(\)[\s\S]*?showModal\(\)[\s\S]*?syncEventVisibility\(\)/);
assert.ok(passwordInitStart >= 0 && passwordInitEnd > passwordInitStart);
assert.doesNotMatch(passwordInitSource, /connectEvents\(\)/, 'password SSE must stay lazy until the password workspace is open');
assert.match(passwordSource, /function closeWorkspace\(\)[\s\S]*?disconnectEvents\(\)[\s\S]*?clearWorkspaceCredentials\(\)/);
assert.match(passwordSource, /password-workspace'\)\.addEventListener\('close', closeWorkspace\)/);
assert.match(passwordSource, /document\.addEventListener\('visibilitychange', syncEventVisibility\)/);
assert.match(passwordSource, /window\.addEventListener\('pagehide', disconnectEvents\)/);

// Returning from Passkey can restore the dashboard without rerunning init()
// or firing visibilitychange. Exercise the actual lifecycle and snapshot code.
const listeners = {};
const streams = [];
let renderedJobs = [];
const existingJob = { id: 'existing', mode: 'check_only', status: 'success' };
const passkeyJob = { id: 'from-passkey', mode: 'check_only', status: 'success' };
const state = {
  token: 'synthetic-local-token',
  jobs: new Map([[existingJob.id, existingJob]]),
  selectedLogoutJobIds: new Set([existingJob.id]),
  pendingRechecks: new Set(),
  pendingRowChangeResults: new Set(),
  filter: 'live',
};
const eventTarget = target => ({
  addEventListener(type, handler) { listeners[`${target}:${type}`] = handler; },
});
const context = {
  state,
  document: { ...eventTarget('document'), visibilityState: 'visible' },
  window: {
    ...eventTarget('window'),
    RealtimeUI: require('../change 2fa community/static/realtime-ui.js'),
  },
  EventSource: class {
    constructor(url) { this.url = url; this.closed = false; streams.push(this); }
    close() { this.closed = true; }
    receive(payload) { this.onmessage({ data: JSON.stringify(payload) }); }
  },
  render() { renderedJobs = [...state.jobs.keys()]; },
  renderConnection() {},
  refreshOutput() { assert.fail('check snapshots must not refresh 2FA output'); },
  console,
};
vm.createContext(context);
const lifecycleStart = appSource.indexOf('  function flushRealtimeEvents(');
const lifecycleEnd = appSource.indexOf('  async function init()', lifecycleStart);
assert.ok(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart);
vm.runInContext(appSource.slice(lifecycleStart, lifecycleEnd), context);
const registrations = appSource.match(/(?:document|window)\.addEventListener\('(?:visibilitychange|pagehide|pageshow)', \w+\);/g);
vm.runInContext(registrations.join('\n'), context);
const dispatch = (target, type, event = {}) => listeners[`${target}:${type}`]?.(event);

context.syncEventVisibility();
streams[0].receive({ type: 'snapshot', jobs: [existingJob] });
state.eventBatcher.flushNow();
assert.deepEqual(renderedJobs, ['existing']);
dispatch('window', 'pagehide', { persisted: true });
assert.equal(streams[0].closed, true);
assert.equal(state.events, null);

// The server now has the Passkey login result; only pageshow fires on return.
dispatch('window', 'pageshow', { persisted: true });
assert.equal(streams.length, 2, 'restored dashboard must reconnect without visibilitychange or reload');
streams[1].receive({ type: 'snapshot', jobs: [existingJob, passkeyJob] });
state.eventBatcher.flushNow();
assert.deepEqual(renderedJobs, ['existing', 'from-passkey'], 'fresh snapshot must render the Passkey account');
assert.equal(state.filter, 'live');
assert.equal(state.selectedLogoutJobIds.has('existing'), true);

dispatch('window', 'pageshow', { persisted: true });
dispatch('document', 'visibilitychange');
assert.equal(streams.length, 2, 'repeated lifecycle events must reuse the open connection');
context.document.visibilityState = 'hidden';
dispatch('document', 'visibilitychange');
dispatch('window', 'pageshow', { persisted: true });
assert.equal(streams[1].closed, true);
assert.equal(streams.length, 2, 'hidden dashboard must not open a background stream');
context.document.visibilityState = 'visible';
dispatch('document', 'visibilitychange');
assert.equal(streams.length, 3);
dispatch('window', 'pagehide');

console.log('event connection lifecycle contract passed');
