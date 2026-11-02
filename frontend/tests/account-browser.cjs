// Synthetic API fixtures only. This suite never contacts a module backend or provider.
const assert = require('node:assert/strict')
const { chromium } = require('/Users/quyetdev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

const origin = process.env.REACT_TEST_BASE || 'http://127.0.0.1:5151'
const token = 'synthetic-local-test-token'
const raw = 'live@example.test|Synthetic!$\\*password|BASE32TEST'
const live = { id: 'live-row', email: 'live@example.test', created_at: 1, mode: 'check_only', status: 'success', account_state: 'live', login_verified: true, rotated_pending_verify: false, plan: 'plus', usage: null }
const settings = { 'twofa.max_concurrent': 2, 'twofa.job_timeout': 180, 'twofa.auto_retry': false, 'twofa.auto_retry_max': 0, 'twofa.auto_retry_delay': 5, 'twofa.change_enabled': false, 'twofa.read_usage': true, 'twofa.read_payment_methods': true, 'twofa.input_draft': '' }
const tests = []
const test = (name, action) => tests.push({ name, action })

async function fixture(browser, workspace = 'twofa', seed = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const state = { jobs: [{ ...live }], settings: { ...settings }, operations: [], passkey: [], password: [], journals: [{ id: 'saved', name: 'Synthetic journal', account_count: 1 }], target: 'SyntheticCommon!password', output: raw, windows: false, overrides: {}, calls: [], unexpected: [], ...seed }
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => { errors.push(`Unexpected native ${dialog.type()}`); void dialog.dismiss() })
  await page.addInitScript(() => {
    window.__streams = []
    window.EventSource = class {
      constructor(url) { this.url = url; this.closed = false; window.__streams.push(this); setTimeout(() => this.onopen?.(), 0) }
      close() { this.closed = true }
    }
    window.__emit = (kind, payload) => {
      const path = `/api/${kind ? `${kind}/` : ''}events`
      for (const stream of window.__streams) if (!stream.closed && new URL(stream.url, location.origin).pathname.endsWith(path)) stream.onmessage?.({ data: JSON.stringify(payload) })
    }
    window.__copied = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.__copied.push(text) } })
    window.__popups = []
    window.__windowOpenCalls = 0
    window.open = () => { window.__windowOpenCalls++; const popup = { closed: false, opener: null, location: { replace(url) { window.__popups.push(url) } }, close() { this.closed = true } }; return popup }
  })
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { state.unexpected.push(url.origin); return route.abort() }
    if (url.pathname === '/api/status') return json(route, { modules: ['twofa', 'export', 'browser', 'chat-backup'].map(key => ({ key, ready: true })), browser_windows_open: state.windows })
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      state.unexpected.push(`${route.request().method()} ${url.pathname}`)
      return json(route, { detail: 'Unexpected synthetic fixture endpoint' }, 501)
    }
    if (!url.pathname.startsWith('/modules/')) return route.continue()
    const method = route.request().method()
    const path = url.pathname.replace('/modules/twofa', '')
    const body = route.request().postData() ? JSON.parse(route.request().postData()) : undefined
    state.calls.push({ method, path, body, search: url.search })
    const override = state.overrides[`${method} ${path}`]
    if (override) return override(route, body, state, json)
    if (path === '/api/bootstrap') return json(route, { token, jobs: state.jobs, settings: state.settings, worker_health: {} })
    if (path === '/api/combined') return json(route, { operations: state.operations })
    if (path === '/api/output' || path === '/api/password/output' || path === '/api/passkey/output' || path === '/api/jobs/export' || path.endsWith('/raw')) return route.fulfill({ contentType: 'text/plain', body: state.output })
    if (path === '/api/settings') { for (const [key, value] of Object.entries(body)) state.settings[`twofa.${key}`] = value; return json(route, { settings: state.settings }) }
    if (path === '/api/live-journals') return json(route, method === 'POST' ? { journal: state.journals[0] } : { journals: state.journals })
    if (path === '/api/live-journals/saved') return json(route, { journal: state.journals[0], jobs: [{ ...live, id: 'historical', email: 'historical@example.test' }] })
    if (path === '/api/twofa-history' || path === '/api/password/history') return json(route, { history: [{ email: live.email, raw, changed_at: 1700000000 }, { email: 'other@example.test', raw: 'other@example.test|OtherSyntheticPassword|TESTSECRET', changed_at: 1700000001 }] })
    if (path === '/api/password/bootstrap') return json(route, { jobs: state.password, configured: Boolean(state.target), target_password: state.target, worker_health: {} })
    if (path === '/api/passkey/bootstrap') return json(route, { jobs: state.passkey, worker_health: {} })
    if (path === '/api/password-settings') { state.target = method === 'DELETE' ? '' : body.target_password; return json(route, { configured: Boolean(state.target) }) }
    if (path.endsWith('/logs')) return json(route, { logs: ['Synthetic safe log'] })
    if (path === '/api/passkey/windows/close') { state.windows = false; return json(route, { closed: 1 }) }
    if (path.endsWith('/stop-all')) return json(route, { stopped: 1 })
    if (/^\/api\/combined\/[^/]+\/stop$/.test(path)) { const operation = { ...state.operations.find(op => op.id === path.split('/')[3]), status: 'cancelled', phase: 'cancelled' }; state.operations = state.operations.map(op => op.id === operation.id ? operation : op); return json(route, operation) }
    if (path === '/api/session-jobs') return json(route, { job: { ...live, id: 'session-row', status: 'queued', mode: 'change_2fa' } })
    if (/^\/api\/(?:password\/|passkey\/)?jobs$/.test(path)) {
      const key = path.includes('/passkey/') ? 'passkey' : path.includes('/password/') ? 'password' : 'jobs'
      if (method === 'DELETE') { state[key] = []; return json(route, { deleted: 1 }) }
      const jobs = body.lines.map((line, index) => ({ ...live, id: `new-${index}`, email: line.split('|')[0], status: 'queued', mode: body.mode || 'check_only', phase: 'queued' }))
      state[key].push(...jobs)
      return json(route, { jobs })
    }
    if (path === '/api/jobs/failed' || path === '/api/jobs/failed/by-type') {
      const type = url.searchParams.get('failure_type') || 'all'
      const before = state.jobs.length
      state.jobs = state.jobs.filter(job => {
        if (!['error','cancelled'].includes(job.status) || job.account_state === 'live') return true
        const group = job.account_state === 'die' || job.error_kind === 'account_die' ? 'die' : /\bHTTP\s+403\b/i.test(job.error || '') ? 'http403' : 'other'
        return type !== 'all' && group !== type
      })
      return json(route, { jobs: state.jobs, deleted: before - state.jobs.length })
    }
    const match = /^\/api\/(password\/|passkey\/)?jobs\/([^/]+)(?:\/(.+))?$/.exec(path)
    if (match) {
      const key = match[1] === 'passkey/' ? 'passkey' : match[1] === 'password/' ? 'password' : 'jobs'
      const job = state[key].find(item => item.id === match[2]) || { ...live, id: match[2] }
      const action = match[3]
      if (action === 'launch' || action === 'passkey/start') return json(route, { opened: true, launch_path: `/api/passkey/launch/${'a'.repeat(43)}` })
      if (action === 'combined/start') { const operation = { id: `op-${job.id}`, job_id: job.id, email: job.email, status: 'running', phase: 'changing_2fa' }; state.operations.push(operation); return json(route, operation) }
      if (method === 'DELETE') { state[key] = state[key].filter(item => item.id !== job.id); return json(route, { deleted: true }) }
      const updated = { ...job, status: action === 'stop' ? 'cancelled' : ['retry', 'recheck', 'change-2fa'].includes(action) ? 'queued' : job.status, ...(action === 'change-2fa' ? { mode: 'change_2fa', login_verified: false } : {}) }
      state[key] = state[key].map(item => item.id === job.id ? updated : item)
      return json(route, { job: updated })
    }
    state.unexpected.push(`${method} ${path}`)
    return json(route, { detail: 'Unexpected synthetic fixture endpoint' }, 404)
  })
  await page.goto(`${origin}/#/workspace/${workspace}`)
  await page.locator(workspace === 'passkey' ? '#react-passkey-input' : '#tf-input').waitFor()
  return { page, state, errors, context, async finish() { assert.deepEqual(errors, []); assert.deepEqual(state.unexpected, []); await context.close() } }
}
const calls = (state, path, method = 'POST') => state.calls.filter(call => call.path === path && call.method === method)
const emit = (page, kind, payload) => page.evaluate(([kind, payload]) => window.__emit(kind, payload), [kind, payload])
const close = page => page.getByRole('dialog').last().getByRole('button', { name: /^Đóng/ }).click()
const confirm = page => page.getByRole('alertdialog').getByRole('button', { name: 'Xác nhận', exact: true }).click()
const waitFor = async (page, check) => { for (let count = 0; count < 80; count++) { if (check()) return; await page.waitForTimeout(25) } assert.ok(check(), 'Expected synthetic API action was not observed') }

test('close tool windows runs directly once while pending and preserves account data', async browser => {
  const f = await fixture(browser, 'twofa', { windows: true }); const { page, state } = f
  const path = '/api/passkey/windows/close'
  let release
  const pending = new Promise(resolve => { release = resolve })
  state.overrides[`POST ${path}`] = async (route, body, state, json) => { await pending; state.windows = false; return json(route, { closed: 2 }) }
  const button = page.locator('.tf-action-bar [data-action=close-windows]')
  try {
    await button.evaluate(el => { el.click(); el.click() })
    await waitFor(page, () => calls(state, path).length === 1)
    assert.equal(await button.isDisabled(), true)
    assert.equal(await page.getByRole('alertdialog').count(), 0)
    assert.equal(await page.getByRole('button', { name: `Thêm Passkey ${live.email}`, exact: true }).isDisabled(), true)
  } finally { release() }
  await page.getByText('Đã đóng 2 cửa sổ do tool mở.', { exact: true }).waitFor()
  await button.waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('button', { name: `Thêm Passkey ${live.email}`, exact: true }).isEnabled(), true)
  assert.equal(calls(state, path).length, 1)
  assert.deepEqual(state.jobs, [{ ...live }]); assert.equal(state.output, raw)
  assert.deepEqual(state.calls.filter(call => call.method === 'POST').map(call => call.path), [path])
  await f.finish()
})

