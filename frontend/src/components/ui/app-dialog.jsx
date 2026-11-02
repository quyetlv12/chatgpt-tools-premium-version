import { useEffect, useRef } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function AppDialog({ title, children, onClose, className = '' }) {
  const trigger = useRef(typeof document === 'undefined' ? null : document.activeElement)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const dismiss = () => close.current()
    window.addEventListener('hashchange', dismiss)
    return () => window.removeEventListener('hashchange', dismiss)
  }, [])
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="feedback-overlay" />
      <Dialog.Content className={`app-dialog ${className}`} aria-describedby={undefined} onInteractOutside={event => {
        if (event.target.closest?.('[data-sonner-toaster]')) event.preventDefault()
      }} onCloseAutoFocus={event => {
        event.preventDefault()
        if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true })
      }}>
        <header className="app-dialog-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label="Đóng hộp thoại"><X /></Button></Dialog.Close></header>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
