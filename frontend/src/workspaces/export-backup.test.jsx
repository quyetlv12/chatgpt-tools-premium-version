import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ExportWorkspace from './ExportWorkspace'
import BackupWorkspace from './BackupWorkspace'
import { backupProgress, clampWorkers, exportRows } from './export-backup-model'

function renderWorkspace(Component, entries = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  for (const [key, value] of entries) client.setQueryData(key, value)
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><Component /></QueryClientProvider>)
  client.clear()
  return html
}

describe('React export workspace', () => {
  it('bounds workers and tracks duplicate emails by input index', () => {
    expect([clampWorkers(-1), clampWorkers(12), clampWorkers('invalid')]).toEqual([1, 8, 2])
    const rows = exportRows('# comment\nsynthetic@example.test|private|secret\nsynthetic@example.test|other|secret', {
      results: [{ index: 0, email: 'synthetic@example.test', ok: true, copyable: true }],
      running: { 0: { index: 0, step: 'login' }, 1: { index: 1, step: 'oauth' } },
    })
    expect(rows.map(({ state }) => state)).toEqual(['ok', 'run'])
    expect(rows[1].step).toBe('oauth')
    expect(JSON.stringify(rows)).not.toContain('private')
    expect(exportRows('', { results: [{ index: 0, cancelled: true }] })[0].state).toBe('cancelled')
  })
  it('renders genuine controls and escaped job metadata without a legacy frame', () => {
    const html = renderWorkspace(ExportWorkspace, [
      [['react-export-config'], { supported: true, url: '', has_api_key: false }],
      [['react-export-current'], { id: 'synthetic-job', seed: 'synthetic@example.test' }],
      [['react-export-job', 'synthetic-job'], { done: true, results: [{ index: 0, email: '<script>synthetic</script>', ok: true, copyable: true }] }],
    ])
    expect(html).toContain('Export Codex')
    expect(html).toContain('Convert JSON')
    expect(html).toContain('Copy tất cả')
    expect(html).toContain('&lt;script&gt;synthetic&lt;/script&gt;')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<script>synthetic</script>')
  })
})

describe('React chat backup workspace', () => {
  it('counts copies, failures and skipped rows in bounded progress', () => {
    expect(backupProgress({ total: 4, done: 1, failed: 1, skipped: 1 })).toEqual({ total: 4, completed: 3, percentage: 75 })
    expect(backupProgress({ total: 2, done: 3 }).percentage).toBe(100)
    expect(backupProgress().percentage).toBe(0)
  })
  it('renders before status or conversations are available', () => {
    const html = renderWorkspace(BackupWorkspace)
    expect(html).toContain('Sao chép lịch sử chat')
    expect(html).toContain('Đang tải…')
  })
  it('preserves scan, stop, selection and checkpoint controls', () => {
    const html = renderWorkspace(BackupWorkspace, [
      [['react-chat-backup-status'], { running: true, stage: 'choosing', run_id: 'synthetic-run' }],
      [['react-chat-backup-conversations', 'synthetic-run'], { run_id: 'synthetic-run', items: [{ id: 'synthetic-chat', title: '<private title>' }] }],
      [['react-chat-backup-history'], { items: [] }],
    ])
    for (const label of ['Tài khoản nguồn', 'Tài khoản đích', 'Tải danh sách chat', 'Dừng an toàn', 'Chọn tất cả', 'Backup các chat đã chọn', 'Kết quả gần đây']) expect(html).toContain(label)
    expect(html).toContain('&lt;private title&gt;')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('localStorage')
  })
})
