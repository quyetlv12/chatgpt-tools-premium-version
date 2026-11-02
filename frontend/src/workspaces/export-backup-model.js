export function clampWorkers(value) {
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(1, Math.min(8, Math.round(count))) : 2
}

export function exportRows(lines, job = {}) {
  const rows = new Map(String(lines || '').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
    .map((line, index) => [String(index), { index, email: line.split('|')[0].trim().toLowerCase(), state: 'queued', step: 'queued' }]))
  for (const [index, item] of (job.results || []).entries()) {
    const id = item.index ?? index
    rows.set(String(id), { ...item, index: id, state: item.cancelled ? 'cancelled' : item.ok ? 'ok' : 'fail', step: item.ok ? 'done' : item.step })
  }
  for (const [key, value] of Object.entries(job.running || {})) {
    const item = value && typeof value === 'object' ? value : { email: key, step: value }
    const id = String(item.index ?? key)
    if (rows.get(id)?.state && rows.get(id).state !== 'queued') continue
    rows.set(id, { ...rows.get(id), ...item, email: item.email || rows.get(id)?.email || key, state: 'run' })
  }
  return [...rows.values()]
}

export function backupProgress(state = {}) {
  const total = Number(state.total || 0)
  const completed = Number(state.done || 0) + Number(state.failed || 0) + Number(state.skipped || 0)
  return { total, completed, percentage: total ? Math.max(0, Math.min(100, completed / total * 100)) : 0 }
}

export async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  try {
    input.select()
    if (!document.execCommand('copy')) throw new Error('Không thể copy vào clipboard.')
  } finally { input.remove() }
}
