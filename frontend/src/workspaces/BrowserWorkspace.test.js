import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BrowserWorkspace from './BrowserWorkspace'
import { collectSessions, deduplicateEntries, isK12Invite, normalizeAccountLine, parseAccounts, parseFileContent, parseSession, webResultVerified } from './browser-model'

const jwt = (payload) => `synthetic.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`

describe('Browser workspace account and session parsing', () => {
  it('preserves pipe credentials and supports legacy delimiters without guessing inside them', () => {
    const input = 'synthetic@example.test|p;ass,w$*|ABC'
    expect(normalizeAccountLine(input)).toBe(input)
    expect(normalizeAccountLine('synthetic@example.test\tp@ss\tABC')).toBe('synthetic@example.test|p@ss|ABC')
    expect(normalizeAccountLine('synthetic@example.test;password;ABC')).toBe('synthetic@example.test|password|ABC')
    expect(normalizeAccountLine('synthetic@example.test,password,ABC')).toBe('synthetic@example.test|password|ABC')
    expect(normalizeAccountLine('synthetic@example.test  password  ABC')).toBe('synthetic@example.test|password|ABC')
    expect(parseAccounts(`# ignored\n${input}\ninvalid\n\n`)).toEqual([{ email: 'synthetic@example.test', password: 'p;ass,w$*', totp: 'ABC', raw: input }])
  })
  it('reads JWT profile, account and expiry and tolerates invalid JWT expiry', () => {
    const token = jwt({ exp: 1893456000, 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-id', chatgpt_plan_type: 'plus' }, 'https://api.openai.com/profile': { email: 'synthetic@example.test' } })
    const parsed = parseSession({ access_token: token, refresh_token: 'synthetic-refresh' })
    expect(parsed.email).toBe('synthetic@example.test')
    expect(parsed.providerSpecificData).toEqual({ chatgptAccountId: 'synthetic-id', chatgptPlanType: 'plus' })
    expect(parsed.expiresAt).toBe('2030-01-01T00:00:00.000Z')
    expect(parsed.refreshToken).toBe('synthetic-refresh')
    expect(parseSession({ accessToken: jwt({ exp: 'invalid' }), expires: '2031-01-01T00:00:00.000Z' }).expiresAt).toBe('2031-01-01T00:00:00.000Z')
    expect(parseSession({ accessToken: 123 })).toBeNull()
    expect(parseSession(null)).toBeNull()
    expect(parseSession({ accessToken: 'synthetic-token', user: { email: {} } })).toBeNull()
    expect(parseSession({ accessToken: 'synthetic-token', account: { planType: {} } })).toBeNull()
  })
  it('accepts nested sessions and supported backup formats, deduplicating email last-wins', () => {
    const session = { accessToken: 'synthetic-token', user: { email: 'A@example.test' } }
    expect(collectSessions({ nested: [null, session, { inner: session }] })).toHaveLength(2)
    const backup = { provider: 'codex', email: 'a@example.test', accessToken: 'synthetic-backup-token' }
    expect(parseFileContent({ providerConnections: [backup, { provider: 'other' }] }, 'backup.json')).toEqual([{ conn: backup, source: 'backup.json', type: 'backup' }])
    expect(parseFileContent([backup], 'array.json')[0].type).toBe('backup')
    expect(parseFileContent(backup, 'single.json')[0].type).toBe('backup')
    expect(parseFileContent([session], 'sessions.json')[0].type).toBe('session')
    const entries = [...parseFileContent(session, 'first.json'), ...parseFileContent(backup, 'last.json'), { conn: { email: '' }, source: 'anonymous.json' }]
    expect(deduplicateEntries(entries).map((entry) => entry.source)).toEqual(['last.json', 'anonymous.json'])
    expect(parseFileContent({ unrelated: true }, 'empty.json')).toEqual([])
  })
  it('recognizes only official K12 URLs and requires verified login results', () => {
    expect(isK12Invite(true, 'https://chatgpt.com/k12-invite?workspace=synthetic')).toBe(true)
    for (const url of ['https://chatgpt.com.evil.test/k12-invite', 'https://user:pass@chatgpt.com/k12-invite', 'http://chatgpt.com/k12-invite', 'https://chatgpt.com/k12-invite/extra', 'invalid']) expect(isK12Invite(true, url)).toBe(false)
    expect(isK12Invite(false, 'https://chatgpt.com/k12-invite')).toBe(false)
    expect(webResultVerified({ status: 'success', personalAccountVerified: true })).toBe(true)
    expect(webResultVerified({ status: 'success', personalAccountVerified: true, workspaceCheckRequired: true, workspaceVerified: false })).toBe(false)
    expect(webResultVerified({ status: 'success', workspaceCheckRequired: true, workspaceVerified: true })).toBe(true)
    expect(webResultVerified({ status: 'success', personalAccountVerified: true, postLoginError: 'reload_error' })).toBe(false)
  })
})

describe('Browser React controls', () => {
  it('renders all six real views, retained session controls and escaped metadata', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const seed = (path, value) => client.setQueryData(['browser-workspace', path], value)
    seed('/api/health', { ok: true })
    seed('/api/web-login/browsers', { browsers: [{ id: 'brave', name: 'Brave' }] })
    seed('/api/web-login/status', { running: true, paused: true, browserControls: true, done: 1, total: 2, webSessions: 1, results: [{ email: '<script>synthetic</script>', index: 1, status: 'success', personalAccountVerified: true }], logs: [{ level: 'info', email: 'synthetic@example.test', message: '<private metadata>' }] })
    seed('/api/codex-web/status', { blockedBy: 'chatgpt' })
    seed('/api/oauth/auto-status', { running: false })
    seed('/api/connections', { connections: [] })
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(BrowserWorkspace)))
    for (const label of ['ChatGPT Web', 'Login Codex', 'OAuth Login', 'Import Session', 'Tài khoản hiện có', 'Import từ file', 'Mở URL sau khi đăng nhập', 'Tự động thử lại', 'Tiếp tục', 'Hủy phiên hiện tại', 'Mở tab', 'Sắp xếp lại tab', 'Login thủ công', 'Ẩn Chrome', 'Tải xuống JSON']) expect(html).toContain(label)
    expect(html).toContain('&lt;script&gt;synthetic&lt;/script&gt;')
    expect(html).toContain('&lt;private metadata&gt;')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<script>synthetic')
    client.clear()
  })
})
