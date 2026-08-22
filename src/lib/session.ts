import { create } from 'zustand'
import type { User, AuthResponse } from '@/types'
import { api, setAccessToken } from './api'

type Status = 'loading' | 'unauthenticated' | 'authenticated'

interface SessionState {
  status: Status
  user: User | null
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string, role: 'Detector' | 'Volunteer' | 'Coordinator') => Promise<void>
  bootstrap: () => Promise<void>
  signOut: () => void
}

function applyAuth(set: (partial: Partial<SessionState>) => void, res: AuthResponse) {
  setAccessToken(res.accessToken)
  set({ status: 'authenticated', user: res.user })
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,

  initialize: async () => {
    try {
      const res = await api<AuthResponse>('/api/v1/auth/refresh', { method: 'POST' })
      applyAuth(set, res)
    } catch {
      set({ status: 'unauthenticated', user: null })
    }
  },

  signIn: async (email, password) => {
    const res = await api<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    applyAuth(set, res)
  },

  register: async (name, email, password, role) => {
    const res = await api<AuthResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, role }),
    })
    applyAuth(set, res)
  },

  bootstrap: async () => {
    const deviceToken = crypto.randomUUID()
    const res = await api<AuthResponse>('/api/v1/profiles/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ deviceToken }),
    })
    applyAuth(set, res)
  },

  signOut: () => {
    setAccessToken(null)
    set({ status: 'unauthenticated', user: null })
    // Fire-and-forget: server clears the refresh cookie. Local state has
    // already been wiped so a failure here doesn't affect the user.
    void api('/api/v1/auth/logout', { method: 'POST' }).catch(() => {})
  },
}))