test('close tool windows requires a window and handles empty queues, no windows and errors', async browser => {
  for (const failure of [false, true]) {
    const f = await fixture(browser, 'twofa', { jobs: [], windows: true }); const { page, state } = f
    const path = '/api/passkey/windows/close'
    state.overrides[`POST ${path}`] = (route, body, state, json) => { if (failure) return json(route, { detail: 'Synthetic close failure' }, 500); state.windows = false; return json(route, { closed: 0 }) }
    const button = page.locator('.tf-action-bar [data-action=close-windows]')
    await button.click()
    await page.getByText(failure ? 'Synthetic close failure' : 'Không có cửa sổ nào do tool mở đang chạy.', { exact: true }).waitFor()
    if (failure) assert.equal(await button.isEnabled(), true)
    else await button.waitFor({ state: 'detached' })
    assert.equal(calls(state, path).length, 1)
    assert.equal(await page.getByRole('alertdialog').count(), 0)
    await f.finish()
  }
})

test('queue actions stay together at the viewport bottom while page and table scroll', async browser => {
  const jobs = Array.from({ length: 35 }, (_, i) => ({ ...live, id: `row-${i}`, email: `account-${i}@example.test` }))
  const f = await fixture(browser, 'twofa', { jobs }); const { page, state } = f
  const bar = page.getByRole('region', { name: 'Thao tác danh sách tài khoản', exact: true })
  const folder = process.env.REACT_ACTION_BAR_SCREENSHOTS
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 640], [820, 420]]) {
    await page.setViewportSize({ width, height })
    await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tf-action-bar-height')) - document.querySelector('.tf-action-bar').getBoundingClientRect().height) < 1)
    await page.evaluate(() => window.scrollTo(0, 0))
    const before = await bar.boundingBox()
    assert.equal(await bar.evaluate(el => getComputedStyle(el).position), 'fixed')
    assert.ok(Math.abs(before.y + before.height - height) <= 1)
    assert.equal(await bar.getByRole('button').count(), 4)
    assert.equal(await bar.getByRole('checkbox').count(), 0)
    assert.equal(await page.locator('thead').getByLabel('Chọn tất cả Live', { exact: true }).count(), 1)
    for (const control of await bar.locator('button, .tf-check').all()) {
      const b = await control.boundingBox()
      assert.ok(b.x >= 0 && b.x + b.width <= width && b.y >= before.y && b.y + b.height <= height, `Control outside the fixed bar at ${width}px`)
      if (width <= 560) assert.ok(b.height >= 44)
    }
    await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); const table = document.querySelector('.tf-table-wrap'); table.scrollTop = table.scrollHeight })
    const after = await bar.boundingBox()
    assert.ok(Math.abs(before.y - after.y) <= 1)
    assert.ok(await page.evaluate(() => window.scrollY > 0 && document.querySelector('.tf-table-wrap').scrollTop > 0))
    const lastRow = await page.locator('.tf-account-row').last().boundingBox()
    assert.ok(lastRow.y + lastRow.height <= after.y, 'Last row must remain above the action bar')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.locator('thead').getByLabel('Chọn tất cả Live', { exact: true }).check()
    assert.equal(await bar.getByRole('button', { name: 'Đổi 2FA + Logout (35)', exact: true }).isEnabled(), true)
    await page.locator('thead').getByLabel('Chọn tất cả Live', { exact: true }).uncheck()
    const downloaded = page.waitForEvent('download')
    await bar.getByRole('button', { name: 'Xuất tab (35)', exact: true }).click(); await downloaded
    const toast = page.locator('[data-sonner-toast][data-visible=true]').last()
    await toast.waitFor(); await page.waitForTimeout(400)
    const t = await toast.boundingBox()
    assert.ok(t.y + t.height <= after.y, 'Toast must not cover queue controls')
    await toast.getByRole('button', { name: 'Đóng thông báo', exact: true }).click()
    await bar.getByRole('button', { name: 'Dọn danh sách', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Hủy', exact: true }).click()
    assert.equal(calls(state, '/api/jobs', 'DELETE').length, 0)
    if (folder) await page.screenshot({ path: `${folder}/fixed-actions-${width}.png` })
  }
  await page.evaluate(() => { location.hash = '/workspace/passkey' })
  await page.locator('#react-passkey-input').waitFor()
  assert.equal(await bar.isVisible(), false)
  await page.evaluate(() => { location.hash = '/workspace/twofa' })
  await bar.waitFor(); assert.equal(await bar.isVisible(), true)
  assert.equal(state.calls.filter(call => !['GET', 'HEAD'].includes(call.method)).length, 0)
  await f.finish()
})

test('fixed queue bar preserves empty, running and journal action eligibility', async browser => {
  const f = await fixture(browser, 'twofa', { jobs: [] }); const { page } = f
  const bar = page.getByRole('region', { name: 'Thao tác danh sách tài khoản', exact: true })
  assert.equal(await bar.getByRole('button').count(), 1)
  assert.equal(await bar.locator('button:not(:disabled), input:not(:disabled)').count(), 1)
  assert.equal(await bar.locator('[data-action=close-windows]').count(), 0)
  assert.equal(await bar.getByRole('button', { name: 'Lên đầu', exact: true }).isEnabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Làm mới', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Dừng tất cả', exact: true }).count(), 0)
  assert.equal(await page.getByText('REALTIME', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: /Tiến trình tài khoản/ }).count(), 0)
  await emit(page, '', { type: 'snapshot', jobs: [{ ...live }] })
  await bar.getByRole('button', { name: 'Làm mới', exact: true }).waitFor()
  assert.equal(await bar.getByRole('button', { name: 'Dừng tất cả', exact: true }).count(), 0)
  await emit(page, '', { type: 'snapshot', jobs: [{ ...live, status: 'running' }] })
  await bar.getByRole('button', { name: 'Dừng tất cả', exact: true }).waitFor()
  assert.equal(await bar.getByRole('button', { name: 'Làm mới', exact: true }).isEnabled(), true)
  assert.equal(await bar.getByRole('button', { name: 'Dọn danh sách', exact: true }).count(), 0)
  assert.equal(await page.locator('thead').getByLabel('Chọn tất cả Live', { exact: true }).count(), 0)
  assert.equal(await bar.getByRole('button', { name: 'Lên đầu', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: 'Nhật ký Live', exact: true }).click()
  await page.getByRole('dialog').locator('select').selectOption('saved')
  await page.getByText('historical@example.test', { exact: true }).waitFor()
  assert.equal(await bar.getByRole('button').count(), 1)
  assert.equal(await bar.locator('[data-action=close-windows]').count(), 0)
  assert.equal(await bar.getByRole('button', { name: 'Lên đầu', exact: true }).isEnabled(), true)
  assert.equal(await bar.getByRole('button', { name: 'Xuất tab (1)', exact: true }).count(), 0)
  assert.equal(await bar.getByRole('checkbox').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Làm mới', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Dừng tất cả', exact: true }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: 'Synthetic journal', exact: true }).isVisible(), true)
  await page.getByRole('button', { name: 'Danh sách hiện tại', exact: true }).click()
  await bar.getByRole('button', { name: 'Dừng tất cả', exact: true }).waitFor()
  await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tf-action-bar-height')) - document.querySelector('.tf-action-bar').getBoundingClientRect().height) < 1)
  await f.finish()
})

test('bottom refresh and stop-all preserve requests and pending protection', async browser => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const f = await fixture(browser, 'twofa', { jobs: [{ ...live, status: 'queued' }], overrides: {
    'POST /api/jobs/stop-all': async (route, body, state, json) => {
      await pending
      state.jobs = state.jobs.map(job => ({ ...job, status: 'cancelled' }))
      return json(route, { stopped: 1 })
    }
  } })
  const { page, state } = f
  const bar = page.getByRole('region', { name: 'Thao tác danh sách tài khoản', exact: true })
  const refresh = bar.getByRole('button', { name: 'Làm mới', exact: true })
  const bootstrapCount = calls(state, '/api/bootstrap', 'GET').length
  await refresh.click()
  await waitFor(page, () => calls(state, '/api/bootstrap', 'GET').length > bootstrapCount)
  await page.getByText('Đã làm mới danh sách.', { exact: true }).waitFor()
  const stopAll = bar.getByRole('button', { name: 'Dừng tất cả', exact: true })
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height })
    await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tf-action-bar-height')) - document.querySelector('.tf-action-bar').getBoundingClientRect().height) < 1)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const bounds = await bar.boundingBox()
    assert.ok(Math.abs(bounds.y + bounds.height - height) <= 1)
    for (const control of [refresh, stopAll]) {
      const b = await control.boundingBox()
      assert.ok(b.x >= 0 && b.x + b.width <= width && b.y >= bounds.y && b.y + b.height <= height)
      if (width <= 560) assert.ok(b.height >= 44)
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    if (process.env.REACT_ACTION_BAR_SCREENSHOTS) await page.screenshot({ path: `${process.env.REACT_ACTION_BAR_SCREENSHOTS}/active-actions-${width}.png` })
  }
  await stopAll.click()
  await waitFor(page, () => calls(state, '/api/jobs/stop-all').length === 1 && calls(state, '/api/combined/stop-all').length === 1)
  assert.equal(await stopAll.isDisabled(), true)
  await stopAll.evaluate(el => el.click())
  assert.equal(calls(state, '/api/jobs/stop-all').length, 1)
  assert.equal(calls(state, '/api/combined/stop-all').length, 1)
  release()
  await page.getByText('Đã gửi yêu cầu dừng tất cả.', { exact: true }).waitFor()
  assert.equal(await stopAll.count(), 0)
  assert.equal(await refresh.isEnabled(), true)
  await f.finish()
})

