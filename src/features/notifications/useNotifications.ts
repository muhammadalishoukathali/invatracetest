/**
 * Custom hook pair for the notification bell: `useNotifications` polls the
 * unread list every 30 seconds while the tab is visible (background polling
 * is off so hidden tabs don't make unnecessary requests), and
 * `useMarkNotificationRead` marks one or all notifications read.
 *
 * Call `useNotifications` anywhere you need the current unread count or list
 * — right now that's just NotificationsPanel.tsx. It's gated on
 * `sessionReady` from private-access-store.ts so it doesn't fire before a
 * profile exists. Gotcha: `markOne`/`markAll` do a hard `refetchQueries`
 * rather than an optimistic update, so the panel briefly shows the old read
 * state until the refetch resolves.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api-client'
import type { AppNotification } from '@/types'
import { usePrivateAccess } from '@/features/private-access/private-access-store'

interface Payload { items: AppNotification[]; unread: number }

export function useNotifications() {
  const sessionReady = usePrivateAccess((state) => state.status === 'ready')
  const profileId = usePrivateAccess((state) => state.profile?.id ?? null)
  return useQuery({
    queryKey: ['notifications', profileId],
    queryFn: () => api<Payload>('/api/v1/notifications'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
    enabled: sessionReady,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  const profileId = usePrivateAccess((state) => state.profile?.id ?? null)
  return {
    markOne: async (id: string) => {
      await api(`/api/v1/notifications/${id}/read`, { method: 'POST' })
      await qc.refetchQueries({ queryKey: ['notifications', profileId] })
    },
    markAll: async () => {
      await api('/api/v1/notifications/read-all', { method: 'POST' })
      await qc.refetchQueries({ queryKey: ['notifications', profileId] })
    },
  }
}
