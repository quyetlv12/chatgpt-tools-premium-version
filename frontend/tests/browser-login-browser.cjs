/* Synthetic browser parity checks. Every API call is intercepted; unknown API/external calls fail closed. */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/quyetdev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const base = process.env.REACT_TEST_URL || 'http://127.0.0.1:5151'
const account = 'synthetic@example.test|p;ass,w$*|JBSWY3DPEHPK3PXP'
const session = email => ({ accessToken: 'synthetic-token', user: { email }, account: { planType: 'plus' }, expires: '2030-01-01T00:00:00Z' })
const connection = email => ({ id: email, email, data: { _plan: 'plus', testStatus: 'active' } })
let checks = 0
function check(value, message) { assert.ok(value, message); checks++ }
function equal(actual, expected) { assert.deepEqual(actual, expected); checks++ }
async function visible(locator) { await locator.waitFor({ state: 'visible' }); checks++ }
function toast(page, text) { return page.locator('[data-sonner-toast]').filter({ hasText: text }) }
async function confirmAction(page, action, title, confirmText, accepted = true) {
  await action.click()
  const dialog = page.getByRole('alertdialog', { name: title, exact: true })
  await visible(dialog)
  await dialog.getByRole('button', { name: accepted ? confirmText : 'Hủy', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}
async function waitUntil(fn) {
  const deadline = Date.now() + 7000
  while (!fn()) { if (Date.now() > deadline) throw new Error('Timed out waiting for synthetic API state'); await new Promise(resolve => setTimeout(resolve, 30)) }
}
function idle() { return { running: false, done: 0, failed: 0, total: 0, results: [], logs: [] } }
async function fixture(browser, { fakeClock = false } = {}) {
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  if (fakeClock) await page.clock.install()
  const calls = [], unexpected = [], errors = []
  const state = { health: true, web: idle(), codex: idle(), auto: idle(), manual: { status: 'idle' }, connections: [], history: [], fail: null }
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => { unexpected.push('native dialog'); return dialog.dismiss() })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method()
    if (url.origin !== base) { unexpected.push(`${method} external`); return route.abort() }
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/modules/')) return route.continue()
    const prefix = '/modules/browser', endpoint = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname
    const body = req.postData() ? JSON.parse(req.postData()) : undefined
    calls.push({ endpoint, method, body })
    const send = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (state.fail?.endpoint === endpoint && method === (state.fail.method || 'POST')) { const error = state.fail; if (!error.persistent) state.fail = null; return send({ error: error.error }, 400) }
    if (method === 'GET') {
      if (endpoint === '/api/status') return send({ modules: ['twofa', 'export', 'browser', 'chat-backup'].map(key => ({ key, ready: true })) })
      if (endpoint === '/api/health') return send({ ok: state.health })
      if (endpoint === '/api/web-login/browsers') return send({ browsers: [{ id: 'auto', name: 'Tự động' }, { id: 'brave', name: 'Brave' }, { id: 'chrome', name: 'Chrome' }] })
      if (endpoint === '/api/web-login/status') return send(state.web)
      if (endpoint === '/api/codex-web/status') return send(state.codex)
      if (endpoint === '/api/oauth/auto-status') return send(state.auto)
      if (endpoint === '/api/oauth/status') return send(state.manual)
      if (endpoint === '/api/connections') return send({ connections: state.connections })
      if (endpoint === '/api/web-login/history') return send({ history: state.history })
    }
    if (method === 'POST') {
      if (endpoint === '/api/web-login/start') { state.web = { ...idle(), running: true, total: body.accounts.length }; return send({ ok: true }) }
      if (endpoint === '/api/web-login/pause' || endpoint === '/api/web-login/resume') { state.web.paused = endpoint.endsWith('pause'); return send({ ok: true }) }
      if (endpoint === '/api/web-login/stop') { state.web = idle(); return send({ ok: true }) }
      if (endpoint === '/api/codex-web/start') { state.codex = { ...idle(), running: true, total: body.accounts.length, runId: 'synthetic-run' }; return send({ ok: true }) }
      if (endpoint === '/api/codex-web/stop') { state.codex = idle(); return send({ ok: true }) }
      if (['/api/web-login/focus', '/api/web-login/show', '/api/web-login/rearrange', '/api/codex-web/focus'].includes(endpoint)) return send({ ok: true })
      if (endpoint === '/api/oauth/auto-login') { state.auto = { ...idle(), running: true, total: body.accounts.length, workersRequested: body.workers, workersRunning: body.workers, currentEmail: 'synthetic@example.test', activeAccounts: ['synthetic@example.test'] }; return send({ ok: true }) }
      if (endpoint === '/api/oauth/auto-stop') { state.auto.running = false; state.auto.stopped = true; return send({ ok: true, killed: true }) }
      if (endpoint === '/api/oauth/start') { state.manual = { status: 'waiting' }; return send({ ok: true }) }
      if (endpoint === '/api/import') { state.connections = body.connections.map(item => connection(item.email)); return send(state.importResponse || { inserted: body.connections.length, replaced: 0, errors: [] }) }
    }
    if (method === 'DELETE' && endpoint === '/api/web-login/history') { state.history = []; return send({ ok: true }) }
    if (method === 'DELETE' && endpoint.startsWith('/api/connections/')) { state.connections = state.connections.filter(item => item.id !== decodeURIComponent(endpoint.slice('/api/connections/'.length))); return send({ ok: true }) }
    unexpected.push(`${method} ${endpoint}`); return send({ error: 'Unmocked API blocked' }, 500)
  })
  await page.goto(`${base}/#/workspace/browser`)
  const workspace = page.locator('.browser-workspace')
  await visible(workspace.locator('.bw-service').filter({ hasText: /Server sẵn sàng|Server offline/ }))
  const tab = name => workspace.getByRole('navigation', { name: 'Chức năng Browser Login' }).getByRole('button', { name, exact: true }).click()
  const panel = name => workspace.getByRole('region', { name, exact: true })
  const sent = endpoint => calls.filter(call => call.endpoint === endpoint && call.method !== 'GET')
  const close = async () => { equal(unexpected, []); equal(errors, []); await context.close() }
  return { page, workspace, tab, panel, calls, sent, state, close }
}

