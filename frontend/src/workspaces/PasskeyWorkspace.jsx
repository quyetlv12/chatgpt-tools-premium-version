import { useCallback, useEffect, useRef, useState } from 'react'
import { Fingerprint, Play, Square, Trash2, X } from 'lucide-react'
import { notify } from '@/lib/feedback'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { modulePath } from '@/lib/module-api'
import { accountLines, jobCanStop, validPasskeyLaunchPath } from './account-workspace-model'
import { AccountDraft, ConnectionLabel, JobLogsDialog, JobQueue, OutputCard } from './account-workspace-shared'
import { copyPrivateText, downloadPrivateText, usePrivateWorkspaceApi, useWorkspaceEvents } from './account-workspace-runtime'

function PasskeyWorkspaceSession({ token }) {
  const { request, isActive } = usePrivateWorkspaceApi(token)
  const [input, setInput] = useState('')
  const [jobs, setJobs] = useState([])
  const jobMap = useRef(new Map())
  const [output, setOutput] = useState('')
  const [loadError, setLoadError] = useState('')
  const [outputError, setOutputError] = useState(false)
  const [pending, setPending] = useState('')
  const pendingRef = useRef('')
  const [initialized, setInitialized] = useState(false)
  const [reload, setReload] = useState(0)
  const [logs, setLogs] = useState(null)
  const handoffs = useRef({ automatic: new Set(), launching: new Set(), opened: new Set(), paths: new Map() })
  const [handoffView, setHandoffView] = useState({ automaticCount: 0, launching: new Set(), opened: new Set(), paths: new Map() })
  const reportError = useCallback(error => { if (error.name !== 'AbortError') notify(error.message || 'Không thực hiện được thao tác passkey.', 'error') }, [])
  const paintHandoffs = useCallback(() => {
    const state = handoffs.current
    setHandoffView({ automaticCount: state.automatic.size, launching: new Set(state.launching), opened: new Set(state.opened), paths: new Map(state.paths) })
  }, [])
  const publishJobs = useCallback(map => { jobMap.current = map; setJobs([...map.values()]) }, [])
  const refreshOutput = useCallback(async signal => {
    const text = await request('/api/passkey/output', { signal })
    setOutput(typeof text === 'string' ? text : '')
    setOutputError(false)
  }, [request])

  async function openHandoff(id) {
    const state = handoffs.current
    const job = jobMap.current.get(id)
    if (!job || job.status !== 'success' || !job.handoff_ready || state.launching.has(id) || state.opened.has(id) || state.paths.has(id)) return
    state.launching.add(id)
    paintHandoffs()
    try {
      const data = await request(`/api/passkey/jobs/${encodeURIComponent(id)}/launch`, { method: 'POST', body: { confirm: 'LAUNCH_PASSKEY', native_window: true } })
      if (!validPasskeyLaunchPath(data.launch_path)) throw new Error('Liên kết passkey không hợp lệ.')
      if (handoffs.current !== state || !jobMap.current.has(id)) return
      if (data.opened === true) {
        state.opened.add(id)
        notify('Đã mở cửa sổ Chrome passkey. Hoàn tất đăng ký trên trang OpenAI.', 'info')
      } else {
        state.paths.set(id, data.launch_path)
        notify('Không khởi chạy được Chrome riêng. Hãy kiểm tra Google Chrome hoặc dùng liên kết dự phòng trong vòng 2 phút.', 'error')
      }
      await refreshOutput()
    } catch (error) { reportError(error) }
    finally {
      state.launching.delete(id)
      state.automatic.delete(id)
      if (isActive()) paintHandoffs()
    }
  }

  function settleAutomatic(job) {
    if (!handoffs.current.automatic.has(job.id)) return
    if (job.status === 'success' && job.handoff_ready) void openHandoff(job.id)
    else if (['error', 'cancelled'].includes(job.status)) { handoffs.current.automatic.delete(job.id); paintHandoffs() }
  }

  function forgetHandoff(id) {
    const state = handoffs.current
    state.automatic.delete(id)
    state.launching.delete(id)
    state.opened.delete(id)
    state.paths.delete(id)
    paintHandoffs()
  }

  function handleEvent(payload) {
    if (payload.type === 'snapshot' && Array.isArray(payload.jobs)) {
      publishJobs(new Map(payload.jobs.map(job => [job.id, job])))
      const ids = new Set(payload.jobs.map(job => job.id))
      for (const id of handoffs.current.automatic) if (!ids.has(id)) handoffs.current.automatic.delete(id)
      payload.jobs.forEach(settleAutomatic)
      paintHandoffs()
      void refreshOutput().catch(() => setOutputError(true))
    } else if (payload.type === 'job' && payload.job) {
      publishJobs(new Map(jobMap.current).set(payload.job.id, payload.job))
      settleAutomatic(payload.job)
    } else if (payload.type === 'removed') {
      const next = new Map(jobMap.current)
      next.delete(payload.id)
      publishJobs(next)
      forgetHandoff(payload.id)
    }
  }
  // Keep receiving ready jobs when native Chrome takes focus from the dashboard.
  const keepHidden = handoffView.automaticCount > 0
  const connection = useWorkspaceEvents('passkey', token, initialized, keepHidden, handleEvent)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoadError('')
      try {
        const data = await request('/api/passkey/bootstrap', { signal: controller.signal })
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
  async function submit(event) {
    event.preventDefault()
    if (!accountLines(input).length) { notify('Hãy nhập ít nhất một tài khoản.', 'error'); return }
    await run('submit', async () => {
      const data = await request('/api/passkey/jobs', { method: 'POST', body: { lines: accountLines(input) } })
      const next = new Map(jobMap.current)
      for (const job of data.jobs || []) { next.set(job.id, job); handoffs.current.automatic.add(job.id) }
      publishJobs(next)
      paintHandoffs()
      ;(data.jobs || []).forEach(settleAutomatic)
      notify(`Đã nạp ${(data.jobs || []).length} passkey job. Chrome sẽ tự mở khi từng tài khoản sẵn sàng.`)
    })
  }
  function jobAction(job, action) {
    if (action === 'logs') { setLogs(job); return }
    if (action === 'copy') { void copyPrivateText(job.email).then(() => notify('Đã copy email.')).catch(reportError); return }
    if (action === 'open') { void openHandoff(job.id); return }
    void run(`${action}:${job.id}`, async () => {
      if (action === 'delete') {
        await request(`/api/passkey/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' })
        const next = new Map(jobMap.current)
        next.delete(job.id)
        publishJobs(next)
        forgetHandoff(job.id)
        await refreshOutput()
      } else {
        const data = await request(`/api/passkey/jobs/${encodeURIComponent(job.id)}/${action}`, { method: 'POST' })
        publishJobs(new Map(jobMap.current).set(job.id, data.job))
        if (action === 'retry') {
          forgetHandoff(job.id)
          handoffs.current.automatic.add(job.id)
          paintHandoffs()
          settleAutomatic(data.job)
        }
      }
      notify(({ delete: 'Đã bỏ tài khoản khỏi danh sách.', stop: 'Đã gửi yêu cầu dừng.', retry: 'Đã gửi yêu cầu chạy lại.' })[action])
    })
  }
  function bulk(action) {
    void run(action, async () => {
      if (action === 'clear') {
        const data = await request('/api/passkey/jobs', { method: 'DELETE' })
        publishJobs(new Map())
        handoffs.current = { automatic: new Set(), launching: new Set(), opened: new Set(), paths: new Map() }
        paintHandoffs()
        await refreshOutput()
        notify(`Đã dọn ${data.deleted || 0} passkey job.`)
      } else if (action === 'stop-all') {
        const data = await request('/api/passkey/jobs/stop-all', { method: 'POST' })
        notify(data.stopped ? `Đã dừng ${data.stopped} passkey job.` : 'Không có passkey job đang chạy.')
      } else {
        const data = await request('/api/passkey/windows/close', { method: 'POST' })
        handoffs.current.opened.clear()
        paintHandoffs()
        notify(data.closed ? `Đã đóng ${data.closed} cửa sổ passkey.` : 'Không có cửa sổ passkey nào đang chạy.')
      }
    })
  }
  function handoffAction(job) {
    const state = handoffView
    if (state.opened.has(job.id)) return <small className="aw-ready">Đã mở cửa sổ</small>
    const path = state.paths.get(job.id)
    if (path) return <Button asChild variant="outline" size="sm"><a href={modulePath('twofa', path)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Fingerprint />Mở liên kết dự phòng</a></Button>
    if (job.handoff_ready) return <Button variant="outline" size="icon-sm" disabled={state.launching.has(job.id) || Boolean(pending)} aria-label={`Mở passkey ${job.email}`} onClick={() => jobAction(job, 'open')}><Fingerprint /></Button>
    return job.handoff_issued ? <small>Đã cấp liên kết</small> : null
  }
  const phaseLabel = job => handoffView.opened.has(job.id) ? 'ĐÃ MỞ CỬA SỔ' : job.handoff_issued ? 'ĐÃ CẤP LIÊN KẾT' : ({ queued: 'ĐANG CHỜ', authenticating: 'ĐANG ĐĂNG NHẬP', handoff_ready: 'CHỜ MỞ CỬA SỔ', error: 'LỖI', cancelled: 'ĐÃ DỪNG' })[job.phase] || String(job.phase || '').toUpperCase()
  async function exportOutput() {
    try {
      const text = await request('/api/passkey/output')
      if (typeof text !== 'string') throw new Error('Không tải được danh sách handoff.')
      setOutput(text)
      downloadPrivateText(text, 'passkey-handoffs.txt')
      notify('Đã xuất danh sách handoff Passkey.')
    } catch (error) { reportError(error) }
  }

  return <section className="aw-workspace" aria-labelledby="react-passkey-title">
    <header className="aw-heading"><div><h2 id="react-passkey-title"><Fingerprint />Thêm passkey hàng loạt</h2><p>Chuẩn bị đăng nhập và mở cửa sổ OpenAI cho từng tài khoản.</p></div><ConnectionLabel state={connection} /></header>
    <p className="aw-warning">Handoff đã cấp hoặc cửa sổ đã mở chưa có nghĩa là đã thêm passkey. Hãy hoàn tất xác thực trên trang OpenAI.</p>
    {loadError && <div className="aw-notice aw-notice-error" role="alert">{loadError} <Button variant="outline" onClick={() => setReload(value => value + 1)}>Kết nối lại</Button></div>}
    {outputError && <p className="aw-row-error" role="alert">Chưa tải được kết quả mới. <button onClick={() => void refreshOutput().catch(reportError)}>Thử lại</button></p>}
    <div className="aw-grid"><Card className="aw-card"><form onSubmit={submit}><AccountDraft id="react-passkey-input" value={input} onChange={setInput} /><Button type="submit" disabled={!initialized || Boolean(pending)} aria-busy={pending === 'submit'}><Play />{pending === 'submit' ? 'Đang nạp…' : 'Thêm passkey'}</Button></form></Card>
      <OutputCard title="Danh sách handoff đã tạo" output={output} unit="handoff đã cấp" onCopy={() => void copyPrivateText(output.trim()).then(() => notify('Đã copy danh sách handoff passkey.')).catch(reportError)} onDownload={exportOutput} />
    </div>
    <JobQueue jobs={jobs} kind="passkey" pending={pending} onAction={jobAction} phaseLabel={phaseLabel} phaseDetail={job => job.handoff_issued ? 'Hoàn tất thêm passkey trên tab OpenAI' : job.handoff_ready ? 'Handoff dùng một lần đã sẵn sàng' : 'Đang chuẩn bị'} handoff={handoffAction}>
      <Button variant="outline" size="sm" disabled={Boolean(pending) || !jobs.some(jobCanStop)} onClick={() => bulk('stop-all')}><Square />{pending === 'stop-all' ? 'Đang dừng…' : 'Dừng tất cả'}</Button>
      <Button variant="outline" size="sm" disabled={!initialized || Boolean(pending)} onClick={() => bulk('close-windows')}><X />{pending === 'close-windows' ? 'Đang đóng…' : 'Đóng tất cả cửa sổ'}</Button>
      <Button variant="outline" size="sm" disabled={!initialized || Boolean(pending)} onClick={() => bulk('clear')}><Trash2 />{pending === 'clear' ? 'Đang dọn…' : 'Dọn danh sách'}</Button>
    </JobQueue>
    {logs && <JobLogsDialog kind="passkey" job={logs} request={request} onClose={() => setLogs(null)} />}
  </section>
}

export default function PasskeyWorkspace(props) {
  return <PasskeyWorkspaceSession key={props.token} {...props} />
}
