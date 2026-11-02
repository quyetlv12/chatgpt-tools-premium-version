import { useLayoutEffect, useRef } from 'react'
import './numbered-textarea.css'

export default function NumberedTextarea({ value = '', className = '', ...props }) {
  const textarea = useRef(null)
  const numbers = useRef(null)
  const count = value ? value.split('\n').length : 0

  function syncScroll() {
    numbers.current.style.transform = `translateY(-${textarea.current.scrollTop}px)`
  }
  useLayoutEffect(syncScroll, [value])

  return <div className={`tf-numbered-editor ${className}`} style={{ '--number-width': `${Math.max(4, String(count).length + 2)}ch` }}>
    <div className="tf-line-gutter" aria-hidden="true"><div ref={numbers}>{Array.from({ length: count }, (_, i) => i + 1).join('\n')}</div></div>
    <textarea {...props} ref={textarea} className="tf-editor" value={value} wrap="off" onScroll={syncScroll} />
  </div>
}
