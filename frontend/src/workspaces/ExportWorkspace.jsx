import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FileJson, FolderOpen, Gauge, LoaderCircle, Network, Play, Power, Save, ServerCog, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { notify } from '@/lib/feedback'
import { useConfirm } from '@/lib/use-confirm'
import { moduleRequest } from '@/lib/module-api'
import { clampWorkers, exportRows, writeClipboard } from './export-backup-model'
import './export-backup.css'

const FORMATS = [['cockpit', 'Cockpit', Gauge], ['9router', '9router', Network], ['sub2api', 'Sub2API', ServerCog]]
const STEPS = { queued: 'Đang chờ worker', parse: 'Đọc dòng', login: 'Đang login', oauth: 'Đang OAuth Codex', refresh: 'Đang refresh token', export: 'Đang ghi JSON', done: 'Xong', cancelled: 'Đã dừng' }
const PREFS_KEY = 'gpt-tool-ui'
const currentKey = ['react-export-current']
const configKey = ['react-export-config']
const EMPTY_JOB = {}
const api = (path, options) => moduleRequest('export', path, options)

function readPreferences() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {} } catch { return {} }
}

function integrationMessage(job) {
  if (job.cancelled) return 'Đã dừng các tiến trình.'
  if (job.error) return job.error
  const errors = [job.cockpit?.error, job.nine_router?.error, job.sub2api?.error].filter(Boolean)
  if (errors.length) return errors.join(' · ')
  const sent = [['Cockpit', job.cockpit], ['9Router', job.nine_router], ['Sub2API', job.sub2api]]
    .filter(([, item]) => item?.sent).map(([label, item]) => `${label}: ${item.count}`)
  return sent.length ? `Đã nhập tự động — ${sent.join(' · ')}.` : ''
}

