// Shared TanStack Query client, wired up once in src/main.tsx and used by
// every feature that fetches server data (map sightings, notifications, etc).
// This is the one place that sets retry/stale-time defaults so features
// don't each reinvent their own caching behaviour.
import { QueryClient } from '@tanstack/react-query'

// Retries are generous with backoff because field connectivity is flaky by
// design for this app (see docs/product.md) — a single dropped request
// shouldn't surface an error to someone standing on a trail with one bar.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
      staleTime: 30_000,
    },
  },
})
