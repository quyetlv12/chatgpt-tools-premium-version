// Real React interactions with an entirely synthetic transport. Unknown API
// requests and external origins are blocked before navigation.
const assert = require('node:assert/strict')
const { test, before, after } = require('node:test')
const { chromium } = require('playwright')

const base = process.env.REACT_TEST_URL || 'http://127.0.0.1:5151'
const ready = { modules: ['twofa', 'export', 'browser', 'chat-backup'].map(key => ({ key, ready: true })), browser_windows_open: false }
const boot = { token: 'synthetic-local-token', jobs: [], settings: {}, worker_health: {} }
const job = { id: 'synthetic-live', email: 'live@example.test', status: 'success', mode: 'check_only', account_state: 'live', login_verified: true, rotated_pending_verify: false }
let browser
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}) }) })
after(async () => { await browser?.close() })

async function until(predicate, message = 'expected state') {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

async function harness(t, { handler = () => undefined, route = '/', viewport = { width: 1440, height: 1000 } } = {}) {
  const context = await browser.newContext({ viewport })
  t.after(() => context.close())
  const page = await context.newPage()
  const calls = [], unexpected = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await context.addInitScript(() => {
    window.syntheticSources = []
    let visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { get: () => visibility })
    window.syntheticVisibility = value => { visibility = value; document.dispatchEvent(new Event('visibilitychange')) }
    window.EventSource = class {
      constructor(url) {
        this.url = url
        this.closed = false
        window.syntheticSources.push(this)
        queueMicrotask(() => { if (!this.closed) this.onopen?.({}) })
      }
      close() { this.closed = true }
      emit(payload) { this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) }) }
    }
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.syntheticClipboard = value } } })
  })
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== new URL(base).origin) { unexpected.push(req.url()); return route.abort() }
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/modules/')) return route.continue()
    const call = { path: url.pathname, method: req.method(), body: req.postData() ? req.postDataJSON() : undefined, token: req.headers()['x-auth-token'] }
    calls.push(call)
    let response = await handler(call)
    if (response === undefined) {
      if (call.path === '/api/status') response = ready
      else if (call.path === '/modules/twofa/api/bootstrap') response = boot
      else if (call.path === '/modules/twofa/api/combined') response = { operations: [] }
      else if (/^\/modules\/twofa\/api\/(?:passkey\/)?output$/.test(call.path)) response = { text: '' }
      else if (call.path === '/modules/twofa/api/passkey/bootstrap') response = { jobs: [] }
      else if (call.path === '/modules/export/api/sub2api/config') response = { supported: true, has_api_key: false, url: '' }
      else if (call.path === '/modules/chat-backup/api/status') response = { running: false, stage: 'idle' }
      else if (call.path === '/modules/chat-backup/api/history') response = { items: [] }
      else if (call.path === '/modules/browser/api/health') response = { ok: true }
      else if (call.path === '/modules/browser/api/web-login/browsers') response = { browsers: [{ id: 'auto', name: 'Tự động' }] }
      else if (/^\/modules\/browser\/api\/(?:web-login\/status|codex-web\/status|oauth\/auto-status)$/.test(call.path)) response = { running: false, done: 0, failed: 0, total: 0, results: [], logs: [] }
      else if (call.path === '/modules/browser/api/connections') response = { connections: [] }
      else if (call.path === '/modules/twofa/api/settings') response = { settings: { ...boot.settings, 'twofa.input_draft': call.body.input_draft } }
    }
    if (response === undefined) { unexpected.push(call); return route.fulfill({ status: 501, json: { error: 'Unmocked synthetic route' } }) }
    if (response.httpError) return route.fulfill({ status: response.httpError, json: { error: 'Synthetic failure' } })
    if (typeof response.text === 'string') return route.fulfill({ contentType: 'text/plain', body: response.text })
    return route.fulfill({ json: response })
  })
  t.after(() => { assert.deepEqual(unexpected, [], 'all APIs must be mocked'); assert.deepEqual(errors, [], 'no runtime errors') })
  await page.goto(`${base}/#${route}`)
  return { page, calls }
}

