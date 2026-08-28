import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from '@/app/router'
import { installIdentityConnectivity, useIdentity } from '@/lib/identity'
import { flushQueue } from '@/lib/report-queue'
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
    /* MSW intercepts everything under `/` in dev, which breaks MapLibre's
     *  module worker script (it silently returns an empty body). Only route
     *  /api requests through MSW; let workers, HMR, tiles, fonts, and vendor
     *  bundles hit the real network unmodified. */
    await worker.start({
      onUnhandledRequest: 'bypass',
      // MSW's default logger includes request/response bodies. Bootstrap
      // bodies contain installation and access tokens, so keep it silent.
      quiet: true,
      serviceWorker: { url: '/mockServiceWorker.js' },
    })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )

  installIdentityConnectivity(flushQueue)
  await useIdentity.getState().initialize()
  if (useIdentity.getState().status === 'ready') void flushQueue()
}

void start()
