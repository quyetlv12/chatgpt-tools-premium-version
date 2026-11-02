import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Tooltip } from 'radix-ui'
import { ArrowUp, LayoutList, CircleCheck, Gauge, CircleGauge, BadgeHelp, CircleAlert, Copy, CopyX, Download, FileClock, Fingerprint, KeyRound, ListChecks, LoaderCircle, Play, RefreshCw, FileDown, Settings, Square, Trash2, LogOut, FileText, Workflow, MessageSquareX, ListX, RotateCcw, CircleStop } from 'lucide-react'
import { useConfirm } from '@/lib/use-confirm'
import { AppDialog } from '@/components/ui/app-dialog'
import { notify } from '@/lib/feedback'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { moduleRequest, modulePath } from '@/lib/module-api'
import { statusOptions } from '@/lib/api'
import { normalizeAccounts, terminal, rowChangeEligible, combinedEligible, accountBusy, logoutEligible, clearableFailure, matchesFailure, filteredJobs, settingsPayload, applyEvent, journalEligible, runBatch, runCombinedBatch } from './twofa-model'
import { buildUsageView, buildPaymentView, buildFilteredExportMeta } from './twofa-view-model'
import PasswordWorkspace from './PasswordWorkspace'
import NumberedTextarea from '@/components/NumberedTextarea'
import './twofa.css'
import './twofa-legacy.css'

const filters = [['all','Tất cả',LayoutList], ['running','Đang xử lý',LoaderCircle], ['success','Thành công',CircleCheck], ['usage-low','Usage < 50%',Gauge], ['usage-full','Usage = 100%',CircleGauge], ['free-no-usage','Free + Plus · Chưa có Usage',BadgeHelp], ['error','Lỗi',CircleAlert]]
const labels = { queued:'Đang chờ', running:'Đang chạy', success:'Thành công', error:'Lỗi', cancelled:'Đã dừng' }
const combinedPhases = { queued:'Đang chờ', changing_2fa:'Đang đổi và xác minh 2FA', logging_out:'Đang logout tất cả phiên', completed:'Đã đổi 2FA và logout', error:'Lỗi', cancelled:'Đã dừng' }
const dialogEyebrows = { settings:'CONTROL SETTINGS', session:'CHATGPT WEB SESSION', logs:'MISSION LOG', history:'LƯU TRỮ BỀN VỮNG · THEO THỨ TỰ HOÀN TẤT', journal:'DANH SÁCH LIVE ĐÃ LƯU' }

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type:'text/plain;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  notify('Đã xuất file TXT.')
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text) } catch {
    const el = document.createElement('textarea'); el.value = text; el.style.position='fixed'; el.style.opacity='0'; document.body.append(el); el.select()
    const ok = document.execCommand('copy'); el.remove(); if (!ok) throw new Error('Không copy được. Hãy chọn và copy văn bản.')
  }
}
function Modal({ className = '', ...props }) { return <AppDialog {...props} className={`tf-modal tf-twofa-modal ${className}`} /> }
function ActionButton({ label, children, disabled, ...props }) {
  return <Tooltip.Root>
    <Tooltip.Trigger asChild><span className="tf-action-trigger" tabIndex={disabled ? 0 : undefined} role={disabled ? 'group' : undefined} aria-label={disabled ? label : undefined}>
      <Button aria-label={label} {...props} disabled={disabled}>{children}</Button>
    </span></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="tf-action-tooltip" side="top" sideOffset={6} collisionPadding={12}>
      {label}<Tooltip.Arrow/>
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root>
}
function Usage({ job }) {
  if (job.usage_enabled === false) return <div className="tf-usage-state"><Gauge aria-hidden="true"/><span>Đã tắt đọc Usage</span></div>
  const view = buildUsageView(job.usage)
  const loading = (job.usage_refreshing || (!view && !terminal(job))) && <small className="tf-usage-loading"><LoaderCircle className="spin" aria-hidden="true"/><span>{job.usage_refreshing ? 'Đang đọc lại Usage…' : 'Đang chờ đọc Usage…'}</span></small>
  if (!view) return <div className="tf-usage-state" aria-busy={Boolean(loading)}>{loading || <><CircleGauge aria-hidden="true"/><span>Chưa có Usage</span></>}</div>
  return <div className="tf-usage" data-tone={view.tone} aria-busy={Boolean(loading)}>
    <div className="tf-usage-metrics"><span className="tf-usage-used" aria-label={`${view.usedLabel} đã dùng`}>{view.usedLabel}</span><strong className="tf-usage-remaining">{view.remainingLabel}</strong></div>
    <progress max="100" value={view.used} aria-label="Usage đã dùng" />
    <div className="tf-usage-meta">
      <span className="tf-usage-reset">{view.statusLabel}</span>
      {(view.creditLabel || view.resetCreditLabel) && <div className="tf-usage-credits">{view.resetCreditLabel && <span>{view.resetCreditLabel}</span>}{view.creditLabel && <span>{view.creditLabel}</span>}</div>}
    </div>
    {loading}
  </div>
}
function Payment({ job }) {
  if (job.payment_methods_enabled === false) return <small>Đã tắt đọc thanh toán</small>
  const view = buildPaymentView(job.payment_methods, job.billing_date)
  if (!view) return <small>{!terminal(job) ? 'Đang chờ đọc thanh toán…' : 'Chưa đọc được thanh toán'}</small>
  if (view.empty) return <small>Chưa lưu thanh toán</small>
  return <div className="tf-payment">
    {view.methods.map((m,i) => {
      const label = m.brandLabel || m.typeLabel
      return <div className="tf-payment-method" key={i}>
        <div className="tf-payment-main">
          <strong className="tf-payment-label">{label}</strong>
          {m.numberLabel && <span className="tf-payment-number">{m.numberLabel}</span>}
        </div>
        {(m.expiryLabel || m.isDefault) && <div className="tf-payment-details">
          {m.expiryLabel && <span>HSD <span className="tf-payment-expiry">{m.expiryLabel}</span></span>}
          {m.isDefault && <Badge variant="outline" className="tf-payment-default">Mặc định</Badge>}
        </div>}
      </div>
    })}
    {view.extraCount > 0 && <span className="tf-payment-extra">+{view.extraCount} phương thức khác</span>}
    {view.paymentDateLabel && <div className="tf-payment-date">{view.paymentDateLabel}</div>}
  </div>
}
function SessionForm({ api, onDone }) {
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [json,setJson]=useState(''); const [agreed,setAgreed]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  async function submit(e) { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { if(new TextEncoder().encode(json).length > 131072) throw new Error('Session JSON tối đa 128 KB.'); await api('/api/session-jobs',{method:'POST',body:{email,password,session_json:json,confirm:'CHANGE_2FA_FROM_SESSION'}}); onDone() } catch(e){setError(e.message)} finally{setBusy(false)} }
  return <form className="tf-form" onSubmit={submit}><p>Chỉ dùng session ChatGPT Web của tài khoản bạn quản lý. Token Codex OAuth xuất từ 9Router không dùng trực tiếp được. Session không được lưu xuống ổ đĩa; mật khẩu và khóa 2FA mới vẫn lưu trong SQLite như luồng hiện tại.</p><label>Email tài khoản<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label><label>Mật khẩu hiện tại<input type="password" required autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)} /><small>Dùng để đăng nhập lại xác minh khóa mới; không cần khóa 2FA cũ.</small></label><label>Hoặc dán session JSON<textarea required value={json} onChange={e=>setJson(e.target.value)} spellCheck={false} /></label><label>Chọn file JSON (tối đa 128 KB)<input type="file" accept=".json,application/json" aria-label="Chọn file Session JSON" onChange={async e=>{ const f=e.target.files[0]; if(!f)return; if(f.size>131072){setError('File tối đa 128 KB.');return} setJson(await f.text()) }} /></label><label className="tf-check"><input type="checkbox" required checked={agreed} onChange={e=>setAgreed(e.target.checked)} />Tôi xác nhận thay khóa 2FA tài khoản này. Nếu bị gián đoạn, tôi sẽ kiểm tra trạng thái trước khi nhập lại; tool không tự gửi lại lệnh đổi 2FA.</label>{error&&<p role="alert">{error}</p>}<Button type="submit" disabled={!agreed||busy}>{busy?<LoaderCircle className="spin"/>:<KeyRound/>}Xác nhận đổi 2FA</Button></form>
}

