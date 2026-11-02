const MODULES = new Set(['twofa', 'export', 'browser', 'chat-backup'])

export function modulePath(key, path = '/') {
  if (!MODULES.has(key) || !path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) throw new Error('Đường dẫn module không hợp lệ.')
  let decoded
  try { decoded = decodeURIComponent(path.split('?')[0]) } catch { throw new Error('Đường dẫn module không hợp lệ.') }
  if (/[\\\r\n]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) throw new Error('Đường dẫn module không hợp lệ.')
  return `/modules/${key}${path}`
}

export async function moduleRequest(key, path, { method = 'GET', body, token, signal } = {}) {
  const headers = {}
  if (token) headers['X-Auth-Token'] = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(modulePath(key, path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: 'no-store' })
  const json = response.headers.get('content-type')?.includes('application/json')
  const data = json ? await response.json() : await response.text()
  if (!response.ok) {
    const detail = typeof data === 'object' && data ? data.detail || data.error : null
    // Validation payloads can contain submitted credentials; never echo them.
    throw new Error(typeof detail === 'string' && detail.length < 500 ? detail : `Yêu cầu thất bại (HTTP ${response.status}).`)
  }
  return data
}