async function emit(page, suffix, payload) {
  await page.evaluate(({ suffix, payload }) => {
    const source = window.syntheticSources.findLast(source => source.url.split('?')[0].endsWith(suffix) && !source.closed)
    if (!source) throw new Error('Missing synthetic stream')
    source.emit(payload)
  }, { suffix, payload })
}
async function activeSources(page, suffix) {
  return page.evaluate(suffix => window.syntheticSources.filter(source => !source.closed && source.url.split('?')[0].endsWith(suffix)).length, suffix)
}

test('idle hidden workspaces stop polling and refresh on return without losing drafts', async t => {
  const { page, calls } = await harness(t, { route: '/workspace/twofa' })
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
  const go = name => nav.getByRole('link', { name, exact: true }).click()
  const count = path => calls.filter(call => call.path === path).length
  await page.getByLabel('Email | Mật khẩu | 2FA', { exact: true }).fill('draft@example.test|synthetic|TEST')
  await until(() => count('/modules/twofa/api/combined') > 0)
  await go('Browser Login')
  await page.locator('#react-web-accounts').fill('browser@example.test|synthetic|TEST')
  await until(() => count('/modules/browser/api/oauth/auto-status') > 0)
  await go('Chat Backup')
  await until(() => count('/modules/chat-backup/api/status') > 0)
  await go('Codex Export')
  await page.waitForTimeout(200)
  const paths = ['/modules/twofa/api/combined', '/modules/chat-backup/api/status', '/modules/browser/api/web-login/status', '/modules/browser/api/codex-web/status', '/modules/browser/api/oauth/auto-status', '/modules/browser/api/health']
  const before = paths.map(count)
  await page.waitForTimeout(4200)
  const extra = paths.map((path, i) => count(path) - before[i])
  t.diagnostic(`Hidden idle requests over 4.2s: ${JSON.stringify(Object.fromEntries(paths.map((path, i) => [path, extra[i]])))}`)
  assert.deepEqual(extra, paths.map(() => 0), 'hidden idle workspaces must issue no repeating status requests')
  await go('Tài khoản & 2FA')
  await until(() => count(paths[0]) > before[0], 'account operations refresh on activation')
  assert.equal(await page.getByLabel('Email | Mật khẩu | 2FA', { exact: true }).inputValue(), 'draft@example.test|synthetic|TEST')
  await go('Browser Login')
  await until(() => count(paths[2]) > before[2], 'browser status refreshes on activation')
  assert.equal(await page.locator('#react-web-accounts').inputValue(), 'browser@example.test|synthetic|TEST')
  await go('Chat Backup')
  await until(() => count(paths[1]) > before[1], 'backup status refreshes on activation')
  assert.deepEqual(calls.filter(call => call.method !== 'GET' && !call.path.endsWith('/api/settings')), [], 'navigation and polling never start or stop jobs')
})

test('combined operations keep polling while hidden and Stop still sends once', async t => {
  let operations = [{ id: 'synthetic-op', job_id: job.id, status: 'running' }]
  const statusPath = '/modules/twofa/api/combined', stopPath = `${statusPath}/synthetic-op/stop`
  const { page, calls } = await harness(t, { route: '/workspace/twofa', handler: call => {
    if (call.path.endsWith('/api/bootstrap')) return { ...boot, jobs: [job] }
    if (call.path === statusPath) return { operations }
    if (call.path === stopPath) { operations = []; return { operation: { status: 'cancelled' } } }
  } })
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
  const count = () => calls.filter(call => call.path === statusPath).length
  await page.getByRole('button', { name: 'Dừng gộp', exact: true }).waitFor()
  await nav.getByRole('link', { name: 'Codex Export', exact: true }).click()
  const hiddenReads = count()
  await until(() => count() >= hiddenReads + 3, 'hidden combined operation must keep polling')
  await nav.getByRole('link', { name: 'Tài khoản & 2FA', exact: true }).click()
  await page.getByRole('button', { name: 'Dừng gộp', exact: true }).click()
  await until(() => calls.some(call => call.path === stopPath))
  await page.getByRole('button', { name: '2FA + Logout', exact: true }).waitFor()
  assert.equal(calls.filter(call => call.method !== 'GET').length, 1, 'only the explicit Stop may mutate')
})

