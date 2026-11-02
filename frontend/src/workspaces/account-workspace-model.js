const INDEX_LABEL = /^\s*(?:\*\*)?第\s*[0-9０-９]+\s*张(?:\*\*)?(?:\s*[:：])?\s*/u

export function normalizeAccountPaste(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n').flatMap(line => {
    const label = line.match(INDEX_LABEL)
    const value = label ? line.slice(label[0].length) : line
    if (label && !value.trim()) return []
    if (value.includes('|')) return [value]
    const parts = value.split('----')
    return [parts.length === 3 && parts.every(part => part.trim()) ? parts.join('|') : value]
  }).join('\n')
}

export const accountLines = text => String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
export const jobCanStop = job => ['queued', 'running'].includes(job.status)
export const jobCanRetry = job => ['error', 'cancelled'].includes(job.status) && job.retryable !== false
export const jobCanDelete = job => ['success', 'error', 'cancelled'].includes(job.status)
export const validPasskeyLaunchPath = path => typeof path === 'string' && /^\/api\/passkey\/launch\/[A-Za-z0-9_-]{43}$/.test(path)

export function targetPasswordError(value) {
  if (!value) return 'Hãy nhập mật khẩu chung mới. Để trống sẽ không thay đổi cấu hình.'
  if (value.length < 12 || value.length > 128) return 'Mật khẩu chung phải dài từ 12 đến 128 ký tự.'
  if (value.includes('|') || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return 'Mật khẩu chung không được chứa dấu | hoặc ký tự điều khiển.'
  return ''
}

export function passwordHistoryEntries(entries, query) {
  const normalized = String(query || '').trim().toLocaleLowerCase('vi')
  return (Array.isArray(entries) ? entries : []).map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !normalized || String(entry?.email || '').toLocaleLowerCase('vi').includes(normalized))
}

export function passwordCredentialParts(entry) {
  const pieces = String(entry?.raw || '').split('|')
  return { email: String(entry?.email || pieces[0] || ''), password: pieces[1] || '', secret: pieces.slice(2).join('|') }
}
