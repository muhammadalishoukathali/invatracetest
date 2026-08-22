import { useEffect, useSyncExternalStore } from 'react'

/** Reflects navigator.onLine, updating on the online/offline window events.
 *  useSyncExternalStore keeps this SSR-safe and re-render-consistent. */
function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/** Fires `fn` once, immediately after transitioning offline → online. */
export function useOnReconnect(fn: () => void) {
  useEffect(() => {
    window.addEventListener('online', fn)
    return () => window.removeEventListener('online', fn)
  }, [fn])
}