test('hidden status failures keep recovering until a successful idle snapshot', async t => {
  let failed = true
  const paths = ['/modules/twofa/api/combined', '/modules/chat-backup/api/status', '/modules/browser/api/codex-web/status']
  const { page, calls } = await harness(t, { route: '/workspace/twofa', handler: call => {
    if (failed && paths.includes(call.path)) return { httpError: 503 }
  } })
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
  const count = path => calls.filter(call => call.path === path).length
  await until(() => count(paths[0]) > 0)
  await page.waitForTimeout(100)
  await nav.getByRole('link', { name: 'Browser Login', exact: true }).click()
  await until(() => count(paths[2]) > 0)
  await page.waitForTimeout(100)
  await nav.getByRole('link', { name: 'Chat Backup', exact: true }).click()
  await until(() => count(paths[1]) > 0)
  await page.waitForTimeout(100)
  await nav.getByRole('link', { name: 'Codex Export', exact: true }).click()
  const reads = paths.map(count)
  failed = false
  await until(() => paths.every((path, i) => count(path) > reads[i]), 'unknown/failed status must recover while hidden')
  await page.waitForTimeout(100)
  const recovered = paths.map(count)
  await page.waitForTimeout(3200)
  assert.deepEqual(paths.map(count), recovered, 'successful hidden idle snapshots stop polling again')
})

test('combined Start with a failed response still follows the accepted operation after navigation', async t => {
  let operations = [], releaseStart
  const started = new Promise(resolve => { releaseStart = resolve })
  const statusPath = '/modules/twofa/api/combined', startPath = `/modules/twofa/api/jobs/${job.id}/combined/start`
  const { page, calls } = await harness(t, { route: '/workspace/twofa', handler: async call => {
    if (call.path.endsWith('/api/bootstrap')) return { ...boot, jobs: [job] }
    if (call.path === statusPath) return { operations }
    if (call.path === startPath) {
      await started
      operations = [{ id: 'synthetic-op', job_id: job.id, status: 'running' }]
      return { httpError: 503 }
    }
  } })
  const count = () => calls.filter(call => call.path === statusPath).length
  await until(() => count() > 0)
  await page.getByRole('button', { name: '2FA + Logout', exact: true }).click()
  await until(() => calls.some(call => call.path === startPath))
  await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Codex Export', exact: true }).click()
  await page.waitForTimeout(200)
  const reads = count()
  releaseStart()
  await until(() => count() >= reads + 2, 'accepted combined Start must be discovered and monitored despite a failed response')
  operations = []
  const runningReads = count()
  await until(() => count() > runningReads)
  await page.waitForTimeout(100)
  const idleReads = count()
  await page.waitForTimeout(3200)
  assert.equal(count(), idleReads, 'confirmed idle combined status pauses again')
  assert.deepEqual(calls.filter(call => call.method !== 'GET').map(call => [call.path, call.body]), [[startPath, { confirm: 'START_COMBINED' }]], 'status recovery never retries Start')
})