test('queue scroll-to-top returns to the header with keyboard and reduced motion', async browser => {
  for (const [width, height, reducedMotion] of [[1600, 1000, 'no-preference'], [390, 844, 'no-preference'], [320, 640, 'reduce']]) {
    const jobs = Array.from({ length: 35 }, (_, i) => ({ ...live, id: `row-${i}`, email: `account-${i}@example.test` }))
    const f = await fixture(browser, 'twofa', { jobs }); const { page, state } = f
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion })
    const bar = page.getByRole('region', { name: 'Thao tác danh sách tài khoản', exact: true })
    await page.locator('thead').getByLabel('Chọn tất cả Live', { exact: true }).check()
    const horizontalScroll = await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
      const table = document.querySelector('.tf-table-wrap'); table.scrollLeft = 200
      window.__topScrolls = []
      const original = window.scrollTo.bind(window)
      window.scrollTo = options => { window.__topScrolls.push(options); return original(options) }
      return table.scrollLeft
    })
    if (width <= 390) assert.ok(horizontalScroll > 0, 'Narrow tables must exercise preserved horizontal scrolling')
    assert.ok(await page.evaluate(() => scrollY > 0))
    const button = bar.getByRole('button', { name: 'Lên đầu', exact: true })
    const folder = process.env.REACT_SCROLL_TOP_SCREENSHOTS
    if (folder) await page.screenshot({ path: `${folder}/before-${width}.png` })
    if (width === 1600) { await button.focus(); await page.keyboard.press('Enter') }
    else await button.click()
    await page.waitForFunction(() => scrollY === 0)
    assert.deepEqual(await page.evaluate(() => window.__topScrolls), [{ top: 0, behavior: reducedMotion === 'reduce' ? 'instant' : 'smooth' }])
    assert.equal(await page.locator('#tf-input').isVisible(), true)
    assert.equal(await page.locator('thead').getByLabel('Chọn tất cả Live', { exact: true }).isChecked(), true)
    assert.equal(await page.locator('.tf-account-row').count(), 35)
    assert.equal(await page.locator('.tf-table-wrap').evaluate(el => el.scrollLeft), horizontalScroll)
    assert.equal(state.calls.filter(call => !['GET', 'HEAD'].includes(call.method)).length, 0)
    if (folder) await page.screenshot({ path: `${folder}/after-${width}.png` })
    await f.finish()
  }
})

test('account columns share available width while actions fit their buttons', async browser => {
  const jobs = [
    { ...live, email: 'a-long-account-name-for-responsive-layout@example.test', payment_methods: [{ type: 'card', brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, is_default: true }] },
    { ...live, id: 'usage-row', email: 'usage@example.test', usage: { used_percent: 32, reset_after_seconds: 86400 } },
    { ...live, id: 'failed-row', email: 'failed@example.test', status: 'error', account_state: 'die', login_verified: false, error: 'Synthetic account error with additional diagnostic details' },
  ]
  const f = await fixture(browser, 'twofa', { jobs }); const { page, state } = f
  const table = page.locator('.tf-table-wrap table')
  const measure = () => table.evaluate(el => {
    const row = el.querySelector('.tf-account-row')
    const cells = [...row.cells].map(cell => cell.getBoundingClientRect().width)
    const action = row.querySelector('.tf-actions-cell').getBoundingClientRect()
    const buttons = [...row.querySelectorAll('.tf-row-actions button')].map(button => button.getBoundingClientRect())
    const wrap = el.parentElement.getBoundingClientRect()
    const email = row.querySelector('.tf-email strong').getBoundingClientRect()
    const copy = row.querySelector('.tf-email button').getBoundingClientRect()
    return { cells, table: el.getBoundingClientRect().width, wrap: el.parentElement.clientWidth, trailing: action.right - buttons.at(-1).right,
      contained: buttons.every(button => button.left >= action.left && button.right <= action.right && Math.abs(button.y - buttons[0].y) < 1),
      visibleActions: buttons.every(button => button.left >= wrap.left && button.right <= wrap.right),
      contentFits: [...el.querySelectorAll('.tf-account-row td')].every(cell => cell.scrollWidth <= cell.clientWidth + 1),
      emailFits: email.left >= row.cells[1].getBoundingClientRect().left && copy.right <= row.cells[1].getBoundingClientRect().right && Math.abs(copy.left - email.right - 6) < 1,
      target: Math.min(...buttons.map(button => Math.min(button.width, button.height))), count: buttons.length,
      pageFits: document.documentElement.scrollWidth <= innerWidth }
  })
  const wide = []
  for (const width of [1920, 2560, 1280, 1366, 1440, 1512, 1024, 680, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await table.scrollIntoViewIfNeeded()
    const m = await measure()
    assert.equal(m.count, 7, 'Keep the seven remaining Live account actions')
    assert.ok(m.contained && m.pageFits && m.contentFits && m.emailFits, `Account content or buttons overflow at ${width}px`)
    assert.ok(m.cells[1] <= 201, `Account column is too wide at ${width}px: ${m.cells[1]}px`)
    if (width >= 1280) assert.ok(m.cells[5] >= 179, `Payment column is too narrow at ${width}px: ${m.cells[5]}px`)
    if (width >= 1440) assert.ok(m.cells[5] > m.cells[1], 'Payment should have more room than account on wide screens')
    assert.ok(m.trailing <= 12, `Action column wastes ${m.trailing}px at ${width}px`)
    assert.ok(await page.locator('.tf-usage').evaluate(el => el.getBoundingClientRect().width >= 180), `Usage must stay readable at ${width}px`)
    if (width >= 1280) {
      assert.ok(Math.abs(m.table - m.wrap) <= 1 && m.visibleActions, `Laptop must show all columns and actions without scrolling at ${width}px`)
      if (width >= 1920) wide.push(m)
    }
    if (width <= 680) assert.ok(m.target >= 44, 'Keep mobile touch targets')
    if (width <= 1024) assert.ok(m.table > m.wrap, 'Keep horizontal scrolling inside the table')
    await page.locator('.tf-table-wrap').evaluate(el => { el.scrollLeft = el.scrollWidth })
    const remove = page.locator('.tf-account-row').first().locator('[data-action=remove]')
    await remove.hover()
    await page.getByRole('tooltip', { name: 'Bỏ khỏi danh sách', exact: true }).waitFor()
    assert.ok(await page.locator('.tf-action-tooltip').evaluate(el => { const b = el.getBoundingClientRect(); return b.x >= 0 && b.right <= innerWidth }))
    if (width === 390 && process.env.REACT_TABLE_SCREENSHOTS) await page.screenshot({ path: `${process.env.REACT_TABLE_SCREENSHOTS}/actions-mobile.png` })
    await page.keyboard.press('Escape')
    await page.getByRole('tooltip').waitFor({ state: 'hidden' })
    await page.locator('.tf-table-wrap').evaluate(el => { el.scrollLeft = 0 })
    if (process.env.REACT_TABLE_SCREENSHOTS) await page.locator('.tf-list').screenshot({ path: `${process.env.REACT_TABLE_SCREENSHOTS}/table-${width}.png` })
  }
  assert.ok(Math.abs(wide[0].cells[6] - wide[1].cells[6]) <= 1, 'Actions must not absorb extra screen width')
  assert.ok(Math.abs(wide[0].cells[1] - wide[1].cells[1]) <= 1, 'Keep the account column bounded on wide monitors')
  for (let column = 2; column <= 5; column++) assert.ok(wide[1].cells[column] > wide[0].cells[column], `Content column ${column} should grow`)
  await page.setViewportSize({ width: 1366, height: 1000 })
  await page.getByRole('button', { name: `Copy email ${jobs[0].email}`, exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.__copied), [jobs[0].email], 'Copy must preserve the complete wrapped email')
  const remove = page.locator('.tf-account-row').first().locator('[data-action=remove]')
  await remove.focus()
  await page.getByRole('tooltip', { name: 'Bỏ khỏi danh sách', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1920, height: 1000 })
  await emit(page, '', { type: 'snapshot', jobs: [jobs[2]] })
  await page.locator('.tf-account-row').filter({ hasText: jobs[0].email }).waitFor({ state: 'detached' })
  const compact = await measure()
  assert.ok(compact.count < 7 && compact.trailing <= 12 && compact.cells[6] < wide[0].cells[6], 'Fewer visible actions should use a narrower column')
  assert.equal(state.calls.filter(call => !['GET', 'HEAD'].includes(call.method)).length, 0)
  await f.finish()
})

test('check input normalization, exact credentials, direct check and confirmed change payloads', async browser => {
  const f = await fixture(browser); const { page, state } = f
  await page.locator('#tf-input').evaluate(el => { const data = new DataTransfer(); data.setData('text', '**第1张**\nnew@example.test----P!$\\*ass----BASE32'); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })) })
  assert.equal(await page.locator('#tf-input').inputValue(), 'new@example.test|P!$\\*ass|BASE32')
  await page.getByRole('button', { name: 'Khởi chạy', exact: true }).click()
  await waitFor(page, () => calls(state, '/api/jobs').length === 1)
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.deepEqual(calls(state, '/api/jobs')[0].body, { lines: ['new@example.test|P!$\\*ass|BASE32'], mode: 'check_only' })
  await page.getByLabel('Đổi 2FA sau đăng nhập').check(); await waitFor(page, () => calls(state, '/api/settings', 'PUT').length > 0)
  await page.getByRole('button', { name: 'Khởi chạy', exact: true }).click(); await confirm(page)
  await waitFor(page, () => calls(state, '/api/jobs').length === 2)
  assert.equal(calls(state, '/api/jobs')[1].body.mode, 'change_2fa'); await f.finish()
})

async function trackListScroll(page) {
  await page.evaluate(() => {
    window.__listScrolls = []
    const scrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (options) {
      if (this.matches('.tf-list')) window.__listScrolls.push({ options, rows: this.querySelectorAll('tbody').length })
      return scrollIntoView.call(this, options)
    }
  })
}

test('successful launch scrolls once after rows render on desktop, mobile and reduced motion', async browser => {
  for (const [width, height, reducedMotion] of [[1600, 1000, 'no-preference'], [390, 844, 'no-preference'], [390, 844, 'reduce']]) {
    const f = await fixture(browser, 'twofa', { jobs: [] }); const { page, state } = f
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion })
    await trackListScroll(page)
    await page.locator('#tf-input').fill(Array.from({ length: 12 }, (_, i) => `new-${i}@example.test|SyntheticPassword|TESTSECRET`).join('\n'))
    const folder = process.env.REACT_LAUNCH_SCROLL_SCREENSHOTS
    if (folder) await page.screenshot({ path: `${folder}/before-${width}-${reducedMotion}.png` })
    await page.getByRole('button', { name: 'Khởi chạy', exact: true }).click()
    await page.waitForFunction(() => {
      const filters = document.querySelector('.tf-list .tf-filters').getBoundingClientRect()
      return window.__listScrolls.length === 1 && filters.top >= 0 && filters.bottom < innerHeight / 2
    })
    await page.waitForFunction(() => {
      const previous = window.__scrollProbe
      if (!previous || previous.y !== scrollY) { window.__scrollProbe = { y: scrollY, at: performance.now() }; return false }
      return performance.now() - previous.at > 120
    })
    assert.deepEqual(await page.evaluate(() => window.__listScrolls), [{ options: { behavior: reducedMotion === 'reduce' ? 'instant' : 'smooth', block: 'start', inline: 'nearest' }, rows: 12 }])
    assert.equal(calls(state, '/api/jobs').length, 1)
    if (folder) await page.screenshot({ path: `${folder}/after-${width}-${reducedMotion}.png` })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await emit(page, '', { type: 'job', job: { ...state.jobs[0], status: 'running' } })
    await page.waitForFunction(() => document.querySelector('.tf-account-row .tf-status')?.textContent === 'Đang chạy')
    assert.ok(await page.evaluate(() => window.scrollY <= 2))
    assert.equal(await page.evaluate(() => window.__listScrolls.length), 1)
    await f.finish()
  }
})

