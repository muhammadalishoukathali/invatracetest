/** Loads notifications every 30 seconds while the tab is visible. Background
 *  polling is disabled so hidden tabs do not make unnecessary requests. */
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
