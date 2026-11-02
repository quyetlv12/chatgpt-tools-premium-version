export function normalizeAccounts(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n').map(line => {
    const cleaned = line.replace(/^\s*(?:\*\*)?第\s*[0-9０-９]+\s*张(?:\*\*)?(?:\s*[:：])?\s*/u, '')
    if (cleaned.includes('|')) return cleaned
    const parts = cleaned.split('----')
    return parts.length === 3 && parts.every(part => part.trim()) ? parts.join('|') : cleaned
  }).filter(line => line.trim()).join('\n')
}
export const terminal = item => ['success', 'error', 'cancelled'].includes(item?.status)
export const rowChangeEligible = j => j.mode === 'check_only' && j.status === 'success' && j.account_state === 'live'
export const combinedEligible = j => rowChangeEligible(j) && j.login_verified && !j.rotated_pending_verify
export const accountBusy = j => ['queued','running'].includes(j.status) || j.chat_deleting || j.sessions_logging_out || j.passkey_preparing || j.usage_refreshing
export const logoutEligible = j => j.status === 'success' && j.account_state === 'live' && !accountBusy(j)
export const clearableFailure = j => ['error', 'cancelled'].includes(j.status) && j.account_state !== 'live'
export function failureGroup(job) {
  if (!clearableFailure(job)) return null
  if (job.account_state === 'die' || job.error_kind === 'account_die') return 'die'
  return /\bHTTP\s+403\b/i.test(job.error || '') ? 'http403' : 'other'
}
export const matchesFailure = (job, type = 'all') => type === 'all' ? clearableFailure(job) : failureGroup(job) === type
export function filteredJobs(jobs, filter, statusFor = j => j.status) {
  return jobs.filter(j => {
    const percent = j.usage?.used_percent
    const valid = typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100
    if (filter === 'all') return true
    if (filter === 'running') return ['queued','running'].includes(statusFor(j))
    if (filter === 'error') return ['error','cancelled'].includes(statusFor(j))
    if (filter === 'usage-low') return valid && percent < 50
    if (filter === 'usage-full') return valid && percent === 100
    if (filter === 'free-no-usage') return j.status === 'success' && j.account_state === 'live' && ['free','plus'].includes(j.plan?.toLowerCase()) && j.usage_enabled !== false && !valid
    return statusFor(j) === filter
  })
}
export function settingsPayload(settings, input) {
  return { max_concurrent: Number(settings['twofa.max_concurrent'] ?? 1), job_timeout: Number(settings['twofa.job_timeout'] ?? 180), auto_retry: Boolean(settings['twofa.auto_retry']), auto_retry_max: Number(settings['twofa.auto_retry_max'] ?? 0), auto_retry_delay: Number(settings['twofa.auto_retry_delay'] ?? 5), change_enabled: Boolean(settings['twofa.change_enabled']), read_usage: settings['twofa.read_usage'] !== false, read_payment_methods: settings['twofa.read_payment_methods'] !== false, input_draft: input }
}
export function applyEvent(jobs, payload) {
  if (payload.type === 'snapshot') return payload.jobs || []
  if (payload.type === 'removed') return jobs.filter(j => j.id !== payload.id)
  if (payload.type === 'job' && payload.job) return jobs.some(j => j.id === payload.job.id) ? jobs.map(j => j.id === payload.job.id ? payload.job : j) : [...jobs, payload.job]
  return jobs
}

export const journalEligible = j => j.status === 'success' && j.account_state === 'live' && j.login_verified && !j.rotated_pending_verify
export const usageEligible = j => j.status === 'success' && j.account_state === 'live' && j.usage_enabled !== false && j.usage == null
// Each account is attempted once. A partial failure never retries a side effect.
export async function runBatch(rows, action, onAttempt = () => {}) {
  let succeeded = 0, failed = 0
  for (const row of rows) {
    try { await action(row); succeeded++ } catch { failed++ }
    finally { onAttempt(row.id) }
  }
  return { succeeded, failed }
}

// Match the original selected combined flow: bound starts, never retry a mutation.
export async function runCombinedBatch(rows, concurrency, action, onStarted = () => {}) {
  let next = 0, succeeded = 0, failed = 0
  const workers = Math.min(rows.length, Math.max(1, Math.floor(Number(concurrency)) || 1))
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < rows.length) {
      const row = rows[next++]
      try {
        const operation = await action(row)
        if (!operation?.id) throw new Error('Combined start was not accepted')
        succeeded++; onStarted(row.id)
      } catch { failed++ }
    }
  }))
  return { succeeded, failed }
}