test('failed or cancelled launch keeps position and confirmed launch scrolls to the list', async browser => {
  const f = await fixture(browser, 'twofa', { jobs: [] }); const { page, state } = f
  await trackListScroll(page)
  await page.locator('#tf-input').fill('new@example.test|SyntheticPassword|TESTSECRET')
  state.overrides['POST /api/jobs'] = (route, body, state, json) => json(route, { detail: 'Synthetic queue failure' }, 500)
  await page.getByRole('button', { name: 'Khởi chạy', exact: true }).click()
  await page.getByText('Synthetic queue failure', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__listScrolls.length), 0)
  delete state.overrides['POST /api/jobs']
  await page.getByLabel('Đổi 2FA sau đăng nhập').check()
  const start = page.getByRole('button', { name: 'Khởi chạy', exact: true })
  await start.click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Hủy', exact: true }).click()
  assert.equal(calls(state, '/api/jobs').length, 1)
  assert.equal(await page.evaluate(() => window.__listScrolls.length), 0)
  await start.click(); await confirm(page)
  await page.waitForFunction(() => window.__listScrolls.length === 1)
  assert.equal(calls(state, '/api/jobs').length, 2)
  assert.equal(calls(state, '/api/jobs')[1].body.mode, 'change_2fa')
  assert.equal(await page.evaluate(() => window.__listScrolls[0].rows), 1)
  await f.finish()
})

test('settings preserve all fields and backend numeric limits', async browser => {
  const f = await fixture(browser); const { page, state } = f
  await page.getByRole('button', { name: 'Cấu hình', exact: true }).click()
  const dialog = page.getByRole('dialog')
  for (const [name, min, max] of [['max_concurrent', '1', '10'], ['job_timeout', '30', '600'], ['auto_retry_max', '0', '5'], ['auto_retry_delay', '0', '60']]) { assert.equal(await dialog.locator(`[name=${name}]`).getAttribute('min'), min); assert.equal(await dialog.locator(`[name=${name}]`).getAttribute('max'), max) }
  await dialog.getByLabel('Timeout mỗi bước (giây)', { exact: true }).fill('240'); await dialog.getByRole('button', { name: 'Lưu vào Settings Store' }).click()
  await waitFor(page, () => calls(state, '/api/settings', 'PUT').length === 1)
  assert.equal(calls(state, '/api/settings', 'PUT')[0].body.job_timeout, 240)
  assert.equal(calls(state, '/api/settings', 'PUT')[0].body.read_payment_methods, true); await f.finish()
})

test('copy remains reachable while logs, recheck and Usage refresh are hidden', async browser => {
  const f = await fixture(browser); const { page, state } = f
  await page.getByRole('button', { name: `Copy email ${live.email}`, exact: true }).click()
  await page.getByRole('button', { name: `Copy tài khoản ${live.email}`, exact: true }).click()
  assert.equal(await page.locator('.tf-row-actions [data-action="logs"], .tf-row-actions [data-action="recheck"], .tf-row-actions [data-action="usage"]').count(), 0)
  assert.equal(await page.locator('.tf-usage-state').textContent(), 'Chưa có Usage', 'Keep Usage display')
  assert.equal(state.calls.filter(call => call.method !== 'GET').length, 0)
  assert.deepEqual(await page.evaluate(() => window.__copied), [live.email, raw]); await f.finish()
})

test('queue retry, stop and delete use the distinct job lifecycle APIs', async browser => {
  const error = { ...live, status: 'error', account_state: 'unknown', retryable: true }
  const f = await fixture(browser, 'twofa', { jobs: [error] }); const { page, state } = f
  await page.getByRole('button', { name: `Chạy lại ${live.email}`, exact: true }).click(); await waitFor(page, () => calls(state, `/api/jobs/${live.id}/retry`).length === 1)
  await page.getByRole('button', { name: `Dừng ${live.email}`, exact: true }).click(); await waitFor(page, () => calls(state, `/api/jobs/${live.id}/stop`).length === 1)
  await emit(page, '', { type: 'job', job: { ...error, status: 'cancelled' } })
  await page.getByRole('button', { name: `Bỏ ${live.email}`, exact: true }).click(); await waitFor(page, () => calls(state, `/api/jobs/${live.id}`, 'DELETE').length === 1); await f.finish()
})

