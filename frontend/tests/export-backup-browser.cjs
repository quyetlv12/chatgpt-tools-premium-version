// Synthetic browser regressions: intercept every API call before the UI opens.
// Run with NODE_PATH pointing to a Playwright installation and REACT_TEST_URL
// pointing to the local Vite frontend. No module backend or credentials needed.
const assert = require('node:assert/strict')
const { test, before, after } = require('node:test')
const { chromium } = require('playwright')

const base = process.env.REACT_TEST_URL || 'http://127.0.0.1:5151'
let browser
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}) }) })
after(async () => { await browser?.close() })

async function harness(t, workspace, handler, prefs) {
  const context = await browser.newContext()
  t.after(() => context.close())
  const page = await context.newPage()
  page.setDefaultTimeout(7000)
  const calls = [], unexpected = [], errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => { unexpected.push('native dialog'); return dialog.dismiss() })
  await context.addInitScript((value) => {
    if (value) localStorage.setItem('gpt-tool-ui', JSON.stringify(value))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.syntheticClipboard = text } } })
  }, prefs)
  await page.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== new URL(base).origin) { unexpected.push(request.url()); return route.abort() }
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/modules/')) return route.continue()
    let body
    if (request.postData()) body = request.postDataJSON()
    const call = { path: url.pathname, method: request.method(), body }
    calls.push(call)
    let response
    if (url.pathname === '/api/status') response = { modules: ['export', 'chat-backup'].map((key) => ({ key, ready: true })) }
    else response = await handler(call, page)
    if (response === undefined) { unexpected.push(call); return route.fulfill({ status: 501, json: { error: 'Unmocked synthetic route' } }) }
    if (response?.httpError) return route.fulfill({ status: response.httpError, json: { error: response.message } })
    return route.fulfill({ json: response })
  })
  await page.goto(`${base}/#/workspace/${workspace}`)
  t.after(() => { assert.deepEqual(unexpected, [], 'all APIs must be mocked'); assert.deepEqual(errors, [], 'no React runtime errors') })
  return { page, calls }
}

async function until(predicate, message = 'expected state') {
  const deadline = Date.now() + 7000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}