export default function ExportWorkspace() {
  const client = useQueryClient()
  const confirm = useConfirm()
  const [preferences] = useState(readPreferences)
  const [format, setFormat] = useState(FORMATS.some(([id]) => id === preferences.format) ? preferences.format : 'cockpit')
  const [workers, setWorkers] = useState(clampWorkers(preferences.workers ?? 2))
  const [autoImport, setAutoImport] = useState(preferences.autoImport !== false)
  const [url, setUrl] = useState(preferences.sub2apiUrl || '')
  const [apiKey, setApiKey] = useState('')
  const [tab, setTab] = useState('export')
  const [lines, setLines] = useState('')
  const [json, setJson] = useState('')
  const [current, setCurrent] = useState(() => client.getQueryData(currentKey) || null)
  const [validation, setValidation] = useState('')
  const [stopped, setStopped] = useState(false)
  const configTouched = useRef(false)
  const initiatedJob = useRef(null)
  const config = useQuery({ queryKey: configKey, queryFn: ({ signal }) => api('/api/sub2api/config', { signal }), retry: false, staleTime: Infinity })
  useEffect(() => {
    if (!configTouched.current && config.data?.url) setUrl(config.data.url)
  }, [config.data])
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ format, workers: clampWorkers(workers), autoImport, sub2apiUrl: url.trim(), ...(preferences.proxy ? { proxy: preferences.proxy } : {}) })) } catch { /* Preferences are optional. */ }
  }, [format, workers, autoImport, url, preferences.proxy])
  const job = useQuery({
    queryKey: ['react-export-job', current?.id],
    queryFn: ({ signal }) => api(`/api/jobs/${encodeURIComponent(current.id)}`, { signal }),
    enabled: Boolean(current?.id) && !stopped,
    refetchInterval: (query) => query.state.data?.done ? false : 400,
    retry: false,
  })
  const data = job.data || current?.result || EMPTY_JOB
  const savedKey = config.data?.has_api_key && config.data.url === url.trim().replace(/\/+$/, '')
  function remember(value) { setCurrent(value); client.setQueryData(currentKey, value) }
  const configure = useMutation({
    gcTime: 0, retry: false,
    mutationFn: (action) => api('/api/sub2api/config', { method: 'POST', body: { action, url: url.trim(), api_key: apiKey.trim() } }),
    onSuccess: (result, action) => {
      configTouched.current = true
      client.setQueryData(configKey, result); setApiKey(''); setUrl(result.url || '')
      notify(action === 'save' ? 'Đã lưu trong macOS Keychain. Lần sau không cần nhập lại.' : 'Đã xóa cấu hình và key đã lưu.')
    },
    onError: () => notify('Không xử lý được cấu hình Keychain. Kiểm tra URL và API Key rồi thử lại.', 'error'),
  })
  const run = useMutation({
    gcTime: 0, retry: false,
    mutationFn: async () => {
      return api('/api/export', { method: 'POST', body: {
        format, lines, proxy: preferences.proxy || '', workers: clampWorkers(workers),
        cockpit_import: format === 'cockpit' && autoImport, nine_router_import: format === '9router' && autoImport,
        sub2api_import: format === 'sub2api' && autoImport,
        sub2api_url: format === 'sub2api' && autoImport ? url.trim() : '',
        sub2api_api_key: format === 'sub2api' && autoImport ? apiKey.trim() : '',
        sub2api_use_saved: format === 'sub2api' && autoImport && !apiKey.trim() && Boolean(savedKey),
      } })
    },
    onMutate: () => setValidation(''),
    onSuccess: (result) => {
      // Keep only public row metadata in the query cache, never account passwords.
      const seed = exportRows(lines).map(({ email }) => email).join('\n')
      initiatedJob.current = result.id
      remember({ id: result.id, seed }); stop.reset()
    },
    onError: (error) => notify(error.message, 'error'),
  })
  const convert = useMutation({
    gcTime: 0, retry: false,
    mutationFn: () => api('/api/convert', { method: 'POST', body: { format, text: json } }),
    onMutate: () => setValidation(''),
    onSuccess: (result) => {
      const snapshot = { ...result, done: true }
      initiatedJob.current = result.id
      client.setQueryData(['react-export-job', result.id], snapshot)
      remember({ id: result.id, result: snapshot }); stop.reset()
    },
    onError: (error) => notify(error.message, 'error'),
  })
  const stop = useMutation({
    retry: false, mutationFn: () => api(`/api/jobs/${encodeURIComponent(current.id)}/stop`, { method: 'POST', body: {} }),
    onSuccess: () => { job.refetch() },
    onError: (error) => notify(error.message, 'error'),
  })
  const copy = useMutation({
    gcTime: 0, retry: false,
    mutationFn: async (target) => {
      const result = await api(`/api/jobs/${encodeURIComponent(current.id)}/copy/${encodeURIComponent(target)}`)
      await writeClipboard(JSON.stringify(result.data, null, 2))
    },
    onSuccess: () => notify('Đã copy JSON vào clipboard.'), onError: (error) => notify(error.message, 'error'),
  })
  const openFiles = useMutation({ retry: false, mutationFn: () => api('/api/open-out', { method: 'POST', body: {} }), onError: (error) => notify(error.message, 'error') })
  const shutdown = useMutation({ retry: false, mutationFn: () => api('/api/shutdown', { method: 'POST', body: {} }), onSuccess: () => { setStopped(true); notify('Tool đã tắt. Bạn có thể đóng tab.') }, onError: (error) => notify(error.message, 'error') })
  const busy = run.isPending || convert.isPending || Boolean(current?.id && !data.done && !stopped)
  const rows = exportRows(current?.seed, data)
  const ok = rows.filter((row) => row.state === 'ok').length
  const failed = rows.filter((row) => row.state === 'fail').length
  const cancelled = rows.filter((row) => row.state === 'cancelled').length
  const done = ok + failed + cancelled
  const total = data.total || rows.length
  const configBusy = configure.isPending || config.isPending
  const message = data.done ? integrationMessage(data) : stop.isSuccess ? 'Đang dừng các tiến trình…' : ''
  useEffect(() => {
    if (!current?.id || initiatedJob.current !== current.id || !data.done) return
    initiatedJob.current = null
    const hasError = Boolean(data.error || data.cockpit?.error || data.nine_router?.error || data.sub2api?.error || failed)
    notify(integrationMessage(data) || `Hoàn tất xuất JSON: ${ok} thành công, ${failed} lỗi.`, hasError ? 'error' : data.cancelled ? 'info' : 'success')
  }, [current?.id, data, failed, ok])
  function startRun() {
    const error = !lines.trim() ? 'Nhập danh sách tài khoản trước khi chạy.' : format === 'sub2api' && autoImport && (!url.trim() || (!apiKey.trim() && !savedKey)) ? 'Nhập URL và Admin API Key của Sub2API trước khi chạy.' : ''
    setValidation(error)
    if (!error) run.mutate()
  }
  async function clearConfiguration() {
    if (await confirm({ title: 'Xóa cấu hình Sub2API?', description: 'Xóa URL và Admin API Key đã lưu trong macOS Keychain. Bạn cần nhập lại cấu hình để tự nhập vào Sub2API.', confirmText: 'Xóa cấu hình', destructive: true })) configure.mutate('clear')
  }
  async function shutdownTool() {
    if (await confirm({ title: 'Tắt tool Export Codex?', description: 'Dịch vụ Export Codex sẽ dừng. Tiến trình đang chạy có thể bị gián đoạn.', confirmText: 'Tắt tool', destructive: true })) shutdown.mutate()
  }
  return <div className="native-tools export-workspace">
    <div className="export-editor">
      <div className="export-format-header">
        <nav className="native-tabs export-format-tabs" aria-label="Định dạng xuất">{FORMATS.map(([id, label, Icon]) => <Button key={id} variant={format === id ? 'secondary' : 'ghost'} aria-pressed={format === id} disabled={busy || stopped} onClick={() => setFormat(id)}><Icon size={16} />{label}</Button>)}</nav>
        <p className="native-help">Chạy cục bộ · token chỉ gửi tới đích bạn bật.</p>
      </div>
      <Card className="native-card export-input-card">
        <div className="native-row export-head"><div className="native-tabs" aria-label="Tác vụ">{[['export', 'Export Codex'], ['convert', 'Convert JSON']].map(([id, label]) => <Button key={id} variant={tab === id ? 'secondary' : 'ghost'} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</Button>)}</div>
          <label className="worker-field">Số luồng<input type="number" min="1" max="8" value={workers} disabled={busy || stopped} onChange={(event) => setWorkers(event.target.value)} onBlur={() => setWorkers(clampWorkers(workers))} /></label>
          <span className="native-pill">{stopped ? 'stopped' : busy ? 'running' : 'ready'}</span><Button variant="outline" size="sm" disabled={shutdown.isPending || stopped} onClick={shutdownTool}><Power />Tắt tool</Button>
        </div>
        {tab === 'export' ? <>
          <label className="native-field"><span>Danh sách tài khoản <small>email | password | totp</small></span><textarea value={lines} onChange={(event) => setLines(event.target.value)} placeholder="user@example.com | password | JBSWY3DPEHPK3PXP" spellCheck={false} autoComplete="off" disabled={busy || stopped} /></label>
          <p className="native-help">Khoảng trắng quanh dấu | được tự động xử lý.</p>
          <label className="native-check"><input type="checkbox" checked={autoImport} disabled={busy || stopped} onChange={(event) => setAutoImport(event.target.checked)} />Tự {format === '9router' ? 'thêm' : 'nhập'} vào {FORMATS.find(([id]) => id === format)[1]}</label>
          <p className="native-help">Bỏ chọn để chỉ xuất JSON, không tự mở hoặc nhập vào tool đích.</p>
          {format === 'sub2api' && autoImport && <div className="native-config">
            <label className="native-field">URL Sub2API<input type="url" value={url} disabled={busy || configure.isPending} onChange={(event) => { configTouched.current = true; setUrl(event.target.value) }} placeholder="https://sub2api.example.com" autoComplete="url" /></label>
            <label className="native-field">Admin API Key <small>Không lưu trên trình duyệt</small><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={busy || configure.isPending} placeholder={savedKey ? 'Đã lưu trong Keychain — để trống để dùng lại' : 'Nhập khóa quản trị Sub2API'} autoComplete="new-password" /></label>
            <div className="native-row"><Button variant="outline" size="sm" disabled={busy || configBusy || config.data?.supported === false} onClick={() => configure.mutate('save')}><Save />Lưu cấu hình</Button><Button variant="ghost" size="sm" disabled={busy || configBusy || !config.data?.has_api_key} onClick={clearConfiguration}><Trash2 />Xóa cấu hình</Button></div>
            <p className="native-help" role="status">{config.isError ? 'Không đọc được cấu hình đã lưu; vẫn có thể nhập thủ công.' : config.isPending ? 'Đang đọc cấu hình…' : savedKey ? 'Đã lưu trong macOS Keychain. Không cần nhập lại key.' : config.data?.supported === false ? 'Lưu API Key hiện chỉ hỗ trợ macOS Keychain.' : 'Bấm Lưu cấu hình để dùng lại lần sau.'}</p>
          </div>}
          <div className="native-row"><Button variant={busy ? 'destructive' : 'default'} disabled={stopped || run.isPending || convert.isPending || (busy && (!current?.id || stop.isPending || stop.isSuccess)) || (!busy && format === 'sub2api' && autoImport && configBusy)} onClick={() => busy ? stop.mutate() : startRun()}>{busy ? <Square /> : <Play />}{busy ? stop.isPending || stop.isSuccess ? 'Đang dừng…' : 'Dừng tiến trình' : 'Chạy tool'}</Button><Button variant="outline" disabled={openFiles.isPending || stopped} onClick={() => openFiles.mutate()}><FolderOpen />Mở file hệ thống</Button></div>
        </> : <>
          <label className="native-field"><span>Session / auth JSON <small>Một hoặc nhiều tài khoản</small></span><textarea value={json} onChange={(event) => setJson(event.target.value)} placeholder={'{"access_token":"...","email":"..."}'} spellCheck={false} autoComplete="off" disabled={busy || stopped} /></label><p className="native-help">JSON được chuyển đổi và lưu vào thư mục out.</p>
          <div className="native-row"><Button disabled={busy || stopped || !json.trim()} onClick={() => convert.mutate()}><FileJson />Chạy Convert</Button>{busy && current?.id && <Button variant="destructive" disabled={stop.isPending || stop.isSuccess} onClick={() => stop.mutate()}><Square />Dừng tiến trình</Button>}</div>
        </>}
        {validation && <p className="native-alert" role="alert">{validation}</p>}
      </Card>
    </div>
    <Card className="native-card native-monitor"><div className="native-row native-between"><div><span className="eyebrow">02 / MONITOR</span><h2>{busy && <LoaderCircle className="spin" size={18} />}Tiến trình</h2></div><div className="native-row"><span className="native-help">{total ? `${busy ? '' : 'Xong '}${done}/${total} · ${ok} OK · ${failed} lỗi${cancelled ? ` · ${cancelled} đã dừng` : ''}` : 'Chưa chạy.'}{busy && ` · ${rows.filter((row) => row.state === 'run').length}/${clampWorkers(workers)} worker`}</span>{!busy && ok > 0 && <Button variant="outline" size="sm" disabled={copy.isPending} onClick={() => copy.mutate('all')}><Copy />Copy tất cả</Button>}</div></div>
      {total > 0 && <progress className="native-progress" aria-label="Tiến trình xuất" value={done} max={total} />}
      <ul className="native-results">{rows.map((row) => <li key={row.index} className={`result-${row.state}`}><span className="native-result-dot" /><div className="native-result-detail"><strong>{row.email}</strong><p>{row.state === 'ok' ? ['JSON sẵn sàng', row.cockpit_sent && 'Đã gửi Cockpit', row.nine_router_sent && 'Đã thêm 9Router', row.nine_router_error, row.sub2api_sent && `Đã nhập Sub2API (${row.sub2api_action || 'xong'})`, row.sub2api_error].filter(Boolean).join(' · ') : row.error}</p></div><div className="native-row">{row.state === 'ok' && row.copyable && <Button variant="outline" size="sm" aria-label={`Copy JSON ${row.email}`} disabled={copy.isPending} onClick={() => copy.mutate(String(row.index))}><Copy />Copy JSON</Button>}<span className="native-pill">{STEPS[row.step] || row.step || 'Lỗi'}</span></div></li>)}</ul>
      {job.isError && <div className="native-alert" role="alert">Mất kết nối khi cập nhật tiến trình. <Button variant="outline" size="sm" onClick={() => job.refetch()}>Thử lại</Button></div>}
      {message && <p className="native-alert" role="status">{message}</p>}
    </Card>
  </div>
}
