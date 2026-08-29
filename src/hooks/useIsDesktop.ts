import { useEffect, useState } from 'react'

/** The application switches from bottom tabs to the desktop sidebar at 900px. */
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