async function webControls(browser) {
  const f = await fixture(browser), { page, workspace, panel, state, sent } = f, web = panel('ChatGPT Web')
  await web.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).click()
  await visible(web.getByRole('alert').filter({ hasText: 'Nhập tài khoản hợp lệ' }))
  equal(sent('/api/web-login/start').length, 0)
  await web.locator('#react-web-accounts').fill(account)
  await web.getByRole('spinbutton').fill('2')
  await web.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).click()
  const options = page.getByRole('dialog', { name: 'Tùy chọn trước khi chạy' })
  await visible(options)
  check(await options.getByLabel('Mobile (DevTools)', { exact: true }).isChecked())
  check(!await options.getByLabel('Reload tab chính sau đăng nhập', { exact: true }).isChecked())
  await options.getByLabel('Mobile (DevTools)', { exact: true }).uncheck()
  await options.getByLabel('Reload tab chính sau đăng nhập', { exact: true }).check()
  await options.getByRole('spinbutton').fill('12')
  await options.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).click()
  await waitUntil(() => sent('/api/web-login/start').length === 1)
  equal(sent('/api/web-login/start')[0].body, { accounts: [account], workers: 2, browser: 'brave', openLinkEnabled: true, linkUrl: 'https://chatgpt.com/api/auth/session', mobileEnabled: false, reloadEnabled: true, reloadSeconds: 12 })
  await visible(web.getByRole('button', { name: 'Tạm dừng', exact: true }))
  check(await web.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).isDisabled())
  check(await web.locator('#react-web-accounts').isEnabled())
  await web.getByRole('button', { name: 'Tạm dừng', exact: true }).click()
  await visible(web.getByRole('button', { name: 'Tiếp tục', exact: true }))
  await web.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
  await waitUntil(() => sent('/api/web-login/resume').length === 1)
  state.web = { ...state.web, done: 2, total: 3, failed: 1, browserControls: true, webSessions: 2, results: [{ email: 'verified@example.test', index: 1, status: 'success', personalAccountVerified: true }, { email: 'unverified@example.test', index: 2, status: 'success', workspaceCheckRequired: true, workspaceVerified: false, workspaceCheckError: 'identity_mismatch' }, { email: 'failed@example.test', status: 'error', error: '<synthetic-error>' }], logs: [{ time: new Date().toISOString(), email: 'synthetic@example.test', message: '<synthetic-log>' }] }
  await visible(web.getByText('verified@example.test', { exact: true }))
  equal(await web.locator('.bw-success').count(), 1)
  equal(await web.locator('.bw-warning').count(), 1)
  equal(await web.locator('.bw-failed').count(), 1)
  await visible(web.getByText('<synthetic-error>', { exact: true }))
  await visible(web.getByText('<synthetic-log>', { exact: true }))
  await web.getByRole('button', { name: 'Mở tab', exact: true }).first().click()
  await waitUntil(() => sent('/api/web-login/focus').length === 1)
  equal(sent('/api/web-login/focus')[0].body, { index: 1 })
  await web.getByRole('button', { name: 'Mở các tab đang chạy', exact: true }).click()
  await waitUntil(() => sent('/api/web-login/show').length === 1)
  await web.getByRole('button', { name: 'Sắp xếp lại tab', exact: true }).click()
  await waitUntil(() => sent('/api/web-login/rearrange').length === 1)
  const cancelSession = web.getByRole('button', { name: 'Hủy phiên hiện tại', exact: true })
  await confirmAction(page, cancelSession, 'Hủy phiên hiện tại?', 'Hủy phiên', false)
  equal(sent('/api/web-login/stop').length, 0)
  check(await cancelSession.evaluate(node => node === document.activeElement), 'Cancel restores the initiating button focus')
  await confirmAction(page, cancelSession, 'Hủy phiên hiện tại?', 'Hủy phiên')
  await waitUntil(() => sent('/api/web-login/stop').length === 1)
  await visible(web.getByRole('button', { name: 'Bắt đầu chạy', exact: true }))
  state.history = [{ email: 'history@example.test', status: 'success', personalAccountVerified: true, durationSeconds: 11, finishedAt: '2030-01-01T00:00:00Z' }]
  await workspace.getByRole('button', { name: 'Lịch sử tài khoản', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'Lịch sử tài khoản', exact: true })
  await visible(history.getByText('history@example.test', { exact: true }))
  await visible(history.getByText(/11s/))
  await confirmAction(page, history.getByRole('button', { name: 'Xóa lịch sử', exact: true }), 'Xóa lịch sử đăng nhập?', 'Xóa lịch sử', false)
  equal(sent('/api/web-login/history').length, 0)
  await confirmAction(page, history.getByRole('button', { name: 'Xóa lịch sử', exact: true }), 'Xóa lịch sử đăng nhập?', 'Xóa lịch sử')
  await visible(history.getByText('Chưa có lịch sử.', { exact: true }))
  equal(sent('/api/web-login/history').length, 1)
  await visible(toast(page, 'Đã xóa lịch sử.'))
  await history.getByRole('button', { name: 'Đóng', exact: true }).last().click()
  await f.close()
}

