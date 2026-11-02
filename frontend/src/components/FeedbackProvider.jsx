import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertDialog } from 'radix-ui'
import { Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmContext } from '@/lib/use-confirm'

export function FeedbackProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const pending = useRef(null)
  const trigger = useRef(null)
  const [context] = useState(() => ({
    request(options, owner) {
      if (pending.current) return Promise.resolve(false)
      trigger.current = document.activeElement
      return new Promise(resolve => {
        pending.current = { resolve, owner }
        setDialog(options)
      })
    },
    cancel(owner) {
      if (pending.current?.owner !== owner) return
      const current = pending.current
      pending.current = null
      setDialog(null)
      current.resolve(false)
    },
  }))
  const settle = useCallback(result => {
    const current = pending.current
    if (!current) return
    pending.current = null
    setDialog(null)
    current.resolve(result)
  }, [])
  useEffect(() => {
    const cancel = () => settle(false)
    window.addEventListener('hashchange', cancel)
    return () => { window.removeEventListener('hashchange', cancel); cancel() }
  }, [settle])

  return <ConfirmContext.Provider value={context}>
    {children}
    <AlertDialog.Root open={Boolean(dialog)} onOpenChange={open => { if (!open) settle(false) }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="feedback-overlay feedback-confirm-overlay" />
        <AlertDialog.Content className="feedback-confirm" onCloseAutoFocus={event => {
          event.preventDefault()
          if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true })
        }}>
          <AlertDialog.Title className="feedback-title">{dialog?.title || 'Xác nhận thao tác'}</AlertDialog.Title>
          <AlertDialog.Description className="feedback-description">{dialog?.description}</AlertDialog.Description>
          <div className="feedback-actions">
            <AlertDialog.Cancel asChild><Button variant="outline" onClick={() => settle(false)}>Hủy</Button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Button variant={dialog?.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>{dialog?.confirmText || 'Xác nhận'}</Button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
    <Toaster theme="dark" position="top-right" richColors closeButton visibleToasts={3}
      offset={24} mobileOffset={16} gap={10} toastOptions={{ className: 'feedback-toast', closeButtonAriaLabel: 'Đóng thông báo' }}
      customAriaLabel="Thông báo" containerAriaLabel="Thông báo hệ thống" />
  </ConfirmContext.Provider>
}
