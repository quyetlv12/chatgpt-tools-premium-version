import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, History, KeyRound, Play, Save, Trash2 } from 'lucide-react'
import { useConfirm } from '@/lib/use-confirm'
import { notify } from '@/lib/feedback'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { accountLines, passwordCredentialParts, passwordHistoryEntries, targetPasswordError } from './account-workspace-model'
import { AccountDraft, ConnectionLabel, JobLogsDialog, JobQueue, OutputCard, WorkspaceDialog } from './account-workspace-shared'
import { copyPrivateText, downloadPrivateText, usePrivateWorkspaceApi, useWorkspaceEvents } from './account-workspace-runtime'

const PHASES = { queued: 'ĐANG CHỜ', authenticating: 'ĐANG ĐĂNG NHẬP', mutation_started: 'ĐÃ BẮT ĐẦU MUTATION', recovery: 'ĐANG ĐỐI SOÁT', verified: 'ĐÃ VERIFY LOGIN', not_applied: 'CHƯA ÁP DỤNG', uncertain: 'CHƯA CHẮC CHẮN', error: 'LỖI', cancelled: 'ĐÃ DỪNG' }

function PasswordHistoryDialog({ request, onClose, reportError }) {
  const [history, setHistory] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const search = useRef(null)
  useEffect(() => {
    const controller = new AbortController()
    request('/api/password/history', { signal: controller.signal }).then(data => {
      setHistory(Array.isArray(data.history) ? data.history : [])
      setLoading(false)
      requestAnimationFrame(() => search.current?.focus())
    }).catch(error => { if (error.name !== 'AbortError') { setLoading(false); setFailed(true) } })
    return () => controller.abort()
  }, [request])
  const filtered = passwordHistoryEntries(history, query)
  function copy(text, message) { void copyPrivateText(text).then(() => notify(message)).catch(reportError) }
  return <WorkspaceDialog title={<><span className="tf-eyebrow tf-dialog-eyebrow">PASSWORD ARCHIVE</span><span className="tf-dialog-title-line">Lịch sử đổi mật khẩu</span></>} className="tf-twofa-modal tf-password-history-modal" onClose={onClose} wide>
    <p className="aw-history-description">Bản ghi đã xác minh, vẫn giữ khi dọn queue.</p>
    <div className="aw-history-tools"><label htmlFor="react-password-history-search">Tìm theo email</label><input id="react-password-history-search" ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm theo email…" disabled={loading} autoComplete="off" /><div className="aw-card-heading"><span className="aw-history-summary"><strong><span>{filtered.length}</span> kết quả</strong><small>{history.length} bản ghi{query.trim() ? ' tổng cộng' : ''}</small></span><Button variant="outline" size="sm" disabled={!filtered.length} onClick={() => copy(filtered.map(({ entry }) => String(entry.raw || '')).filter(Boolean).join('\n'), query.trim() ? `Đã copy ${filtered.length} kết quả đang hiển thị.` : 'Đã copy toàn bộ lịch sử đổi mật khẩu.')}><Copy />{query.trim() ? 'Copy kết quả' : 'Copy tất cả'}</Button></div></div>
    {loading ? <p className="aw-empty" role="status">Đang tải lịch sử…</p> : failed ? <p className="aw-row-error" role="alert">Không tải được lịch sử đổi mật khẩu.</p> : !filtered.length ? <div className="aw-empty"><strong>{history.length ? 'Không tìm thấy email' : 'Chưa có lịch sử'}</strong><p>{history.length ? 'Thử một từ khóa ngắn hơn hoặc kiểm tra lại chính tả.' : 'Bản ghi sẽ xuất hiện sau khi mật khẩu mới được xác minh bằng fresh login.'}</p></div> : <div className="aw-history-list">{filtered.map(({ entry, index }, visibleIndex) => {
      const parts = passwordCredentialParts(entry)
      const date = new Date(Number(entry.changed_at) * 1000)
      const validDate = !Number.isNaN(date.getTime())
      return <article className="aw-history-entry" key={index}><span className="aw-history-number">{String(visibleIndex + 1).padStart(2, '0')}</span><div className="aw-history-body"><header><strong>{parts.email}</strong><time dateTime={validDate ? date.toISOString() : undefined}>{validDate ? date.toLocaleString('vi-VN') : 'Không rõ thời gian'}</time></header><dl><div><dt>Mật khẩu mới</dt><dd><code>{parts.password || 'Không có dữ liệu'}</code></dd></div><div><dt>Khóa 2FA hiện tại</dt><dd><code>{parts.secret || 'Không có dữ liệu'}</code></dd></div></dl></div><Button variant="outline" size="sm" aria-label={`Copy bản ghi của ${parts.email}`} onClick={() => copy(String(entry.raw || ''), 'Đã copy bản ghi mật khẩu.')}><Copy />Copy</Button></article>
    })}</div>}
  </WorkspaceDialog>
}