async function webOptionsAndErrors(browser) {
  const f = await fixture(browser), { page, workspace, panel, sent, state } = f, web = panel('ChatGPT Web')
  await web.locator('#react-web-accounts').fill(account)
  await web.getByRole('combobox').selectOption('chrome')
  await web.getByRole('textbox', { name: 'URL sau khi đăng nhập', exact: true }).fill('javascript:invalid')
  await web.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).click()
  await visible(web.getByRole('alert').filter({ hasText: 'Link phải bắt đầu' }))
  equal(sent('/api/web-login/start').length, 0)
  await web.getByRole('textbox', { name: 'URL sau khi đăng nhập', exact: true }).fill('https://chatgpt.com/k12-invite?workspace=synthetic')
  await web.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).click()
  let options = page.getByRole('dialog', { name: 'Tùy chọn trước khi chạy' })
  check(await options.getByLabel('Reload tab chính sau đăng nhập', { exact: true }).isChecked())
  equal(await options.getByRole('spinbutton').inputValue(), '10')
  await options.getByRole('button', { name: 'Hủy', exact: true }).click()
  await web.getByLabel('Mở URL sau khi đăng nhập', { exact: true }).uncheck()
  await web.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).click()
  options = page.getByRole('dialog', { name: 'Tùy chọn trước khi chạy' })
  check(!await options.getByLabel('Reload tab chính sau đăng nhập', { exact: true }).isChecked())
  state.fail = { endpoint: '/api/web-login/start', error: 'Synthetic start rejected' }
  await options.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).click()
  await visible(toast(page, 'Synthetic start rejected'))
  equal(await web.getByText('Synthetic start rejected', { exact: true }).count(), 0)
  equal(sent('/api/web-login/start').length, 1)
  equal(sent('/api/web-login/start')[0].body.linkUrl, '')
  equal(sent('/api/web-login/start')[0].body.openLinkEnabled, false)
  await page.reload()
  await visible(workspace.getByText('Server sẵn sàng', { exact: true }))
  equal(await web.getByRole('combobox').inputValue(), 'chrome')
  check(!await web.getByLabel('Mở URL sau khi đăng nhập', { exact: true }).isChecked())
  await f.close()
}

