import { afterEach, describe, expect, it } from 'bun:test'
import { fetchStatus, request, statusOptions } from './api'
const originalFetch = globalThis.fetch

afterEach(() => { globalThis.fetch = originalFetch })
describe('Suite API contract', () => {
  it('slows only healthy idle status polling and keeps failures and windows responsive', () => {
    const interval = (status, data) => statusOptions.refetchInterval({ state: { status, data } })
    const ready = { modules: [{ key: 'twofa', ready: true }], browser_windows_open: false }
    expect(interval('success', ready)).toBe(5000)
    expect(interval('success', { ...ready, browser_windows_open: true })).toBe(3000)
    expect(interval('success', { ...ready, modules: [{ key: 'twofa', ready: false }] })).toBe(3000)
    expect(interval('error', ready)).toBe(3000)
    expect(interval('pending')).toBe(3000)
    expect(statusOptions.staleTime).toBe(2000)
  })
  it('forwards cancellation and never caches readiness', async () => {
    const controller = new AbortController()
    let options
    globalThis.fetch = async (_url, config) => {
      options = config
      return Response.json({ modules: [{ key: 'twofa', ready: true }] })
    }
    expect((await fetchStatus({ signal: controller.signal })).modules[0].ready).toBe(true)
    expect(options.signal).toBe(controller.signal)
    expect(options.cache).toBe('no-store')
    expect(statusOptions.retry).toBe(false)
  })
  it('rejects a malformed or failed status response', async () => {
    globalThis.fetch = async () => Response.json({ modules: [{ key: 'twofa', ready: 'yes' }] })
    await expect(fetchStatus({})).rejects.toThrow('không hợp lệ')
    globalThis.fetch = async () => new Response('', { status: 503 })
    await expect(fetchStatus({})).rejects.toThrow('503')
  })
  it('propagates abort and sends mutation only on explicit request', async () => {
    let calls = 0
    globalThis.fetch = async (_url, options) => { calls++; expect(options.method).toBe('POST'); return Response.json({ closed: true }) }
    expect(calls).toBe(0)
    await request('/api/windows/close', { method: 'POST' })
    expect(calls).toBe(1)
    const controller = new AbortController()
    controller.abort()
    globalThis.fetch = originalFetch
    await expect(fetchStatus({ signal: controller.signal })).rejects.toThrow()
  })
})
