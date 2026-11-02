import { toast } from 'sonner'

export function notify(message, type = 'success', options = {}) {
  if (!message) return
  const show = { success: toast.success, error: toast.error, info: toast.info, warning: toast.warning }[type] || toast
  return show(message, { duration: type === 'error' ? 7000 : 4500, ...options })
}