async function codexControls(browser) {
  const f = await fixture(browser), { page, panel, state, sent } = f
  await f.tab('Login Codex')
  const codex = panel('Login Codex')
  await codex.locator('#react-codex-accounts').fill(Array(51).fill(account).join('\n'))
  await codex.getByRole('button', { name: 'Đăng nhập Codex', exact: true }).click()
  await visible(codex.getByRole('alert').filter({ hasText: 'tối đa 50' }))
  await codex.locator('#react-codex-accounts').fill(account)
  await codex.getByRole('spinbutton').fill('11')
  await codex.getByRole('button', { name: 'Đăng nhập Codex', exact: true }).click()
  await visible(codex.getByRole('alert').filter({ hasText: 'từ 1 đến 10' }))
  equal(sent('/api/codex-web/start').length, 0)
  await codex.getByRole('spinbutton').fill('2')
  await codex.getByRole('button', { name: 'Đăng nhập Codex', exact: true }).click()
  await waitUntil(() => sent('/api/codex-web/start').length === 1)
  equal(sent('/api/codex-web/start')[0].body, { accounts: [account], workers: 2 })
  state.codex = { ...state.codex, done: 1, webReady: true, results: [{ email: 'synthetic@example.test', status: 'success', codexOpened: true, index: 1 }] }
  await visible(codex.getByRole('button', { name: 'Mở tab', exact: true }))
  await codex.getByRole('button', { name: 'Mở tab', exact: true }).click()
  await waitUntil(() => sent('/api/codex-web/focus').length === 1)
  equal(sent('/api/codex-web/focus')[0].body, { index: 1, runId: 'synthetic-run' })
  await confirmAction(page, codex.getByRole('button', { name: 'Hủy phiên hiện tại', exact: true }), 'Hủy phiên hiện tại?', 'Hủy phiên')
  await waitUntil(() => sent('/api/codex-web/stop').length === 1)
  equal(sent('/api/codex-web/stop')[0].body, { runId: 'synthetic-run' })
  state.codex = { ...idle(), blockedBy: 'chatgpt' }
  await visible(codex.getByText(/Đang có phiên ChatGPT Web mở/))
  check(await codex.getByRole('button', { name: 'Đăng nhập Codex', exact: true }).isDisabled())
  await f.close()
}

