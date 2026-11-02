import { useState } from 'react'
import { useConfirm } from '@/lib/use-confirm'
import { notify } from '@/lib/feedback'
import { HashRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Layers3, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { workspaces } from '@/lib/modules'
import { request, statusOptions } from '@/lib/api'
import { moduleRequest } from '@/lib/module-api'
import TwoFAWorkspace from '@/workspaces/TwoFAWorkspace'
import PasskeyWorkspace from '@/workspaces/PasskeyWorkspace'
import BrowserWorkspace from '@/workspaces/BrowserWorkspace'
import ExportWorkspace from '@/workspaces/ExportWorkspace'
import BackupWorkspace from '@/workspaces/BackupWorkspace'

function AccountWorkspace({ passkeyPage, isActive, headerToolsTarget }) {
  const boot = useQuery({ queryKey: ['account-bootstrap', passkeyPage], queryFn: ({ signal }) => moduleRequest('twofa', '/api/bootstrap', { signal }), retry: false, gcTime: 0, staleTime: 0 })
  if (boot.isPending) return <div className="frame-loading" role="status"><LoaderCircle className="spin" />Đang tải tài khoản…</div>
  if (boot.isError) return <div className="frame-loading" role="alert">Không tải được dữ liệu tài khoản.<Button variant="outline" onClick={() => boot.refetch()}>Thử lại</Button></div>
  return passkeyPage ? <PasskeyWorkspace token={boot.data.token} settings={boot.data.settings} /> : <TwoFAWorkspace token={boot.data.token} bootstrap={boot.data} isActive={isActive} headerToolsTarget={headerToolsTarget} />
}

function WorkspaceDeck({ headerToolsTarget }) {
  const location = useLocation()
  const key = /^\/workspace\/([^/]+)$/.exec(location.pathname)?.[1]
  const [visited, setVisited] = useState([])
  if (key && workspaces.some(item => item.key === key) && !visited.includes(key)) setVisited([...visited, key])
  return <>{visited.map(id => {
    const item = workspaces.find(m => m.key === id)
    return <section key={id} hidden={id !== key} className="workspace native-workspace" aria-label={item.title}>
      {id === 'twofa' ? <AccountWorkspace isActive={id === key} headerToolsTarget={headerToolsTarget} /> : id === 'passkey' ? <AccountWorkspace passkeyPage /> : id === 'browser' ? <BrowserWorkspace isActive={id === key} /> : id === 'export' ? <ExportWorkspace /> : <BackupWorkspace isActive={id === key} />}
    </section>
  })}</>
}

function Shell() {
  const [headerToolsTarget, setHeaderToolsTarget] = useState(null)
  const confirm = useConfirm()
  const query = useQuery(statusOptions)
  const client = useQueryClient()
  const closeWindows = useMutation({
    mutationFn: () => request('/api/windows/close', { method: 'POST' }), retry: false,
    onSuccess: () => { notify('Đã đóng cửa sổ tool.'); client.invalidateQueries({ queryKey: ['suite-status'] }) },
    onError: () => notify('Không đóng được cửa sổ. Hãy thử lại.', 'error'),
  })
  return <div className="app-shell">
    <a href="#main-content" className="skip-link" onClick={(event) => { event.preventDefault(); document.getElementById("main-content").focus() }}>Đến nội dung chính</a>
    <header className="app-header">
      <Link to="/workspace/twofa" className="brand"><span className="brand-mark" aria-hidden="true"><Layers3 size={23} strokeWidth={1.8} /></span><span className="brand-copy"><span className="brand-name">shoptaikhoan</span><span className="brand-sub">WORKSPACE</span></span></Link>
      <nav className="app-nav" aria-label="Điều hướng chính">
        {workspaces.map((item) => { const Icon = item.icon; return <NavLink className="nav-item" key={item.key} to={`/workspace/${item.key}`}><Icon size={18} />{item.title}</NavLink> })}
      </nav>
      <div ref={setHeaderToolsTarget} className="workspace-header-tools" />
      <div className="topbar-actions">{!query.isError && query.data?.browser_windows_open && <Button className="close-windows-button" variant="outline" size="sm" aria-label={closeWindows.isPending ? 'Đang đóng…' : 'Đóng cửa sổ tool'} title="Đóng cửa sổ tool" disabled={closeWindows.isPending} onClick={async () => { if (await confirm({ title: 'Đóng cửa sổ tool', description: 'Đóng các cửa sổ trình duyệt do tool mở. Các thao tác cần cửa sổ có thể bị gián đoạn.', destructive: true })) closeWindows.mutate() }}><X /><span className="close-windows-label">{closeWindows.isPending ? 'Đang đóng…' : 'Đóng cửa sổ tool'}</span></Button>}
      </div>
    </header>
    <div className="main-shell">
      {query.isError && <div className="error-banner" role="alert">Không lấy được trạng thái backend. <button onClick={() => query.refetch()}>Thử kết nối lại</button></div>}
      <main id="main-content" tabIndex={-1}><WorkspaceDeck headerToolsTarget={headerToolsTarget} /><Routes><Route path="/" element={<Navigate to="/workspace/twofa" replace />} /><Route path="/workspace/:key" element={null} /><Route path="*" element={<div className="overview"><h1>Trang không tồn tại</h1><Link to="/workspace/twofa">Về tool 2FA</Link></div>} /></Routes></main>
    </div>
  </div>
}

export default function App() { return <HashRouter><Shell /></HashRouter> }