export default function TwoFAWorkspace({ token, bootstrap, isActive = true, headerToolsTarget }) {
  const queryClient = useQueryClient()
  const windowStatus = useQuery({ ...statusOptions, enabled: false })
  const [jobs,setJobs]=useState(bootstrap.jobs || []); const [settings,setSettings]=useState(bootstrap.settings || {}); const [health,setHealth]=useState(bootstrap.worker_health)
  const [input,setInput]=useState(()=>bootstrap.jobs?.some(j=>!terminal(j)) ? String(bootstrap.settings?.['twofa.input_draft'] || '') : '')
  const [filter,setFilter]=useState('all'); const [selected,setSelected]=useState([]); const [output,setOutput]=useState(''); const [connected,setConnected]=useState(false)
  const [modal,setModal]=useState(null); const confirm = useConfirm(); const [busy,setBusy]=useState(false); const [pending,setPending]=useState(new Set()); const [journal,setJournal]=useState(null); const [journalName,setJournalName]=useState(''); const [journalId,setJournalId]=useState(''); const [history,setHistory]=useState([]); const [historyState,setHistoryState]=useState('loading'); const [launch,setLaunch]=useState(''); const [draftDirty,setDraftDirty]=useState(false)
  const actionBarRef=useRef(null)
  const listRef=useRef(null)
  const [cleanupOpen,setCleanupOpen]=useState(false); const [cleanupType,setCleanupType]=useState('')
  const cleanupOptions=[['die','Tài khoản DIE','Tài khoản đã bị vô hiệu hóa.'],['http403','Lỗi HTTP 403','Lỗi có mã HTTP 403, không thuộc nhóm DIE.'],['all','Tất cả lỗi','Toàn bộ tài khoản lỗi hoặc đã dừng, trừ Live.']]
  const cleanupCount=jobs.filter(j=>matchesFailure(j,cleanupType)).length
  const [launchCount,setLaunchCount]=useState(0)
  useEffect(()=>{
    if(!launchCount)return
    listRef.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start',inline:'nearest'})
  },[launchCount])
  useEffect(()=>{
    const bar=actionBarRef.current
    const updateHeight=()=>{
      const height=bar.getBoundingClientRect().height
      if(height>0)document.documentElement.style.setProperty('--tf-action-bar-height',`${height}px`)
    }
    updateHeight()
    const observer=new ResizeObserver(updateHeight)
    observer.observe(bar)
    return()=>{observer.disconnect();document.documentElement.style.removeProperty('--tf-action-bar-height')}
  },[])
  const [stopping,setStopping]=useState(new Set()); const stoppingRef=useRef(new Set())
  const [rowResult,setRowResult]=useState(null); const rowChangeResults=useRef(new Set()); const rowResultVersion=useRef(0)
  const active=useRef(true); const journalVersion=useRef(0); const pendingRef=useRef(new Set()); const settingsRef=useRef(settings); const inputRef=useRef(input); const settingsQueue=useRef(Promise.resolve()); const settingsVersion=useRef(0)
  const jobEvents=useRef({version:0,snapshot:0,rows:new Map()})
  const combinedStatuses=useRef(new Map())
  const jobsRef=useRef(jobs)
  useEffect(()=>{jobsRef.current=jobs},[jobs])
  const busyRef=useRef(false);const outputVersion=useRef(0);const refreshVersion=useRef(0)
  useEffect(()=>{settingsRef.current=settings},[settings]);useEffect(()=>{inputRef.current=input},[input])
  const api=useCallback((path,opts={})=>moduleRequest('twofa',path,{...opts,token}),[token])
  const report=useCallback((message,type)=>notify(typeof message==='string'?message:message.message,type||(typeof message==='string'?'success':'error')),[])
  useEffect(()=>{const changes=rowChangeResults.current;active.current=true;return()=>{active.current=false;changes.clear()}},[])
  const refreshOutput=useCallback(()=>{const version=++outputVersion.current;return api('/api/output').then(text=>{if(active.current&&version===outputVersion.current)setOutput(text)}).catch(()=>{})},[api])
  const refresh=useCallback(async()=>{
    const request=++refreshVersion.current;const version=jobEvents.current.version;const d=await api('/api/bootstrap')
    if(!active.current||request!==refreshVersion.current)return
    setJobs(prev=>{
      const events=jobEvents.current
      if(events.snapshot>version)return prev
      const current=new Map(prev.map(j=>[j.id,j]));const incoming=new Set(d.jobs.map(j=>j.id))
      return [...d.jobs.map(j=>(events.rows.get(j.id)||0)>version?current.get(j.id):j).filter(Boolean),...prev.filter(j=>!incoming.has(j.id)&&(events.rows.get(j.id)||0)>version)]
    })
    setHealth(d.worker_health)
  },[api])
  const showRowResult=useCallback(async job=>{
    const version=++rowResultVersion.current
    setRowResult({email:job.email,raw:'',loading:true});setModal('row-result')
    try{
      const raw=await api(`/api/jobs/${encodeURIComponent(job.id)}/raw`)
      if(active.current&&version===rowResultVersion.current)setRowResult({email:job.email,raw,loading:false})
    }catch{
      if(active.current&&version===rowResultVersion.current){setRowResult({email:job.email,raw:'',loading:false,error:true});report('Đổi 2FA thành công nhưng chưa tải được dữ liệu mới. Có thể dùng Copy tài khoản trên dòng để thử lại.','warning')}
    }
  },[api,report])
  const receiveRowChange=useCallback(payload=>{
    if(payload.type==='removed'){rowChangeResults.current.delete(payload.id);return}
    const rows=payload.type==='snapshot'?payload.jobs||[]:payload.type==='job'&&payload.job?[payload.job]:[]
    if(payload.type==='snapshot'){const ids=new Set(rows.map(j=>j.id));for(const id of rowChangeResults.current)if(!ids.has(id))rowChangeResults.current.delete(id)}
    for(const job of rows){
      if(!rowChangeResults.current.has(job.id))continue
      if(job.mode==='change_2fa'&&job.status==='success'){rowChangeResults.current.delete(job.id);void showRowResult(job)}
      else if(['error','cancelled'].includes(job.status))rowChangeResults.current.delete(job.id)
    }
  },[showRowResult])
  useEffect(()=>{
    let events=null;let disposed=false
    function close(){events?.close();events=null;if(!disposed)setConnected(false)}
    function sync(){if(disposed)return;if(document.visibilityState==='hidden'){close();return}if(events)return
      events=new EventSource(modulePath('twofa',`/api/events?token=${encodeURIComponent(token)}`))
      const current=events
      events.onopen=()=>{if(!disposed&&events===current)setConnected(true)};events.onerror=()=>{if(!disposed&&events===current)setConnected(false)}
      events.onmessage=({data})=>{if(disposed||events!==current)return;let p;try{p=JSON.parse(data)}catch{return}
        // HTTP responses must not replace newer stream updates, including removals.
        const state=jobEvents.current
        if(p.type==='snapshot')state.snapshot=++state.version
        else if(p.type==='job'&&p.job)state.rows.set(p.job.id,++state.version)
        else if(p.type==='removed')state.rows.set(p.id,++state.version)
        receiveRowChange(p);setJobs(prev=>applyEvent(prev,p));if(p.worker_health)setHealth(p.worker_health);if(p.type==='snapshot'||(p.type==='job'&&terminal(p.job)))refreshOutput()}
    }
    sync();refreshOutput();document.addEventListener('visibilitychange',sync);window.addEventListener('pagehide',close);window.addEventListener('pageshow',sync)
    return()=>{disposed=true;close();document.removeEventListener('visibilitychange',sync);window.removeEventListener('pagehide',close);window.removeEventListener('pageshow',sync)}
  },[token,refreshOutput,receiveRowChange])
  const persistSettings=useCallback(()=>{
    const request=settingsQueue.current.catch(()=>{}).then(async()=>{
      if(!active.current)return
      const version=settingsVersion.current
      const d=await api('/api/settings',{method:'PUT',body:settingsPayload(settingsRef.current,inputRef.current)})
      if(active.current&&version===settingsVersion.current){settingsRef.current=d.settings;setSettings(d.settings)}
    })
    settingsQueue.current=request
    return request
  },[api])
  useEffect(()=>{if(!draftDirty)return;const timer=setTimeout(()=>persistSettings().catch(report),450);return()=>clearTimeout(timer)},[input,draftDirty,persistSettings,report])
  const operations=useQuery({queryKey:['twofa-combined',token],queryFn:({signal})=>api('/api/combined',{signal}),enabled:q=>isActive||q.state.status!=='success'||Boolean(q.state.data?.operations?.some(o=>!terminal(o))),retry:false,refetchInterval:q=>q.state.data?.operations?.some(o=>!terminal(o))?500:3000,gcTime:0})
  const combinedActive=Boolean(operations.data?.operations?.some(op=>!terminal(op)))
  useEffect(()=>{
    if(!isActive||!combinedActive)return
    let disposed=false,timer
    // Bulk jobs can overflow SSE; reconcile source state while the operation runs.
    async function sync(){await refresh().catch(()=>{});if(!disposed)timer=setTimeout(sync,3000)}
    timer=setTimeout(sync,3000)
    return()=>{disposed=true;clearTimeout(timer)}
  },[isActive,combinedActive,refresh])
  useEffect(()=>{
    let completed=false
    for(const op of operations.data?.operations||[]){
      const previous=combinedStatuses.current.get(op.id)
      if(previous&&!terminal({status:previous})&&terminal(op)){
        completed=true
        report(op.status==='success'?'Đã đổi 2FA và logout tất cả phiên.':op.error||combinedPhases[op.phase]||labels[op.status],op.status==='success'?'success':op.status==='error'?'error':'info')
      }
      combinedStatuses.current.set(op.id,op.status)
    }
    if(completed){void refresh().catch(()=>{});void refreshOutput()}
  },[operations.data,report,refresh,refreshOutput])
  const journals=useQuery({queryKey:['twofa-journals',token],queryFn:({signal})=>api('/api/live-journals',{signal}),enabled:modal==='journal',retry:false,gcTime:0})
  const opFor=j=>operations.data?.operations?.find(o=>!terminal(o)&&(o.job_id===j.id||o.email?.trim().toLowerCase()===j.email?.trim().toLowerCase()))
  const resultFor=j=>operations.data?.operations?.findLast(o=>o.job_id===j.id&&(o.finished_at??Infinity)>=(j.started_at??0))
  const isBusy=j=>accountBusy(j)||pending.has(j.id)||Boolean(opFor(j))
  const statusFor=j=>(!journal&&!accountBusy(j)?resultFor(j)?.status:null)||j.status
  const shown=filteredJobs(journal?.jobs||jobs,filter,statusFor)
  const selectedJobs=jobs.filter(j=>selected.includes(j.id))
  const canCombine=selectedJobs.length>0&&selectedJobs.every(j=>combinedEligible(j)&&!isBusy(j))
  async function run(action){if(busyRef.current)return;busyRef.current=true;setBusy(true);try{await action()}catch(e){report(e)}finally{busyRef.current=false;if(active.current)setBusy(false)}}
  async function stop(key, action){if(stoppingRef.current.has(key))return;stoppingRef.current.add(key);setStopping(new Set(stoppingRef.current));try{await action()}catch(e){report(e)}finally{stoppingRef.current.delete(key);if(active.current)setStopping(new Set(stoppingRef.current))}}
  function acceptResponse(job,version){const state=jobEvents.current;return Math.max(state.snapshot,state.rows.get(job.id)||0)<=version}
  async function rowAction(job,action,body){
    if(pendingRef.current.has(job.id))throw new Error('Tài khoản đang gửi yêu cầu.')
    pendingRef.current.add(job.id);setPending(new Set(pendingRef.current));const version=jobEvents.current.version
    try{
      const d=await api(`/api/jobs/${encodeURIComponent(job.id)}/${action}`,{method:'POST',body})
      if(action==='combined/start'){
        const key=['twofa-combined',token]
        await queryClient.cancelQueries({queryKey:key})
        queryClient.setQueryData(key,prev=>({operations:[...(prev?.operations||[]).filter(op=>op.id!==d.id),d]}))
      }
      if(d.job&&acceptResponse(d.job,version)){receiveRowChange({type:'job',job:d.job});setJobs(prev=>applyEvent(prev,{type:'job',job:d.job}))}
      return d
    }finally{pendingRef.current.delete(job.id);if(active.current)setPending(new Set(pendingRef.current))}
  }
  async function changeRow(job){rowChangeResults.current.add(job.id);try{await rowAction(job,'change-2fa')}catch(error){rowChangeResults.current.delete(job.id);throw error}}
  async function ask(title,description,action,destructive=false){if(await confirm({title,description,destructive}))await run(action)}
  async function saveSetting(key,value){if(busy)return;const next={...settingsRef.current,[`twofa.${key}`]:value};settingsVersion.current++;settingsRef.current=next;setSettings(next);await run(persistSettings)}
  async function copyRaw(j){const path=journal?`/api/live-journals/${encodeURIComponent(journal.journal.id)}/accounts/${encodeURIComponent(j.id)}/raw`:`/api/jobs/${encodeURIComponent(j.id)}/raw`;await copy(await api(path));report('Đã copy tài khoản.')}
  async function chooseJournal(id){setJournalId(id);const version=++journalVersion.current;setSelected([]);setFilter('all');if(!id){setJournal(null);return}try{const data=await api(`/api/live-journals/${encodeURIComponent(id)}`);if(active.current&&version===journalVersion.current){setJournal(data);setModal(null)}}catch(e){if(version===journalVersion.current)report(e)}}
  async function showHistory(){
    setHistory([]);setHistoryState('loading');setModal('history')
    const version=++journalVersion.current
    try{
      const data=await api('/api/twofa-history')
      if(active.current&&version===journalVersion.current){setHistory(data.history||[]);setHistoryState('ready')}
    }catch{
      if(active.current&&version===journalVersion.current)setHistoryState('error')
    }
  }
  function closeModal(){journalVersion.current++;rowResultVersion.current++;setRowResult(null);setModal(null);setHistory([]);setLaunch('')}
  function openLaunch(){
    chooseJournal('')
    const submit=async()=>{const version=jobEvents.current.version;const d=await api('/api/jobs',{method:'POST',body:{lines:input.split('\n').filter(l=>l.trim()),mode:settings['twofa.change_enabled']?'change_2fa':'check_only'}});setJobs(prev=>d.jobs.filter(j=>acceptResponse(j,version)).reduce((list,j)=>applyEvent(list,{type:'job',job:j}),prev));setLaunchCount(count=>count+1);report('Đã thêm vào hàng đợi.')}
    if(settings['twofa.change_enabled'])ask('Xác nhận đổi 2FA','Đăng nhập và đổi 2FA cho các tài khoản đã nhập.',submit,true)
    else run(submit)
  }
  function preparePasskey(j){
    if(pendingRef.current.has(j.id))return
    run(async()=>{
      const data=await rowAction(j,'passkey/start',{confirm:'ADD_PASSKEY',native_window:true})
      if(!/^\/api\/passkey\/launch\/[A-Za-z0-9_-]{43}$/.test(data.launch_path))throw new Error('Liên kết passkey không hợp lệ.')
      if(!active.current)return
      if(data.opened===true)report('Đã mở Chrome với profile riêng. Hoàn tất đăng ký trên trang OpenAI. Tool chưa xác nhận đã thêm passkey.','info')
      else{
        setLaunch(modulePath('twofa',data.launch_path));setModal('passkey')
        report('Không khởi chạy được Chrome riêng. Hãy kiểm tra Google Chrome hoặc dùng liên kết dự phòng trong vòng 2 phút.','error')
      }
    })
  }
  async function batch(rows, action){const result=await runBatch(rows,action,id=>setSelected(prev=>prev.filter(value=>value!==id)));report(`Đã gửi ${result.succeeded}/${rows.length} tài khoản${result.failed ? ` · ${result.failed} lỗi; xem trạng thái từng dòng trước khi thao tác tiếp` : ''}.`,result.failed?'warning':'success')}
  async function combined(row){
    const j=jobsRef.current.find(j=>j.id===row.id)
    const current=queryClient.getQueryData(['twofa-combined',token])?.operations||[]
    if(!j||!combinedEligible(j)||accountBusy(j)||pendingRef.current.has(j.id)||current.some(op=>!terminal(op)&&(op.job_id===j.id||op.email?.trim().toLowerCase()===j.email?.trim().toLowerCase())))throw new Error('Tài khoản không còn đủ điều kiện chạy luồng gộp.')
    return rowAction(j,'combined/start',{confirm:'START_COMBINED'})
  }
  async function combinedBatch(rows){
    const result=await runCombinedBatch(rows,settingsRef.current['twofa.max_concurrent'],combined,id=>setSelected(prev=>prev.filter(value=>value!==id)))
    report(`Đã gửi ${result.succeeded}/${rows.length} tài khoản${result.failed ? ` · ${result.failed} lỗi; xem trạng thái từng dòng trước khi thao tác tiếp` : ''}.`,result.failed?'warning':'success')
  }
  const allActive=jobs.some(j=>!terminal(j)||isBusy(j))
  const selectable=shown.filter(j=>logoutEligible(j)&&!isBusy(j))
  const counts={all:jobs.length,...Object.fromEntries(['running','success','error'].map(key=>[key,filteredJobs(jobs,key,statusFor).length]))}
  return <div className="tf-workspace tf-twofa-workspace">
    {isActive && headerToolsTarget && createPortal(<div className="tf-tools tf-twofa-tools" role="group" aria-label="Công cụ tài khoản"><Button variant="outline" onClick={()=>setModal('password')}><KeyRound/>Đổi mật khẩu</Button><Button variant="outline" onClick={()=>setModal('session')}><FileText/>Session JSON</Button><Button variant="outline" onClick={showHistory}><FileClock/>Lịch sử 2FA</Button><Button variant="outline" onClick={()=>setModal('journal')}><ListChecks/>Nhật ký Live</Button><Button variant="outline" onClick={()=>setModal('settings')}><Settings/>Cấu hình</Button></div>, headerToolsTarget)}
    <div className="tf-grid"><Card className="tf-panel tf-input-panel"><header><div><span className="tf-eyebrow">ĐẦU VÀO</span><h3>Danh sách tài khoản</h3></div><span className="tf-counter">{input.split('\n').filter(x=>x.trim()).length} bản ghi</span></header><label className="tf-editor-label" htmlFor="tf-input">Định dạng <code>email|password|2FA_cũ</code></label><NumberedTextarea id="tf-input" spellCheck={false} autoComplete="off" placeholder="email|password|2FA" value={input} onChange={e=>{settingsVersion.current++;inputRef.current=e.target.value;setInput(e.target.value);setDraftDirty(true)}} onPaste={e=>{const raw=e.clipboardData.getData('text');if(!raw)return;e.preventDefault();const el=e.currentTarget;const value=input.slice(0,el.selectionStart)+normalizeAccounts(raw)+input.slice(el.selectionEnd);settingsVersion.current++;inputRef.current=value;setInput(value);setDraftDirty(true)}} /><div className="tf-launch-controls" role="group" aria-label="Tùy chọn kiểm tra tài khoản"><div className="tf-options">{[['change_enabled','CHANGE 2FA','Đổi 2FA sau đăng nhập'],['read_usage','Đọc Usage','Đọc Usage'],['read_payment_methods','Đọc Payment','Đọc thanh toán']].map(([k,label,description])=><label className="tf-check tf-switch" key={k} title={description}><input type="checkbox" role="switch" aria-label={description} disabled={busy} checked={k==='change_enabled'?Boolean(settings[`twofa.${k}`]):settings[`twofa.${k}`]!==false} onChange={e=>saveSetting(k,e.target.checked)} /> {k==='change_enabled'?<span className="tf-mode-copy"><small>{label}</small><strong>{settings['twofa.change_enabled']?'BẬT · SẼ ĐỔI 2FA':'TẮT · CHỈ CHECK'}</strong></span>:label}</label>)}</div><label className="tf-concurrency">Số luồng <select value={settings['twofa.max_concurrent']??1} disabled={busy} onChange={e=>saveSetting('max_concurrent',Number(e.target.value))}>{Array.from({length:10},(_,i)=><option key={i+1}>{i+1}</option>)}</select></label><Button disabled={busy||!input.trim()} onClick={openLaunch}><Play/>Khởi chạy</Button></div></Card>
    <Card className="tf-panel tf-output-panel"><header><div><span className="tf-eyebrow">VERIFIED OUTPUT</span><h3>Tài khoản đã change</h3></div><span className="tf-counter tf-success-counter">{output.split('\n').filter(Boolean).length} tài khoản</span></header><p className="tf-output-note">Chỉ hiển thị tài khoản đã đăng nhập lại thành công bằng 2FA mới.</p><div className="tf-output-wrap"><NumberedTextarea className="tf-output" aria-label="Kết quả đã xác minh" readOnly value={output} spellCheck={false} />{!output&&<div className="tf-output-empty"><strong>Chưa có kết quả</strong><small>Tài khoản hoàn tất sẽ xuất hiện tại đây.</small></div>}</div><div className="tf-row tf-output-actions"><Button variant="outline" disabled={!output} onClick={()=>run(async()=>{await copy(output);report('Đã copy kết quả.')} )}><Copy/>Copy tất cả</Button><Button variant="outline" disabled={!output} onClick={()=>download(output,'twofa-success.txt')}><Download/>Xuất .txt</Button></div></Card></div>
    <div className="tf-stats">{[['all','Tổng tài khoản'],['running','Đang chạy'],['success','Thành công'],['error','Lỗi / Dừng']].map(([key,label])=><Card key={key} data-status={key}><strong>{counts[key]}</strong><small>{label}</small></Card>)}</div>
    <Card ref={listRef} className="tf-panel tf-list">{journal&&<header><div><h3>{journal.journal.name}</h3><p>Live tại thời điểm lưu · Chỉ xem và copy</p></div><Button variant="outline" onClick={()=>chooseJournal('')}>Danh sách hiện tại</Button></header>}
    <div className="tf-filters">{filters.map(([k,label,Icon])=><button key={k} data-filter={k} className={filter===k?'active':''} aria-pressed={filter===k} onClick={()=>setFilter(k)}><Icon aria-hidden="true"/>{label} <span>{filteredJobs(journal?.jobs||jobs,k,statusFor).length}</span></button>)}</div>
    <Tooltip.Provider delayDuration={250}><div className="tf-table-wrap"><table aria-label="Danh sách tài khoản xử lý"><colgroup><col className="tf-col-select"/><col className="tf-col-account"/><col className="tf-col-status"/><col className="tf-col-check"/><col className="tf-col-usage"/><col className="tf-col-payment"/><col className="tf-col-actions"/></colgroup><thead><tr><th scope="col">{!journal&&selectable.length>0&&<label className="tf-check tf-select-all" title="Chọn tất cả Live"><input type="checkbox" checked={!journal&&selectable.length>0&&selectable.every(j=>selected.includes(j.id))} disabled={busy||!selectable.length} onChange={e=>setSelected(prev=>e.target.checked?[...new Set([...prev,...selectable.map(j=>j.id)])]:prev.filter(id=>!selectable.some(j=>j.id===id)))} /><span className="sr-only">Chọn tất cả Live</span></label>}</th><th scope="col">Tài khoản · Chế độ</th><th scope="col">Trạng thái · Gói</th><th scope="col">Kiểm tra tài khoản</th><th scope="col">Usage tuần</th><th scope="col">Thanh toán</th><th scope="col"><span className="sr-only">Thao tác</span></th></tr></thead>{shown.map(j=>{const op=opFor(j);const result=!journal&&!accountBusy(j)?resultFor(j):null;const status=statusFor(j);const plan=j.plan?.toUpperCase();const blocked=isBusy(j);const processing=!journal&&(j.status==='running'||j.chat_deleting||j.sessions_logging_out||j.passkey_preparing||j.usage_refreshing||op?.status==='running');return <tbody className="tf-account-group" key={j.id}><tr className="tf-account-row"><td><input type="checkbox" aria-label={`Chọn ${j.email}`} disabled={Boolean(journal)||!logoutEligible(j)||blocked||busy} checked={selected.includes(j.id)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,j.id]:prev.filter(id=>id!==j.id))} /></td><td><div className="tf-email"><strong>{j.email}</strong><Button variant="ghost" size="icon-sm" aria-label={`Copy email ${j.email}`} title="Copy email" onClick={()=>run(async()=>{await copy(j.email);report('Đã copy email.')} )}><Copy/></Button></div><small>{j.id.slice(0,10).toUpperCase()} · {!journal&&op?'2FA + LOGOUT':j.mode==='check_only'?'CHỈ CHECK':'ĐỔI 2FA'}</small></td><td><span className={`tf-status ${processing?'running tf-status-loading':status}`}>{processing&&<LoaderCircle className="spin" aria-hidden="true"/>}{processing&&j.status!=='running'?'Đang xử lý':labels[status]||status}{!processing&&status==='success'&&plan&&` · ${plan}`}</span>{(op||result)&&(op||result).phase!=='completed'&&<small>Luồng gộp: {combinedPhases[(op||result).phase]||labels[(op||result).status]}</small>}{(result?.error||j.error)&&<small className="tf-error">{result?.error||j.error}</small>}</td><td><div className="tf-account-check">{j.account_state==='live'?<Badge variant="outline" className="tf-live-badge">LIVE{plan&&` · ${plan}`}</Badge>:<b className="tf-muted">{j.account_state?.toUpperCase()||'CHƯA RÕ'}{plan&&` · ${plan}`}</b>}</div><small className="tf-checkpoint">{journal?'LIVE TẠI THỜI ĐIỂM LƯU':j.rotated_pending_verify?'ĐÃ LƯU · CHỜ VERIFY':op?(op.phase==='logging_out'?'2FA ĐÃ XÁC MINH · ĐANG LOGOUT':'ĐANG XỬ LÝ 2FA + LOGOUT'):j.mode==='check_only'&&j.status==='success'?'ĐÃ CHECK LIVE':j.login_verified?'2FA ĐÃ XÁC MINH':'CHƯA XÁC MINH'}</small></td><td><Usage job={j}/></td><td><Payment job={j}/></td><td className="tf-actions-cell"><div className="tf-row-actions tf-action-buttons" role="group" aria-label={`Thao tác cho ${j.email}`}>
        <ActionButton variant="outline" size="sm" data-action="copy" label="Copy tài khoản" aria-label={`Copy tài khoản ${j.email}`} onClick={()=>run(()=>copyRaw(j))}><Copy/></ActionButton>
        {!journal&&<>
          {!terminal(j)&&<ActionButton variant="outline" size="sm" data-action="stop" label="Dừng" aria-label={`Dừng ${j.email}`} disabled={stopping.has(j.id)} onClick={()=>stop(j.id,async()=>{await api(`/api/jobs/${encodeURIComponent(j.id)}/stop`,{method:'POST'});report('Đã gửi yêu cầu dừng.')})}><CircleStop/></ActionButton>}
          {['error','cancelled'].includes(j.status)&&j.retryable!==false&&<ActionButton variant="outline" size="sm" data-action="retry" label="Chạy lại" aria-label={`Chạy lại ${j.email}`} disabled={blocked||busy} onClick={()=>run(async()=>{await rowAction(j,'retry');report('Đã gửi yêu cầu chạy lại.')})}><RotateCcw/></ActionButton>}
        </>}
      {!journal&&<>
        {(op||(j.status==='success'&&j.account_state==='live'))&&<>
          {rowChangeEligible(j)&&<ActionButton variant="outline" size="sm" data-action="twofa" label="Đổi 2FA" aria-label={`Đổi 2FA ${j.email}`} disabled={blocked||busy} onClick={()=>ask('Đổi 2FA','Đổi và xác minh 2FA mới cho tài khoản này.',async()=>{await changeRow(j);report('Đã gửi yêu cầu đổi 2FA.')},true)}><KeyRound/></ActionButton>}
          {(combinedEligible(j)||op)&&<ActionButton variant="outline" size="sm" data-action={op?'stop':'combined'} label={op?'Dừng gộp':'2FA + Logout'} disabled={op?stopping.has(op.id):busy||pending.has(j.id)||blocked} onClick={()=>op?stop(op.id,()=>api(`/api/combined/${op.id}/stop`,{method:'POST'}).then(()=>{operations.refetch();report('Đã gửi yêu cầu dừng luồng gộp.')})):run(async()=>{await combined(j);report('Đã gửi yêu cầu đổi 2FA + Logout.')})}>{op?<CircleStop/>:<Workflow/>}</ActionButton>}
          {j.status==='success'&&j.account_state==='live'&&<>
            <ActionButton variant="outline" size="sm" data-action="passkey" label="Thêm Passkey" aria-label={`Thêm Passkey ${j.email}`} disabled={blocked||busy||stopping.has('windows')||!j.login_verified} onClick={()=>preparePasskey(j)}><Fingerprint/></ActionButton>
            <ActionButton variant="outline" size="sm" data-action="logout" label="Logout tất cả" aria-label={`Logout ${j.email}`} disabled={blocked||busy} onClick={()=>ask('Logout tất cả phiên','Tất cả phiên đăng nhập sẽ bị đăng xuất. Tool không tự đăng nhập lại.',async()=>{await rowAction(j,'logout-sessions',{confirm:'LOGOUT_ALL_SESSIONS'});report('Đã gửi yêu cầu logout tất cả phiên.')},true)}><LogOut/></ActionButton>
          </>}
        </>}
        {terminal(j)&&<>
          {j.status==='success'&&j.account_state==='live'&&<ActionButton variant="destructive" size="sm" data-action="delete" label="Xóa hội thoại" aria-label={`Xóa hội thoại ${j.email}`} disabled={blocked||busy} onClick={()=>ask('Xóa tất cả hội thoại','Thao tác xóa toàn bộ hội thoại không thể hoàn tác.',async()=>{await rowAction(j,'delete-chats',{confirm:'DELETE_ALL_CHATS'});report('Đã xử lý yêu cầu xóa hội thoại.')},true)}><MessageSquareX/></ActionButton>}
          <ActionButton variant="outline" size="sm" data-action="remove" label="Bỏ khỏi danh sách" aria-label={`Bỏ ${j.email}`} disabled={blocked||busy} onClick={()=>run(async()=>{await api(`/api/jobs/${j.id}`,{method:'DELETE'});setJobs(prev=>prev.filter(x=>x.id!==j.id));report('Đã bỏ tài khoản khỏi danh sách.')})}><Trash2/></ActionButton>
        </>}
      </>}
    </div></td></tr></tbody>})}</table>{!shown.length&&<div className="tf-empty"><ListChecks/><strong>Danh sách đang trống</strong><p>Nạp combo phía trên để bắt đầu.</p></div>}</div></Tooltip.Provider>
    </Card>
    <div className="tf-action-bar" ref={actionBarRef} role="region" aria-label="Thao tác danh sách tài khoản">
      <div className="tf-action-bar-inner">
    <div className="tf-list-actions">{!journal&&<>{canCombine&&<Button variant="outline" data-action="combined" disabled={busy||!canCombine} onClick={()=>run(()=>combinedBatch(selectedJobs))}><Workflow aria-hidden="true"/>Đổi 2FA + Logout ({selectedJobs.length})</Button>}{selectedJobs.length>0&&<Button variant="outline" data-action="logout" disabled={busy||!selectedJobs.length||selectedJobs.some(j=>!logoutEligible(j)||isBusy(j))} onClick={()=>ask('Logout tài khoản đã chọn','Đăng xuất tất cả phiên của các tài khoản đã chọn. Không đăng nhập lại tự động.',()=>batch(selectedJobs,j=>rowAction(j,'logout-sessions',{confirm:'LOGOUT_ALL_SESSIONS'})),true)}><LogOut aria-hidden="true"/>Logout all sessions</Button>}</>}{!journal&&shown.length>0&&<Button variant="outline" data-action="export" disabled={busy||!shown.length||Boolean(journal)} onClick={()=>run(async()=>download(['running','success','error'].includes(filter)&&jobs.some(j=>statusFor(j)!==j.status)?(await Promise.all(shown.map(j=>api(`/api/jobs/${encodeURIComponent(j.id)}/raw`)))).join('\n'):await api(`/api/jobs/export?view=${encodeURIComponent(filter)}`),buildFilteredExportMeta(filter,shown.length).fileName))}><FileDown aria-hidden="true"/>Xuất tab ({shown.length})</Button>}</div>
    <div className="tf-row tf-cleanup-actions">{!journal&&<>{jobs.length>0&&<Button variant="outline" data-action="refresh" disabled={busy} onClick={()=>run(async()=>{await refresh();report('Đã làm mới danh sách.')})}><RefreshCw aria-hidden="true"/>Làm mới</Button>}{allActive&&<Button variant="outline" data-action="stop-all" disabled={stopping.has('all')} onClick={()=>stop('all',async()=>{const results=await Promise.allSettled([api('/api/jobs/stop-all',{method:'POST'}),api('/api/combined/stop-all',{method:'POST'})]);await refresh();operations.refetch();for(const result of results)if(result.status==='rejected')report(result.reason);if(results.every(result=>result.status==='fulfilled'))report('Đã gửi yêu cầu dừng tất cả.')})}><Square aria-hidden="true"/>Dừng tất cả</Button>}</>}{(stopping.has('windows')||(!windowStatus.isError&&windowStatus.data?.browser_windows_open))&&<Button variant="outline" data-action="close-windows" title="Đóng các cửa sổ Chrome Passkey do tool mở" disabled={busy||stopping.has('windows')} onClick={()=>stop('windows',async()=>{const data=await api('/api/passkey/windows/close',{method:'POST'});report(data.closed?`Đã đóng ${data.closed} cửa sổ do tool mở.`:'Không có cửa sổ nào do tool mở đang chạy.');await queryClient.invalidateQueries({queryKey:statusOptions.queryKey})})}>{stopping.has('windows')?<LoaderCircle className="spin" aria-hidden="true"/>:<CopyX aria-hidden="true"/>}{stopping.has('windows')?'Đang đóng cửa sổ…':'Đóng toàn bộ cửa sổ'}</Button>}{!journal&&<>{jobs.some(j=>['error','cancelled'].includes(j.status)&&j.retryable!==false)&&<Button variant="outline" data-action="retry" disabled={busy||!jobs.some(j=>['error','cancelled'].includes(j.status)&&j.retryable!==false)} onClick={()=>run(()=>batch(jobs.filter(j=>['error','cancelled'].includes(j.status)&&j.retryable!==false),j=>rowAction(j,'retry')))}><RotateCcw aria-hidden="true"/>Retry lỗi</Button>}{jobs.some(clearableFailure)&&<Button variant="outline" data-action="clear-errors" disabled={busy||!jobs.some(clearableFailure)} onClick={()=>{setCleanupType('');setCleanupOpen(true)}}><ListX aria-hidden="true"/>Dọn lỗi</Button>}{!allActive&&jobs.length>0&&<Button variant="outline" data-action="clear-all" disabled={busy||allActive||!jobs.length} onClick={()=>ask('Dọn toàn bộ danh sách','Xóa các dòng đã hoàn tất khỏi danh sách hiện tại. Lịch sử đã lưu vẫn còn.',async()=>{await api('/api/jobs',{method:'DELETE'});await refresh();setSelected([]);report('Đã dọn danh sách.')},true)}><Trash2 aria-hidden="true"/>Dọn danh sách</Button>}</>}<Button variant="outline" onClick={()=>window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}><ArrowUp aria-hidden="true"/>Lên đầu</Button></div>
      </div>
    </div>
    {cleanupOpen&&<Modal className="tf-cleanup-modal" title="Dọn tài khoản lỗi" onClose={()=>{if(!busy)setCleanupOpen(false)}}>
      <form className="tf-form" onSubmit={e=>{e.preventDefault();if(busy||!cleanupCount||!cleanupType)return;run(async()=>{const version=jobEvents.current.version;const d=await api(`/api/jobs/failed/by-type?failure_type=${encodeURIComponent(cleanupType)}`,{method:'DELETE'});if(version===jobEvents.current.version)setJobs(d.jobs);setSelected(prev=>prev.filter(id=>d.jobs.some(j=>j.id===id)));setCleanupOpen(false);report(`Đã dọn ${d.deleted} tài khoản · ${cleanupOptions.find(([type])=>type===cleanupType)[1]}.`)})}}>
        <p id="tf-cleanup-description" className="tf-muted">Chọn nhóm cần bỏ khỏi danh sách. Tài khoản Live, tài khoản đang chạy và lịch sử 2FA được giữ lại.</p>
        <fieldset className="tf-cleanup-options" aria-describedby="tf-cleanup-description" disabled={busy}><legend className="sr-only">Nhóm lỗi cần dọn</legend>
          {cleanupOptions.map(([type,label,hint])=>{const count=jobs.filter(j=>matchesFailure(j,type)).length;return <label className="tf-cleanup-option" key={type} data-selected={cleanupType===type} data-empty={!count}>
            <input type="radio" name="failure-type" value={type} checked={cleanupType===type} disabled={!count} onChange={()=>setCleanupType(type)}/><span><strong>{label}</strong><small>{hint}</small></span><Badge variant="outline">{count}</Badge>
          </label>})}
        </fieldset>
        <div className="tf-row tf-cleanup-footer"><Button type="button" variant="outline" disabled={busy} onClick={()=>setCleanupOpen(false)}>Hủy</Button><Button type="submit" variant="destructive" disabled={busy||!cleanupType||!cleanupCount}>{busy?<LoaderCircle className="spin" aria-hidden="true"/>:<ListX aria-hidden="true"/>}{busy?'Đang dọn…':`Dọn${cleanupType?` ${cleanupCount} tài khoản`:''}`}</Button></div>
      </form>
    </Modal>}
    {modal&&<Modal className={`tf-${modal}-modal`} title={<>{dialogEyebrows[modal]&&<span className="tf-eyebrow tf-dialog-eyebrow">{dialogEyebrows[modal]}</span>}<span className="tf-dialog-title-line">{{settings:'Cấu hình runtime',password:'Đổi mật khẩu',session:'Đổi 2FA từ session JSON',history:<><span className="tf-history-icon"><FileClock aria-hidden="true"/></span>Lịch sử đã đổi 2FA</>,journal:'Nhật ký tài khoản',passkey:'Hoàn tất Passkey','row-result':'Dữ liệu mới đã sẵn sàng'}[modal]}</span></>} onClose={closeModal}>
      {modal==='password'&&<PasswordWorkspace token={token} settings={settings} onClose={closeModal}/>}
      {modal==='session'&&<SessionForm api={api} onDone={()=>{closeModal();refresh();report('Đã đưa tài khoản vào hàng đợi đổi 2FA.')}}/>}
      {modal==='settings'&&<form className="tf-form" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);run(async()=>{const next={...settings,'twofa.max_concurrent':Number(data.get('max_concurrent')),'twofa.job_timeout':Number(data.get('job_timeout')),'twofa.auto_retry':data.has('auto_retry'),'twofa.auto_retry_max':Number(data.get('auto_retry_max')),'twofa.auto_retry_delay':Number(data.get('auto_retry_delay'))};settingsVersion.current++;settingsRef.current=next;setSettings(next);await persistSettings();closeModal();report('Đã lưu cấu hình runtime.')})}}>{[['max_concurrent','Luồng đồng thời',1,10],['job_timeout','Timeout mỗi bước (giây)',30,600],['auto_retry_max','Số lần retry',0,5],['auto_retry_delay','Độ trễ retry (giây)',0,60]].map(([k,l,min,max])=><label key={k}>{l}<input required type="number" name={k} min={min} max={max} defaultValue={settings[`twofa.${k}`]??min}/></label>)}<label className="tf-check"><input type="checkbox" name="auto_retry" defaultChecked={settings['twofa.auto_retry']}/>Tự động thử lại</label><Button disabled={busy}>Lưu vào Settings Store</Button></form>}
      {modal==='history'&&<>
        <div className="tf-history-summary"><span>Dòng đổi sau luôn nằm dưới cùng. Lịch sử vẫn được giữ khi dọn danh sách job.</span><span className="tf-history-count" role="status">{historyState==='loading'?'Đang tải…':historyState==='error'?'Chưa tải được':`${history.length} bản ghi`}</span></div>
        <div className="tf-history-list" role="region" aria-label="Danh sách lịch sử 2FA" aria-busy={historyState==='loading'} tabIndex={0}>
          {historyState==='loading'?<div className="tf-history-state"><LoaderCircle className="animate-spin" aria-hidden="true"/><strong>Đang tải lịch sử</strong><p>Vui lòng chờ trong giây lát.</p></div>
          :historyState==='error'?<div className="tf-history-state"><CircleAlert aria-hidden="true"/><strong role="alert">Không tải được lịch sử 2FA</strong><p>Hãy thử tải lại dữ liệu.</p><Button variant="outline" onClick={showHistory}><RefreshCw aria-hidden="true"/>Thử lại</Button></div>
          :history.length?<ol>{history.map((entry,i)=><li className="tf-history-entry" key={i}>
            <div className="tf-history-entry-heading"><span className="tf-history-index" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><div className="tf-history-account"><strong>{entry.email}</strong><time>{new Date(entry.changed_at*1000).toLocaleString('vi-VN')}</time></div><Button variant="outline" className="tf-history-copy" aria-label={`Copy bản ghi ${i+1}`} onClick={()=>run(async()=>{await copy(entry.raw);report('Đã copy kết quả.')})}><Copy aria-hidden="true"/>Copy</Button></div>
            <div className="tf-history-data"><span>Dữ liệu tài khoản</span><code>{entry.raw}</code></div>
          </li>)}</ol>:<div className="tf-history-state"><FileClock aria-hidden="true"/><strong>Chưa có tài khoản đổi 2FA thành công.</strong><p>Các bản ghi sẽ xuất hiện tại đây sau khi đổi 2FA.</p></div>}
        </div>
        <footer className="tf-history-footer"><span>Copy từng bản ghi hoặc xuất toàn bộ</span><div><Button variant="outline" disabled={!history.length} onClick={()=>download(history.map(e=>e.raw).join('\n'),'twofa-history.txt')}><Download aria-hidden="true"/>Xuất .txt</Button><Button disabled={!history.length} onClick={()=>run(async()=>{await copy(history.map(e=>e.raw).join('\n'));report('Đã copy lịch sử 2FA.')})}><Copy aria-hidden="true"/>Copy tất cả</Button></div></footer>
      </>}
      {modal==='journal'&&<div className="tf-form"><p className="tf-journal-intro">Lưu danh sách hiện tại hoặc chọn nhật ký để xem lại.</p><label>Xem nhật ký đã lưu<select value={journalId} disabled={journals.isPending} onChange={e=>chooseJournal(e.target.value)}><option value="">Danh sách hiện tại</option>{journals.data?.journals?.map(j=><option value={j.id} key={j.id}>{j.name} · {j.account_count} tài khoản</option>)}</select></label>{journals.isError&&<p role="alert">Không tải được nhật ký. <button onClick={()=>journals.refetch()}>Thử lại</button></p>}<label>Tên nhật ký mới<input placeholder="Để trống để đặt tên theo thời gian" value={journalName} onChange={e=>setJournalName(e.target.value)}/></label><Button disabled={busy||Boolean(journal)||!jobs.some(journalEligible)} onClick={()=>run(async()=>{await api('/api/live-journals',{method:'POST',body:{name:journalName.trim()}});setJournalName('');closeModal();report('Đã lưu nhật ký Live.');const result=await journals.refetch();if(result.isError)report('Nhật ký đã lưu. Chưa tải lại được danh sách nhật ký.','warning')} )}>Lưu nhật ký</Button><p>Nhật ký chỉ xem và copy, hàng đợi hiện tại tiếp tục chạy riêng.</p></div>}
      {modal==='row-result'&&rowResult&&<div className="tf-form"><span className="tf-eyebrow">ĐỔI 2FA THÀNH CÔNG</span><strong>{rowResult.email}</strong><p>{rowResult.loading?'Đang tải dữ liệu đã xác minh…':rowResult.error?'Chưa tải được dữ liệu mới. Dùng Copy tài khoản trên dòng để thử lại.':'Dữ liệu chỉ hiển thị trong hộp thoại này và sẽ được xóa khi đóng.'}</p><label>RAW DATA MỚI<textarea aria-label="Dữ liệu sau đổi 2FA" readOnly value={rowResult.raw} spellCheck={false} autoComplete="off" /></label><Button disabled={!rowResult.raw||busy} onClick={()=>run(async()=>{await copy(rowResult.raw);report('Đã copy dữ liệu mới sau khi đổi 2FA.')})}><Copy/>Copy dữ liệu mới</Button></div>}
      {modal==='passkey'&&launch&&<div className="tf-form"><p>Không mở được Chrome với profile riêng. Kiểm tra Google Chrome; liên kết dự phòng bên dưới dùng một lần và hết hạn sau 2 phút.</p><a href={launch} target="_blank" rel="noreferrer">Mở trang đăng ký OpenAI</a></div>}
    </Modal>}
  </div>
}
