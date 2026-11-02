import { useEffect, useMemo, useRef, useState } from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, SlidersHorizontal, SquareTerminal, CircleCheck, CircleAlert, Download, FileJson, FolderOpen, Globe, History, KeyRound, LoaderCircle, LogIn, Pause, Play, RefreshCw, Square, Trash2, Upload, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AppDialog } from '@/components/ui/app-dialog'
import { useConfirm } from '@/lib/use-confirm'
import { notify } from '@/lib/feedback'
import { moduleRequest } from '@/lib/module-api'
import { collectSessions, deduplicateEntries, isK12Invite, normalizeAccountLine, parseAccounts, parseFileContent, webResultVerified } from './browser-model'
import './BrowserWorkspace.css'

const request = (path, options) => moduleRequest('browser', path, options)
const tabs = [['web-login', 'ChatGPT Web', Globe], ['codex-web', 'Login Codex', KeyRound], ['oauth', 'OAuth Login', LogIn], ['import', 'Import Session', FileJson], ['accounts', 'Tài khoản hiện có', Users], ['file', 'Import từ file', FolderOpen]]
const queryKey = (path) => ['browser-workspace', path]

const flowErrors = { link_error: 'Tab phụ chưa tải xong', mobile_error: 'Chưa bật được mobile; chưa mở tab phụ', main_tab_error: 'Không quay lại được tab chính', reload_error: 'Reload tab chính thất bại', tabs_closed: 'Tab hoặc Chrome đã đóng', cancelled: 'Đã dừng kiểm tra tài khoản', workspace_check_failed: 'Không thể tiếp tục xác minh workspace' }
function verificationLabel(result) {
  if (result.workspaceCheckRequired !== true) return result.personalAccountVerified === true ? 'Đã xác minh Personal account' : 'Chưa xác minh Personal account'
  const errors = { invalid_invite: 'Link mời thiếu hoặc sai ID workspace', identity_mismatch: 'Phiên không khớp tài khoản', wrong_origin: 'Tab chính chưa ở ChatGPT', session_unavailable: 'Chưa đọc được phiên', access_denied: 'Backend từ chối truy cập', rate_limited: 'Giới hạn lượt kiểm tra', request_failed: 'Chưa đọc được backend', unsupported_response: 'Dữ liệu chưa hỗ trợ', workspace_unavailable: 'Workspace không hoạt động', not_joined: 'Chưa có quyền truy cập workspace đích' }
  return `${result.workspaceVerified ? 'Đã xác minh quyền truy cập workspace đích' : `Chưa xác minh workspace đích${errors[result.workspaceCheckError] ? ` · ${errors[result.workspaceCheckError]}` : ''}`} · Workspace đang dùng: ${result.activeWorkspaceId ? result.activeWorkspaceId === result.workspaceId ? 'workspace đích' : 'workspace khác' : 'chưa xác minh'}`
}
function formatDate(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN', { hour12: false }) }
function duration(milliseconds) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }
function preference(key, fallback) { try { return localStorage.getItem(key) ?? fallback } catch { return fallback } }
function savePreference(key, value) { try { localStorage.setItem(key, value) } catch { /* Preferences are optional. */ } }
function useBrowserQuery(path, { enabled = true, interval = 0, isActive = true, keepRunning = false } = {}) {
  const mutating = useIsMutating({ mutationKey: ['browser-workspace'] })
  return useQuery({ queryKey: queryKey(path), queryFn: ({ signal }) => request(path, { signal }), enabled: query => enabled && !mutating && (isActive || query.state.isInvalidated || query.state.status !== 'success' || keepRunning && Boolean(query.state.data?.running || query.state.data?.webReady || query.state.data?.paused)), retry: false, refetchInterval: interval || false, refetchOnWindowFocus: true })
}
function useBrowserAction() {
  const client = useQueryClient()
  const pending = useRef(false)
  const mutation = useMutation({ mutationKey: ['browser-workspace'], retry: false, mutationFn: async ({ path, body, method = 'POST' }) => {
    const data = await request(path, { method, ...(body === undefined ? {} : { body }) })
    if (data?.error || data?.ok === false) throw new Error(data.error || 'Thao tác chưa thành công')
    return data
  } })
  async function run(path, body, method, success) {
    if (pending.current) return null
    pending.current = true
    try {
      await client.cancelQueries({ queryKey: ['browser-workspace'] })
      const data = await mutation.mutateAsync({ path, body, method })
      if (success) notify(typeof success === 'function' ? success(data) : success)
      return data
    } catch (error) { notify(error.message, 'error'); return null }
    finally { pending.current = false; client.invalidateQueries({ queryKey: ['browser-workspace'] }) }
  }
  return { run, busy: mutation.isPending }
}
function Notice({ message }) { return message ? <div className={`bw-notice ${message.error ? 'bw-error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</div> : null }
function QueryError({ query }) { return query.isError ? <div className="bw-notice bw-error" role="alert">Không tải được dữ liệu. <Button variant="link" size="sm" onClick={() => query.refetch()}>Thử lại</Button></div> : null }
function Panel({ title, description, action, icon: Icon, children, className = '' }) { return <Card className={`bw-panel ${className}`}><div className="bw-panel-head"><div><h2>{Icon && <Icon size={18} aria-hidden="true" />}{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</Card> }
function Stats({ values }) { return <div className="bw-stats">{values.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div> }
function Toggle({ checked, onChange, children, disabled = false }) { return <label className="bw-toggle"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange?.(event.target.checked)} /><span>{children}</span></label> }
function AccountInput({ id, value, onChange, disabled = false }) {
  return <label className="bw-field" htmlFor={id}><span>Danh sách tài khoản <small>email|password|2fa_secret · mỗi dòng một tài khoản</small></span><textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} spellCheck={false} autoComplete="off" placeholder={'you@example.com|password|2fa_secret\n# Dòng bắt đầu bằng # sẽ được bỏ qua'} onPaste={(event) => {
    const pasted = event.clipboardData.getData('text')
    if (!pasted) return
    event.preventDefault()
    const target = event.currentTarget
    const next = value.slice(0, target.selectionStart) + pasted + value.slice(target.selectionEnd)
    onChange(next.split('\n').map(normalizeAccountLine).join('\n'))
  }} /></label>
}
function Logs({ logs = [], running }) {
  const ref = useRef(null)
  const follow = useRef(true)
  useEffect(() => { if (follow.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [logs])
  return <div className="bw-terminal" ref={ref} tabIndex={0} aria-label="Nhật ký hoạt động" onScroll={(event) => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48 }}><div className="bw-terminal-title"><span><SquareTerminal size={15} aria-hidden="true" />NHẬT KÝ HOẠT ĐỘNG</span><span className={`bw-terminal-status ${running ? 'bw-terminal-live' : ''}`}>{running ? '● LIVE' : 'TERMINAL'}</span></div>{logs.length ? logs.map((log, index) => <div className={`bw-log bw-log-${log.level || 'info'}`} key={log.id || `${log.time}-${index}`}><time>{log.time ? new Date(log.time).toLocaleTimeString('vi-VN', { hour12: false }) : '—'}</time><div><strong>{log.email || 'system'}</strong><span>{log.message}</span></div></div>) : <p className="bw-empty">$ Sẵn sàng nhận danh sách tài khoản…</p>}</div>
}
function Results({ results = [], codex, canFocus, onFocus, busy }) {
  return <div className="bw-results">{results.length ? results.map((result, index) => {
    const success = result.status === 'success'
    const verified = codex ? success && result.codexOpened : webResultVerified(result)
    const detail = codex ? !success ? result.error || 'Chưa mở được phiên OAuth' : result.codexOpened ? 'Codex OAuth đã xác thực · tab đang được giữ mở' : 'Tab OAuth đang giữ mở · cần bạn kiểm tra/hoàn tất'
      : !success ? result.error || 'Login lỗi' : `${flowErrors[result.postLoginError] ? `${flowErrors[result.postLoginError]} · ` : ''}${verificationLabel(result)} · ${result.linkOpened ? 'Tab phụ đã mở' : 'ChatGPT đang mở'}${result.chatgptReloaded ? ', tab chính đã reload' : ''}`
    return <div className={`bw-result ${verified ? 'bw-success' : success ? 'bw-warning' : 'bw-failed'}`} key={`${result.email}-${result.index || index}`}>
      {verified ? <CircleCheck size={17} /> : <CircleAlert size={17} />}<div><strong>{result.email || 'Tài khoản'}</strong><p>{detail}</p></div>{canFocus && success && Number(result.index) > 0 && <Button variant="outline" size="sm" disabled={busy} onClick={() => onFocus(Number(result.index))}><FolderOpen />Mở tab</Button>}
    </div>
  }) : <div className="bw-empty-state"><FolderOpen size={24} aria-hidden="true" /><p className="bw-empty">Chưa có kết quả phiên này.</p></div>}</div>
}
function BrowserDialog({ title, onClose, children }) {
  return <AppDialog title={title} onClose={onClose} className="bw-dialog">{children}</AppDialog>
}
function WebLogin({ codex = false, online, isActive }) {
  const confirm = useConfirm()
  const base = codex ? '/api/codex-web' : '/api/web-login'
  const status = useBrowserQuery(`${base}/status`, { interval: 1000, isActive, keepRunning: true })
  const state = status.data || {}
  const browsers = useBrowserQuery('/api/web-login/browsers', { enabled: !codex })
  const [text, setText] = useState('')
  const [workers, setWorkers] = useState('3')
  const [browser, setBrowser] = useState(() => preference('shoptaikhoan.webLoginBrowser', ''))
  const [linkEnabled, setLinkEnabled] = useState(() => preference('shoptaikhoan.webLoginLinkEnabled', 'true') !== 'false')
  const [link, setLink] = useState('https://chatgpt.com/api/auth/session')
  const [options, setOptions] = useState(null)
  const [validation, setValidation] = useState(null)
  const action = useBrowserAction()
  const accounts = useMemo(() => parseAccounts(text), [text])
  const retained = Boolean(state.running || state.webReady || state.paused)
  const canFocus = state.browserControls === true && retained && Boolean(state.webSessions || state.done)
  const choices = browsers.data?.browsers || []
  const chosenBrowser = choices.some((item) => item.id === browser) ? browser : choices.some((item) => item.id === 'brave') ? 'brave' : 'auto'
  const blocked = Boolean(state.blockedBy)
  function validate() {
    const lines = text.split('\n').map(normalizeAccountLine).filter((line) => line && !line.startsWith('#'))
    if (!accounts.length || codex && (lines.length > 50 || lines.some((line) => { const parts = line.split('|'); return parts.length < 2 || parts.length > 3 || !parts[0].includes('@') || !parts[1].trim() }))) return 'Nhập tài khoản hợp lệ theo dạng email|password|2fa, tối đa 50 dòng cho Codex.'
    if (!Number.isInteger(Number(workers)) || Number(workers) < 1 || codex && Number(workers) > 10) return codex ? 'Số luồng Codex phải là số nguyên từ 1 đến 10.' : 'Số cửa sổ phải là số nguyên lớn hơn 0.'
    if (!codex && linkEnabled && link.trim()) { try { if (!['http:', 'https:'].includes(new URL(link.trim()).protocol)) throw new Error() } catch { return 'Link phải bắt đầu bằng http:// hoặc https://.' } }
    return null
  }
  async function start(settings) {
    setOptions(null)
    await action.run(`${base}/start`, { accounts: accounts.map((account) => account.raw), workers: Number(workers), ...(!codex ? { browser: chosenBrowser, openLinkEnabled: linkEnabled, linkUrl: linkEnabled ? link.trim() : '', ...settings } : {}) })
  }
  function prepare() {
    const error = validate()
    setValidation(error ? { text: error, error: true } : null)
    if (error) return
    if (codex) { start(); return }
    setOptions({ mobileEnabled: true, reloadEnabled: isK12Invite(linkEnabled, link.trim()), reloadSeconds: 10 })
  }
  const percent = Math.min(100, state.total ? Math.round(((state.done || 0) + (state.failed || 0)) / state.total * 100) : 0)
  return <div className="bw-columns bw-login"><div className="bw-control-column">
    <Panel icon={SlidersHorizontal} className="bw-login-form" title={codex ? 'Đăng nhập Codex' : 'Đăng nhập ChatGPT Web'} description={codex ? 'Xác thực OAuth Codex rồi giữ tab để bạn thao tác. Không import 9Router.' : 'Mỗi tài khoản mở trong cửa sổ ẩn danh riêng và được giữ sau đăng nhập.'}>
      <div className="bw-login-settings">
      {!codex && <label className="bw-field"><span>Trình duyệt</span><select value={chosenBrowser} disabled={!choices.length || action.busy || retained} onChange={(event) => { setBrowser(event.target.value); savePreference('shoptaikhoan.webLoginBrowser', event.target.value) }}>{choices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{!choices.length && <option value="auto">Đang tải trình duyệt…</option>}</select></label>}
      <label className="bw-field"><span>{codex ? 'Số luồng' : 'Số cửa sổ song song'}</span><input type="number" min="1" max={codex ? 10 : undefined} step="1" value={workers} onChange={(event) => setWorkers(event.target.value)} /></label>
      </div>
      {!codex && <QueryError query={browsers} />}
      <AccountInput id={codex ? 'react-codex-accounts' : 'react-web-accounts'} value={text} onChange={setText} />
      {!codex && <div className="bw-link-setting"><div className="bw-link-heading"><Toggle checked={linkEnabled} onChange={(value) => { setLinkEnabled(value); savePreference('shoptaikhoan.webLoginLinkEnabled', String(value)) }}>Mở URL sau khi đăng nhập</Toggle><Toggle checked disabled>Tự động thử lại</Toggle></div><label className="bw-field"><span className="bw-sr-only">URL sau khi đăng nhập</span><input type="url" value={link} disabled={!linkEnabled} onChange={(event) => setLink(event.target.value)} /></label><p className="bw-help">{linkEnabled ? 'Mở URL trong tab phụ dùng chung phiên đăng nhập.' : 'Chỉ mở ChatGPT, không tạo tab phụ.'}</p></div>}
      <Stats values={[["Tài khoản", accounts.length], ["Có 2FA", accounts.filter((account) => account.totp).length], ["Thành công", state.done || 0], [codex ? 'Lỗi' : 'Thử lại', codex ? state.failed || 0 : state.retries || 0]]} />
      <div className="bw-actions bw-login-actions"><Button disabled={!online || status.isPending || status.isError || retained || blocked || action.busy || !codex && !choices.length} onClick={prepare}><Play />{action.busy ? 'Đang xử lý…' : codex ? 'Đăng nhập Codex' : 'Bắt đầu chạy'}</Button>
        {!codex && state.running && !state.completed && <Button variant="outline" disabled={action.busy} onClick={() => action.run(`${base}/${state.paused ? 'resume' : 'pause'}`)}>{state.paused ? <Play /> : <Pause />}{state.paused ? 'Tiếp tục' : 'Tạm dừng'}</Button>}
        {retained && <Button variant="destructive" disabled={action.busy} onClick={async () => { if (await confirm({ title: 'Hủy phiên hiện tại?', description: `Hủy phiên ${codex ? 'Codex' : 'ChatGPT'} Web và đóng cửa sổ của phiên này?`, confirmText: 'Hủy phiên', destructive: true })) action.run(`${base}/stop`, codex ? { runId: state.runId } : undefined) }}><Square />Hủy phiên hiện tại</Button>}
      </div>
      {blocked && <Notice message={{ error: true, text: `Đang có phiên ${state.blockedBy === 'codex' ? 'Codex Web' : 'ChatGPT Web'} mở. Hãy kết thúc phiên đó trước khi chạy.` }} />}
      {state.interrupted && <Notice message={{ error: true, text: 'Phiên trước bị gián đoạn. Log và kết quả được giữ để bạn kiểm tra.' }} />}
      {retained && <p className="bw-help">{state.webReady || state.completed ? 'Luồng đã xử lý xong; cửa sổ đang được giữ mở cho bạn thao tác.' : state.paused ? 'Luồng đang tạm dừng.' : 'Đang đăng nhập các tài khoản trong hàng đợi.'}</p>}
      <QueryError query={status} /><Notice message={validation} />
    </Panel>
  </div><div className="bw-output-column">
    <Panel icon={Activity} className="bw-progress-panel" title="Tiến độ & kết quả" action={<Button variant="ghost" size="icon" aria-label="Cập nhật tiến độ" onClick={() => status.refetch()} disabled={status.isFetching}><RefreshCw size={16} /></Button>}>
      <div className="bw-progress-label"><span>{state.done || 0}/{state.total || 0} thành công · {state.queued || 0} chờ · {state.failed || 0} lỗi</span><strong>{percent}%</strong></div><progress max="100" value={percent} aria-label="Tiến độ đăng nhập" />
      {state.activeAccounts?.length > 0 && <p className="bw-active">Đang chạy: {state.activeAccounts.join(' • ')}</p>}
      {!codex && canFocus && <div className="bw-actions"><Button variant="outline" size="sm" disabled={action.busy} onClick={() => action.run(`${base}/show`)}><FolderOpen />Mở các tab đang chạy</Button><Button variant="outline" size="sm" disabled={action.busy} onClick={() => action.run(`${base}/rearrange`)}>Sắp xếp lại tab</Button></div>}
      <Results codex={codex} results={state.results} canFocus={codex ? retained : canFocus} busy={action.busy} onFocus={(index) => action.run(`${base}/focus`, { index, ...(codex ? { runId: state.runId } : {}) })} />
    </Panel><Logs logs={state.logs} running={state.running} />
  </div>{options && <BrowserDialog title="Tùy chọn trước khi chạy" onClose={() => setOptions(null)}><form onSubmit={(event) => { event.preventDefault(); start(options) }}><Toggle checked={options.mobileEnabled} onChange={(value) => setOptions({ ...options, mobileEnabled: value })}>Mobile (DevTools)</Toggle><p className="bw-help">Mở chế độ mobile cho từng cửa sổ. Mặc định bật ở mỗi lần chạy.</p><Toggle checked={options.reloadEnabled} onChange={(value) => setOptions({ ...options, reloadEnabled: value })}>Reload tab chính sau đăng nhập</Toggle><label className="bw-field"><span>Thời gian chờ (giây)</span><input type="number" min="1" max="3600" step="1" required={options.reloadEnabled} disabled={!options.reloadEnabled} value={options.reloadSeconds} onChange={(event) => setOptions({ ...options, reloadSeconds: Number(event.target.value) })} /></label><p className="bw-help">{isK12Invite(linkEnabled, link.trim()) ? 'Link K12 invite: mặc định reload 10 giây và mobile. Có thể chỉnh trước khi chạy.' : 'Reload mặc định tắt, chỉ áp dụng cho lần chạy này.'}</p><div className="bw-dialog-actions"><Button type="button" variant="outline" onClick={() => setOptions(null)}>Hủy</Button><Button type="submit"><Play />Bắt đầu chạy</Button></div></form></BrowserDialog>}</div>
}
function OAuthHistory({ results, clock, currentTimer, startedAt }) {
  const [history, setHistory] = useState({ source: null, entries: new Map() })
  if (results && history.source !== results) {
    const entries = new Map(history.entries)
    const latest = new Map(results.filter((result) => result.email && ['success', 'error'].includes(result.status)).map((result) => [result.email, result]))
    for (const result of latest.values()) {
      const previous = entries.get(result.email)
      if (previous?.result === result) continue
      const start = result.email === currentTimer.email ? currentTimer.at : startedAt
      entries.set(result.email, { result, time: start ? duration(clock - start) : formatDate(clock) })
    }
    setHistory({ source: results, entries })
  }
  return <div className="bw-results">{history.entries.size ? [...history.entries.values()].map(({ result, time }) => <div className={`bw-result ${result.status === 'success' ? 'bw-success' : 'bw-failed'}`} key={result.email}>{result.status === 'success' ? <CircleCheck size={17} /> : <CircleAlert size={17} />}<div><strong>{result.email}</strong><p>{result.status === 'error' ? result.error || 'Login lỗi' : `${result.plan || 'free'} · Refresh token: ${result.hasRefresh ? 'Có' : 'Không'}`}</p></div><time>{time}</time></div>) : <p className="bw-empty">Chưa có lịch sử login phiên này.</p>}</div>
}
function OAuthLogin({ online, isActive }) {
  const client = useQueryClient()
  const [mode, setMode] = useState('auto')
  const [text, setText] = useState('')
  const [workers, setWorkers] = useState('3')
  const [headless, setHeadless] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [currentTimer, setCurrentTimer] = useState({ email: '', at: 0 })
  const [clock, setClock] = useState(Date.now)
  const [autoClock, setAutoClock] = useState(0)
  const [manualDeadline, setManualDeadline] = useState(0)
  const [manualRun, setManualRun] = useState(0)
  const [validation, setValidation] = useState(null)
  const action = useBrowserAction()
  const status = useBrowserQuery('/api/oauth/auto-status', { interval: 1000, isActive: isActive && mode === 'auto', keepRunning: true })
  const manual = useQuery({ queryKey: [...queryKey('/api/oauth/status'), manualRun], queryFn: ({ signal }) => request('/api/oauth/status', { signal }), enabled: (query) => manualDeadline > clock && !action.busy && !['success', 'error'].includes(query.state.data?.status), retry: false, refetchInterval: 1000, refetchOnWindowFocus: false, gcTime: 0 })
  const state = status.data || {}
  const accounts = useMemo(() => parseAccounts(text), [text])
  const manualWaiting = manualDeadline > clock && !['success', 'error'].includes(manual.data?.status)
  useEffect(() => { if (!state.running && !manualWaiting) return; const id = setInterval(() => { const now = Date.now(); setClock(now); if (state.running) setAutoClock(now) }, 1000); return () => clearInterval(id) }, [state.running, manualWaiting])
  if ((state.currentEmail || '') !== currentTimer.email) setCurrentTimer({ email: state.currentEmail || '', at: clock })
  const manualResult = manual.data
  useEffect(() => {
    if ((!state.running && state.done > 0) || manualResult?.status === 'success') client.invalidateQueries({ queryKey: queryKey('/api/connections') })
  }, [client, state.running, state.done, manualResult?.status, manualRun])
  const finished = (state.done || 0) + (state.failed || 0)
  async function startAuto() {
    if (!accounts.length || !Number.isInteger(Number(workers)) || Number(workers) < 1) { setValidation({ error: true, text: 'Nhập tài khoản hợp lệ và số luồng là số nguyên lớn hơn 0.' }); return }
    setValidation(null)
    const now = Date.now(); setStartedAt(now); setAutoClock(now); setClock(now)
    await action.run('/api/oauth/auto-login', { accounts: accounts.map((account) => account.raw), headless, workers: Number(workers) })
  }
  async function startManual() {
    setValidation(null)
    setManualDeadline(0)
    setManualRun((value) => value + 1)
    const result = await action.run('/api/oauth/start')
    if (result) { setClock(Date.now()); setManualDeadline(Date.now() + 120000) }
  }
  return <div className="bw-columns"><Panel title="OAuth Login" description="Đăng nhập và import tài khoản vào 9router.">
    <div className="bw-subtabs" role="group" aria-label="Chế độ OAuth"><Button variant={mode === 'auto' ? 'secondary' : 'ghost'} onClick={() => setMode('auto')}>Auto Login</Button><Button variant={mode === 'manual' ? 'secondary' : 'ghost'} onClick={() => setMode('manual')}>Login thủ công</Button></div>
    <div hidden={mode !== 'auto'}><AccountInput id="react-oauth-accounts" value={text} onChange={setText} /><div className="bw-worker-row"><label className="bw-field"><span>Số luồng song song</span><input type="number" min="1" step="1" value={workers} onChange={(event) => setWorkers(event.target.value)} /></label><Toggle checked={headless} onChange={setHeadless}>Ẩn Chrome</Toggle></div>
      <Stats values={[["Tài khoản", accounts.length], ["Có 2FA", accounts.filter((account) => account.totp).length], ["Thành công", state.done || 0], ["Lỗi", state.failed || 0]]} />
      <div className="bw-actions"><Button onClick={startAuto} disabled={!online || state.running || status.isPending || status.isError || action.busy}><Play />Auto Login tất cả</Button>{state.running && <Button variant="destructive" disabled={action.busy} onClick={() => action.run('/api/oauth/auto-stop', undefined, undefined, 'Đã gửi lệnh dừng auto login.')}><Square />Dừng</Button>}</div><QueryError query={status} />
    </div>
    <div hidden={mode !== 'manual'}><p className="bw-help">Trình duyệt mở trang OpenAI. Đăng nhập xong, kết quả sẽ tự hiển thị ở đây.</p><Button disabled={!online || manualWaiting || action.busy} onClick={startManual}><LogIn />{manualWaiting ? 'Đang chờ đăng nhập…' : 'Login ChatGPT (OAuth)'}</Button>
      {manualDeadline > 0 && <div className="bw-manual-result" role="status">{manualResult?.status === 'success' ? <><strong>{manualResult.email}</strong><p>{manualResult.plan || 'free'} · Refresh token: {manualResult.hasRefresh ? 'Có' : 'Không'}</p><p>Thêm mới: {manualResult.inserted || 0} · Ghi đè: {manualResult.replaced || 0}</p></> : manualResult?.status === 'error' ? manualResult.error || 'Login thất bại' : manualWaiting ? 'Đang chờ đăng nhập trên trình duyệt…' : 'Hết thời gian chờ. Bấm Login lại để thử.'}</div>}
      <QueryError query={manual} />
    </div><Notice message={validation} />
  </Panel><div className="bw-output-column"><Panel title="Tiến độ OAuth"><div className="bw-progress-label"><span>{finished}/{state.total || 0} · {state.workersRunning || 0}/{state.workersRequested || 0} luồng {state.mode ? `· ${state.mode}` : ''}</span><strong>{startedAt ? duration(autoClock - startedAt) : '00:00'}</strong></div><progress max={state.total || 1} value={finished} aria-label="Tiến độ OAuth" />{state.currentEmail && <p className="bw-active">{state.currentEmail} · {currentTimer.at && state.running ? duration(clock - currentTimer.at) : '—'}</p>}{state.activeAccounts?.length > 0 && <p className="bw-help">Đang chạy: {state.activeAccounts.join(' • ')}</p>}{state.stopped && <p className="bw-help">Đã dừng auto login.</p>}
      <OAuthHistory results={state.results} clock={clock} currentTimer={currentTimer} startedAt={startedAt} />
    </Panel></div></div>
}
function ConnectionTable({ connections, entries, onDelete, deleting = false }) {
  return <div className="bw-table-wrap"><table><thead><tr><th>#</th><th>Email</th><th>Plan</th><th>Hết hạn</th>{entries && <th>Nguồn</th>}{onDelete && <><th>Trạng thái</th><th><span className="bw-sr-only">Thao tác</span></th></>}</tr></thead><tbody>{connections.length ? connections.map((connection, index) => {
    const data = onDelete ? connection.data || {} : connection
    return <tr key={`${connection.id || connection.email || index}-${index}`}><td>{onDelete ? connection.priority || index + 1 : index + 1}</td><td className="bw-email-cell">{String(connection.email || connection.name || '—')}</td><td>{String(data._plan || data.providerSpecificData?.chatgptPlanType || '—')}</td><td>{formatDate(data._expires || data.expiresAt)}</td>{entries && <td>{entries[index]?.source || '—'}</td>}{onDelete && <><td>{data.testStatus || 'unknown'}</td><td><Button size="icon-sm" variant="ghost" aria-label={`Xóa ${connection.email || 'tài khoản'}`} disabled={deleting} onClick={() => onDelete(connection.id)}><Trash2 /></Button></td></>}</tr>
  }) : <tr><td colSpan={4 + (entries ? 1 : 0) + (onDelete ? 2 : 0)} className="bw-empty">Chưa có tài khoản.</td></tr>}</tbody></table></div>
}
function Accounts({ online, active }) {
  const confirm = useConfirm()
  const query = useBrowserQuery('/api/connections', { enabled: online && active })
  const action = useBrowserAction()
  const connections = query.data?.connections || []
  return <Panel title="Codex accounts trong 9router" description={`${connections.length} tài khoản · SQLite database`} action={<Button variant="outline" disabled={!online || query.isFetching} onClick={() => query.refetch()}><RefreshCw />Refresh</Button>}>
    {query.isPending ? <p className="bw-empty">{online ? 'Đang tải…' : 'Server offline'}</p> : <ConnectionTable connections={connections} deleting={action.busy} onDelete={async (id) => { if (await confirm({ title: 'Xóa tài khoản này?', description: 'Tài khoản sẽ bị xóa khỏi 9router.', confirmText: 'Xóa tài khoản', destructive: true })) action.run(`/api/connections/${encodeURIComponent(id)}`, undefined, 'DELETE', 'Đã xóa tài khoản.') }} />}<QueryError query={query} />
  </Panel>
}
function importMessage(data) {
  const errors = Array.isArray(data.errors) ? data.errors.length : 0
  return `Import thành công: ${data.inserted || 0} thêm mới, ${data.replaced || 0} ghi đè.${errors ? ` Có ${errors} mục lỗi; hãy kiểm tra tài khoản hiện có.` : ''}`
}
function downloadConnections(connections) {
  const data = { settings: { cloudEnabled: false, tunnelEnabled: false, tunnelUrl: '', stickyRoundRobinLimit: 3, providerStrategies: {}, comboStrategy: 'fallback', requireLogin: false, rtkEnabled: true }, providerConnections: connections.map((connection, index) => { const item = { ...connection, priority: index + 1 }; delete item._plan; delete item._expires; return item }) }
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${(connections[0]?.email || 'session').replace(/[^a-z0-9@._-]/gi, '')}.9router.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function SessionImport({ online }) {
  const [text, setText] = useState('')
  const action = useBrowserAction()
  const accounts = useBrowserQuery('/api/connections', { enabled: online })
  const parsed = useMemo(() => { if (!text.trim()) return { connections: [], error: '' }; try { const connections = collectSessions(JSON.parse(text)); return { connections, error: connections.length ? '' : 'Không tìm thấy session trong JSON.' } } catch { return { connections: [], error: 'JSON không hợp lệ.' } } }, [text])
  const existing = new Set((accounts.data?.connections || []).map((connection) => (connection.email || '').trim().toLowerCase()))
  return <div className="bw-import"><Panel title="Dán Session ChatGPT" description="Hỗ trợ một hoặc nhiều session và JSON lồng nhau." action={<Button variant="ghost" onClick={() => setText('')}>Xóa</Button>}><p className="bw-info">Đăng nhập ChatGPT → mở <a href="https://chatgpt.com/api/auth/session" target="_blank" rel="noreferrer">chatgpt.com/api/auth/session</a> → copy JSON → dán vào đây.</p><label className="bw-field"><span>Session JSON</span><textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} autoComplete="off" placeholder="Dán JSON session ở đây…" /></label></Panel><Stats values={[["Đã parse", parsed.connections.length], ["Đã có (sẽ update)", parsed.connections.filter((connection) => existing.has(connection.email.trim().toLowerCase())).length], ["Lỗi", parsed.error ? 1 : 0]]} /><ConnectionTable connections={parsed.connections} />{parsed.error && <Notice message={{ error: true, text: parsed.error }} />}<div className="bw-actions"><Button disabled={!online || !parsed.connections.length || action.busy} onClick={() => action.run('/api/import', { connections: parsed.connections }, 'POST', importMessage)}><Upload />{action.busy ? 'Đang import…' : 'Import vào 9router'}</Button><Button variant="outline" disabled={!parsed.connections.length} onClick={() => downloadConnections(parsed.connections)}><Download />Tải xuống JSON</Button></div></div>
}
function FileImport({ online }) {
  const [files, setFiles] = useState([])
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef(null)
  const readingRef = useRef(false)
  const action = useBrowserAction()
  const entries = useMemo(() => files.flatMap((file) => file.entries), [files])
  const unique = useMemo(() => deduplicateEntries(entries), [entries])
  async function handleFiles(list) {
    if (readingRef.current || action.busy) return
    readingRef.current = true; setReading(true)
    try {
      const results = await Promise.all(Array.from(list).map(async (file) => {
        try { const found = parseFileContent(JSON.parse(await file.text()), file.name); return { name: file.name, entries: found, error: found.length ? '' : 'Không tìm thấy account' } }
        catch { return { name: file.name, entries: [], error: 'Không đọc được JSON hợp lệ' } }
      }))
      setFiles((previous) => [...previous, ...results])
    } finally { readingRef.current = false; setReading(false); if (fileInput.current) fileInput.current.value = '' }
  }
  return <div className="bw-import"><Panel title="Import từ file JSON" description="Chọn nhiều file session ChatGPT hoặc backup 9router."><input className="bw-sr-only" ref={fileInput} type="file" multiple accept=".json,application/json" aria-label="Chọn file JSON" onChange={(event) => handleFiles(event.target.files)} disabled={reading || action.busy} /><button className={`bw-drop-zone ${dragging ? 'bw-dragging' : ''}`} type="button" disabled={reading || action.busy} onClick={() => fileInput.current.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFiles(event.dataTransfer.files) }}><FileJson size={26} /><strong>{reading ? 'Đang đọc file…' : 'Kéo thả hoặc bấm để chọn file JSON'}</strong><span>Có thể chọn nhiều file</span></button>
      {files.length > 0 && <><Stats values={[["File đã chọn", files.length], ["Tổng accounts", entries.length], ["File lỗi", files.filter((file) => file.error).length]]} /><div className="bw-file-list">{files.map((file, index) => <div key={`${file.name}-${index}`}><FileJson size={16} /><strong>{file.name}</strong><span className={file.error ? 'bw-error-text' : ''}>{file.error || `${file.entries.length} account · ${file.entries[0]?.type}`}</span></div>)}</div></>}
    </Panel><ConnectionTable connections={unique.map((entry) => entry.conn)} entries={unique} />{entries.length > unique.length && <p className="bw-help">{entries.length - unique.length} tài khoản trùng email đã gộp, giữ bản cuối.</p>}<div className="bw-actions"><Button disabled={!online || !unique.length || reading || action.busy} onClick={() => action.run('/api/import', { connections: unique.map((entry) => entry.conn) }, 'POST', importMessage)}><Upload />{action.busy ? 'Đang import…' : `Import ${unique.length || ''} vào 9router`}</Button><Button variant="outline" disabled={!files.length || reading || action.busy} onClick={() => setFiles([])}><Trash2 />Xóa tất cả</Button></div></div>
}
function HistoryDialog({ onClose }) {
  const confirm = useConfirm()
  const query = useBrowserQuery('/api/web-login/history')
  const action = useBrowserAction()
  const history = query.data?.history || []
  return <BrowserDialog title="Lịch sử tài khoản" onClose={onClose}><div className="bw-dialog-content"><div className="bw-progress-label"><span>{history.length} bản ghi</span><Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw />Cập nhật</Button></div><QueryError query={query} /><div className="bw-history">{query.isPending ? <p className="bw-empty">Đang tải lịch sử…</p> : history.length ? history.slice(0, 200).map((item, index) => <div className="bw-history-row" key={`${item.email}-${index}`}><div><strong>{item.email}</strong><p>{item.status === 'success' ? flowErrors[item.postLoginError] || verificationLabel(item) : item.error || 'Lỗi'} · {item.durationSeconds ? `${item.durationSeconds}s` : '—'}</p></div><time>{formatDate(item.finishedAt || item.startedAt)}</time></div>) : <p className="bw-empty">Chưa có lịch sử.</p>}</div></div><div className="bw-dialog-actions"><Button variant="destructive" disabled={!history.length || action.busy} onClick={async () => { if (await confirm({ title: 'Xóa lịch sử đăng nhập?', description: 'Xóa toàn bộ lịch sử đăng nhập web?', confirmText: 'Xóa lịch sử', destructive: true })) action.run('/api/web-login/history', undefined, 'DELETE', 'Đã xóa lịch sử.') }}><Trash2 />Xóa lịch sử</Button><Button variant="outline" onClick={onClose}>Đóng</Button></div></BrowserDialog>
}
export default function BrowserWorkspace({ isActive = true }) {
  const [tab, setTab] = useState('web-login')
  const [history, setHistory] = useState(false)
  const health = useBrowserQuery('/api/health', { interval: 5000, isActive })
  const online = health.data?.ok === true && !health.isError
  return <div className="browser-workspace"><div className="bw-heading"><div><h1>Browser Login</h1><p>Đăng nhập, quản lý phiên và import tài khoản.</p></div><div className="bw-heading-actions"><span className={`bw-service ${online ? 'bw-service-online' : ''}`}>{health.isPending ? <LoaderCircle size={14} className="spin" /> : <span />}{health.isPending ? 'Đang kết nối…' : online ? 'Server sẵn sàng' : 'Server offline'}</span>{tab === 'web-login' && <Button variant="outline" size="sm" onClick={() => setHistory(true)}><History />Lịch sử tài khoản</Button>}<Button asChild variant="ghost" size="icon" aria-label="Mở Browser Login riêng"><a href="/#/workspace/browser" target="_blank" rel="noreferrer"><FolderOpen /></a></Button></div></div>
    <nav className="bw-tabs" aria-label="Chức năng Browser Login">{tabs.map(([key, title, Icon]) => <Button key={key} variant={tab === key ? 'secondary' : 'ghost'} aria-pressed={tab === key} onClick={() => setTab(key)}><Icon size={16} />{title}</Button>)}</nav>
    {!online && !health.isPending && <div className="bw-notice bw-error" role="alert">Không kết nối được Browser Login. Có thể dán session và tải JSON khi offline. <Button variant="link" size="sm" onClick={() => health.refetch()}>Kết nối lại</Button></div>}
    <section hidden={tab !== 'web-login'} aria-label="ChatGPT Web"><WebLogin online={online} isActive={isActive && tab === 'web-login'} /></section><section hidden={tab !== 'codex-web'} aria-label="Login Codex"><WebLogin codex online={online} isActive={isActive && tab === 'codex-web'} /></section><section hidden={tab !== 'oauth'} aria-label="OAuth Login"><OAuthLogin online={online} isActive={isActive && tab === 'oauth'} /></section><section hidden={tab !== 'import'} aria-label="Import Session"><SessionImport online={online} /></section><section hidden={tab !== 'accounts'} aria-label="Tài khoản hiện có"><Accounts online={online} active={isActive && tab === 'accounts'} /></section><section hidden={tab !== 'file'} aria-label="Import từ file"><FileImport online={online} /></section>
    {history && <HistoryDialog onClose={() => setHistory(false)} />}
  </div>
}
