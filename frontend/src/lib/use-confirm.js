import { createContext, useCallback, useContext, useEffect, useRef } from 'react'

export const ConfirmContext = createContext(null)

export function useConfirm() {
  const context = useContext(ConfirmContext)
  const owner = useRef(Symbol('confirmation'))
  useEffect(() => () => context?.cancel(owner.current), [context])
  return useCallback(options => context?.request(options, owner.current) ?? Promise.resolve(false), [context])
}
