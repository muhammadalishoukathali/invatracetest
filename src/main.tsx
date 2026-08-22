import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from '@/app/router'
import { useSession } from '@/lib/session'
import { flushQueue, installOnlineFlush } from '@/lib/report-queue'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (n) => Math.min(1000 * 2 ** n, 15000),
      staleTime: 30_000,
    },
  },
})

async function start() {
  if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCKS === 'true') {
    const { worker } = await import('@/mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }

  try {
    await useSession.getState().initialize()
  } catch (err) {
    // A refresh-token failure is expected for a fresh visitor; anything else
    // is a real network problem, so surface a retry screen instead of freezing
    // the loading spinner behind a rejected promise.
    if (import.meta.env.DEV) console.warn('[cold-start]', err)
    renderColdStartError(err instanceof Error ? err : new Error(String(err)))
    return
  }
  installOnlineFlush()
  void flushQueue()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

function renderColdStartError(err: Error) {
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = `
    <div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;background:#F4F6F3;font-family:'Inter',system-ui,sans-serif;">
      <div style="max-width:380px;text-align:center;">
        <div style="width:56px;height:56px;border-radius:50%;background:#FBEAE6;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
          <span style="font-size:28px;color:#C2412D;">⚠</span>
        </div>
        <h1 style="font-size:20px;font-weight:700;color:#16201B;letter-spacing:-0.02em;">Could not reach InvaTrace</h1>
        <p style="font-size:13.5px;color:#4B5A52;margin-top:10px;line-height:1.55;">
          ${err.message || 'Check your connection and try again.'}
        </p>
        <button id="cold-start-retry" style="margin-top:18px;height:46px;padding:0 22px;border-radius:9px;border:none;background:#1B7A50;color:#fff;font-weight:600;font-size:14px;cursor:pointer;">
          Try again
        </button>
      </div>
    </div>
  `
  document.getElementById('cold-start-retry')?.addEventListener('click', () => location.reload())
}

void start()