async function oauthAndAccounts(browser) {
  const f = await fixture(browser), { panel, state, sent, calls, page } = f
  await f.tab('OAuth Login')
  const oauth = panel('OAuth Login')
  await oauth.locator('#react-oauth-accounts').fill(account)
  await oauth.getByRole('spinbutton').fill('2')
  await oauth.getByLabel('Ẩn Chrome', { exact: true }).check()
  await oauth.getByRole('button', { name: 'Auto Login tất cả', exact: true }).click()
  await waitUntil(() => sent('/api/oauth/auto-login').length === 1)
  equal(sent('/api/oauth/auto-login')[0].body, { accounts: [account], headless: true, workers: 2 })
  await visible(oauth.getByRole('button', { name: 'Dừng', exact: true }))
  await oauth.getByRole('button', { name: 'Dừng', exact: true }).click()
  await visible(oauth.getByText('Đã dừng auto login.', { exact: true }))
  equal(sent('/api/oauth/auto-stop').length, 1)
  await oauth.getByRole('button', { name: 'Auto Login tất cả', exact: true }).click()
  await visible(oauth.getByRole('button', { name: 'Dừng', exact: true }))
  const countBefore = calls.filter(call => call.endpoint === '/api/connections').length
  state.connections = [connection('auto-imported@example.test')]
  state.auto = { ...idle(), done: 1, total: 1, results: [{ email: 'auto-imported@example.test', status: 'error', error: 'Earlier retry failed' }, { email: 'auto-imported@example.test', status: 'success', plan: 'plus', hasRefresh: true, imported: true }] }
  await visible(oauth.getByText('auto-imported@example.test', { exact: true }))
  equal(await oauth.getByText('auto-imported@example.test', { exact: true }).count(), 1)
  equal(await oauth.getByText('Earlier retry failed', { exact: true }).count(), 0)
  check(/^\d+:\d{2}$/.test(await oauth.locator('.bw-result time').innerText()))
  await f.tab('Tài khoản hiện có')
  await waitUntil(() => calls.filter(call => call.endpoint === '/api/connections').length > countBefore)
  const accounts = panel('Tài khoản hiện có')
  await visible(accounts.getByText('auto-imported@example.test', { exact: true }))
  await f.tab('OAuth Login')
  await oauth.getByRole('button', { name: 'Login thủ công', exact: true }).click()
  await oauth.getByRole('button', { name: 'Login ChatGPT (OAuth)', exact: true }).click()
  await visible(oauth.getByRole('button', { name: 'Đang chờ đăng nhập…', exact: true }))
  await waitUntil(() => calls.some(call => call.endpoint === '/api/oauth/status'))
  const manualBefore = calls.filter(call => call.endpoint === '/api/connections').length
  state.connections.push(connection('manual-imported@example.test'))
  state.manual = { status: 'success', email: 'manual-imported@example.test', plan: 'plus', hasRefresh: true, inserted: 1 }
  await visible(oauth.getByText('manual-imported@example.test', { exact: true }))
  await f.tab('Tài khoản hiện có')
  await waitUntil(() => calls.filter(call => call.endpoint === '/api/connections').length > manualBefore)
  await visible(accounts.getByText('manual-imported@example.test', { exact: true }))
  await confirmAction(page, accounts.getByRole('button', { name: 'Xóa manual-imported@example.test', exact: true }), 'Xóa tài khoản này?', 'Xóa tài khoản', false)
  equal(sent('/api/connections/manual-imported%40example.test').length, 0)
  await confirmAction(page, accounts.getByRole('button', { name: 'Xóa manual-imported@example.test', exact: true }), 'Xóa tài khoản này?', 'Xóa tài khoản')
  await waitUntil(() => sent('/api/connections/manual-imported%40example.test').length === 1)
  await visible(accounts.getByText('auto-imported@example.test', { exact: true }))
  await f.close()
}

