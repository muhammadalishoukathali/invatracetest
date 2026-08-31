import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from '@/app/router'
import { installPrivateAccessConnectivity, usePrivateAccess } from '@/features/private-access/private-access-store'
import { flushQueue } from '@/features/report/report-queue'
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
    // The development mock service worker handles API calls only. Other files,
    // including MapLibre workers, map tiles, fonts, and Vite updates, must pass
    // through unchanged or the map can load with an empty worker script.
    try {
      await worker.start({
        onUnhandledRequest: 'bypass',
        // Disable request logging because profile requests can contain private
        // installation or access tokens.
        quiet: true,
        serviceWorker: { url: '/mockServiceWorker.js' },
      })
    } catch (err) {
      // Service Worker unavailable (sandboxed preview browser, insecure context,
      // etc.). Continue booting so the UI still renders; API calls will fail.
      console.warn('[MSW] worker.start failed, continuing without mocks:', err)
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )

  installPrivateAccessConnectivity(flushQueue)
  await usePrivateAccess.getState().initialize()
  if (usePrivateAccess.getState().status === 'ready') void flushQueue()
}

void start()