test('a delayed browser Start keeps monitoring after navigation, including retained windows', async t => {
  const statusPath = '/modules/browser/api/codex-web/status', startPath = '/modules/browser/api/codex-web/start'
  let state = { running: false }, releaseStart
  const started = new Promise(resolve => { releaseStart = resolve })
  t.after(() => releaseStart())
  const { page, calls } = await harness(t, { route: '/workspace/browser', handler: async call => {
    if (call.path === statusPath) return state
    if (call.path === startPath) { await started; state = { running: true, total: 1, runId: 'synthetic-run' }; return { ok: true } }
    if (call.path === '/modules/browser/api/codex-web/stop') { state = { running: false }; return { ok: true } }
  } })
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
  const count = () => calls.filter(call => call.path === statusPath).length
  await page.getByRole('navigation', { name: 'Chức năng Browser Login' }).getByRole('button', { name: 'Login Codex', exact: true }).click()
  await page.locator('#react-codex-accounts').fill('codex@example.test|synthetic|TEST')
  await page.getByRole('button', { name: 'Đăng nhập Codex', exact: true }).click()
  await until(() => calls.some(call => call.path === startPath))
  await nav.getByRole('link', { name: 'Codex Export', exact: true }).click()
  await until(() => page.locator('.browser-workspace').isHidden())
  await page.waitForTimeout(200)
  const hiddenReads = count()
  releaseStart()
  await until(() => count() >= hiddenReads + 2, 'Start completed while hidden must resume status polling')
  state = { ...state, running: false, webReady: true, done: 1 }
  const retainedReads = count()
  await until(() => count() >= retainedReads + 2, 'retained window must stay monitored while hidden')
  await nav.getByRole('link', { name: 'Browser Login', exact: true }).click()
  await page.getByRole('button', { name: 'Hủy phiên hiện tại', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Hủy phiên', exact: true }).click()
  await until(() => calls.some(call => call.path === '/modules/browser/api/codex-web/stop'))
  await until(() => page.getByRole('button', { name: 'Đăng nhập Codex', exact: true }).isEnabled())
  assert.deepEqual(calls.filter(call => call.method !== 'GET').map(call => call.path), [startPath, '/modules/browser/api/codex-web/stop'])
})

test('manual OAuth callbacks keep polling while the workspace is hidden', async t => {
  let state = { status: 'waiting' }
  const statusPath = '/modules/browser/api/oauth/status'
  const { page, calls } = await harness(t, { route: '/workspace/browser', handler: call => {
    if (call.path === '/modules/browser/api/oauth/start') return { ok: true }
    if (call.path === statusPath) return state
  } })
  await page.getByRole('navigation', { name: 'Chức năng Browser Login' }).getByRole('button', { name: 'OAuth Login', exact: true }).click()
  await page.getByRole('button', { name: 'Login thủ công', exact: true }).click()
  await page.getByRole('button', { name: 'Login ChatGPT (OAuth)', exact: true }).click()
  await until(() => calls.some(call => call.path === statusPath))
  await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Codex Export', exact: true }).click()
  const reads = calls.filter(call => call.path === statusPath).length
  state = { status: 'success', email: 'oauth@example.test', plan: 'free' }
  await until(() => calls.filter(call => call.path === statusPath).length > reads, 'hidden manual callback must be consumed')
  await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Browser Login', exact: true }).click()
  await page.getByText('oauth@example.test', { exact: true }).waitFor()
  assert.equal(calls.filter(call => call.method !== 'GET').length, 1)
})

test('backup follows hidden runs, refreshes history on completion, and preserves Stop', async t => {
  let state = { running: false, stage: 'idle' }
  const statusPath = '/modules/chat-backup/api/status', historyPath = '/modules/chat-backup/api/history'
  const { page, calls } = await harness(t, { route: '/workspace/chat-backup', handler: call => {
    if (call.path === statusPath) return state
    if (call.path.endsWith('/api/jobs/scan')) { state = { running: true, stage: 'choosing', run_id: 'synthetic-backup' }; return state }
    if (call.path.endsWith('/api/conversations')) return { run_id: state.run_id, items: [{ id: 'a', title: 'Synthetic chat' }] }
    if (call.path.endsWith('/api/jobs/selection')) { state = { ...state, stage: 'copying' }; return state }
    if (call.path.endsWith('/api/jobs/stop')) { state = { ...state, running: false, stage: 'stopped' }; return state }
  } })
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
  async function scan() {
    await page.getByLabel('Tài khoản nguồn', { exact: false }).fill('source@example.test|synthetic|TEST')
    await page.getByLabel('Tài khoản đích', { exact: false }).fill('target@example.test|synthetic|TEST')
    await page.getByRole('button', { name: 'Tải danh sách chat', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Synthetic chat', exact: true }).waitFor()
  }
  await scan()
  await page.getByRole('checkbox', { name: 'Synthetic chat', exact: true }).check()
  await page.getByRole('button', { name: 'Backup các chat đã chọn', exact: true }).click()
  await until(() => calls.some(call => call.path.endsWith('/api/jobs/selection')))
  await nav.getByRole('link', { name: 'Codex Export', exact: true }).click()
  const reads = calls.filter(call => call.path === statusPath).length
  const historyReads = calls.filter(call => call.path === historyPath).length
  await until(() => calls.filter(call => call.path === statusPath).length > reads, 'hidden backup must stay monitored')
  state = { ...state, running: false, stage: 'complete', done: 1, message: 'Synthetic hidden backup complete' }
  await page.locator('[data-sonner-toast]').filter({ hasText: state.message }).waitFor()
  await until(() => calls.filter(call => call.path === historyPath).length > historyReads, 'completion refreshes history while hidden')
  await nav.getByRole('link', { name: 'Chat Backup', exact: true }).click()
  await scan()
  await page.getByRole('button', { name: 'Dừng an toàn', exact: true }).click()
  await until(() => calls.some(call => call.path.endsWith('/api/jobs/stop')))
  assert.equal(calls.filter(call => call.path.endsWith('/api/jobs/stop')).length, 1)
})

test('backup Start with a failed response still follows the accepted run after navigation', async t => {
  let state = { running: false, stage: 'idle' }, releaseStart
  const started = new Promise(resolve => { releaseStart = resolve })
  const statusPath = '/modules/chat-backup/api/status', startPath = '/modules/chat-backup/api/jobs/scan'
  const { page, calls } = await harness(t, { route: '/workspace/chat-backup', handler: async call => {
    if (call.path === statusPath) return state
    if (call.path === startPath) {
      await started
      state = { running: true, stage: 'scanning', run_id: 'synthetic-backup' }
      return { httpError: 503 }
    }
  } })
  const count = () => calls.filter(call => call.path === statusPath).length
  await page.getByLabel('Tài khoản nguồn', { exact: false }).fill('source@example.test|synthetic|TEST')
  await page.getByLabel('Tài khoản đích', { exact: false }).fill('target@example.test|synthetic|TEST')
  await page.getByRole('button', { name: 'Tải danh sách chat', exact: true }).click()
  await until(() => calls.some(call => call.path === startPath))
  await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Codex Export', exact: true }).click()
  await page.waitForTimeout(200)
  const reads = count()
  releaseStart()
  await until(() => count() >= reads + 2, 'accepted backup Start must be discovered and monitored despite a failed response')
  state = { ...state, running: false, stage: 'error' }
  const runningReads = count()
  await until(() => count() > runningReads)
  await page.waitForTimeout(100)
  const idleReads = count()
  await page.waitForTimeout(1800)
  assert.equal(count(), idleReads, 'confirmed idle backup status pauses again')
  assert.deepEqual(calls.filter(call => call.method !== 'GET').map(call => call.path), [startPath], 'status recovery never retries Start')
})

test('account editor numbering follows scroll without changing pasted, copied or exported data', async t => {
  const rows = Array.from({ length: 42 }, (_, i) => i === 5 ? '' : `account${i + 1}@example.test|synthetic!$\\*${'long'.repeat(25)}|TEST`)
  const raw = rows.join('\n')
  for (const width of [1440, 390]) {
    const { page, calls } = await harness(t, {
      route: '/workspace/twofa', viewport: { width, height: 1000 },
      handler: call => {
        if (call.path === '/modules/twofa/api/output') return { text: raw }
        if (call.path === '/modules/twofa/api/jobs' && call.method === 'POST') return { jobs: [] }
      },
    })
    const input = page.getByLabel('Email | Mật khẩu | 2FA', { exact: true })
    const output = page.getByRole('textbox', { name: 'Kết quả đã xác minh', exact: true })
    await input.waitFor()
    assert.equal(await input.locator('..').locator('.tf-line-gutter').textContent(), '')
    await input.fill(raw)
    await until(async () => await output.inputValue() === raw)
    for (const editor of [input, output]) {
      assert.equal(await editor.inputValue(), raw)
      assert.equal(await editor.locator('..').locator('.tf-line-gutter').textContent(), rows.map((_, i) => i + 1).join('\n'))
      assert.equal(await editor.getAttribute('wrap'), 'off')
      await editor.evaluate(el => { el.scrollTop = 240; el.scrollLeft = 90 })
      await until(() => editor.evaluate(el => el.scrollTop > 0 && el.parentElement.querySelector('.tf-line-gutter>div').style.transform === `translateY(-${el.scrollTop}px)`), 'numbers must follow vertical scroll')
      assert.ok(await editor.evaluate(el => el.scrollLeft > 0), 'long rows scroll inside the editor')
      await editor.evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0 })
    }
    await page.getByRole('button', { name: 'Copy toàn bộ', exact: true }).click()
    await until(async () => await page.evaluate(() => window.syntheticClipboard) === raw)
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Xuất TXT', exact: true }).click()
    const download = await downloaded
    assert.equal(require('node:fs').readFileSync(await download.path(), 'utf8'), raw)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow')
    await page.evaluate(() => document.activeElement?.blur())
    await page.screenshot({ path: require('node:path').resolve(__dirname, `../../.artifacts/numbered-editors/${width}.png`), fullPage: true })
    await input.fill('')
    const pasted = 'paste@example.test----synthetic!*\\pass----TEST'
    await input.evaluate((el, text) => {
      const clipboardData = new DataTransfer(); clipboardData.setData('text', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
    }, pasted)
    const normalized = 'paste@example.test|synthetic!*\\pass|TEST'
    assert.equal(await input.inputValue(), normalized)
    assert.equal(await input.locator('..').locator('.tf-line-gutter').textContent(), '1')
    await page.getByRole('button', { name: 'Bắt đầu check', exact: true }).click()
    assert.equal(await page.getByRole('dialog').count(), 0)
    await until(() => calls.some(call => call.path === '/modules/twofa/api/jobs' && call.method === 'POST'))
    assert.deepEqual(calls.find(call => call.path === '/modules/twofa/api/jobs' && call.method === 'POST').body.lines, [normalized])
    await page.close()
  }
})

test('shell handles connection failure/recovery and never retries close-window side effects', async t => {
  let failing = true, closeFailure = true
  const { page, calls } = await harness(t, { handler: async call => {
    if (call.path === '/api/status') return failing ? { httpError: 503 } : { ...ready, browser_windows_open: true }
    if (call.path === '/api/windows/close') {
      await new Promise(resolve => setTimeout(resolve, 150))
      return closeFailure ? { httpError: 500 } : { ok: true }
    }
  } })
  const connectionError = page.getByRole('alert').filter({ hasText: 'Không lấy được trạng thái backend' })
  await connectionError.waitFor()
  assert.equal(await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link').count(), 5)
  assert.equal(await page.locator('#tf-input').isVisible(), true)
  failing = false
  await page.getByRole('button', { name: 'Thử kết nối lại', exact: true }).click()
  await connectionError.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Đóng cửa sổ tool', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Hủy', exact: true }).click()
  assert.equal(calls.filter(call => call.path === '/api/windows/close').length, 0)
  await page.getByRole('button', { name: 'Đóng cửa sổ tool', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Xác nhận', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Đang đóng…', exact: true }).isDisabled(), true)
  const failureToast = page.locator('[data-sonner-toast][data-type=error]').filter({ hasText: 'Không đóng được cửa sổ' })
  await failureToast.waitFor()
  assert.equal(calls.filter(call => call.path === '/api/windows/close').length, 1)
  await failureToast.getByRole('button', { name: 'Đóng thông báo', exact: true }).click()
  closeFailure = false
  await page.getByRole('button', { name: 'Đóng cửa sổ tool', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Xác nhận', exact: true }).click()
  await page.locator('[data-sonner-toast][data-type=success]').getByText('Đã đóng cửa sổ tool.', { exact: true }).waitFor()
  assert.equal(calls.filter(call => call.path === '/api/windows/close').length, 2)
})

test('switching Passkey and Accounts preserves drafts and receives imported accounts without reload', async t => {
  const { page, calls } = await harness(t, { route: '/workspace/twofa' })
  await page.getByLabel('Email | Mật khẩu | 2FA', { exact: true }).fill('draft@example.test|synthetic!$\\*pass|TEST')
  await page.getByRole('navigation').getByRole('link', { name: 'Thêm Passkey', exact: true }).click()
  await page.getByRole('textbox', { name: 'Danh sách tài khoản', exact: true }).fill('passkey@example.test|synthetic|TEST')
  await until(() => activeSources(page, '/api/passkey/events'))
  await emit(page, '/api/events', { type: 'job', job })
  await page.getByRole('navigation').getByRole('link', { name: 'Tài khoản & 2FA', exact: true }).click()
  await page.getByRole('button', { name: `Copy email ${job.email}`, exact: true }).waitFor()
  assert.equal(await page.getByLabel('Email | Mật khẩu | 2FA', { exact: true }).inputValue(), 'draft@example.test|synthetic!$\\*pass|TEST')
  await page.getByRole('button', { name: `Copy email ${job.email}`, exact: true }).click()
  await until(async () => await page.evaluate(() => window.syntheticClipboard) === job.email)
  await page.getByRole('navigation').getByRole('link', { name: 'Thêm Passkey', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Danh sách tài khoản', exact: true }).inputValue(), 'passkey@example.test|synthetic|TEST')
  await page.getByRole('navigation').getByRole('link', { name: 'Tài khoản & 2FA', exact: true }).click()
  await emit(page, '/api/events', { type: 'removed', id: job.id })
  await until(async () => await page.getByRole('button', { name: `Copy email ${job.email}`, exact: true }).count() === 0)
  assert.deepEqual(calls.filter(call => call.method !== 'GET' && call.path !== '/modules/twofa/api/settings'), [], 'navigation must never mutate accounts')
  assert.ok(calls.filter(call => call.path.startsWith('/modules/') && !call.path.endsWith('/bootstrap')).every(call => call.token === boot.token), 'private calls carry the local token')
})

test('Accounts stream closes on pagehide and ignores late events until pageshow reconnects', async t => {
  const { page } = await harness(t, { route: '/workspace/twofa' })
  await until(() => activeSources(page, '/api/events'))
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  assert.equal(await activeSources(page, '/api/events'), 0, 'pagehide must close the account stream')
  await page.evaluate(payload => window.syntheticSources.filter(source => source.url.split('?')[0].endsWith('/api/events')).forEach(source => source.emit(payload)), { type: 'job', job })
  assert.equal(await page.getByRole('button', { name: `Copy email ${job.email}`, exact: true }).count(), 0, 'a closed source cannot update account state')
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
  await until(() => activeSources(page, '/api/events'))
  assert.equal(await activeSources(page, '/api/events'), 1)
  await emit(page, '/api/events', { type: 'snapshot', jobs: [job] })
  await page.getByRole('button', { name: `Copy email ${job.email}`, exact: true }).waitFor()
})

test('Passkey stream pauses while hidden, reconnects once and rejects malformed/stale events', async t => {
  const { page } = await harness(t, { route: '/workspace/passkey' })
  await until(() => activeSources(page, '/api/passkey/events'))
  await emit(page, '/api/passkey/events', '{malformed')
  await page.evaluate(() => window.syntheticVisibility('hidden'))
  assert.equal(await activeSources(page, '/api/passkey/events'), 0)
  await page.getByText('Tạm dừng cập nhật khi ẩn', { exact: true }).waitFor()
  await page.evaluate(payload => window.syntheticSources.forEach(source => source.emit(payload)), { type: 'job', job: { ...job, handoff_ready: true } })
  assert.equal(await page.getByRole('button', { name: `Copy email ${job.email}`, exact: true }).count(), 0)
  await page.evaluate(() => window.syntheticVisibility('visible'))
  await until(() => activeSources(page, '/api/passkey/events'))
  assert.equal(await activeSources(page, '/api/passkey/events'), 1)
  await emit(page, '/api/passkey/events', { type: 'snapshot', jobs: [{ ...job, handoff_ready: true }] })
  await page.getByRole('button', { name: `Copy email ${job.email}`, exact: true }).waitFor()
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  assert.equal(await activeSources(page, '/api/passkey/events'), 0)
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
  await until(() => activeSources(page, '/api/passkey/events'))
  assert.equal(await activeSources(page, '/api/passkey/events'), 1)
})

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
  test(`all five workspaces fit ${viewport.width}px and support keyboard skip navigation`, async t => {
    const { page } = await harness(t, { route: '/workspace/twofa', viewport, handler: call => call.path === '/api/status' ? { ...ready, browser_windows_open: true } : undefined })
    await page.getByLabel('Email | Mật khẩu | 2FA', { exact: true }).waitFor()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content')
    for (const key of ['twofa', 'passkey', 'export', 'browser', 'chat-backup']) {
      await page.goto(`${base}/#/workspace/${key}`)
      await page.locator('section.workspace:not([hidden])').locator(key === 'twofa' ? '.tf-workspace' : key === 'passkey' ? '.aw-workspace' : key === 'browser' ? '.browser-workspace' : '.native-tools').waitFor()
      assert.equal(await page.locator('iframe').count(), 0)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${key}: document must not overflow horizontally`)
      const layout = await page.evaluate(() => {
        const header = document.querySelector('.app-header').getBoundingClientRect()
        const content = document.querySelector('section.workspace:not([hidden])').getBoundingClientRect()
        const tool = document.querySelector('section.workspace:not([hidden]) > :is(.tf-workspace, .aw-workspace, .browser-workspace, .native-tools)').getBoundingClientRect()
        const links = [...document.querySelectorAll('.app-header nav a')].map(link => link.getBoundingClientRect())
        const actions = document.querySelector('.topbar-actions').getBoundingClientRect()
        const bar = document.querySelector('section.workspace:not([hidden]) .tf-action-bar')?.getBoundingClientRect()
        return { top: header.bottom, contentTop: content.top, left: tool.left, width: tool.width, horizontal: links.every(link => Math.abs(link.top - links[0].top) < 1), linksInHeader: links.every(link => link.top >= header.top && link.bottom <= header.bottom), actionsRight: actions.right, barLeft: bar?.left }
      })
      assert.ok(layout.contentTop >= layout.top, 'tool must follow the header')
      assert.ok(layout.horizontal && layout.linksInHeader, 'navigation must stay horizontal inside the header')
      assert.ok(layout.actionsRight <= viewport.width, 'header utilities must stay within the viewport')
      assert.ok(Math.abs(layout.left) < 1 && Math.abs(layout.width - viewport.width) < 1, `${key}: tool must fill the page width`)
      if (layout.barLeft !== undefined) assert.ok(Math.abs(layout.barLeft) < 1, 'queue bar must span the page width')
      if (process.env.REACT_SCREENSHOT_DIR) {
        await require('node:fs/promises').mkdir(process.env.REACT_SCREENSHOT_DIR, { recursive: true })
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: `${process.env.REACT_SCREENSHOT_DIR}/${key}-${viewport.width}.png` })
      }
    }
  })
}
