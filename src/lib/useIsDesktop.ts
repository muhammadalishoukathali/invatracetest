import { useEffect, useState } from 'react'

/** 900px is the breakpoint the approved prototype switches layout at. */
const QUERY = '(min-width: 900px)'

export function useIsDesktop(): boolean {
  const [match, setMatch] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  return match
}
