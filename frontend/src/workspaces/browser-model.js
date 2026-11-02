export function normalizeAccountLine(value) {
  const line = value.trim()
  if (!line || line.startsWith('#') || line.includes('|')) return line
  if (line.includes('\t')) return line.split('\t').map((part) => part.trim()).join('|')
  if (line.includes(';')) return line.split(';').map((part) => part.trim()).join('|')
  if (line.includes(',') && line.split(',')[0].includes('@')) return line.split(',').map((part) => part.trim()).join('|')
  return /\s{2,}/.test(line) ? line.split(/\s{2,}/).map((part) => part.trim()).join('|') : line
}
export function parseAccounts(text) {
  return text.split('\n').map(normalizeAccountLine).filter((line) => line && !line.startsWith('#')).map((raw) => {
    const parts = raw.split('|')
    return { email: parts[0]?.trim() || '', password: parts[1]?.trim() || '', totp: parts[2]?.trim() || '', raw }
  }).filter((account) => account.email && account.password)
}
function decodeJwt(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')), (char) => char.charCodeAt(0))))
  } catch { return null }
}
export function parseSession(obj) {
  if (!obj || typeof obj !== 'object') return null
  const accessToken = obj.accessToken || obj.access_token || obj.token?.accessToken
  if (typeof accessToken !== 'string' || !accessToken) return null
  const payload = decodeJwt(accessToken)
  const auth = payload?.['https://api.openai.com/auth'] || {}
  const profile = payload?.['https://api.openai.com/profile'] || {}
  const email = obj.user?.email || obj.email || profile.email || payload?.email || ''
  const accountId = obj.account?.id || obj.providerSpecificData?.chatgptAccountId || auth.chatgpt_account_id || crypto.randomUUID()
  const plan = obj.account?.planType || obj.providerSpecificData?.chatgptPlanType || auth.chatgpt_plan_type || null
  if (typeof email !== 'string' || plan !== null && typeof plan !== 'string') return null
  const expiryDate = payload?.exp ? new Date(Number(payload.exp) * 1000) : null
  const expires = expiryDate && !Number.isNaN(expiryDate.getTime()) ? expiryDate.toISOString() : obj.expires || obj.expiresAt || null
  const now = new Date().toISOString()
  return { accessToken, refreshToken: obj.refreshToken || obj.refresh_token || '', idToken: obj.idToken || '', expiresAt: expires,
    testStatus: 'active', expiresIn: expires ? Math.max(0, Math.floor((new Date(expires) - Date.now()) / 1000)) : 0,
    providerSpecificData: { chatgptAccountId: accountId, chatgptPlanType: plan }, lastUsedAt: now, consecutiveUseCount: 0, backoffLevel: 0,
    id: accountId, provider: 'codex', authType: 'oauth', name: email || 'ChatGPT Account', email, priority: 1, isActive: true, createdAt: now, updatedAt: now,
    _plan: plan, _expires: expires }
}
export function collectSessions(value) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(collectSessions)
  const session = parseSession(value)
  return session ? [session] : Object.values(value).flatMap(collectSessions)
}
export function parseFileContent(raw, source) {
  if (!raw || typeof raw !== 'object') return []
  const connections = Array.isArray(raw.providerConnections) ? raw.providerConnections.filter((item) => item?.provider === 'codex')
    : Array.isArray(raw) ? raw.filter((item) => item?.provider === 'codex')
      : raw.provider === 'codex' && raw.accessToken ? [raw] : null
  if (connections && (connections.length || !Array.isArray(raw))) return connections.map((conn) => ({ conn, source, type: 'backup' }))
  return collectSessions(raw).map((conn) => ({ conn, source, type: 'session' }))
}
export function deduplicateEntries(entries) {
  const last = new Map()
  entries.forEach((entry, index) => { const email = String(entry.conn.email || '').trim().toLowerCase(); if (email) last.set(email, index) })
  return entries.filter((entry, index) => { const email = String(entry.conn.email || '').trim().toLowerCase(); return !email || last.get(email) === index })
}
export function isK12Invite(enabled, value) {
  if (!enabled) return false
  try { const url = new URL(value); return url.origin === 'https://chatgpt.com' && !url.username && !url.password && /^\/k12-invite\/?$/.test(url.pathname) } catch { return false }
}
export function webResultVerified(result) {
  return result.status === 'success' && !result.postLoginError && (result.workspaceCheckRequired === true ? result.workspaceVerified === true : result.personalAccountVerified === true)
}
