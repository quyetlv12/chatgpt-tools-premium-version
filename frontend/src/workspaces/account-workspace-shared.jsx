import { useEffect, useRef, useState } from 'react'
import { Copy, Download, List, RefreshCw, Square, Trash2 } from 'lucide-react'
import { AppDialog } from '@/components/ui/app-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { accountLines, jobCanDelete, jobCanRetry, jobCanStop, normalizeAccountPaste } from './account-workspace-model'
import './account-workspaces.css'

export function ConnectionLabel({ state }) {
  return <span className={`aw-connection aw-${state}`} role="status">{({ connecting: 'Đang kết nối…', connected: 'Đang cập nhật trực tiếp', reconnecting: 'Đang kết nối lại…', paused: 'Tạm dừng cập nhật khi ẩn' })[state] || state}</span>
}

export function AccountDraft({ id, value, onChange, title = 'Danh sách tài khoản', eyebrow, hint = 'Mỗi dòng: email|password_hiện_tại|2FA_hiện_tại', placeholder = 'email|password|2FA' }) {
  const ref = useRef(null)
  function paste(event) {
    const text = event.clipboardData.getData('text/plain')
    const normalized = normalizeAccountPaste(text)
    if (normalized === text) return
    event.preventDefault()
    const start = event.currentTarget.selectionStart
    const end = event.currentTarget.selectionEnd
    onChange(value.slice(0, start) + normalized + value.slice(end))
    requestAnimationFrame(() => ref.current?.setSelectionRange(start + normalized.length, start + normalized.length))
  }
  return <div className="aw-draft">
    <div className="aw-field-heading">{eyebrow ? <div><span className="tf-eyebrow">{eyebrow}</span><label htmlFor={id}>{title}</label></div> : <label htmlFor={id}>{title}</label>}<span>{accountLines(value).length} bản ghi</span></div>
    <p className="aw-help">{hint}</p>
    <textarea id={id} ref={ref} value={value} onChange={event => onChange(event.target.value)} onPaste={paste} rows={9} placeholder={placeholder} autoComplete="off" spellCheck={false} autoCapitalize="off" />
  </div>
}

export function OutputCard({ title, output, unit, onCopy, onDownload, eyebrow, note, exportLabel = 'Xuất TXT' }) {
  const count = accountLines(output).length
  return <Card className="aw-card aw-output"><div className="aw-card-heading">{eyebrow ? <div><span className="tf-eyebrow">{eyebrow}</span><h3>{title}</h3></div> : <h3>{title}</h3>}<span>{count} {unit}</span></div>
    {note && <p className="aw-help aw-output-note">{note}</p>}
    <textarea readOnly aria-label={title} value={output} rows={9} placeholder="Chưa có dữ liệu." spellCheck={false} />
    <div className="aw-buttons"><Button variant="outline" size="sm" disabled={!count} onClick={onCopy}><Copy />Copy</Button><Button variant="outline" size="sm" disabled={!count} onClick={onDownload}><Download />{exportLabel}</Button></div>
  </Card>
}

export function WorkspaceDialog({ title, children, onClose, wide = false, className = '' }) {
  return <AppDialog title={title} onClose={onClose} className={`aw-dialog${wide ? ' aw-dialog-wide' : ''} ${className}`}>{children}</AppDialog>
}

export function JobLogsDialog({ kind, job, request, onClose }) {
  const [content, setContent] = useState('Đang tải…')
  useEffect(() => {
    const controller = new AbortController()
    request(`/api/${kind}/jobs/${encodeURIComponent(job.id)}/logs`, { signal: controller.signal })
      .then(data => setContent(Array.isArray(data.logs) ? data.logs.join('\n') || 'Chưa có log.' : 'Chưa có log.'))
      .catch(error => { if (error.name !== 'AbortError') setContent('Không tải được log.') })
    return () => controller.abort()
  }, [kind, job.id, request])
  return <WorkspaceDialog title={kind === 'password' ? <><span className="tf-eyebrow tf-dialog-eyebrow">PASSWORD JOB LOG</span><span className="tf-dialog-title-line">{job.email || 'Password job'}</span></> : `Chi tiết — ${job.email || 'Tài khoản'}`} className={kind === 'password' ? 'tf-twofa-modal tf-password-logs-modal' : ''} onClose={onClose}><pre className="aw-logs">{content}</pre></WorkspaceDialog>
}

export function JobQueue({ jobs, kind, pending, onAction, phaseLabel, phaseDetail, handoff, children }) {
  const sorted = [...jobs].sort((a, b) => Number(a.created_at) - Number(b.created_at))
  return <Card className="aw-card aw-queue"><div className="aw-card-heading aw-queue-heading"><div>{kind === 'password' && <span className="tf-eyebrow">PASSWORD QUEUE</span>}<h3>{kind === 'password' ? 'Tiến trình độc lập' : 'Hàng đợi Passkey'}</h3><p className="aw-help">{jobs.length} tài khoản · Queue độc lập</p></div><div className="aw-buttons">{children}</div></div>
    {!sorted.length ? <p className="aw-empty">{kind === 'password' ? 'Chưa có password job.' : 'Chưa có tài khoản trong hàng đợi.'}</p> : <div className="aw-table-wrap"><table className="aw-table"><thead><tr><th scope="col">Tài khoản</th><th scope="col">Trạng thái</th><th scope="col">{kind === 'password' ? 'Checkpoint' : 'Tiến trình'}</th><th scope="col">Thao tác</th></tr></thead><tbody>{sorted.map(job => <tr key={job.id}>
      <td><div className="aw-email"><strong>{job.email}</strong><Button variant="ghost" size="icon-sm" aria-label={`Copy email ${job.email}`} onClick={() => onAction(job, 'copy')}><Copy /></Button></div><small>{String(job.id).slice(0, 10).toUpperCase()}</small></td>
      <td><span className={`aw-status aw-status-${job.status}`}>{({ queued: 'ĐANG CHỜ', running: 'ĐANG CHẠY', success: kind === 'passkey' ? 'SẴN SÀNG' : 'THÀNH CÔNG', error: 'LỖI', cancelled: 'ĐÃ DỪNG' })[job.status] || job.status}</span>{job.error && <small className="aw-row-error">{job.error}</small>}</td>
      <td><span className="aw-phase">{phaseLabel(job)}</span><small>{phaseDetail(job)}</small></td>
      <td><div className="aw-row-actions">{handoff?.(job)}<Button variant="outline" size="icon-sm" aria-label={`Xem log ${job.email}`} onClick={() => onAction(job, 'logs')}><List /></Button>
        {jobCanRetry(job) && <Button variant="outline" size="icon-sm" disabled={Boolean(pending)} aria-label={`Chạy lại ${job.email}`} onClick={() => onAction(job, 'retry')}><RefreshCw /></Button>}
        {jobCanStop(job) && <Button variant="outline" size="icon-sm" disabled={Boolean(pending)} aria-label={`Dừng ${job.email}`} onClick={() => onAction(job, 'stop')}><Square /></Button>}
        {jobCanDelete(job) && <Button variant="outline" size="icon-sm" disabled={Boolean(pending)} aria-label={`Xóa ${job.email}`} onClick={() => onAction(job, 'delete')}><Trash2 /></Button>}
      </div></td>
    </tr>)}</tbody></table></div>}
  </Card>
}
