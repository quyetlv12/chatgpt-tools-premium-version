import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CheckCheck, Copy, ListChecks, LoaderCircle, RefreshCw, ShieldCheck, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { notify } from '@/lib/feedback'
import { moduleRequest } from '@/lib/module-api'
import { backupProgress } from './export-backup-model'
import './export-backup.css'

const statusKey = ['react-chat-backup-status']
const historyKey = ['react-chat-backup-history']
const api = (path, options) => moduleRequest('chat-backup', path, options)

export default function BackupWorkspace({ isActive = true }) {
  const client = useQueryClient()
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [marker, setMarker] = useState('Đã lưu bản sao từ tài khoản nguồn.')
  const [limit, setLimit] = useState('0')
  const [cleanup, setCleanup] = useState(true)
  const [selection, setSelection] = useState({ runId: '', ids: [] })
  const [mutating, setMutating] = useState(false)
  const wasRunning = useRef(false)
  const initiatedRun = useRef(null)
  const status = useQuery({ queryKey: statusKey, queryFn: ({ signal }) => api('/api/status', { signal }), enabled: query => !mutating && (isActive || query.state.isInvalidated || query.state.status !== 'success' || Boolean(query.state.data?.running)), refetchInterval: 1500, retry: false })
  const state = status.data || {}
  const history = useQuery({ queryKey: historyKey, queryFn: ({ signal }) => api('/api/history', { signal }), retry: false })
  useEffect(() => {
    if (wasRunning.current && !state.running) client.invalidateQueries({ queryKey: historyKey })
    wasRunning.current = Boolean(state.running)
    if (!state.run_id || initiatedRun.current !== state.run_id || state.running || !['complete', 'empty', 'stopped', 'error'].includes(state.stage)) return
    initiatedRun.current = null
    notify(state.message || (state.stage === 'stopped' ? 'Đã dừng backup an toàn.' : state.stage === 'error' ? 'Backup chưa thành công; hãy kiểm tra checkpoint.' : 'Đã hoàn tất backup chat.'), state.stage === 'error' || state.failed > 0 ? 'error' : state.stage === 'stopped' || state.stage === 'empty' ? 'info' : 'success')
  }, [state.running, state.run_id, state.stage, state.message, state.failed, client])
  const catalog = useQuery({
    queryKey: ['react-chat-backup-conversations', state.run_id],
    queryFn: ({ signal }) => api('/api/conversations', { signal }),
    enabled: Boolean(state.run_id && state.running && state.stage === 'choosing'), retry: false,
  })
  const items = catalog.data?.run_id === state.run_id ? catalog.data?.items || [] : []
  const selectedIds = selection.runId === state.run_id ? selection.ids : []
  async function beginMutation() {
    setMutating(true)
    await client.cancelQueries({ queryKey: statusKey })
  }
  function finishMutation() {
    setMutating(false)
    client.invalidateQueries({ queryKey: statusKey })
  }
  const start = useMutation({
    gcTime: 0, retry: false,
    mutationFn: () => api('/api/jobs/scan', { method: 'POST', body: { source, target, marker_message: marker, limit: Number(limit || 0), cleanup_links: cleanup } }),
    onMutate: beginMutation,
    onSuccess: (result) => { initiatedRun.current = result.run_id; setSource(''); setTarget(''); setSelection({ runId: '', ids: [] }); client.setQueryData(statusKey, result) },
    onError: (cause) => notify(cause.message, 'error'),
    onSettled: finishMutation,
  })
  const stop = useMutation({
    retry: false, mutationFn: () => api('/api/jobs/stop', { method: 'POST' }),
    onMutate: beginMutation,
    onSuccess: (result) => client.setQueryData(statusKey, result),
    onError: (cause) => notify(cause.message, 'error'),
    onSettled: finishMutation,
  })
  const backup = useMutation({
    retry: false,
    mutationFn: () => api('/api/jobs/selection', { method: 'POST', body: { run_id: state.run_id, conversation_ids: selectedIds } }),
    onMutate: beginMutation,
    onSuccess: (result) => { initiatedRun.current = result.run_id || state.run_id; client.setQueryData(statusKey, result) },
    onError: (cause) => notify(cause.message, 'error'),
    onSettled: finishMutation,
  })
  const pending = start.isPending || stop.isPending || backup.isPending
  const choosing = Boolean(state.running && state.stage === 'choosing' && catalog.data?.run_id === state.run_id)
  const canChoose = choosing && !pending
  const { total, percentage } = backupProgress(state)
  function toggle(id, checked) {
    setSelection({ runId: state.run_id, ids: checked ? [...selectedIds, id] : selectedIds.filter((value) => value !== id) })
  }
  return <div className="native-tools backup-workspace">
    <header className="native-intro"><span className="eyebrow">CHATGPT · MODULE RIÊNG</span><h1>Sao chép lịch sử chat</h1><p>Tạo link Share ở tài khoản nguồn, mở bằng tài khoản đích và gửi một tin nhắn để lưu bản sao.</p></header>
    <div className="native-notice"><ShieldCheck size={22} /><p><strong>Thông tin đăng nhập được hiển thị để bạn kiểm tra và chỉ nằm trong bộ nhớ của tiến trình này.</strong><br />Tool không ghi mật khẩu, 2FA secret, cookie hoặc token vào database. Link Share mới sẽ được xóa sau khi bản sao được lưu.</p></div>
    <Card className="native-card"><form autoComplete="off" onSubmit={(event) => { event.preventDefault(); if (!pending && !state.running) start.mutate() }}>
      <div className="backup-accounts"><label className="native-field"><span><b>1</b> Tài khoản nguồn</span><input type="text" value={source} onChange={(event) => setSource(event.target.value)} required autoComplete="off" spellCheck={false} placeholder="email|mật khẩu|2fa" disabled={state.running || pending} /><small>Chỉ đọc danh sách chat và tạo link Share.</small></label><ArrowRight className="backup-arrow" aria-hidden="true" /><label className="native-field"><span><b>2</b> Tài khoản đích</span><input type="text" value={target} onChange={(event) => setTarget(event.target.value)} required autoComplete="off" spellCheck={false} placeholder="email|mật khẩu|2fa" disabled={state.running || pending} /><small>Nhận một chat mới cho mỗi link Share.</small></label></div>
      <div className="backup-options"><label className="native-field">Tin nhắn dùng để lưu bản sao<input type="text" value={marker} onChange={(event) => setMarker(event.target.value)} maxLength={500} disabled={state.running || pending} /></label><label className="native-field">Giới hạn chat<input type="number" min="0" max="10000" value={limit} onChange={(event) => setLimit(event.target.value)} disabled={state.running || pending} /><small>0 = tất cả chat đã chọn</small></label></div>
      <label className="native-check"><input type="checkbox" checked={cleanup} onChange={(event) => setCleanup(event.target.checked)} disabled={state.running || pending} />Xóa link Share mới sau khi copy</label>
      <div className="native-row backup-actions"><Button type="submit" disabled={state.running || pending || status.isPending || status.isError}>{start.isPending ? <LoaderCircle className="spin" /> : <ListChecks />}Tải danh sách chat</Button><Button type="button" variant="outline" disabled={!state.running || pending} onClick={() => stop.mutate()}><Square />{stop.isPending ? 'Đang dừng…' : 'Dừng an toàn'}</Button></div>
    </form></Card>
    {state.running && state.stage === 'choosing' && <Card className="native-card"><div className="native-row native-between"><div><span className="eyebrow">CHỌN CHAT CẦN BACKUP</span><h2>Cuộc hội thoại nguồn</h2></div><span className="native-help" aria-live="polite">Đã chọn {selectedIds.length} / {items.length}</span></div><p className="native-help">Tích chọn tùy ý. Chưa có chat nào được sao chép cho đến khi bạn bấm backup.</p>
      {catalog.isPending ? <p role="status"><LoaderCircle className="spin inline" size={16} /> Đang tải danh sách chat…</p> : catalog.isError ? <div className="native-alert" role="alert">Không tải được danh sách chat. <Button variant="outline" size="sm" onClick={() => catalog.refetch()}>Thử lại</Button></div> : <><div className="native-row"><Button variant="outline" size="sm" disabled={!canChoose} onClick={() => setSelection({ runId: state.run_id, ids: items.map((item) => item.id) })}><CheckCheck />Chọn tất cả</Button><Button variant="ghost" size="sm" disabled={!canChoose} onClick={() => setSelection({ runId: state.run_id, ids: [] })}>Bỏ chọn tất cả</Button></div>
        <div className="backup-conversations">{items.length ? items.map((item) => <label className="native-check" key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} disabled={!canChoose} onChange={(event) => toggle(item.id, event.target.checked)} /><span>{item.title || item.id}</span></label>) : <p className="native-help">Tài khoản nguồn chưa có hội thoại.</p>}</div><div><Button disabled={!canChoose || selectedIds.length === 0} onClick={() => backup.mutate()}>{backup.isPending ? <LoaderCircle className="spin" /> : <Copy />}Backup các chat đã chọn</Button></div></>}
    </Card>}
    <Card className="native-card" aria-live="polite"><div className="native-row native-between"><div><span className="eyebrow">TRẠNG THÁI</span><h2>{state.running && <LoaderCircle className="spin" size={18} />}{status.isError ? 'Mất kết nối với module' : state.message || 'Sẵn sàng'}</h2></div><span className="native-pill">{state.stage || 'idle'}</span></div>
      <progress className="native-progress" aria-label="Tiến trình sao chép chat" value={percentage} max="100" /><div className="backup-stats">{[[state.done || 0, 'Đã copy'], [state.failed || 0, 'Lỗi'], [state.skipped || 0, 'Đã có'], [total, 'Tổng']].map(([count, label]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>{state.source && state.target && <p className="native-help backup-account-label">{state.source} → {state.target}</p>}{status.isError && <div><Button variant="outline" size="sm" disabled={status.isFetching} onClick={() => status.refetch()}><RefreshCw />Thử kết nối lại</Button></div>}
    </Card>
    <Card className="native-card"><div className="native-row native-between"><div><span className="eyebrow">CHECKPOINT</span><h2>Kết quả gần đây</h2></div><Button variant="ghost" size="sm" disabled={history.isFetching} onClick={() => history.refetch()}><RefreshCw className={history.isFetching ? 'spin' : ''} />Làm mới</Button></div><div className="backup-table-wrap"><table className="backup-table"><thead><tr><th>Hội thoại</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead><tbody>{history.isPending || history.isError || !history.data?.items?.length ? <tr><td colSpan="3" className="backup-empty">{history.isPending ? 'Đang tải…' : history.isError ? 'Không đọc được checkpoint' : 'Chưa có dữ liệu'}</td></tr> : history.data.items.map((item, index) => <tr key={`${item.conversation_id}-${index}`}><td title={item.error || ''}>{item.title || item.conversation_id}</td><td>{item.status}</td><td>{item.updated_at ? new Date(item.updated_at).toLocaleString('vi-VN') : ''}</td></tr>)}</tbody></table></div></Card>
  </div>
}
