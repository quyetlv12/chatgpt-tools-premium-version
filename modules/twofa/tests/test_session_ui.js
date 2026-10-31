'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { TextEncoder } = require('node:util');

const source = fs.readFileSync(
  path.join(__dirname, '../change 2fa community/static/session-ui.js'),
  'utf8',
);

class Element {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.files = [];
    this.disabled = false;
    this.checked = false;
    this.textContent = '';
    this.open = false;
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async dispatch(type, event = {}) {
    const handlers = this.listeners.get(type) || [];
    return Promise.all(handlers.map(handler => handler({
      type,
      target: this,
      preventDefault() { event.defaultPrevented = true; },
      ...event,
    })));
  }

  reset() {
    this.value = '';
    this.files = [];
    this.checked = false;
  }

  reportValidity() { return true; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
}

function setup({ api } = {}) {
  const ids = [
    'session-import', 'session-import-form', 'session-email', 'session-password',
    'session-file', 'session-json', 'session-confirm', 'session-import-status',
    'submit-session-import', 'close-session-import', 'open-session-import',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  elements['session-import-form'].reset = () => {
    for (const id of ['session-email', 'session-password', 'session-file', 'session-json', 'session-confirm']) {
      elements[id].reset();
    }
  };
  const sandbox = {
    TextEncoder,
    JSON,
    console,
    setTimeout,
    clearTimeout,
    document: { getElementById: id => elements[id] },
  };
  vm.runInNewContext(source, sandbox);
  const toasts = [];
  const jobs = [];
  sandbox.SessionImportUI.init({
    api: api || (async () => ({ job: { id: 'job' } })),
    toast: message => toasts.push(message),
    onJob: job => jobs.push(job),
    ready: () => true,
    document: sandbox.document,
  });
  return { elements, sandbox, toasts, jobs };
}

async function submit(ui) {
  return ui.elements['session-import-form'].dispatch('submit', {
    preventDefault() {},
  });
}

(async function main() {
{
  let parseCount = 0;
  const originalParse = JSON.parse;
  const ui = setup({
    api: async (_url, options) => ({ job: { id: 'safe-job', body: options.body } }),
  });
  ui.sandbox.JSON.parse = value => { parseCount += 1; return originalParse(value); };
  await ui.elements['open-session-import'].dispatch('click');
  ui.elements['session-email'].value = 'owner@example.test';
  ui.elements['session-password'].value = 'synthetic-password';
  ui.elements['session-json'].value = '{"accessToken":"synthetic-token"}';
  ui.elements['session-confirm'].checked = true;
  await submit(ui);
  assert.equal(parseCount, 1);
  assert.equal(ui.jobs.length, 1);
  assert.equal(ui.elements['session-email'].value, '');
  assert.equal(ui.elements['session-password'].value, '');
  assert.equal(ui.elements['session-json'].value, '');
  assert.equal(ui.elements['session-import'].open, false);
  assert.equal(ui.toasts.length, 1);
  assert.doesNotMatch(ui.toasts[0], /synthetic-token/);
}

{
  let resolve;
  const calls = [];
  const ui = setup({
    api: async (...args) => {
      calls.push(args);
      await new Promise(done => { resolve = done; });
      return { job: { id: 'job' } };
    },
  });
  await ui.elements['open-session-import'].dispatch('click');
  ui.elements['session-email'].value = 'owner@example.test';
  ui.elements['session-password'].value = 'synthetic-password';
  ui.elements['session-json'].value = '{"accessToken":"synthetic-token"}';
  ui.elements['session-confirm'].checked = true;
  const first = submit(ui);
  await Promise.resolve();
  const cancel = { defaultPrevented: false };
  await ui.elements['session-import'].dispatch('cancel', cancel);
  await ui.elements['close-session-import'].dispatch('click');
  const second = submit(ui);
  assert.equal(calls.length, 1);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(ui.elements['session-import'].open, true);
  resolve();
  await Promise.all([first, second]);
  assert.equal(ui.elements['session-import'].open, false);
  assert.equal(ui.elements['session-import-status'].textContent, '');
}

{
  const ui = setup({ api: async () => { throw new Error('lost response'); } });
  await ui.elements['open-session-import'].dispatch('click');
  ui.elements['session-email'].value = 'owner@example.test';
  ui.elements['session-password'].value = 'synthetic-password';
  ui.elements['session-json'].value = '{"accessToken":"synthetic-token"}';
  ui.elements['session-confirm'].checked = true;
  await submit(ui);
  assert.equal(ui.elements['session-email'].value, '');
  assert.match(ui.elements['session-import-status'].textContent, /Chưa xác nhận/);

  await ui.elements['open-session-import'].dispatch('click');
  ui.elements['session-email'].value = 'owner@example.test';
  await ui.elements['close-session-import'].dispatch('click');
  assert.equal(ui.elements['session-email'].value, '');
}

{
  let resolveFirst;
  const firstFile = { size: 10, text: () => new Promise(resolve => { resolveFirst = resolve; }) };
  const secondFile = { size: 10, text: async () => '{"accessToken":"second"}' };
  const ui = setup();
  await ui.elements['open-session-import'].dispatch('click');
  ui.elements['session-file'].files = [firstFile];
  const firstRead = ui.elements['session-file'].dispatch('change');
  await Promise.resolve();
  ui.elements['session-file'].files = [secondFile];
  const secondRead = ui.elements['session-file'].dispatch('change');
  await secondRead;
  resolveFirst('{"accessToken":"first"}');
  await firstRead;
  assert.equal(ui.elements['session-json'].value, '{"accessToken":"second"}');
}

console.log('session UI tests passed');
})();
