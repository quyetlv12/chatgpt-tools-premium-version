export async function request(path, { signal, method = 'GET' } = {}) {
  const response = await fetch(path, { signal, method, cache: 'no-store' })
  if (!response.ok) throw new Error(`Dịch vụ trả về lỗi ${response.status}.`)
  return response.json()
}

export async function fetchStatus({ signal }) {
  const data = await request('/api/status', { signal })
  if (!Array.isArray(data.modules) || !data.modules.every(
    (module) => typeof module.key === 'string' && typeof module.ready === 'boolean',
  )) throw new Error('Dữ liệu trạng thái không hợp lệ.')
  return data
}

export const statusOptions = {
  queryKey: ['suite-status'], queryFn: fetchStatus,
  refetchInterval: query => query.state.status === 'success'
    && query.state.data?.modules?.every(module => module.ready)
    && !query.state.data.browser_windows_open ? 5000 : 3000,
  staleTime: 2000, retry: false,
}
