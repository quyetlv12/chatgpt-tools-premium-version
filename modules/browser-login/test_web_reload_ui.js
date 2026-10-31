const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
// Parse every inline script, then exercise the real reload controls without a browser.
for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script);
const toggleTag = html.match(/<input[^>]*id="web-login-reload-toggle"[^>]*>/)[0];
assert.doesNotMatch(toggleTag, /\bchecked\b/);
assert.match(html, /id="web-login-reload-seconds"[^>]*value="10"[^>]*required disabled/);
const dialogHtml = html.slice(html.indexOf('<dialog class="modal" id="web-login-reload-dialog"'), html.indexOf('</dialog>'));
assert.match(dialogHtml, /<form method="dialog">/);
assert.match(dialogHtml, /id="web-login-reload-toggle"/);
assert.match(dialogHtml, /id="web-login-mobile-toggle" checked/);
assert.match(dialogHtml, /tự mở DevTools thật và bật nút Device Toolbar/);
assert.match(dialogHtml, /không đổi kích thước cửa sổ để giả mobile/);
assert.match(dialogHtml, /type="button" value="cancel"/);
const pageStart = html.indexOf('id="tab-web-login"');
assert.ok(pageStart > 0);
assert.doesNotMatch(html.slice(pageStart, html.indexOf('</section>', pageStart)), /id="web-login-reload-toggle"/);
assert.match(dialogHtml, /id="web-login-reload-help">Mặc định tắt\. Chỉ áp dụng cho lần chạy này\.<\/div>/);
assert.doesNotMatch(dialogHtml, /web-login-reload-question|backend|wId/);
assert.doesNotMatch(html, /tab chính đã reload một lần/);
assert.match(html, /tabs_closed: 'đã dừng kiểm tra vì tab hoặc Chrome đã đóng'/);
const begin = html.indexOf('      function syncWebLoginReloadToggle()');
const end = html.indexOf('      function parseWebLoginAccounts()', begin);
const nodes = new Map([
  ['web-login-reload-toggle', { checked: false, addEventListener(_, handler) { this.change = handler; } }],
  ['web-login-reload-seconds', { value: '10' }],
  ['web-login-reload-toggle-text', {}],
  ['web-login-reload-help', {}],
  ['web-login-mobile-toggle', { checked: true, addEventListener(_, handler) { this.change = handler; } }],
  ['web-login-mobile-toggle-text', {}],
  ['web-login-reload-dialog', {
    open: false,
    addEventListener(_, handler) { this.closed = handler; },
    showModal() { this.open = true; },
    close(value = '') { this.returnValue = value; this.open = false; this.closed(); },
  }],
]);
const context = { $: id => nodes.get(id), URL };
vm.createContext(context);
vm.runInContext(html.slice(begin, end), context);
const toggle = nodes.get('web-login-reload-toggle');
const input = nodes.get('web-login-reload-seconds');
const mobile = nodes.get('web-login-mobile-toggle');
mobile.checked = false;
mobile.change();
assert.equal(nodes.get('web-login-mobile-toggle-text').textContent, 'Tắt');
assert.equal(input.disabled, true);
toggle.checked = true;
toggle.change();
assert.equal(input.disabled, false);
assert.equal(nodes.get('web-login-reload-toggle-text').textContent, 'Bật');
assert.match(html, /JSON\.stringify\(\{ accounts: accounts\.map\(account => account\.raw\), workers, browser, \.\.\.linkSettings, \.\.\.reloadSettings \}\)/);
assert.match(html, /const reloadSettings = await askWebLoginReloadSettings\(linkSettings\);\s*if \(!reloadSettings\) return;/);
assert.ok(html.indexOf('const reloadSettings = await askWebLoginReloadSettings(linkSettings)') < html.indexOf("fetch(API + '/api/web-login/start'"));
(async () => {
  const dialog = nodes.get('web-login-reload-dialog');
  for (const value of ['1', '10', '37', '3600']) {
    const answer = context.askWebLoginReloadSettings();
    assert.equal(dialog.open, true);
    assert.equal(toggle.checked, false, 'each run starts with reload off');
    assert.equal(mobile.checked, true, 'each run starts with mobile on');
    assert.equal(input.disabled, true);
    assert.equal(await context.askWebLoginReloadSettings(), null, 'duplicate click cannot start a second prompt');
    toggle.checked = true;
    toggle.change();
    input.value = value;
    dialog.close('start');
    assert.deepEqual(JSON.parse(JSON.stringify(await answer)), {reloadEnabled: true, reloadSeconds: Number(value), mobileEnabled: true});
  }
  for (const action of ['cancel', '']) {
    const answer = context.askWebLoginReloadSettings();
    dialog.close(action);
    assert.equal(await answer, null, 'Cancel/Escape never starts login');
  }
  const answer = context.askWebLoginReloadSettings();
  mobile.checked = false;
  mobile.change();
  dialog.close('start');
  const settings = await answer;
  assert.equal(settings.reloadEnabled, false);
  assert.equal(settings.mobileEnabled, false);
  const invite = 'https://chatgpt.com/k12-invite?inv_email=synthetic%40example.invalid&wId=11111111-1111-4111-8111-111111111111';
  for (const url of [invite, invite.replace('/k12-invite?', '/k12-invite/?'), invite.replace('chatgpt.com/', 'chatgpt.com:443/')]) {
    input.value = '37';
    mobile.checked = false;
    const answer = context.askWebLoginReloadSettings({ openLinkEnabled: true, linkUrl: url });
    assert.equal(toggle.checked, true, 'K12 invite enables reload before confirmation');
    assert.equal(mobile.checked, true, 'K12 invite enables mobile before confirmation');
    assert.equal(input.disabled, false);
    assert.equal(input.value, '10');
    assert.match(nodes.get('web-login-reload-help').textContent, /K12 invite/);
    dialog.close('start');
    assert.deepEqual(JSON.parse(JSON.stringify(await answer)), { reloadEnabled: true, reloadSeconds: 10, mobileEnabled: true });
  }
  for (const linkSettings of [
    { openLinkEnabled: false, linkUrl: invite },
    ...['', 'not a url', 'https://chatgpt.com/api/auth/session', 'https://example.invalid/?next=' + invite,
      'https://chatgpt.com.example.invalid/k12-invite', 'https://chatgpt.com/k12-invite-extra',
      'http://chatgpt.com/k12-invite', 'https://chatgpt.com:8443/k12-invite',
      'https://synthetic@chatgpt.com/k12-invite'].map(linkUrl => ({ openLinkEnabled: true, linkUrl })),
  ]) {
    const answer = context.askWebLoginReloadSettings(linkSettings);
    assert.equal(toggle.checked, false, 'disabled/non-K12/foreign URL must keep reload off');
    assert.equal(mobile.checked, true, 'ordinary runs retain the existing mobile default');
    assert.equal(input.disabled, true);
    assert.equal(nodes.get('web-login-reload-help').textContent, 'Mặc định tắt. Chỉ áp dụng cho lần chạy này.');
    dialog.close();
    assert.equal(await answer, null);
  }
  const cancelledInvite = context.askWebLoginReloadSettings({ openLinkEnabled: true, linkUrl: invite });
  dialog.close('cancel');
  assert.equal(await cancelledInvite, null);
  const manualInvite = context.askWebLoginReloadSettings({ openLinkEnabled: true, linkUrl: invite });
  toggle.checked = false;
  toggle.change();
  mobile.checked = false;
  mobile.change();
  dialog.close('start');
  assert.deepEqual(JSON.parse(JSON.stringify(await manualInvite)), { reloadEnabled: false, reloadSeconds: 10, mobileEnabled: false });
  console.log('Run-options UI: K12 invite auto defaults, exact URL matching, overrides, ordinary defaults, Cancel/Escape, duplicate guard and payload passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