const exportConfig = { supported: true, has_api_key: false, url: '' }
const account = 'synthetic@example.test|synthetic-password|JBSWY3DPEHPK3PXP'
const toast = (page, text) => page.locator('[data-sonner-toast]').filter({ hasText: text })
async function answerConfirmation(page, trigger, title, confirmText, answer = 'accept') {
  await trigger.click()
  const dialog = page.getByRole('alertdialog', { name: title, exact: true })
  await dialog.waitFor()
  if (answer === 'escape') await page.keyboard.press('Escape')
  else await dialog.getByRole('button', { name: answer === 'cancel' ? 'Hủy' : confirmText, exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}
async function recordToasts(page) {
  await page.evaluate(() => {
    window.syntheticToastEvents = []
    const seen = new WeakSet()
    new MutationObserver((mutations) => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        const nodes = [...(node.matches('[data-sonner-toast]') ? [node] : []), ...node.querySelectorAll('[data-sonner-toast]')]
        for (const item of nodes) if (!seen.has(item)) { seen.add(item); window.syntheticToastEvents.push(item.textContent) }
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
}

for (const format of ['cockpit', '9router', 'sub2api']) {
  for (const autoImport of [true, false]) {
    test(`export ${format}: import=${autoImport} sends the original payload and retains preferences`, async (t) => {
      const { page, calls } = await harness(t, 'export', (call) => {
        if (call.path.endsWith('/sub2api/config')) return exportConfig
        if (call.path.endsWith('/api/export')) return { id: 'synthetic-export' }
        if (call.path.endsWith('/jobs/synthetic-export')) return { done: true, total: 1, results: [{ index: 0, email: 'synthetic@example.test', ok: true, copyable: true }] }
      }, { proxy: 'http://synthetic-proxy.test:8000' })
      const formatButton = page.getByRole('navigation', { name: 'Định dạng xuất' }).getByRole('button', { name: format === 'cockpit' ? 'Cockpit' : format === 'sub2api' ? 'Sub2API' : format, exact: true })
      await formatButton.click()
      assert.equal(await formatButton.getAttribute('aria-pressed'), 'true')
      await page.getByLabel('Số luồng').fill('4')
      await page.getByRole('textbox', { name: /Danh sách tài khoản/ }).fill(account)
      await page.getByRole('checkbox', { name: /^Tự / }).setChecked(autoImport)
      if (format === 'sub2api' && autoImport) {
        await page.getByLabel('URL Sub2API', { exact: true }).fill('https://sub2api.synthetic.test')
        await page.getByLabel('Admin API Key', { exact: false }).fill('synthetic-key')
      }
      await page.getByRole('button', { name: 'Chạy tool', exact: true }).click()
      await until(() => calls.some((call) => call.path.endsWith('/api/export')))
      assert.deepEqual(calls.find((call) => call.path.endsWith('/api/export')).body, {
        format, lines: account, proxy: 'http://synthetic-proxy.test:8000', workers: 4,
        cockpit_import: format === 'cockpit' && autoImport,
        nine_router_import: format === '9router' && autoImport,
        sub2api_import: format === 'sub2api' && autoImport,
        sub2api_url: format === 'sub2api' && autoImport ? 'https://sub2api.synthetic.test' : '',
        sub2api_api_key: format === 'sub2api' && autoImport ? 'synthetic-key' : '', sub2api_use_saved: false,
      })
      const stored = await page.evaluate(() => localStorage.getItem('gpt-tool-ui'))
      assert.equal(JSON.parse(stored).format, format)
      assert.equal(JSON.parse(stored).workers, 4)
      assert.equal(JSON.parse(stored).autoImport, autoImport)
      assert.ok(!stored.includes('synthetic-password') && !stored.includes('synthetic-key'))
      await page.getByRole('button', { name: 'Copy tất cả', exact: true }).waitFor()
    })
  }
}

test('Sub2API save, saved-key export, URL mismatch validation and clear use matching routes', async (t) => {
  let config = exportConfig
  const { page, calls } = await harness(t, 'export', (call) => {
    if (call.path.endsWith('/sub2api/config')) {
      if (call.method === 'POST') config = call.body.action === 'save' ? { supported: true, url: call.body.url, has_api_key: true } : exportConfig
      return config
    }
    if (call.path.endsWith('/api/export')) return { id: 'saved-export' }
    if (call.path.endsWith('/jobs/saved-export')) return { done: true, results: [] }
  })
  await page.getByRole('navigation', { name: 'Định dạng xuất' }).getByRole('button', { name: 'Sub2API', exact: true }).click()
  await page.getByLabel('URL Sub2API', { exact: true }).fill('https://saved.synthetic.test')
  await page.getByLabel('Admin API Key', { exact: false }).fill('synthetic-key')
  await page.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click()
  await until(async () => await page.getByLabel('Admin API Key', { exact: false }).inputValue() === '')
  assert.deepEqual(calls.find((call) => call.path.endsWith('/sub2api/config') && call.method === 'POST').body, { action: 'save', url: 'https://saved.synthetic.test', api_key: 'synthetic-key' })
  await page.reload()
  await until(async () => await page.getByLabel('URL Sub2API', { exact: true }).inputValue() === 'https://saved.synthetic.test')
  assert.equal(await page.getByLabel('Admin API Key', { exact: false }).inputValue(), '')
  assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('synthetic-key'))
  await page.getByRole('textbox', { name: /Danh sách tài khoản/ }).fill(account)
  await page.getByLabel('URL Sub2API', { exact: true }).fill('https://other.synthetic.test')
  await page.getByRole('button', { name: 'Chạy tool', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Nhập URL và Admin API Key của Sub2API trước khi chạy.' }).waitFor()
  assert.equal(await page.locator('[data-sonner-toast]').count(), 0, 'form validation stays inline')
  assert.equal(calls.filter((call) => call.path.endsWith('/api/export')).length, 0)
  await page.getByLabel('URL Sub2API', { exact: true }).fill('https://saved.synthetic.test/')
  await page.getByRole('button', { name: 'Chạy tool', exact: true }).click()
  await until(() => calls.some((call) => call.path.endsWith('/api/export')))
  assert.equal(calls.find((call) => call.path.endsWith('/api/export')).body.sub2api_use_saved, true)
  await page.getByRole('button', { name: 'Chạy tool', exact: true }).waitFor()
  const clear = page.getByRole('button', { name: 'Xóa cấu hình', exact: true })
  const clearCalls = () => calls.filter((call) => call.body?.action === 'clear')
  await answerConfirmation(page, clear, 'Xóa cấu hình Sub2API?', 'Xóa cấu hình', 'cancel')
  assert.equal(clearCalls().length, 0, 'cancel keeps Keychain configuration')
  await answerConfirmation(page, clear, 'Xóa cấu hình Sub2API?', 'Xóa cấu hình', 'escape')
  assert.equal(clearCalls().length, 0, 'Escape keeps Keychain configuration')
  await answerConfirmation(page, clear, 'Xóa cấu hình Sub2API?', 'Xóa cấu hình')
  await until(() => calls.some((call) => call.body?.action === 'clear'))
  await toast(page, 'Đã xóa cấu hình và key đã lưu.').waitFor()
  assert.equal(clearCalls().length, 1)
  assert.deepEqual(clearCalls()[0].body, { action: 'clear', url: 'https://saved.synthetic.test/', api_key: '' })
})

test('convert, row/all JSON copy, folder and shutdown preserve original actions', async (t) => {
  const { page, calls } = await harness(t, 'export', (call) => {
    if (call.path.endsWith('/sub2api/config')) return exportConfig
    if (call.path.endsWith('/api/convert') || call.path.endsWith('/jobs/converted')) return { id: 'converted', done: true, results: [{ index: 0, email: 'converted@example.test', ok: true, copyable: true }] }
    if (call.path.includes('/copy/')) return { data: { synthetic: call.path.endsWith('/all') ? 'all' : 'row' } }
    if (call.path.endsWith('/api/open-out') || call.path.endsWith('/api/shutdown')) return { ok: true }
  })
  await page.getByRole('button', { name: 'Convert JSON', exact: true }).click()
  await page.getByRole('textbox', { name: /Session \/ auth JSON/ }).fill('{"email":"converted@example.test","access_token":"synthetic"}')
  await page.getByRole('button', { name: 'Chạy Convert', exact: true }).click()
  await page.getByRole('button', { name: 'Copy JSON converted@example.test', exact: true }).click()
  await until(async () => (await page.evaluate(() => window.syntheticClipboard))?.includes('row'))
  await toast(page, 'Đã copy JSON vào clipboard.').waitFor()
  await page.getByRole('button', { name: 'Copy tất cả', exact: true }).click()
  await until(async () => (await page.evaluate(() => window.syntheticClipboard))?.includes('all'))
  assert.deepEqual(calls.find((call) => call.path.endsWith('/api/convert')).body, { format: 'cockpit', text: '{"email":"converted@example.test","access_token":"synthetic"}' })
  await page.getByRole('button', { name: 'Export Codex', exact: true }).click()
  await page.getByRole('button', { name: 'Mở file hệ thống', exact: true }).click()
  await until(() => calls.some((call) => call.path.endsWith('/api/open-out')))
  const shutdown = page.getByRole('button', { name: 'Tắt tool', exact: true })
  const shutdownCalls = () => calls.filter((call) => call.path.endsWith('/api/shutdown'))
  await answerConfirmation(page, shutdown, 'Tắt tool Export Codex?', 'Tắt tool', 'cancel')
  assert.equal(shutdownCalls().length, 0, 'cancel keeps Export running')
  await answerConfirmation(page, shutdown, 'Tắt tool Export Codex?', 'Tắt tool', 'escape')
  assert.equal(shutdownCalls().length, 0, 'Escape keeps Export running')
  await answerConfirmation(page, shutdown, 'Tắt tool Export Codex?', 'Tắt tool')
  await toast(page, 'Tool đã tắt. Bạn có thể đóng tab.').waitFor()
  assert.equal(shutdownCalls().length, 1)
  assert.equal(shutdownCalls()[0].method, 'POST')
  assert.deepEqual(shutdownCalls()[0].body, {})
  assert.equal(await page.getByRole('button', { name: 'Chạy tool', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('navigation', { name: 'Định dạng xuất' }).locator('button:disabled').count(), 3)
})

test('export stops an active job once and allows a fresh run after cancellation', async (t) => {
  let stopped = false, id = 0
  const { page, calls } = await harness(t, 'export', (call) => {
    if (call.path.endsWith('/sub2api/config')) return exportConfig
    if (call.path.endsWith('/api/export')) { stopped = false; id++; return { id: `running-${id}` } }
    if (call.path.endsWith('/stop')) { stopped = true; return { ok: true } }
    if (call.path.includes('/jobs/running-')) return { done: stopped, cancelled: stopped, total: 1, results: stopped ? [{ index: 0, email: 'synthetic@example.test', cancelled: true }] : [], running: stopped ? {} : { 0: { index: 0, email: 'synthetic@example.test', step: 'login' } } }
  })
  await page.getByRole('textbox', { name: /Danh sách tài khoản/ }).fill(account)
  await page.getByRole('button', { name: 'Chạy tool', exact: true }).click()
  assert.equal(await page.getByRole('navigation', { name: 'Định dạng xuất' }).locator('button:disabled').count(), 3)
  await page.getByRole('button', { name: 'Dừng tiến trình', exact: true }).click()
  await until(() => calls.some((call) => call.path.endsWith('/jobs/running-1/stop')))
  await page.getByRole('status').filter({ hasText: 'Đã dừng các tiến trình.' }).first().waitFor()
  assert.equal(await page.getByRole('navigation', { name: 'Định dạng xuất' }).locator('button:enabled').count(), 3)
  await page.getByRole('button', { name: 'Chạy tool', exact: true }).click()
  await page.getByRole('button', { name: 'Dừng tiến trình', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Dừng tiến trình', exact: true }).isEnabled(), true)
  assert.equal(calls.filter((call) => call.path.endsWith('/stop')).length, 1)
})

test('backup scan, explicit selection, safe stop and checkpoint refresh match the original flow', async (t) => {
  let state = { running: false, stage: 'idle' }, historyReads = 0
  const { page, calls } = await harness(t, 'chat-backup', (call) => {
    if (call.path.endsWith('/api/status')) return state
    if (call.path.endsWith('/api/history')) { historyReads++; return { items: [{ conversation_id: 'previous', title: 'Previous synthetic chat', status: 'done' }] } }
    if (call.path.endsWith('/jobs/scan')) { state = { running: true, stage: 'choosing', run_id: 'run-1' }; return state }
    if (call.path.endsWith('/api/conversations')) return { run_id: 'run-1', items: [{ id: 'a', title: 'Synthetic Alpha' }, { id: 'b', title: 'Synthetic Beta' }] }
    if (call.path.endsWith('/jobs/selection')) { state = { ...state, stage: 'copying', total: 2, done: 1 }; return state }
    if (call.path.endsWith('/jobs/stop')) { state = { ...state, running: false, stage: 'stopped' }; return state }
  })
  await page.getByLabel('Tài khoản nguồn', { exact: false }).fill('source@example.test|synthetic|TEST')
  await page.getByLabel('Tài khoản đích', { exact: false }).fill('target@example.test|synthetic|TEST')
  await page.getByLabel('Tin nhắn dùng để lưu bản sao').fill('Synthetic marker')
  await page.getByLabel('Giới hạn chat', { exact: false }).fill('2')
  await page.getByRole('checkbox', { name: 'Xóa link Share mới sau khi copy', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Tải danh sách chat', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Synthetic Alpha', exact: true }).waitFor()
  assert.deepEqual(calls.find((call) => call.path.endsWith('/jobs/scan')).body, { source: 'source@example.test|synthetic|TEST', target: 'target@example.test|synthetic|TEST', marker_message: 'Synthetic marker', limit: 2, cleanup_links: false })
  assert.equal(await page.getByLabel('Tài khoản nguồn', { exact: false }).inputValue(), '')
  assert.equal(await page.getByLabel('Tài khoản đích', { exact: false }).inputValue(), '')
  const backup = page.getByRole('button', { name: 'Backup các chat đã chọn', exact: true })
  assert.equal(await backup.isDisabled(), true)
  assert.equal(calls.filter((call) => call.path.endsWith('/jobs/selection')).length, 0)
  await page.getByRole('button', { name: 'Chọn tất cả', exact: true }).click()
  assert.equal(await page.getByRole('checkbox', { name: 'Synthetic Beta', exact: true }).isChecked(), true)
  await page.getByRole('button', { name: 'Bỏ chọn tất cả', exact: true }).click()
  assert.equal(await backup.isDisabled(), true)
  await page.getByRole('checkbox', { name: 'Synthetic Beta', exact: true }).check()
  await backup.click()
  await until(() => calls.some((call) => call.path.endsWith('/jobs/selection')))
  assert.deepEqual(calls.find((call) => call.path.endsWith('/jobs/selection')).body, { run_id: 'run-1', conversation_ids: ['b'] })
  await until(async () => await page.getByRole('progressbar', { name: 'Tiến trình sao chép chat' }).getAttribute('value') === '50')
  await page.getByRole('button', { name: 'Dừng an toàn', exact: true }).click()
  await until(() => historyReads >= 2)
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click()
  await until(() => historyReads >= 3)
  await page.getByText('Previous synthetic chat', { exact: true }).waitFor()
})

test('backup rejects stale catalogs and surfaces failed scans without losing inputs', async (t) => {
  let state = { running: false, stage: 'idle' }, failScan = true
  const { page, calls } = await harness(t, 'chat-backup', (call) => {
    if (call.path.endsWith('/api/status')) return state
    if (call.path.endsWith('/api/history')) return { items: [] }
    if (call.path.endsWith('/jobs/scan')) {
      if (failScan) return { httpError: 400, message: 'Synthetic scan failure' }
      state = { running: true, stage: 'choosing', run_id: 'new-run' }; return state
    }
    if (call.path.endsWith('/api/conversations')) return { run_id: 'old-run', items: [{ id: 'stale', title: 'Stale synthetic chat' }] }
  })
  await page.getByLabel('Tài khoản nguồn', { exact: false }).fill('source@example.test|synthetic|TEST')
  await page.getByLabel('Tài khoản đích', { exact: false }).fill('target@example.test|synthetic|TEST')
  await page.getByRole('button', { name: 'Tải danh sách chat', exact: true }).click()
  await toast(page, 'Synthetic scan failure').waitFor()
  assert.equal(await page.getByLabel('Tài khoản nguồn', { exact: false }).inputValue(), 'source@example.test|synthetic|TEST')
  failScan = false
  await page.getByRole('button', { name: 'Tải danh sách chat', exact: true }).click()
  await page.getByText('Tài khoản nguồn chưa có hội thoại.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('checkbox', { name: 'Stale synthetic chat', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Backup các chat đã chọn', exact: true }).isDisabled(), true)
  assert.equal(calls.filter((call) => call.path.endsWith('/jobs/selection')).length, 0)
})

test('export-only bypasses pending Keychain config and late config cannot overwrite a typed URL', async (t) => {
  let release
  const pendingConfig = new Promise((resolve) => { release = resolve })
  t.after(() => release(exportConfig))
  const { page, calls } = await harness(t, 'export', (call) => {
    if (call.path.endsWith('/sub2api/config')) return pendingConfig
    if (call.path.endsWith('/api/export')) return { id: 'no-keychain' }
    if (call.path.endsWith('/jobs/no-keychain')) return { done: true, results: [] }
  })
  await page.getByRole('navigation', { name: 'Định dạng xuất' }).getByRole('button', { name: 'Sub2API', exact: true }).click()
  await page.getByLabel('URL Sub2API', { exact: true }).fill('https://typed.synthetic.test')
  await page.getByRole('checkbox', { name: /^Tự / }).uncheck()
  await page.getByRole('textbox', { name: /Danh sách tài khoản/ }).fill(account)
  await page.getByRole('button', { name: 'Chạy tool', exact: true }).click()
  await until(() => calls.some((call) => call.path.endsWith('/api/export')))
  assert.equal(calls.find((call) => call.path.endsWith('/api/export')).body.sub2api_import, false)
  release({ supported: true, has_api_key: true, url: 'https://saved.synthetic.test' })
  await page.getByRole('button', { name: 'Chạy tool', exact: true }).waitFor()
  await page.getByRole('checkbox', { name: /^Tự / }).check()
  await page.getByText('Bấm Lưu cấu hình để dùng lại lần sau.', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('URL Sub2API', { exact: true }).inputValue(), 'https://typed.synthetic.test')
})

test('failed Keychain reads preserve manual exports and failed exports are never retried automatically', async (t) => {
  const { page, calls } = await harness(t, 'export', (call) => {
    if (call.path.endsWith('/sub2api/config')) return { httpError: 503, message: 'Synthetic Keychain unavailable' }
    if (call.path.endsWith('/api/export')) return { httpError: 400, message: 'Synthetic export failure' }
  })
  await page.getByRole('navigation', { name: 'Định dạng xuất' }).getByRole('button', { name: 'Sub2API', exact: true }).click()
  await page.getByText('Không đọc được cấu hình đã lưu; vẫn có thể nhập thủ công.', { exact: true }).waitFor()
  await page.getByLabel('URL Sub2API', { exact: true }).fill('https://manual.synthetic.test')
  await page.getByLabel('Admin API Key', { exact: false }).fill('synthetic-manual-key')
  await page.getByRole('textbox', { name: /Danh sách tài khoản/ }).fill(account)
  await page.getByRole('button', { name: 'Chạy tool', exact: true }).click()
  await toast(page, 'Synthetic export failure').waitFor()
  assert.equal(calls.filter((call) => call.path.endsWith('/api/export')).length, 1)
  assert.equal(calls.find((call) => call.path.endsWith('/api/export')).body.sub2api_api_key, 'synthetic-manual-key')
  assert.equal(await page.getByRole('button', { name: 'Chạy tool', exact: true }).isEnabled(), true)
})

test('backup ignores late status polls, retains failed selections and resets them for new runs', async (t) => {
  let state = { running: false, stage: 'idle' }, holdPoll = false, pollHeld = false, run = 0, failSelection = true, release
  const oldPoll = new Promise((resolve) => { release = resolve })
  t.after(() => release({ running: false, stage: 'idle' }))
  const { page, calls } = await harness(t, 'chat-backup', (call) => {
    if (call.path.endsWith('/api/status')) {
      if (holdPoll) { holdPoll = false; pollHeld = true; return oldPoll }
      return state
    }
    if (call.path.endsWith('/api/history')) return { items: [] }
    if (call.path.endsWith('/jobs/scan')) { run++; state = { running: true, stage: 'choosing', run_id: `run-${run}` }; return state }
    if (call.path.endsWith('/api/conversations')) return { run_id: state.run_id, items: [{ id: 'a', title: 'Synthetic selection' }] }
    if (call.path.endsWith('/jobs/selection')) {
      if (failSelection) return { httpError: 409, message: 'Synthetic selection failure' }
      state = { ...state, stage: 'copying' }; return state
    }
    if (call.path.endsWith('/jobs/stop')) { state = { ...state, running: false, stage: 'stopped' }; return state }
  })
  async function scan() {
    await page.getByLabel('Tài khoản nguồn', { exact: false }).fill('source@example.test|synthetic|TEST')
    await page.getByLabel('Tài khoản đích', { exact: false }).fill('target@example.test|synthetic|TEST')
    await page.getByRole('button', { name: 'Tải danh sách chat', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Synthetic selection', exact: true }).waitFor()
  }
  await until(() => page.getByRole('button', { name: 'Tải danh sách chat', exact: true }).isEnabled())
  holdPoll = true
  await until(() => pollHeld, 'poll must be in flight before mutation')
  await scan()
  release({ running: false, stage: 'idle' })
  await page.waitForTimeout(100)
  assert.equal(await page.getByRole('checkbox', { name: 'Synthetic selection', exact: true }).isVisible(), true)
  assert.equal(await page.getByLabel('Tài khoản nguồn', { exact: false }).isDisabled(), true)
  await page.getByRole('checkbox', { name: 'Synthetic selection', exact: true }).check()
  const backup = page.getByRole('button', { name: 'Backup các chat đã chọn', exact: true })
  await backup.click()
  await toast(page, 'Synthetic selection failure').waitFor()
  assert.equal(await page.getByRole('checkbox', { name: 'Synthetic selection', exact: true }).isChecked(), true)
  assert.equal(await backup.isEnabled(), true)
  failSelection = false
  await backup.click()
  await until(() => calls.filter((call) => call.path.endsWith('/jobs/selection')).length === 2)
  await page.getByRole('button', { name: 'Dừng an toàn', exact: true }).click()
  await scan()
  assert.equal(await page.getByRole('checkbox', { name: 'Synthetic selection', exact: true }).isChecked(), false)
  assert.equal(await backup.isDisabled(), true)
})

test('export completion notifies once across job refetches and workspace navigation', async (t) => {
  let jobReads = 0
  const { page } = await harness(t, 'export', (call) => {
    if (call.path === '/modules/chat-backup/api/status') return { running: false, stage: 'idle' }
    if (call.path === '/modules/chat-backup/api/history') return { items: [] }
    if (call.path.endsWith('/sub2api/config')) return exportConfig
    if (call.path.endsWith('/api/export')) return { id: 'notify-once' }
    if (call.path.endsWith('/jobs/notify-once')) {
      jobReads++
      return { done: true, total: 1, results: [{ index: 0, email: 'synthetic@example.test', ok: true }] }
    }
  })
  await recordToasts(page)
  await page.getByRole('textbox', { name: /Danh sách tài khoản/ }).fill(account)
  await page.getByRole('button', { name: 'Chạy tool', exact: true }).click()
  await toast(page, 'Hoàn tất xuất JSON: 1 thành công, 0 lỗi.').waitFor()
  for (let attempt = 0; attempt < 2; attempt++) {
    const previous = jobReads
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      window.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      window.dispatchEvent(new Event('visibilitychange'))
    })
    await until(() => jobReads > previous, 'completed job must refetch')
  }
  await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Chat Backup', exact: true }).click()
  await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Codex Export', exact: true }).click()
  assert.equal((await page.evaluate(() => window.syntheticToastEvents)).length, 1, 'refetch/navigation must not repeat completion')
})

test('backup restored results stay quiet and user completion notifies once across polls', async (t) => {
  let state = { running: false, stage: 'complete', run_id: 'restored', message: 'Restored synthetic backup', total: 1, done: 1 }, statusReads = 0
  const { page, calls } = await harness(t, 'chat-backup', (call) => {
    if (call.path.endsWith('/api/status')) { statusReads++; return state }
    if (call.path.endsWith('/api/history')) return { items: [] }
    if (call.path.endsWith('/jobs/scan')) { state = { running: true, stage: 'choosing', run_id: 'notify-backup' }; return state }
    if (call.path.endsWith('/api/conversations')) return { run_id: 'notify-backup', items: [{ id: 'a', title: 'Synthetic completion chat' }] }
    if (call.path.endsWith('/jobs/selection')) { state = { ...state, stage: 'copying', total: 1 }; return state }
  })
  await recordToasts(page)
  await page.getByRole('heading', { name: 'Restored synthetic backup', exact: true }).waitFor()
  assert.equal(await page.locator('[data-sonner-toast]').count(), 0, 'restored terminal state must not notify')
  await page.getByLabel('Tài khoản nguồn', { exact: false }).fill('source@example.test|synthetic|TEST')
  await page.getByLabel('Tài khoản đích', { exact: false }).fill('target@example.test|synthetic|TEST')
  await page.getByRole('button', { name: 'Tải danh sách chat', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Synthetic completion chat', exact: true }).check()
  await page.getByRole('button', { name: 'Backup các chat đã chọn', exact: true }).click()
  await until(() => calls.some((call) => call.path.endsWith('/jobs/selection')))
  state = { ...state, running: false, stage: 'complete', done: 1, message: 'Synthetic backup completed' }
  await toast(page, 'Synthetic backup completed').waitFor()
  const terminalReads = statusReads
  await until(() => statusReads >= terminalReads + 2, 'completed status must poll repeatedly')
  assert.equal((await page.evaluate(() => window.syntheticToastEvents)).length, 1, 'terminal polls must not repeat completion')
})
