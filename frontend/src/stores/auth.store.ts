import { create } from 'zustand'

export interface AuthUser {
  id: string
  email: string
}

export type AuthStatus = 'anonymous' | 'pending' | 'authenticated'

/** The ONLY persisted auth item. The access token lives in memory only. */
export const REFRESH_KEY = 'note-app.refreshToken'

export function getStoredRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(REFRESH_KEY)
}

function setStoredRefreshToken(token: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(REFRESH_KEY, token)
}

function removeStoredRefreshToken(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(REFRESH_KEY)
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  status: AuthStatus
  /** Login: store identity + access token (memory) and refresh token (localStorage). */
  setSession(p: { accessToken: string; refreshToken: string; user: AuthUser }): void
  /** Refresh rotation: replace the token pair, keep the existing user. */
  setTokens(p: { accessToken: string; refreshToken: string }): void
  setStatus(status: AuthStatus): void
  /** Drop in-memory state and remove the persisted refresh token. */
  clear(): void
}

// If a refresh token survived a reload but no access token is in memory yet,
// we start in 'pending' so the guard waits for bootstrap rather than flashing login.
const initialStatus: AuthStatus = getStoredRefreshToken() ? 'pending' : 'anonymous'

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: initialStatus,
  setSession: ({ accessToken, refreshToken, user }) => {
    setStoredRefreshToken(refreshToken)
    set({ accessToken, user, status: 'authenticated' })
  },
  setTokens: ({ accessToken, refreshToken }) => {
    setStoredRefreshToken(refreshToken)
    set({ accessToken, status: 'authenticated' })
  },
  setStatus: (status) => set({ status }),
  clear: () => {
    removeStoredRefreshToken()
    set({ user: null, accessToken: null, status: 'anonymous' })
  },
}))