function PasswordWorkspaceSession({ token, onClose }) {
  const { request, dispose, isActive } = usePrivateWorkspaceApi(token)
  const [input, setInput] = useState('')
  const [target, setTarget] = useState('')
  const [configured, setConfigured] = useState(false)
  const [jobs, setJobs] = useState([])
  const jobMap = useRef(new Map())
  const [output, setOutput] = useState('')
  const [pending, setPending] = useState('')
  const pendingRef = useRef('')
  const [initialized, setInitialized] = useState(false)
  const [reload, setReload] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [logs, setLogs] = useState(null)
  const confirm = useConfirm()
  const [loadError, setLoadError] = useState('')
  const [outputError, setOutputError] = useState(false)
  const reportError = useCallback(error => { if (error.name !== 'AbortError') notify(error.message || 'Không thực hiện được thao tác đổi mật khẩu.', 'error') }, [])
  const publishJobs = useCallback(map => { jobMap.current = map; setJobs([...map.values()]) }, [])
  const refreshOutput = useCallback(async signal => {
    const text = await request('/api/password/output', { signal })
    setOutput(typeof text === 'string' ? text : '')
    setOutputError(false)
  }, [request])
  function handleEvent(payload) {
    if (payload.type === 'snapshot' && Array.isArray(payload.jobs)) {
      publishJobs(new Map(payload.jobs.map(job => [job.id, job])))
      void refreshOutput().catch(() => setOutputError(true))
    } else if (payload.type === 'job' && payload.job) {
      const previous = jobMap.current.get(payload.job.id)
      publishJobs(new Map(jobMap.current).set(payload.job.id, payload.job))
      if (payload.job.status === 'success' && previous?.status !== 'success') void refreshOutput().catch(() => setOutputError(true))
    } else if (payload.type === 'removed') {
      const next = new Map(jobMap.current)
      next.delete(payload.id)
      publishJobs(next)
    }
  }
  const connection = useWorkspaceEvents('password', token, initialized, false, handleEvent)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoadError('')
      try {
        const data = await request('/api/password/bootstrap', { signal: controller.signal })
        setConfigured(Boolean(data.configured))
        setTarget(typeof data.target_password === 'string' ? data.target_password : '')
        publishJobs(new Map((data.jobs || []).map(job => [job.id, job])))
        await refreshOutput(controller.signal)
        if (!controller.signal.aborted) setInitialized(true)
      } catch (error) { if (error.name !== 'AbortError') setLoadError('Không tải được workspace. Hãy kết nối lại.') }
    }
    void load()
    return () => controller.abort()
  }, [request, publishJobs, refreshOutput, reload])

  async function run(name, action) {
    if (pendingRef.current) return
    pendingRef.current = name
    setPending(name)
    try { await action() } catch (error) { reportError(error) }
    finally { pendingRef.current = ''; if (isActive()) setPending('') }
  }
  function saveTarget(event) {
    event.preventDefault()
    const error = targetPasswordError(target)
    if (error) { notify(error, 'error'); return }
    void run('save', async () => {
      const data = await request('/api/password-settings', { method: 'PUT', body: { target_password: target } })
      setConfigured(Boolean(data.configured))
      notify('Đã lưu mật khẩu chung cho các password job mới.')
    })
  }
  async function clearTarget() {
    if (!await confirm({ title: 'Xóa mật khẩu chung', description: 'Xóa mật khẩu chung đã cấu hình? Job đã enqueue vẫn giữ checkpoint riêng.', destructive: true })) return
    void run('clear-target', async () => {
      const data = await request('/api/password-settings', { method: 'DELETE' })
      setTarget('')
      setConfigured(Boolean(data.configured))
      notify('Đã xóa cấu hình mật khẩu chung.')
    })
  }
  function submit(event) {
    event.preventDefault()
    if (!configured) { notify('Hãy nhập và lưu mật khẩu chung trước khi chạy.', 'error'); return }
    if (!accountLines(input).length) { notify('Hãy nhập ít nhất một tài khoản.', 'error'); return }
    void run('submit', async () => {
      const data = await request('/api/password/jobs', { method: 'POST', body: { lines: accountLines(input) } })
      const next = new Map(jobMap.current)
      for (const job of data.jobs || []) next.set(job.id, job)
      publishJobs(next)
      notify(`Đã nạp ${(data.jobs || []).length} password job vào queue riêng.`)
    })
  }
  function jobAction(job, action) {
    if (action === 'logs') { setLogs(job); return }
    if (action === 'copy') { void copyPrivateText(job.email).then(() => notify('Đã copy email.')).catch(reportError); return }
    void run(`${action}:${job.id}`, async () => {
      if (action === 'delete') {
        await request(`/api/password/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' })
        const next = new Map(jobMap.current)
        next.delete(job.id)
        publishJobs(next)
        await refreshOutput()
      } else {
        const data = await request(`/api/password/jobs/${encodeURIComponent(job.id)}/${action}`, { method: 'POST' })
        publishJobs(new Map(jobMap.current).set(job.id, data.job))
      }
      notify(({ delete: 'Đã bỏ tài khoản khỏi danh sách.', stop: 'Đã gửi yêu cầu dừng.', retry: 'Đã gửi yêu cầu chạy lại.' })[action])
    })
  }
  async function clearJobs() {
    if (!await confirm({ title: 'Dọn danh sách đổi mật khẩu', description: 'Xóa các job khỏi danh sách xử lý. Lịch sử đã xác minh vẫn được lưu.', destructive: true })) return
    void run('clear', async () => {
      const data = await request('/api/password/jobs', { method: 'DELETE', timeout: 60000, timeoutMessage: 'Dọn password job quá lâu, hãy kiểm tra lại trạng thái rồi thử lại.' })
      publishJobs(new Map())
      await refreshOutput()
      notify(`Đã dọn ${data.deleted || 0} password job.`)
    })
  }
  async function exportOutput() {
    try {
      const text = await request('/api/password/output')
      if (typeof text !== 'string') throw new Error('Không tải được kết quả đổi mật khẩu.')
      setOutput(text)
      downloadPrivateText(text, 'password-success.txt')
      notify('Đã xuất kết quả đổi mật khẩu.')
    } catch (error) { reportError(error) }
  }
  function close() {
    dispose()
    setInitialized(false)
    setInput('')
    setTarget('')
    setOutput('')
    setHistoryOpen(false)
    setLogs(null)
    setLoadError('')
    onClose?.()
  }

  return <section className="aw-workspace aw-password-workspace" aria-labelledby="react-password-title">
    <header className="aw-heading"><div><span className="tf-eyebrow">PURE HTTP · WORKFLOW RIÊNG</span><h2 id="react-password-title"><KeyRound />Đổi mật khẩu hàng loạt</h2><p>Luồng này không đổi 2FA. Chỉ ghi thành công sau khi đăng nhập mới bằng mật khẩu đích.</p></div><div className="aw-buttons"><ConnectionLabel state={connection} />{onClose && <Button variant="outline" size="sm" onClick={close}><ArrowLeft />Quay lại</Button>}</div></header>
    {loadError && <div className="aw-notice aw-notice-error" role="alert">{loadError} <Button variant="outline" onClick={() => setReload(value => value + 1)}>Kết nối lại</Button></div>}
    {outputError && <p className="aw-row-error" role="alert">Chưa tải được kết quả mới. <button onClick={() => void refreshOutput().catch(reportError)}>Thử lại</button></p>}
    <Card className="aw-card aw-password-settings"><form onSubmit={saveTarget}><div className="aw-card-heading"><div><span className="tf-eyebrow">MẬT KHẨU ĐÍCH</span><strong>Mật khẩu chung cho job mới</strong></div><span className={configured ? 'aw-ready' : 'aw-muted'}>{configured ? 'ĐÃ CẤU HÌNH' : 'CHƯA CẤU HÌNH'}</span></div><p className="aw-help">Chỉnh sửa và lưu ngay tại đây. Job đã có trong queue vẫn giữ mật khẩu đã snapshot lúc nạp.</p><label htmlFor="react-target-password">Mật khẩu đang dùng</label><div className="aw-target-row"><input id="react-target-password" type="text" value={target} onChange={event => setTarget(event.target.value)} minLength={12} maxLength={128} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Tối thiểu 12 ký tự" /><Button type="submit" disabled={!initialized || Boolean(pending)}><Save />{pending === 'save' ? 'Đang lưu…' : 'Lưu thay đổi'}</Button><Button type="button" variant="outline" disabled={!configured || Boolean(pending)} onClick={clearTarget}><Trash2 />Xóa</Button></div><p className="aw-help">{configured ? 'Đang hiển thị mật khẩu chung đã lưu. Sửa trực tiếp rồi bấm Lưu để cập nhật.' : 'Chưa có mật khẩu chung. Hãy nhập và lưu trước khi chạy.'} Cấu hình chỉ áp dụng cho job mới.</p></form></Card>
    <div className="aw-grid"><Card className="aw-card"><form onSubmit={submit}><AccountDraft id="react-password-input" value={input} onChange={setInput} title="Tài khoản cần đổi" eyebrow="ĐẦU VÀO RIÊNG" placeholder="email@example.com|password hiện tại|TOTP secret" hint={<>Định dạng <code>email|password_hiện_tại|2FA_hiện_tại</code></>} /><Button type="submit" disabled={!initialized || !configured || Boolean(pending)} aria-busy={pending === 'submit'}><Play />{pending === 'submit' ? 'Đang nạp…' : 'Bắt đầu đổi mật khẩu'}</Button></form></Card><OutputCard title="Dữ liệu đã xác minh" eyebrow="VERIFIED OUTPUT" note={<>Output: <code>email|MẬT_KHẨU_CHUNG|2FA_hiện_tại</code></>} exportLabel="Xuất .txt" output={output} unit="tài khoản" onCopy={() => void copyPrivateText(output.trim()).then(() => notify('Đã copy verified password output.')).catch(reportError)} onDownload={exportOutput} /></div>
    <JobQueue jobs={jobs} kind="password" pending={pending} onAction={jobAction} phaseLabel={job => PHASES[job.phase] || String(job.phase || '').toUpperCase()} phaseDetail={job => job.login_verified ? 'Fresh login thành công' : job.mutation_started ? 'Không auto-resend' : 'Chưa mutation'}>
      <Button variant="outline" size="sm" disabled={!initialized} onClick={() => setHistoryOpen(true)}><History />Lịch sử</Button><Button variant="outline" size="sm" disabled={!initialized || Boolean(pending)} onClick={clearJobs} aria-busy={pending === 'clear'}><Trash2 />{pending === 'clear' ? 'Đang dọn…' : 'Dọn danh sách'}</Button>
    </JobQueue>
    {logs && <JobLogsDialog kind="password" job={logs} request={request} onClose={() => setLogs(null)} />}
    {historyOpen && <PasswordHistoryDialog request={request} onClose={() => setHistoryOpen(false)} reportError={reportError} />}
  </section>
}

export default function PasswordWorkspace(props) {
  return <PasswordWorkspaceSession key={props.token} {...props} />
}
