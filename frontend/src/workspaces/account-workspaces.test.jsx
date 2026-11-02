import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import PasskeyWorkspace from './PasskeyWorkspace'
import PasswordWorkspace from './PasswordWorkspace'
import { AccountDraft, JobQueue } from './account-workspace-shared'
import { accountLines, jobCanDelete, jobCanRetry, jobCanStop, normalizeAccountPaste, passwordCredentialParts, passwordHistoryEntries, targetPasswordError, validPasskeyLaunchPath } from './account-workspace-model'

describe('account input and protected workspace contracts', () => {
  it('normalizes only unambiguous pasted account formats without modifying passwords', () => {
    const fixture = '**第1张**\r\nfirst@example.test----synthetic!$\\*pass----BASE32\r\n第２张： second@example.test----other!----SECRET\n\nmanual@example.test|keep----inside|SECRET'
    expect(normalizeAccountPaste(fixture)).toBe('first@example.test|synthetic!$\\*pass|BASE32\nsecond@example.test|other!|SECRET\n\nmanual@example.test|keep----inside|SECRET')
    expect(normalizeAccountPaste('ambiguous@example.test----has----delimiter----SECRET')).toBe('ambiguous@example.test----has----delimiter----SECRET')
    expect(normalizeAccountPaste('第3张\n')).toBe('')
    expect(accountLines('one\n\n two \n')).toEqual(['one', 'two'])
  })
  it('accepts only the exact one-use local launch route', () => {
    const token = 'a'.repeat(43)
    expect(validPasskeyLaunchPath(`/api/passkey/launch/${token}`)).toBe(true)
    for (const path of [`https://example.test/api/passkey/launch/${token}`, `//api/passkey/launch/${token}`, `/api/passkey/launch/${token}?x=1`, `/api/passkey/launch/${token}/`, `/api/passkey/launch/${'a'.repeat(42)}`, null]) expect(validPasskeyLaunchPath(path)).toBe(false)
  })
  it('restricts retries and row mutations to the existing lifecycle', () => {
    expect(jobCanRetry({ status: 'success' })).toBe(false)
    expect(jobCanRetry({ status: 'error', retryable: false })).toBe(false)
    expect(jobCanRetry({ status: 'cancelled' })).toBe(true)
    expect(jobCanStop({ status: 'running' })).toBe(true)
    expect(jobCanStop({ status: 'success' })).toBe(false)
    expect(jobCanDelete({ status: 'queued' })).toBe(false)
    expect(jobCanDelete({ status: 'error' })).toBe(true)
  })
  it('validates password settings without silently clearing a blank target', () => {
    expect(targetPasswordError('')).toContain('không thay đổi')
    expect(targetPasswordError('short')).toContain('12')
    expect(targetPasswordError('a'.repeat(129))).not.toBe('')
    expect(targetPasswordError('synthetic|password')).not.toBe('')
    expect(targetPasswordError('synthetic\npassword')).not.toBe('')
    expect(targetPasswordError('Synthetic!$\\*password')).toBe('')
  })
  it('searches password history by email only and preserves original raw lines', () => {
    const history = [{ email: 'First@Example.test', raw: 'First@Example.test|needle-password|secret|tail' }, { email: 'second@example.test', raw: 'second@example.test|private|secret' }]
    expect(passwordHistoryEntries(history, 'FIRST').map(item => item.index)).toEqual([0])
    expect(passwordHistoryEntries(history, 'needle-password')).toEqual([])
    expect(passwordCredentialParts(history[0])).toEqual({ email: 'First@Example.test', password: 'needle-password', secret: 'secret|tail' })
    expect(passwordHistoryEntries(history, '')[0].entry.raw).toBe(history[0].raw)
  })
  it('renders native React forms and no account mutation or legacy embed on mount', () => {
    const passkey = renderToStaticMarkup(<PasskeyWorkspace token="synthetic-local-token" />)
    const password = renderToStaticMarkup(<PasswordWorkspace token="synthetic-local-token" onClose={() => {}} />)
    for (const html of [passkey, password]) {
      expect(html).not.toContain('<iframe')
      expect(html).not.toContain('<script')
      expect(html).not.toContain('synthetic-local-token')
      expect(html).toContain('<textarea')
      expect(html).toContain('Dọn danh sách')
    }
    expect(passkey).toContain('chưa có nghĩa là đã thêm passkey')
    expect(passkey).toContain('Dừng tất cả')
    expect(passkey).toContain('Đóng tất cả cửa sổ')
    expect(password).toContain('Mật khẩu chung')
    expect(password).toContain('Lịch sử')
    expect(password).toContain('Quay lại')
  })
  it('renders escaped email and keeps copy adjacent while omitting unavailable actions', () => {
    const job = { id: 'synthetic', email: '<private@example.test>', status: 'success', phase: 'verified' }
    const html = renderToStaticMarkup(<JobQueue jobs={[job]} kind="password" onAction={() => {}} phaseLabel={() => 'ĐÃ VERIFY LOGIN'} phaseDetail={() => 'Fresh login thành công'} />)
    expect(html).toContain('&lt;private@example.test&gt;')
    expect(html).toContain('Copy email')
    expect(html).not.toContain('Chạy lại')
    expect(html).not.toContain('Dừng ')
    expect(html).toContain('Xóa ')
    expect(renderToStaticMarkup(<AccountDraft id="test" value="" onChange={() => {}} />)).toContain('autoComplete="off"')
  })
})
