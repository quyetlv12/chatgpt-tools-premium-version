'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const staticDir = path.join(root, 'change 2fa community', 'static');
const appSource = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(staticDir, 'dashboard.css'), 'utf8');
const indexSource = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
const spriteSource = fs.readFileSync(path.join(staticDir, 'tabler-icons.svg'), 'utf8');

assert.match(appSource, /tabler-icons\.svg\?v=1\.0\.4#ti-\$\{name\}/);
assert.match(appSource, /class="icon-button combined-flow[^"\n]*"[^>]+data-action="\$\{activeCombined \? 'stop-combined' : 'combined'\}"/);
assert.match(appSource, /Đổi 2FA → Logout tất cả phiên/);
assert.match(appSource, /activeCombined \? 'player-stop' : combinedStarting \? 'loader-2' : 'route'/);
assert.match(appSource, /const combinedTitle = activeCombined \? 'Dừng luồng gộp'/);
assert.match(cssSource, /\.icon-button\.combined-flow\{/);
assert.match(cssSource, /\.icon-button\.combined-flow\.is-pending \.ui-icon\{animation:recheckSpin/);
assert.doesNotMatch(cssSource, /\.combined-options\{|\.combined-option\{|#combined-confirm/);
assert.match(spriteSource, /<symbol id="ti-route"(?:\s|>)[\s\S]*?<\/symbol>/);
assert.match(spriteSource, /<symbol id="ti-player-stop"(?:\s|>)[\s\S]*?<\/symbol>/);

for (const id of [
  'combined-confirm',
  'combined-title',
  'combined-email',
  'combined-note',
  'combined-open',
  'combined-options',
  'combined-step-passkey',
  'combined-step-twofa',
  'combined-step-logout',
  'combined-start-action',
  'combined-confirm-action',
  'combined-stop-action',
  'combined-cancel',
]) {
  assert.doesNotMatch(indexSource, new RegExp(`id="${id}"`), `obsolete combined workflow element #${id}`);
}

assert.match(indexSource, /dashboard\.css\?v=1\.5\.26/);
assert.match(indexSource, /app\.js\?v=1\.3\.49/);
assert.doesNotMatch(appSource, /combinedStepDefinitions|selectedCombinedSteps|openCombinedConfirmation|confirmCombinedPasskey|confirm-passkey|combinedPreparing|combinedWindow|combinedLaunchOpened|hasCombinedUi/);

const startSource = appSource.slice(
  appSource.indexOf('async function startCombined'),
  appSource.indexOf('async function stopCombined'),
);
assert.match(startSource, /async function startCombined\(id\)/);
assert.match(startSource, /combinedStartingJobIds\.has\(id\)/);
assert.match(startSource, /combinedStartingJobIds\.add\(id\)/);
assert.match(startSource, /combinedStartingJobIds\.delete\(id\)/);
assert.match(startSource, /JSON\.stringify\(\{ confirm: 'START_COMBINED' \}\)/);
assert.doesNotMatch(startSource, /steps|showModal|\/passkey\//);

const stopSource = appSource.slice(
  appSource.indexOf('async function stopCombined'),
  appSource.indexOf('async function runWithConcurrency'),
);
assert.match(stopSource, /async function stopCombined\(id\)/);
assert.match(stopSource, /activeCombinedOperation\(state\.jobs\.get\(id\)\)/);
assert.match(stopSource, /combinedStoppingOperationIds\.has\(operation\.id\)/);
assert.match(stopSource, /combinedStoppingOperationIds\.add\(operation\.id\)/);
assert.match(stopSource, /combinedStoppingOperationIds\.delete\(operation\.id\)/);
assert.match(stopSource, /\/api\/combined\/\$\{encodeURIComponent\(operation\.id\)\}\/stop/);

assert.match(appSource, /if \(action === 'combined'\) return startCombined\(id\);/);
assert.match(appSource, /if \(action === 'stop-combined'\) return stopCombined\(id\);/);
assert.match(appSource, /function activeCombinedOperation\(job\)[\s\S]*?operation\.job_id === job\?\.id[\s\S]*?normalizedEmail\(operation\) === email/);
assert.match(appSource, /scheduleCombinedPoll\(operation\.id, 350\)/);
assert.match(appSource, /Đã dừng luồng gộp\. Thao tác đã gửi có thể không hoàn tác được\./);
assert.doesNotMatch(appSource, /Các bước còn lại sẽ không được chạy\./);

for (const action of ['passkey', 'change-2fa', 'logout-sessions']) {
  assert.match(appSource, new RegExp(`data-action="${action}"`), `missing existing ${action} action`);
}

console.log('fixed combined 2FA then logout UI and legacy actions passed');
