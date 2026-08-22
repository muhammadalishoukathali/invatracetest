/** Notifications hook. Pull-based per Arch §14 (no push wiring in Iter 1).
 *  Polls every 30 s while the tab is visible. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { AppNotification } from '@/types'

interface Payload { items: AppNotification[]; unread: number }

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Payload>('/api/v1/notifications'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return {
    markOne: async (id: string) => {
      await api(`/api/v1/notifications/${id}/read`, { method: 'POST' })
      await qc.refetchQueries({ queryKey: ['notifications'] })
    },
    markAll: async () => {
      await api('/api/v1/notifications/read-all', { method: 'POST' })
      await qc.refetchQueries({ queryKey: ['notifications'] })
    },
  }
}
