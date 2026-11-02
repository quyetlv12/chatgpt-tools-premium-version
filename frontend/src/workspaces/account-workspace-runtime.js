import { useCallback, useEffect, useRef, useState } from 'react'
import { modulePath, moduleRequest } from '@/lib/module-api'

const aborted = () => new DOMException('Workspace đã đóng.', 'AbortError')

// Private responses live only in the mounted workspace, never in a query cache.
export function usePrivateWorkspaceApi(token) {
  const lifetime = useRef(null)
  const dispose = useCallback(() => {
    if (!lifetime.current) return
    lifetime.current.active = false
    lifetime.current.controllers.forEach(controller => controller.abort())
    lifetime.current.controllers.clear()
  }, [])
  useEffect(() => {
    lifetime.current = { active: true, controllers: new Set() }
    return dispose
  }, [token, dispose])
  const request = useCallback(async (path, { signal, timeout, timeoutMessage, ...options } = {}) => {
    const session = lifetime.current
    if (!session?.active || !token) throw aborted()
    const controller = new AbortController()
    session.controllers.add(controller)
    const onAbort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    let timedOut = false
    const timer = timeout ? setTimeout(() => { timedOut = true; controller.abort() }, timeout) : null
    try {
      const data = await moduleRequest('twofa', path, { ...options, token, signal: controller.signal })
      if (!session.active || signal?.aborted) throw aborted()
      return data
    } catch (error) {
      if (!session.active || signal?.aborted) throw aborted()
      if (timedOut) throw new Error(timeoutMessage || 'Yêu cầu quá thời gian. Hãy kiểm tra trạng thái trước khi thử lại.')
      throw error
    } finally {
      clearTimeout(timer)
      session.controllers.delete(controller)
      signal?.removeEventListener('abort', onAbort)
    }
  }, [token])
  const isActive = useCallback(() => Boolean(lifetime.current?.active), [])
  return { request, dispose, isActive }
}

export function useWorkspaceEvents(kind, token, enabled, keepHidden, onEvent) {
  const handler = useRef(onEvent)
  useEffect(() => { handler.current = onEvent }, [onEvent])
  const [connection, setConnection] = useState('connecting')
  useEffect(() => {
    if (!enabled || !token) return
    let source = null
    let disposed = false
    function close() { source?.close(); source = null }
    function sync() {
      if (disposed) return
      if (document.visibilityState === 'hidden' && !keepHidden) { close(); setConnection('paused'); return }
      if (source) return
      setConnection('connecting')
      source = new EventSource(modulePath('twofa', `/api/${kind}/events?token=${encodeURIComponent(token)}`))
      const current = source
      source.onopen = () => { if (!disposed && source === current) setConnection('connected') }
      source.onerror = () => { if (!disposed && source === current) setConnection('reconnecting') }
      source.onmessage = event => {
        if (disposed || source !== current) return
        try { handler.current(JSON.parse(event.data)) } catch { /* Ignore malformed events without logging private payloads. */ }
      }
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('pagehide', close)
    window.addEventListener('pageshow', sync)
    return () => {
      disposed = true
      close()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pagehide', close)
      window.removeEventListener('pageshow', sync)
    }
  }, [kind, token, enabled, keepHidden])
  return connection
}

export async function copyPrivateText(text) {
  if (!text) return
  if (!navigator.clipboard?.writeText) throw new Error('Trình duyệt không hỗ trợ clipboard bảo mật.')
  await navigator.clipboard.writeText(text)
}

export function downloadPrivateText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
