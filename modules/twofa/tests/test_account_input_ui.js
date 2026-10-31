'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'change 2fa community', 'static');
const helperSource = fs.readFileSync(path.join(root, 'account-input.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const passkeyHtml = fs.readFileSync(path.join(root, 'passkey.html'), 'utf8');
const scripts = ['app.js', 'password-ui.js', 'passkey-ui.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));

class TestEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
  }
}

const context = { window: {}, Event: TestEvent };
vm.createContext(context);
vm.runInContext(helperSource, context);
const { installPasteNormalizer, normalizeAccounts } = context.window.AccountInput;

assert.equal(normalizeAccounts('第1张\r\nfirst@example.test----p@ss\\*word----AAAA\r\n第 2 张\r\nsecond@example.test----p----BBBB'),
  'first@example.test|p@ss\\*word|AAAA\nsecond@example.test|p|BBBB');
assert.equal(normalizeAccounts('**第３张** inline@example.test----pw----CCCC'), 'inline@example.test|pw|CCCC');
assert.equal(normalizeAccounts('ready@example.test|pw----inside|DDDD'), 'ready@example.test|pw----inside|DDDD');
assert.equal(normalizeAccounts('ambiguous@example.test----pw----AAAA----extra'),
  'ambiguous@example.test----pw----AAAA----extra');
assert.equal(normalizeAccounts('empty@example.test--------AAAA'), 'empty@example.test--------AAAA');
assert.equal(normalizeAccounts('first@example.test----pw----AAAA\n\n第4张\nsecond@example.test----pw----BBBB'),
  'first@example.test|pw|AAAA\n\nsecond@example.test|pw|BBBB');

const listeners = new Map();
let inputEvents = 0;
const input = {
  value: 'before\nreplace me\nafter',
  selectionStart: 7,
  selectionEnd: 17,
  addEventListener(type, listener) { listeners.set(type, listener); },
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  dispatchEvent(event) {
    assert.equal(event.type, 'input');
    assert.equal(event.bubbles, true);
    inputEvents += 1;
  },
};
installPasteNormalizer(input);
let prevented = 0;
listeners.get('paste')({
  clipboardData: { getData: () => '第1张\r\nnew@example.test----pw----EEEE' },
  preventDefault() { prevented += 1; },
});
const inserted = 'new@example.test|pw|EEEE';
assert.equal(input.value, `before\n${inserted}\nafter`);
assert.equal(input.selectionStart, 7 + inserted.length);
assert.equal(input.selectionEnd, input.selectionStart);
assert.equal(prevented, 1);
assert.equal(inputEvents, 1);

listeners.get('paste')({
  clipboardData: { getData: () => 'ready@example.test|pw|FFFF' },
  preventDefault() { prevented += 1; },
});
assert.equal(prevented, 1, 'already-normalized input must use the browser paste path');
assert.equal(inputEvents, 1);

assert.ok(indexHtml.indexOf('/assets/account-input.js?v=1.0.0') < indexHtml.indexOf('/assets/app.js?v=1.3.49'));
assert.ok(indexHtml.indexOf('/assets/account-input.js?v=1.0.0') < indexHtml.indexOf('/assets/password-ui.js?v=1.2.3'));
assert.ok(passkeyHtml.indexOf('/assets/account-input.js?v=1.0.0') < passkeyHtml.indexOf('/assets/passkey-ui.js?v=1.1.3'));
assert.match(scripts[0], /AccountInput\.installPasteNormalizer\(\$\('combo-input'\)\)/);
assert.match(scripts[1], /AccountInput\.installPasteNormalizer\(\$\('password-combo-input'\)\)/);
assert.match(scripts[2], /AccountInput\.installPasteNormalizer\(\$\('passkey-combo-input'\)\)/);
assert.equal(scripts.join('\n').match(/AccountInput\.installPasteNormalizer/g).length, 3);

console.log('account paste normalization passed');