test('logout and chat deletion confirm; passkey opens directly with its existing payload', async browser => {
  const f = await fixture(browser); const { page, state } = f
  for (const [label, action, literal] of [[`Logout ${live.email}`, 'logout-sessions', 'LOGOUT_ALL_SESSIONS'], [`Xóa hội thoại ${live.email}`, 'delete-chats', 'DELETE_ALL_CHATS']]) {
    await page.getByRole('button', { name: label, exact: true }).click(); assert.equal(calls(state, `/api/jobs/${live.id}/${action}`).length, 0); await confirm(page)
    await waitFor(page, () => calls(state, `/api/jobs/${live.id}/${action}`).length === 1); assert.deepEqual(calls(state, `/api/jobs/${live.id}/${action}`)[0].body, { confirm: literal })
  }
  await page.getByRole('button', { name: `Thêm Passkey ${live.email}`, exact: true }).click()
  await waitFor(page, () => calls(state, `/api/jobs/${live.id}/passkey/start`).length === 1)
  assert.deepEqual(calls(state, `/api/jobs/${live.id}/passkey/start`)[0].body, { confirm: 'ADD_PASSKEY', native_window: true })
  assert.equal(await page.getByRole('alertdialog').count(), 0)
  await page.getByText('Đã mở Chrome với profile riêng. Hoàn tất đăng ký trên trang OpenAI. Tool chưa xác nhận đã thêm passkey.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__windowOpenCalls), 0)
  assert.equal(await page.getByRole('dialog').count(), 0); await f.finish()
})

test('row passkey opens without confirmation and ignores pending duplicate clicks', async browser => {
  const f = await fixture(browser); const { page, state } = f
  const path = `/api/jobs/${live.id}/passkey/start`
  const trigger = page.getByRole('button', { name: `Thêm Passkey ${live.email}`, exact: true })
  let release
  const pending = new Promise(resolve => { release = resolve })
  state.overrides[`POST ${path}`] = async (route, body, state, json) => { await pending; return json(route, { opened: true, launch_path: `/api/passkey/launch/${'a'.repeat(43)}` }) }
  try {
    await trigger.evaluate(el => { el.click(); el.click() })
    await waitFor(page, () => calls(state, path).length === 1)
    assert.equal(await trigger.isDisabled(), true)
    assert.equal(await page.getByRole('alertdialog').count(), 0)
    assert.equal(await page.evaluate(() => window.__windowOpenCalls), 0)
  } finally { release() }
  await page.getByText(/Đã mở Chrome với profile riêng/).waitFor()
  assert.equal(await trigger.isEnabled(), true)
  assert.equal(calls(state, path).length, 1)
  assert.equal(await page.locator('[data-sonner-toast][data-type=error]').count(), 0)
  await f.finish()
})

test('row passkey native launch failure shows a validated fallback without opening a tab', async browser => {
  const f = await fixture(browser); const { page, state } = f
  const path = `/api/jobs/${live.id}/passkey/start`
  state.overrides[`POST ${path}`] = (route, body, state, json) => json(route, { opened: false, launch_path: `/api/passkey/launch/${'a'.repeat(43)}` })
  await page.getByRole('button', { name: `Thêm Passkey ${live.email}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText(/Không mở được Chrome với profile riêng/).waitFor()
  assert.equal(await dialog.getByRole('link', { name: 'Mở trang đăng ký OpenAI', exact: true }).getAttribute('href'), `/modules/twofa/api/passkey/launch/${'a'.repeat(43)}`)
  await page.locator('[data-sonner-toast][data-type=error]').getByText(/Không khởi chạy được Chrome riêng/).waitFor()
  assert.equal(await page.evaluate(() => window.__windowOpenCalls), 0)
  assert.equal(calls(state, path).length, 1)
  await close(page)
  assert.equal(await page.getByRole('link', { name: 'Mở trang đăng ký OpenAI', exact: true }).count(), 0)
  await f.finish()
})

test('row passkey preparation errors and invalid links do not launch or retry', async browser => {
  for (const invalid of [false, true]) {
    const f = await fixture(browser); const { page, state } = f
    const path = `/api/jobs/${live.id}/passkey/start`
    state.overrides[`POST ${path}`] = (route, body, state, json) => invalid ? json(route, { opened: true, launch_path: 'https://example.test/untrusted' }) : json(route, { detail: 'Synthetic passkey preparation failed' }, 502)
    const trigger = page.getByRole('button', { name: `Thêm Passkey ${live.email}`, exact: true })
    await trigger.click()
    await page.locator('[data-sonner-toast][data-type=error]').getByText(invalid ? 'Liên kết passkey không hợp lệ.' : 'Synthetic passkey preparation failed', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-sonner-toast][data-type=error]').count(), 1)
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await trigger.isEnabled(), true)
    assert.equal(await page.evaluate(() => window.__windowOpenCalls), 0)
    assert.equal(calls(state, path).length, 1)
    await f.finish()
  }
})

test('combined selection starts once per account and partial failures do not retry', async browser => {
  const second = { ...live, id: 'second', email: 'second@example.test' }
  const f = await fixture(browser, 'twofa', { jobs: [live, second] }); const { page, state } = f
  state.overrides['POST /api/jobs/second/combined/start'] = (route, body, state, json) => json(route, { detail: 'Synthetic rejected account' }, 409)
  await page.getByLabel('Chọn tất cả Live', { exact: true }).check(); await page.getByRole('button', { name: 'Đổi 2FA + Logout (2)', exact: true }).click()
  await waitFor(page, () => calls(state, '/api/jobs/second/combined/start').length === 1)
  assert.equal(calls(state, `/api/jobs/${live.id}/combined/start`).length, 1); assert.deepEqual(calls(state, `/api/jobs/${live.id}/combined/start`)[0].body, { confirm: 'START_COMBINED' })
  assert.equal(await page.getByRole('dialog').count(), 0); await page.getByRole('button', { name: 'Dừng gộp', exact: true }).click(); await waitFor(page, () => calls(state, `/api/combined/op-${live.id}/stop`).length === 1); await f.finish()
})

test('bulk combined respects configured concurrency and retains rejected selections', async browser => {
  const jobs = Array.from({ length: 12 }, (_, i) => ({ ...live, id: `bulk-${i}`, email: `bulk-${i}@example.test` }))
  const f = await fixture(browser, 'twofa', { jobs, settings: { ...settings, 'twofa.max_concurrent': 3 } })
  const { page, state } = f
  const releases = []
  let inFlight = 0, peak = 0
  for (const job of jobs) state.overrides[`POST /api/jobs/${job.id}/combined/start`] = async (route, body, state, json) => {
    inFlight++; peak = Math.max(peak, inFlight)
    await new Promise(resolve => releases.push(resolve))
    inFlight--
    if (job.id === 'bulk-4') return json(route, { detail: 'Synthetic rejected account' }, 409)
    const operation = { id: `op-${job.id}`, job_id: job.id, email: job.email, status: 'running', phase: 'changing_2fa' }
    state.operations.push(operation)
    return json(route, operation)
  }
  try {
    await page.getByLabel('Chọn tất cả Live', { exact: true }).check()
    await page.getByRole('button', { name: 'Đổi 2FA + Logout (12)', exact: true }).click()
    await waitFor(page, () => releases.length === 3)
    assert.equal(peak, 3)
    for (let offset = 0; offset < 12; offset += 3) {
      await waitFor(page, () => releases.length >= offset + 3)
      releases.slice(offset, offset + 3).forEach(release => release())
    }
    await page.getByText('Đã gửi 11/12 tài khoản · 1 lỗi; xem trạng thái từng dòng trước khi thao tác tiếp', { exact: false }).waitFor()
    assert.equal(peak, 3)
    for (const job of jobs) {
      assert.equal(calls(state, `/api/jobs/${job.id}/combined/start`).length, 1)
      assert.equal(await page.getByRole('checkbox', { name: `Chọn ${job.email}`, exact: true }).isChecked(), job.id === 'bulk-4')
    }
  } finally { releases.forEach(release => release()) }
  await f.finish()
})

test('select all Live shows combined mode and reconciles active rows when SSE is lost', async browser => {
  const jobs = Array.from({ length: 12 }, (_, i) => ({ ...live, id: `mode-${i}`, email: `mode-${i}@example.test` }))
  const f = await fixture(browser, 'twofa', { jobs })
  const { page, state } = f
  await page.getByLabel('Chọn tất cả Live', { exact: true }).check()
  await page.getByRole('button', { name: 'Đổi 2FA + Logout (12)', exact: true }).click()
  await waitFor(page, () => state.operations.length === jobs.length)
  for (const job of jobs) {
    const row = page.locator('.tf-account-row').filter({ hasText: job.email })
    await row.getByRole('button', { name: 'Dừng gộp', exact: true }).waitFor()
    assert.match(await row.locator('td').nth(1).textContent(), /2FA \+ LOGOUT/)
    assert.equal(await row.getByText('ĐÃ CHECK LIVE', { exact: true }).count(), 0)
  }
  // Backend snapshots advance, but no EventSource update reaches the UI.
  state.jobs = jobs.map(job => ({ ...job, mode: 'change_2fa', status: 'running', login_verified: false, rotated_pending_verify: true }))
  await page.locator('.tf-account-row').first().getByText('ĐÃ LƯU · CHỜ VERIFY', { exact: true }).waitFor({ timeout: 6000 })
  assert.equal(state.calls.filter(call => call.method !== 'GET' && !call.path.endsWith('/combined/start')).length, 0)
  assert.equal(calls(state, '/api/jobs').length, 0)
  for (const job of jobs) assert.equal(calls(state, `/api/jobs/${job.id}/combined/start`).length, 1)
  await f.finish()
})

test('bulk combined revalidates later rows against current events without counting a skip as success', async browser => {
  const second = { ...live, id: 'later', email: 'later@example.test' }
  const f = await fixture(browser, 'twofa', { jobs: [live, second], settings: { ...settings, 'twofa.max_concurrent': 1 } })
  const { page, state } = f
  let release
  state.overrides[`POST /api/jobs/${live.id}/combined/start`] = (route, body, state, json) => new Promise(resolve => { release = () => {
    const operation = { id: 'op-first', job_id: live.id, email: live.email, status: 'running', phase: 'changing_2fa' }
    state.operations.push(operation);return json(route, operation).then(resolve)
  } })
  try {
    await page.getByLabel('Chọn tất cả Live', { exact: true }).check()
    await page.getByRole('button', { name: 'Đổi 2FA + Logout (2)', exact: true }).click()
    await waitFor(page, () => Boolean(release))
    await emit(page, '', { type: 'job', job: { ...second, mode: 'change_2fa', status: 'running', rotated_pending_verify: true } })
    await page.locator('.tf-account-row').filter({ hasText: second.email }).getByText('ĐÃ LƯU · CHỜ VERIFY', { exact: true }).waitFor()
    await release();release = null
    await page.getByText('Đã gửi 1/2 tài khoản · 1 lỗi; xem trạng thái từng dòng trước khi thao tác tiếp', { exact: false }).waitFor()
    assert.equal(calls(state, '/api/jobs/later/combined/start').length, 0)
    assert.equal(await page.getByRole('checkbox', { name: `Chọn ${second.email}`, exact: true }).isChecked(), true)
  } finally { if(release)await release() }
  await f.finish()
})

test('combined POST is shown immediately while polling is delayed', async browser => {
  const f = await fixture(browser); const { page, state } = f
  const releases = []
  state.overrides['GET /api/combined'] = (route, body, state, json) => { const snapshot = structuredClone(state.operations); return new Promise(resolve => releases.push(() => json(route, { operations: snapshot }).then(resolve))) }
  try {
    await page.getByLabel('Chọn tất cả Live', { exact: true }).check()
    await page.getByRole('button', { name: 'Đổi 2FA + Logout (1)', exact: true }).click()
    await page.getByRole('button', { name: 'Dừng gộp', exact: true }).waitFor({ timeout: 1500 })
    assert.equal(calls(state, `/api/jobs/${live.id}/combined/start`).length, 1)
    await Promise.all(releases.splice(0).map(release => release()))
    await page.waitForTimeout(100)
    assert.equal(await page.getByRole('button', { name: 'Dừng gộp', exact: true }).count(), 1)
  } finally { await Promise.all(releases.map(release => release())) }
  await f.finish()
})

test('combined completion reconciles verified output when terminal SSE is missing', async browser => {
  const operation = { id: 'op-missing-event', job_id: live.id, email: live.email, status: 'running', phase: 'changing_2fa' }
  const f = await fixture(browser, 'twofa', { operations: [operation], output: '' }); const { page, state } = f
  await page.getByRole('button', { name: 'Dừng gộp', exact: true }).waitFor()
  state.jobs = [{ ...live, mode: 'change_2fa' }]
  state.output = raw
  state.operations = [{ ...operation, status: 'success', phase: 'completed', finished_at: 100 }]
  await page.waitForFunction(expected => document.querySelector('[aria-label="Kết quả đã xác minh"]')?.value === expected, raw, { timeout: 1800 })
  assert.ok((await page.locator('.tf-account-row').innerText()).includes('ĐỔI 2FA'))
  assert.equal(state.calls.filter(call => call.method !== 'GET').length, 0)
  await f.finish()
})

test('combined completion ignores an older bootstrap after a later account completes', async browser => {
  const second = { ...live, id: 'second', email: 'second@example.test', status: 'running', mode: 'change_2fa' }
  const operations = [live, second].map(j => ({ id: `op-${j.id}`, job_id: j.id, email: j.email, status: 'running', phase: 'changing_2fa' }))
  const f = await fixture(browser, 'twofa', { jobs: [live, second], operations }); const { page, state } = f
  const releases = []
  state.overrides['GET /api/bootstrap'] = (route, body, state, json) => {
    const snapshot = structuredClone({ token, jobs: state.jobs, settings: state.settings, worker_health: {} })
    return new Promise(resolve => releases.push(() => json(route, snapshot).then(resolve)))
  }
  try {
    await page.getByRole('button', { name: 'Dừng gộp', exact: true }).first().waitFor()
    state.jobs = [{ ...live, mode: 'change_2fa' }, second]
    state.operations = [{ ...operations[0], status: 'success', phase: 'completed', finished_at: 100 }, operations[1]]
    await waitFor(page, () => releases.length === 1)
    state.jobs[1] = { ...second, status: 'success' }
    state.operations[1] = { ...operations[1], status: 'success', phase: 'completed', finished_at: 101 }
    await waitFor(page, () => releases.length === 2)
    await releases[1]()
    const row = page.locator('.tf-account-row').filter({ hasText: second.email })
    await row.locator('.tf-status.success').waitFor()
    await releases[0]()
    await page.waitForTimeout(100)
    assert.equal(await row.locator('.tf-status.success').count(), 1)
  } finally { await Promise.all(releases.map(release => release().catch(() => {}))) }
  await f.finish()
})

test('older output response cannot erase a newer verified result', async browser => {
  const f = await fixture(browser, 'twofa', { output: '' }); const { page, state } = f
  const releases = []
  state.overrides['GET /api/output'] = route => new Promise(resolve => releases.push(value => route.fulfill({ contentType: 'text/plain', body: value }).then(resolve)))
  try {
    await emit(page, '', { type: 'job', job: { ...live, mode: 'change_2fa' } })
    await waitFor(page, () => releases.length === 1)
    await emit(page, '', { type: 'job', job: { ...live, mode: 'change_2fa' } })
    await waitFor(page, () => releases.length === 2)
    await releases[1](raw)
    await page.waitForFunction(expected => document.querySelector('[aria-label="Kết quả đã xác minh"]')?.value === expected, raw)
    await releases[0]('')
    await page.waitForTimeout(100)
    assert.equal(await page.getByRole('textbox', { name: 'Kết quả đã xác minh', exact: true }).inputValue(), raw)
  } finally { await Promise.all(releases.map(release => release(raw).catch(() => {}))) }
  await f.finish()
})

test('single-row rotation presents fresh raw credentials and clears them on close', async browser => {
  const f = await fixture(browser); const { page, state } = f
  await page.getByRole('button', { name: `Đổi 2FA ${live.email}`, exact: true }).click(); await confirm(page)
  await waitFor(page, () => calls(state, `/api/jobs/${live.id}/change-2fa`).length === 1)
  await emit(page, '', { type: 'job', job: { ...live, mode: 'change_2fa', status: 'success' } })
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Dữ liệu sau đổi 2FA' }).waitFor({ timeout: 1500 })
  await page.waitForFunction(expected => document.querySelector('[aria-label="Dữ liệu sau đổi 2FA"]')?.value === expected, raw)
  assert.equal(await dialog.getByRole('textbox', { name: 'Dữ liệu sau đổi 2FA' }).inputValue(), raw)
  await dialog.getByRole('button', { name: 'Copy dữ liệu mới', exact: true }).click(); assert.deepEqual(await page.evaluate(() => window.__copied), [raw]); await close(page)
  assert.equal(await page.getByRole('textbox', { name: 'Dữ liệu sau đổi 2FA' }).count(), 0); await f.finish()
})

test('closing the rotation result discards a delayed private raw response', async browser => {
  const f = await fixture(browser); const { page, state } = f
  let releaseRaw
  state.overrides[`GET /api/jobs/${live.id}/raw`] = route => new Promise(resolve => { releaseRaw = () => route.fulfill({ contentType: 'text/plain', body: raw }).then(resolve) })
  await page.getByRole('button', { name: `Đổi 2FA ${live.email}`, exact: true }).click(); await confirm(page)
  await page.getByRole('button', { name: `Dừng ${live.email}`, exact: true }).waitFor()
  await emit(page, '', { type: 'job', job: { ...live, mode: 'change_2fa', status: 'success' } })
  await page.getByRole('textbox', { name: 'Dữ liệu sau đổi 2FA' }).waitFor()
  await waitFor(page, () => Boolean(releaseRaw)); await close(page); await releaseRaw(); await page.waitForTimeout(50)
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.getByRole('textbox', { name: 'Dữ liệu sau đổi 2FA' }).count(), 0); await f.finish()
})

test('unrequested or failed rotation never opens private credentials or repeats a mutation', async browser => {
  const f = await fixture(browser); const { page, state } = f
  await emit(page, '', { type: 'job', job: { ...live, id: 'unrequested', email: 'unrequested@example.test', mode: 'change_2fa' } })
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.getByRole('button', { name: `Đổi 2FA ${live.email}`, exact: true }).click(); await confirm(page)
  await page.getByRole('button', { name: `Dừng ${live.email}`, exact: true }).waitFor()
  await emit(page, '', { type: 'job', job: { ...live, mode: 'change_2fa', status: 'error', retryable: false } })
  await emit(page, '', { type: 'job', job: { ...live, mode: 'change_2fa', status: 'success' } })
  await page.waitForTimeout(50)
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(calls(state, `/api/jobs/${live.id}/raw`, 'GET').length, 0)
  assert.equal(calls(state, `/api/jobs/${live.id}/change-2fa`).length, 1); await f.finish()
})

test('combined shows real phases and preserves logout failure, success and cancellation without retry', async browser => {
  for (const [status, phase, error, label] of [
    ['error', 'error', 'Synthetic logout failed after verified 2FA', 'Lỗi'],
    ['success', 'completed', null, 'Đã đổi 2FA và logout'],
    ['cancelled', 'cancelled', 'Đã dừng bởi người dùng', 'Đã dừng'],
  ]) {
    const operation = { id: 'combined-current', job_id: live.id, email: live.email, status: 'running', phase: 'changing_2fa' }
    const old = { ...operation, id: 'combined-old', status: 'success', phase: 'completed', finished_at: 90 }
    const f = await fixture(browser, 'twofa', { operations: [old, operation] }); const { page, state } = f
    const row = page.locator('.tf-account-row')
    await row.getByText('Luồng gộp: Đang đổi và xác minh 2FA', { exact: true }).waitFor()
    state.operations[1] = { ...operation, phase: 'logging_out' }
    await row.getByText('Luồng gộp: Đang logout tất cả phiên', { exact: true }).waitFor()
    state.operations[1] = { ...operation, status, phase, error, finished_at: 100 }
    if (phase === 'completed') {
      await row.getByText('Luồng gộp: Đang logout tất cả phiên', { exact: true }).waitFor({ state: 'hidden' })
      assert.equal(await row.getByText(`Luồng gộp: ${label}`, { exact: true }).count(), 0, 'Completed combined details should be hidden')
    } else {
      await row.getByText(`Luồng gộp: ${label}`, { exact: true }).waitFor()
    }
    if (error) await row.getByText(error, { exact: true }).waitFor()
    assert.equal(await row.getByRole('button', { name: 'Dừng gộp', exact: true }).count(), 0)
    assert.equal(await row.locator('[data-action=combined]').isEnabled(), true)
    await page.waitForTimeout(3200)
    assert.equal(await page.locator('[data-sonner-toast]').count(), 1, 'A repeated terminal poll must not duplicate its toast')
    assert.equal(state.calls.filter(call => call.method !== 'GET').length, 0)
    await page.locator(`.tf-filters [data-filter="${status === 'success' ? 'success' : 'error'}"]`).click()
    assert.equal(await page.locator('.tf-account-row').count(), 1, 'Filters must match the displayed combined outcome')
    if (status === 'error') {
      const downloaded = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Xuất tab (1)', exact: true }).click()
      assert.equal((await downloaded).suggestedFilename(), 'twofa-errors.txt')
      assert.equal(calls(state, `/api/jobs/${live.id}/raw`, 'GET').length, 1)
      assert.equal(await page.getByRole('button', { name: `Chạy lại ${live.email}`, exact: true }).count(), 0, 'Logout failure must not offer a rotation retry')
    }
    await page.locator('.tf-filters [data-filter="all"]').click()
    await emit(page, '', { type: 'job', job: { ...live, started_at: 101 } })
    await page.waitForFunction(() => !document.querySelector('.tf-account-row')?.textContent.includes('Luồng gộp:'))
    assert.equal(await row.locator('.tf-status').textContent(), 'Thành công · PLUS', 'An older combined result must not replace a later account check')
    await f.finish()
  }
})

test('late HTTP queued response cannot overwrite SSE success for an account action', async browser => {
  const f = await fixture(browser, 'twofa', { jobs: [{ ...live, status: 'error', account_state: 'unknown', retryable: true }] }); const { page, state } = f
  let release
  const pending = new Promise(resolve => { release = resolve })
  state.overrides[`POST /api/jobs/${live.id}/retry`] = async (route, body, state, json) => { await pending; return json(route, { job: { ...live, status: 'queued' } }) }
  try {
    await page.getByRole('button', { name: `Chạy lại ${live.email}`, exact: true }).click()
    await waitFor(page, () => calls(state, `/api/jobs/${live.id}/retry`).length === 1)
    await emit(page, '', { type: 'job', job: { ...live, plan: 'free' } })
  } finally { release() }
  await page.getByText('Đã gửi yêu cầu chạy lại.', { exact: true }).waitFor()
  const row = page.locator('.tf-account-row')
  assert.equal(await row.locator('.tf-status').innerText(), 'Thành công · FREE')
  assert.equal(await row.getByRole('button', { name: `Dừng ${live.email}`, exact: true }).count(), 0)
  assert.ok((await row.innerText()).includes('FREE'))
  assert.equal(calls(state, `/api/jobs/${live.id}/retry`).length, 1)
  await f.finish()
})

test('saved journal closes its dialog after successful save', async browser => {
  const f = await fixture(browser); const { page, state } = f
  await page.getByRole('button', { name: 'Nhật ký Live', exact: true }).click(); await page.getByLabel('Tên nhật ký mới', { exact: true }).fill('Synthetic saved journal')
  await page.getByRole('button', { name: 'Lưu nhật ký', exact: true }).click(); await waitFor(page, () => calls(state, '/api/live-journals').length === 1)
  await page.waitForTimeout(50); assert.equal(await page.getByRole('dialog').count(), 0); await f.finish()
})

test('historical journal exposes historical copy only and launch returns to current queue', async browser => {
  const f = await fixture(browser); const { page, state } = f
  await page.getByRole('button', { name: 'Nhật ký Live', exact: true }).click(); await page.getByRole('dialog').locator('select').selectOption('saved')
  await page.getByText('historical@example.test', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Xuất tab (1)', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Đổi 2FA historical@example.test', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Copy tài khoản historical@example.test', exact: true }).click(); assert.equal(calls(state, '/api/live-journals/saved/accounts/historical/raw', 'GET').length, 1)
  await page.locator('#tf-input').fill('new@example.test|SyntheticPassword|TESTSECRET'); await page.getByRole('button', { name: 'Khởi chạy', exact: true }).click()
  await waitFor(page, () => calls(state, '/api/jobs').length === 1)
  assert.equal(await page.getByText('historical@example.test', { exact: true }).count(), 0); await f.finish()
})

test('filtered export keeps canonical backend filenames', async browser => {
  const f = await fixture(browser); const { page } = f
  await page.locator('.tf-filters button').filter({ hasText: /^Thành công/ }).click()
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Xuất tab (1)', exact: true }).click()
  assert.equal((await downloaded).suggestedFilename(), 'twofa-success-tab.txt'); await f.finish()
})

test('clear failures is unavailable when only a preserved live error exists', async browser => {
  const f = await fixture(browser, 'twofa', { jobs: [{ ...live, status: 'error' }] })
  assert.equal(await f.page.getByRole('button', { name: 'Dọn lỗi', exact: true }).count(), 0); await f.finish()
})

test('session JSON stays unmodified and sends only its explicit rotation payload', async browser => {
  const f = await fixture(browser); const { page, state } = f
  await page.getByRole('button', { name: 'Session JSON', exact: true }).click(); const dialog = page.getByRole('dialog')
  const session = '{"accessToken":"synthetic-only-token","note":"第1张----unchanged"}'
  await dialog.getByLabel('Email tài khoản', { exact: true }).fill('session@example.test'); await dialog.getByLabel(/^Mật khẩu hiện tại/).fill('SyntheticPassword')
  await dialog.getByLabel('Hoặc dán session JSON', { exact: true }).fill(session); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Xác nhận đổi 2FA', exact: true }).click()
  await waitFor(page, () => calls(state, '/api/session-jobs').length === 1)
  assert.deepEqual(calls(state, '/api/session-jobs')[0].body, { email: 'session@example.test', password: 'SyntheticPassword', session_json: session, confirm: 'CHANGE_2FA_FROM_SESSION' }); await f.finish()
})

test('2FA history supports row/all copy and export', async browser => {
  const f = await fixture(browser); const { page } = f
  await page.getByRole('button', { name: 'Lịch sử 2FA', exact: true }).click(); const dialog = page.getByRole('dialog'); await dialog.getByText(live.email, { exact: true }).waitFor()
  if (process.env.REACT_HISTORY_SCREENSHOTS) for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(220)
    await page.screenshot({ path: `${process.env.REACT_HISTORY_SCREENSHOTS}/history-default-${width}.png` })
  }
  await dialog.getByRole('button', { name: 'Copy bản ghi 1', exact: true }).click(); await dialog.getByRole('button', { name: 'Copy tất cả', exact: true }).click()
  const all = `${raw}\nother@example.test|OtherSyntheticPassword|TESTSECRET`
  assert.deepEqual(await page.evaluate(() => window.__copied), [raw, all])
  const downloaded = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Xuất .txt', exact: true }).click()
  const file = await downloaded
  assert.equal(file.suggestedFilename(), 'twofa-history.txt')
  assert.equal(require('node:fs').readFileSync(await file.path(), 'utf8'), all)
  await f.finish()
})

test('2FA history loading, error, retry and empty states dismiss safely', async browser => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const f = await fixture(browser, 'twofa', { overrides: { 'GET /api/twofa-history': async (route, body, state, json) => { await pending; return json(route, { detail: 'Synthetic failure' }, 500) } } })
  const { page, state } = f
  const trigger = page.getByRole('button', { name: 'Lịch sử 2FA', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Đang tải lịch sử', { exact: true }).waitFor()
  assert.equal(await dialog.getByText('Chưa có tài khoản đổi 2FA thành công.', { exact: true }).count(), 0)
  assert.equal(await dialog.getByRole('button', { name: 'Copy tất cả', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
  release()
  await trigger.click()
  await dialog.getByRole('alert').getByText('Không tải được lịch sử 2FA', { exact: true }).waitFor()
  if (process.env.REACT_HISTORY_SCREENSHOTS) await page.screenshot({ path: `${process.env.REACT_HISTORY_SCREENSHOTS}/history-error.png` })
  state.overrides['GET /api/twofa-history'] = (route, body, state, json) => json(route, { history: [] })
  await dialog.getByRole('button', { name: 'Thử lại', exact: true }).click()
  await dialog.getByText('Chưa có tài khoản đổi 2FA thành công.', { exact: true }).waitFor()
  if (process.env.REACT_HISTORY_SCREENSHOTS) await page.screenshot({ path: `${process.env.REACT_HISTORY_SCREENSHOTS}/history-empty.png` })
  assert.equal(await dialog.getByRole('button', { name: 'Xuất .txt', exact: true }).isDisabled(), true)
  assert.equal(await page.locator('[data-sonner-toast]').count(), 0)
  await f.finish()
})

test('2FA history keeps header and actions visible with long data and keyboard focus', async browser => {
  const entries = Array.from({ length: 24 }, (_, i) => ({ email: `account-${i}-${'long'.repeat(12)}@example.test`, changed_at: 1700000000+i, raw: `account-${i}@example.test|${'Synthetic!$\\*password'.repeat(8)}|BASE32TEST` }))
  const f = await fixture(browser, 'twofa', { overrides: { 'GET /api/twofa-history': (route, body, state, json) => json(route, { history: entries }) } })
  const { page } = f
  await page.getByRole('button', { name: 'Lịch sử 2FA', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('24 bản ghi', { exact: true }).waitFor()
  const folder = process.env.REACT_HISTORY_SCREENSHOTS
  for (const [width, height] of [[1600, 1000], [390, 844], [320, 640], [820, 420]]) {
    await page.setViewportSize({ width, height })
    const list = dialog.getByRole('region', { name: 'Danh sách lịch sử 2FA' })
    await list.evaluate(el => { el.scrollTop = 0 })
    const heading = dialog.locator('.app-dialog-heading')
    const footer = dialog.locator('.tf-history-footer')
    const before = await footer.boundingBox()
    await list.evaluate(el => { el.scrollTop = el.scrollHeight })
    const bounds = await dialog.boundingBox()
    const after = await footer.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height)
    assert.ok(Math.abs(before.y - after.y) <= 1)
    assert.ok(await list.evaluate(el => el.scrollTop > 0 && el.scrollWidth <= el.clientWidth))
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollTop === 0))
    assert.ok((await heading.boundingBox()).y >= bounds.y)
    for (const button of await footer.getByRole('button').all()) {
      const b = await button.boundingBox()
      assert.ok(b.x >= bounds.x && b.x + b.width <= bounds.x + bounds.width && b.y + b.height <= height)
      if (width <= 560) assert.ok(b.height >= 44)
    }
    await dialog.getByRole('button', { name: 'Đóng hộp thoại', exact: true }).focus()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await dialog.getByRole('button', { name: 'Copy tất cả', exact: true }).evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Tab')
    assert.equal(await dialog.getByRole('button', { name: 'Đóng hộp thoại', exact: true }).evaluate(el => el === document.activeElement), true)
    if (folder) {
      await list.evaluate(el => { el.scrollTop = 0 })
      await page.screenshot({ path: `${folder}/history-${width}.png` })
    }
  }
  await f.finish()
})

test('passkey automatic handoff launches once with native confirmation and never claims enrollment', async browser => {
  const f = await fixture(browser, 'passkey'); const { page, state } = f
  await page.locator('#react-passkey-input').fill(raw); await page.getByRole('button', { name: 'Thêm passkey', exact: true }).click(); await waitFor(page, () => calls(state, '/api/passkey/jobs').length === 1)
  await page.getByRole('button', { name: `Dừng ${live.email}`, exact: true }).waitFor()
  await page.getByRole('button', { name: 'Thêm passkey', exact: true }).waitFor()
  const ready = { ...state.passkey[0], status: 'success', handoff_ready: true, phase: 'handoff_ready' }
  await emit(page, 'passkey', { type: 'job', job: ready }); await waitFor(page, () => calls(state, `/api/passkey/jobs/${ready.id}/launch`).length === 1)
  await emit(page, 'passkey', { type: 'snapshot', jobs: [ready] }); await page.waitForTimeout(50)
  assert.equal(calls(state, `/api/passkey/jobs/${ready.id}/launch`).length, 1)
  assert.deepEqual(calls(state, `/api/passkey/jobs/${ready.id}/launch`)[0].body, { confirm: 'LAUNCH_PASSKEY', native_window: true })
  await page.getByText(/chưa có nghĩa là đã thêm passkey/).waitFor(); await f.finish()
})

test('passkey retry/stop/delete/logs and bulk controls keep their API namespace', async browser => {
  const job = { ...live, status: 'error', retryable: true, phase: 'error' }
  const f = await fixture(browser, 'passkey', { passkey: [job] }); const { page, state } = f
  await page.getByRole('button', { name: `Xem log ${live.email}`, exact: true }).click(); await page.getByText('Synthetic safe log', { exact: true }).waitFor(); await close(page)
  await page.getByRole('button', { name: `Chạy lại ${live.email}`, exact: true }).click(); await waitFor(page, () => calls(state, `/api/passkey/jobs/${live.id}/retry`).length === 1)
  await page.getByRole('button', { name: `Dừng ${live.email}`, exact: true }).click(); await waitFor(page, () => calls(state, `/api/passkey/jobs/${live.id}/stop`).length === 1)
  await page.getByRole('button', { name: `Xóa ${live.email}`, exact: true }).click(); await waitFor(page, () => calls(state, `/api/passkey/jobs/${live.id}`, 'DELETE').length === 1)
  await page.getByRole('button', { name: 'Đóng tất cả cửa sổ', exact: true }).click(); await waitFor(page, () => calls(state, '/api/passkey/windows/close').length === 1)
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.getByRole('button', { name: 'Dọn danh sách', exact: true }).click()
  await waitFor(page, () => calls(state, '/api/passkey/jobs', 'DELETE').length === 1)
  assert.equal(await page.getByRole('alertdialog').count(), 0)
  await f.finish()
})

test('confirmation cancel, Escape, focus and duplicate accept protect destructive actions', async browser => {
  const f = await fixture(browser); const { page, state } = f
  const trigger = page.getByRole('button', { name: `Xóa hội thoại ${live.email}`, exact: true })
  await trigger.click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).waitFor()
  await page.waitForFunction(() => document.activeElement?.textContent === 'Hủy')
  await page.keyboard.press('Tab')
  assert.equal(await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Tab')
  assert.equal(await dialog.getByRole('button', { name: 'Hủy', exact: true }).evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Escape')
  assert.equal(calls(state, `/api/jobs/${live.id}/delete-chats`).length, 0)
  await page.waitForFunction(email => document.activeElement?.getAttribute('aria-label') === `Xóa hội thoại ${email}`, live.email)
  await trigger.click(); await dialog.getByRole('button', { name: 'Hủy', exact: true }).click()
  assert.equal(calls(state, `/api/jobs/${live.id}/delete-chats`).length, 0)
  await trigger.evaluate(el => { el.click(); el.click() })
  assert.equal(await dialog.count(), 1)
  await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).evaluate(el => { el.click(); el.click() })
  await waitFor(page, () => calls(state, `/api/jobs/${live.id}/delete-chats`).length === 1)
  await page.locator('[data-sonner-toast][data-type=success]').getByText('Đã xử lý yêu cầu xóa hội thoại.', { exact: true }).waitFor()
  assert.equal(calls(state, `/api/jobs/${live.id}/delete-chats`).length, 1)
  await f.finish()
})

test('failed mutation uses one error toast and navigation cancels a pending confirmation', async browser => {
  const f = await fixture(browser, 'twofa', { overrides: { [`POST /api/jobs/${live.id}/delete-chats`]: (route, body, state, json) => json(route, { detail: 'Synthetic action failed' }, 503) } }); const { page, state } = f
  await page.getByRole('button', { name: `Xóa hội thoại ${live.email}`, exact: true }).click(); await confirm(page)
  await page.locator('[data-sonner-toast][data-type=error]').getByText('Synthetic action failed', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-sonner-toast][data-type=error]').count(), 1)
  assert.equal(await page.locator('.native-message').count(), 0)
  await page.getByRole('button', { name: `Logout ${live.email}`, exact: true }).click()
  await page.getByRole('alertdialog').waitFor()
  await page.evaluate(() => { location.hash = '/workspace/passkey' })
  await page.locator('#react-passkey-input').waitFor()
  assert.equal(await page.getByRole('alertdialog').count(), 0)
  assert.equal(calls(state, `/api/jobs/${live.id}/logout-sessions`).length, 0)
  await f.finish()
})

test('nested dialogs and toasts fit desktop and mobile with safe focus restoration', async browser => {
  const f = await fixture(browser, 'twofa', { output: '' }); const { page, state } = f
  const folder = process.env.REACT_FEEDBACK_SCREENSHOTS
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height })
    const open = page.getByRole('button', { name: 'Đổi mật khẩu', exact: true })
    await open.click()
    const form = page.getByRole('dialog')
    const clear = form.getByRole('button', { name: 'Xóa', exact: true })
    await page.waitForFunction(() => !document.querySelector('#react-target-password')?.disabled)
    await clear.click()
    const confirmDialog = page.getByRole('alertdialog')
    await confirmDialog.waitFor()
    const bounds = await confirmDialog.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height)
    assert.equal(await confirmDialog.getByRole('button', { name: 'Hủy', exact: true }).evaluate(el => el === document.activeElement), true)
    if (folder && width !== 320) await page.screenshot({ path: `${folder}/confirm-${width}.png` })
    // Let Radix finish registering the nested dismissable layer before sending Escape.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.keyboard.press('Escape')
    assert.equal(calls(state, '/api/password-settings', 'DELETE').length, 0)
    await page.waitForFunction(() => document.activeElement?.textContent === 'Xóa')
    await form.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
    const nestedToast = page.locator('[data-sonner-toast][data-visible=true]').filter({ hasText: 'Đã lưu mật khẩu chung' })
    await nestedToast.waitFor()
    assert.equal(await nestedToast.evaluate(el => Boolean(el.closest('[aria-hidden=true]'))), false)
    assert.equal(await nestedToast.evaluate(el => el.closest('[aria-live]')?.getAttribute('aria-live')), 'polite')
    await nestedToast.getByRole('button', { name: 'Đóng thông báo', exact: true }).click()
    assert.equal(await form.isVisible(), true)
    await form.getByRole('button', { name: 'Đóng hộp thoại', exact: true }).click()
    await page.waitForFunction(() => document.activeElement?.textContent?.includes('Đổi mật khẩu'))
    await page.getByRole('button', { name: 'Làm mới', exact: true }).click()
    const toast = page.locator('[data-sonner-toast][data-visible=true]').last()
    await toast.waitFor(); await page.waitForTimeout(400)
    const toastBounds = await toast.boundingBox()
    assert.equal(await toast.evaluate(el => `${el.parentElement.dataset.yPosition}-${el.parentElement.dataset.xPosition}`), 'top-right')
    assert.ok(toastBounds.y >= 0 && toastBounds.y < 50)
    assert.ok(toastBounds.x >= 0 && toastBounds.x + toastBounds.width <= width)
    const toastColors = await toast.evaluate(el => {
      const sample = document.createElement('span')
      sample.style.backgroundColor = 'color-mix(in srgb, var(--success) 13%, var(--bg-sidebar))'
      document.body.append(sample)
      const expected = getComputedStyle(sample).backgroundColor
      sample.remove()
      return { actual: getComputedStyle(el).backgroundColor, expected }
    })
    assert.equal(toastColors.actual, toastColors.expected)
    if (width <= 580) {
      const closeBounds = await toast.getByRole('button', { name: 'Đóng thông báo', exact: true }).boundingBox()
      assert.ok(closeBounds.width >= 43.99 && closeBounds.height >= 43.99)
      assert.ok(closeBounds.x >= 0 && closeBounds.x + closeBounds.width <= width)
    }
    if (folder && width !== 320) await page.screenshot({ path: `${folder}/toast-${width}.png` })
    await toast.getByRole('button', { name: 'Đóng thông báo', exact: true }).click()
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: `Logout ${live.email}`, exact: true }).click()
  await page.keyboard.press('Escape')
  await f.finish()
})

test('SSE snapshots and repeat success updates do not create duplicate toasts', async browser => {
  const f = await fixture(browser); const { page } = f
  for (let i = 0; i < 4; i++) await emit(page, '', { type: 'snapshot', jobs: [{ ...live }] })
  await page.waitForTimeout(100)
  assert.equal(await page.locator('[data-sonner-toast]').count(), 0)
  await f.finish()
})

test('password settings, independent queue, history search/copy and cleanup', async browser => {
  const job = { ...live, status: 'error', retryable: true, phase: 'error' }
  const f = await fixture(browser, 'twofa', { password: [job] }); const { page, state } = f
  await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click(); const workspace = page.locator('.aw-workspace'); await workspace.locator('#react-target-password').waitFor()
  await page.waitForFunction(expected => document.querySelector('#react-target-password')?.value === expected, state.target)
  assert.equal(await workspace.locator('#react-target-password').inputValue(), state.target)
  await workspace.locator('#react-target-password').fill('UpdatedSynthetic!password'); await workspace.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click(); await waitFor(page, () => calls(state, '/api/password-settings', 'PUT').length === 1)
  assert.deepEqual(calls(state, '/api/password-settings', 'PUT')[0].body, { target_password: 'UpdatedSynthetic!password' })
  const newRaw = 'new-password@example.test|Synthetic!Password|TESTSECRET'
  await workspace.locator('#react-password-input').fill(newRaw); await workspace.getByRole('button', { name: 'Bắt đầu đổi mật khẩu', exact: true }).click(); await waitFor(page, () => calls(state, '/api/password/jobs').length === 1)
  assert.deepEqual(calls(state, '/api/password/jobs')[0].body, { lines: [newRaw] })
  await workspace.getByRole('button', { name: `Chạy lại ${live.email}`, exact: true }).click(); await waitFor(page, () => calls(state, `/api/password/jobs/${live.id}/retry`).length === 1)
  await workspace.getByRole('button', { name: `Dừng ${live.email}`, exact: true }).click(); await waitFor(page, () => calls(state, `/api/password/jobs/${live.id}/stop`).length === 1)
  await workspace.getByRole('button', { name: `Xóa ${live.email}`, exact: true }).click(); await waitFor(page, () => calls(state, `/api/password/jobs/${live.id}`, 'DELETE').length === 1)
  await workspace.getByRole('button', { name: 'Lịch sử', exact: true }).click(); const history = page.locator('.aw-dialog[data-state=open]'); await history.getByLabel('Tìm theo email', { exact: true }).fill('live@')
  assert.equal(await history.locator('.aw-history-entry').count(), 1); await history.getByRole('button', { name: 'Copy kết quả', exact: true }).click(); assert.deepEqual(await page.evaluate(() => window.__copied), [raw]); await close(page)
  await workspace.getByRole('button', { name: 'Dọn danh sách', exact: true }).click(); await confirm(page); await waitFor(page, () => calls(state, '/api/password/jobs', 'DELETE').length === 1)
  await workspace.getByRole('button', { name: 'Xóa', exact: true }).click(); await confirm(page); await waitFor(page, () => calls(state, '/api/password-settings', 'DELETE').length === 1)
  await workspace.getByRole('button', { name: 'Quay lại', exact: true }).click(); assert.equal(await page.locator('.aw-workspace').count(), 0); await f.finish()
})

test('typed cleanup selects DIE or HTTP403 and preserves unrelated rows', async browser => {
  for (const width of [1600,390,320]) {
    const failed = { ...live, status:'error', account_state:'unknown', login_verified:false }
    const f = await fixture(browser,'twofa',{jobs:[{...live},{...failed,id:'die',email:'die@example.test',account_state:'die',error:'account deactivated'},{...failed,id:'403',email:'403@example.test',error:'MFA verify failed: HTTP 403 - incorrect_code'},{...failed,id:'other',email:'other@example.test',error:'no mail_provider available'},{...failed,id:'active',email:'active@example.test',status:'running',error:'HTTP 403'}]})
    const {page,state}=f
    await page.setViewportSize({width,height:1000})
    await page.getByRole('button',{name:'Dọn lỗi',exact:true}).click()
    const dialog=page.getByRole('dialog')
    await dialog.getByRole('button',{name:'Dọn',exact:true}).isDisabled().then(disabled=>assert.equal(disabled,true))
    await dialog.getByRole('radio',{name:/Tài khoản DIE/}).check()
    await page.waitForFunction(()=>!document.querySelector('.tf-cleanup-modal button[type=submit]')?.disabled)
    if(process.env.REACT_CLEANUP_SCREENSHOTS)await page.screenshot({path:`${process.env.REACT_CLEANUP_SCREENSHOTS}/cleanup-${width}.png`})
    const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width)
    await dialog.getByRole('button',{name:'Dọn 1 tài khoản',exact:true}).click()
    await waitFor(page,()=>calls(state,'/api/jobs/failed/by-type','DELETE').length===1)
    await dialog.waitFor({state:'hidden'})
    assert.deepEqual(state.jobs.map(j=>j.id),['live-row','403','other','active'])
    assert.equal(calls(state,'/api/jobs/failed/by-type','DELETE')[0].search,'?failure_type=die')
    await page.getByRole('button',{name:'Dọn lỗi',exact:true}).click()
    assert.equal(await dialog.getByRole('radio',{name:/Tài khoản DIE/}).isDisabled(),true)
    await dialog.getByRole('radio',{name:/Lỗi HTTP 403/}).check()
    await dialog.getByRole('button',{name:'Dọn 1 tài khoản',exact:true}).click()
    await waitFor(page,()=>calls(state,'/api/jobs/failed/by-type','DELETE').length===2)
    await dialog.waitFor({state:'hidden'})
    assert.deepEqual(state.jobs.map(j=>j.id),['live-row','other','active'])
    await f.finish()
  }
})

;(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}) })
  let failed = 0
  const selected = tests.filter(({ name }) => !process.env.REACT_TEST_FILTER || new RegExp(process.env.REACT_TEST_FILTER).test(name))
  for (const { name, action } of selected) {
    try { await action(browser); console.log(`PASS ${name}`) }
    catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`) }
    finally { for (const context of browser.contexts()) await context.close() }
  }
  await browser.close()
  console.log(`RESULT tests=${selected.length} passed=${selected.length - failed} failed=${failed}`)
  process.exitCode = failed ? 1 : 0
})().catch(error => { console.error(error); process.exitCode = 1 })