async function imports(browser) {
  const f = await fixture(browser), { panel, page, sent } = f
  await f.tab('Import Session')
  const imports = panel('Import Session')
  await imports.getByRole('textbox', { name: 'Session JSON', exact: true }).fill('{invalid')
  await visible(imports.getByRole('alert').filter({ hasText: 'JSON không hợp lệ' }))
  check(await imports.getByRole('button', { name: 'Import vào 9router', exact: true }).isDisabled())
  await imports.getByRole('textbox', { name: 'Session JSON', exact: true }).fill(JSON.stringify({ nested: [session('nested@example.test')] }))
  await visible(imports.getByText('nested@example.test', { exact: true }))
  const downloadPromise = page.waitForEvent('download')
  await imports.getByRole('button', { name: 'Tải xuống JSON', exact: true }).click()
  const download = await downloadPromise
  check(download.suggestedFilename().endsWith('.9router.json'))
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'react-browser-synthetic-'))
  try { const file = path.join(temp, 'download.json'); await download.saveAs(file); const json = JSON.parse(await fs.readFile(file, 'utf8')); equal(json.providerConnections[0].email, 'nested@example.test'); equal(json.settings.requireLogin, false) } finally { await fs.rm(temp, { recursive: true, force: true }) }
  await imports.getByRole('button', { name: 'Import vào 9router', exact: true }).click()
  await visible(toast(page, 'Import thành công: 1'))
  equal(await imports.getByText(/Import thành công:/).count(), 0)
  equal(sent('/api/import')[0].body.connections[0].email, 'nested@example.test')
  await imports.getByRole('button', { name: 'Xóa', exact: true }).click()
  equal(await imports.getByRole('textbox', { name: 'Session JSON', exact: true }).inputValue(), '')
  await f.tab('Import từ file')
  const files = panel('Import từ file')
  await files.getByLabel('Chọn file JSON', { exact: true }).setInputFiles([
    { name: 'first.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(session('duplicate@example.test'))) },
    { name: 'last.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ providerConnections: [{ provider: 'codex', email: 'DUPLICATE@example.test', accessToken: 'synthetic-last' }] })) },
    { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') },
  ])
  await visible(files.getByText('1 tài khoản trùng email đã gộp, giữ bản cuối.', { exact: true }))
  await visible(files.getByText('DUPLICATE@example.test', { exact: true }))
  await files.getByRole('button', { name: 'Import 1 vào 9router', exact: true }).click()
  await waitUntil(() => sent('/api/import').length === 2)
  equal(sent('/api/import')[1].body, { connections: [{ provider: 'codex', email: 'DUPLICATE@example.test', accessToken: 'synthetic-last' }] })
  await files.getByRole('button', { name: 'Xóa tất cả', exact: true }).click()
  check(await files.getByRole('button', { name: /Import.*vào 9router/ }).isDisabled())
  await f.close()
}

async function offlineAndRetained(browser) {
  const f = await fixture(browser), { state, panel, workspace, page } = f
  state.web = { ...idle(), interrupted: true, webReady: true, browserControls: true, done: 1, webSessions: 1, results: [{ email: 'retained@example.test', index: 1, status: 'success', personalAccountVerified: true }] }
  await visible(panel('ChatGPT Web').getByText('retained@example.test', { exact: true }))
  await visible(panel('ChatGPT Web').getByText(/Phiên trước bị gián đoạn/))
  check(await panel('ChatGPT Web').getByRole('button', { name: 'Bắt đầu chạy', exact: true }).isDisabled())
  state.health = false
  await page.reload()
  await visible(workspace.locator('.bw-service').filter({ hasText: 'Server offline' }))
  await f.tab('Import Session')
  const imports = panel('Import Session')
  await imports.getByRole('textbox', { name: 'Session JSON', exact: true }).fill(JSON.stringify(session('offline@example.test')))
  check(await imports.getByRole('button', { name: 'Import vào 9router', exact: true }).isDisabled())
  check(await imports.getByRole('button', { name: 'Tải xuống JSON', exact: true }).isEnabled())
  state.health = true
  await workspace.getByRole('button', { name: 'Kết nối lại', exact: true }).click()
  await visible(workspace.getByText('Server sẵn sàng', { exact: true }))
  check(await imports.getByRole('button', { name: 'Import vào 9router', exact: true }).isEnabled())
  await f.close()
}

async function validationRetryAndMobile(browser) {
  const f = await fixture(browser), { panel, page, state, sent } = f
  const web = panel('ChatGPT Web')
  await web.locator('#react-web-accounts').evaluate((input, text) => {
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: (() => { const data = new DataTransfer(); data.setData('text', text); return data })() }))
  }, 'synthetic@example.test\tp;ass,w$*\tJBSWY3DPEHPK3PXP')
  equal(await web.locator('#react-web-accounts').inputValue(), account)
  await page.waitForFunction(() => {
    const select = document.querySelector('[aria-label="ChatGPT Web"] select')
    return select && !select.disabled
  })
  state.fail = { endpoint: '/api/web-login/browsers', method: 'GET', persistent: true, error: 'Synthetic query failure' }
  await page.reload()
  await visible(web.getByRole('alert').filter({ hasText: 'Không tải được dữ liệu' }))
  equal(await page.locator('[data-sonner-toast]').count(), 0)
  state.fail = null
  await web.getByRole('button', { name: 'Thử lại', exact: true }).click()
  await page.waitForFunction(() => {
    const select = document.querySelector('[aria-label="ChatGPT Web"] select')
    return select && !select.disabled
  })
  await web.getByRole('combobox').waitFor({ state: 'visible' })
  check(await web.getByRole('combobox').isEnabled())
  await f.tab('OAuth Login')
  const oauth = panel('OAuth Login')
  await oauth.getByRole('button', { name: 'Auto Login tất cả', exact: true }).click()
  await visible(oauth.getByRole('alert').filter({ hasText: 'Nhập tài khoản hợp lệ' }))
  await oauth.locator('#react-oauth-accounts').fill(account)
  await oauth.getByRole('spinbutton').fill('1.5')
  await oauth.getByRole('button', { name: 'Auto Login tất cả', exact: true }).click()
  equal(sent('/api/oauth/auto-login').length, 0)
  await oauth.getByRole('button', { name: 'Login thủ công', exact: true }).click()
  state.fail = { endpoint: '/api/oauth/start', error: 'Synthetic manual rejection' }
  await oauth.getByRole('button', { name: 'Login ChatGPT (OAuth)', exact: true }).click()
  await visible(toast(page, 'Synthetic manual rejection'))
  await oauth.getByRole('button', { name: 'Login ChatGPT (OAuth)', exact: true }).click()
  await visible(oauth.getByRole('button', { name: 'Đang chờ đăng nhập…', exact: true }))
  state.manual = { status: 'error', error: 'Synthetic callback failure' }
  await visible(oauth.getByText('Synthetic callback failure', { exact: true }))
  await page.clock.install()
  await oauth.getByRole('button', { name: 'Login ChatGPT (OAuth)', exact: true }).click()
  await visible(oauth.getByRole('button', { name: 'Đang chờ đăng nhập…', exact: true }))
  await page.clock.fastForward(121000)
  await visible(oauth.getByText('Hết thời gian chờ. Bấm Login lại để thử.', { exact: true }))
  check(await oauth.getByRole('button', { name: 'Login ChatGPT (OAuth)', exact: true }).isEnabled())
  await page.setViewportSize({ width: 390, height: 844 })
  await f.tab('ChatGPT Web')
  await web.locator('#react-web-accounts').fill(account)
  await web.getByRole('button', { name: 'Bắt đầu chạy', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Tùy chọn trước khi chạy' })
  await visible(dialog)
  const bounds = await dialog.boundingBox()
  check(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844, 'Mobile options stay inside viewport')
  await page.keyboard.press('Escape')
  equal(sent('/api/web-login/start').length, 0)
  await f.close()
}

;(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}) })
  try {
    const tests = [webControls, webOptionsAndErrors, codexControls, oauthAndAccounts, imports, offlineAndRetained, validationRetryAndMobile]
    for (const test of tests) { await test(browser); console.log(`PASS ${test.name}`) }
    console.log(`Browser Login: ${tests.length} scenarios, ${checks} assertions; all API mocked, no provider calls`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
