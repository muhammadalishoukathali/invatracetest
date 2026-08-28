import { useEffect, useRef } from 'react'

/** Route-level headings receive focus after navigation without entering the tab order. */
export function usePageHeadingFocus() {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return ref
}
