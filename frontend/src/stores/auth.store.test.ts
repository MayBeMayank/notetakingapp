import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REFRESH_KEY, getStoredRefreshToken, useAuthStore } from './auth.store'

describe('frontend-app-shell › Auth session store', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null, accessToken: null, status: 'anonymous' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tokens stored on login: access+user in memory, refresh in localStorage', () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: { id: 'u1', email: 'a@b.com' },
    })

    const state = useAuthStore.getState()
    expect(state.accessToken).toBe('access-1')
    expect(state.user).toEqual({ id: 'u1', email: 'a@b.com' })
    expect(state.status).toBe('authenticated')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-1')
  })

  it('rehydrate after reload: a re-initialized store starts pending when a refresh token persists', async () => {
    localStorage.setItem(REFRESH_KEY, 'refresh-survived')
    vi.resetModules()
    const fresh = await import('./auth.store')
    expect(fresh.getStoredRefreshToken()).toBe('refresh-survived')
    expect(fresh.useAuthStore.getState().status).toBe('pending')
  })

  it('reload with no stored refresh token is anonymous', async () => {
    localStorage.clear()
    vi.resetModules()
    const fresh = await import('./auth.store')
    expect(fresh.useAuthStore.getState().status).toBe('anonymous')
  })

  it('session cleared on logout: memory dropped and refresh key removed', () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: { id: 'u1', email: 'a@b.com' },
    })

    useAuthStore.getState().clear()

    const state = useAuthStore.getState()
    expect(state.accessToken).toBeNull()
    expect(state.user).toBeNull()
    expect(state.status).toBe('anonymous')
    expect(getStoredRefreshToken()).toBeNull()
  })

  it('tokens are never written to the console', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    useAuthStore.getState().setSession({
      accessToken: 'secret-access',
      refreshToken: 'secret-refresh',
      user: { id: 'u1', email: 'a@b.com' },
    })
    useAuthStore.getState().setTokens({ accessToken: 'secret-access-2', refreshToken: 'secret-refresh-2' })
    useAuthStore.getState().clear()

    const allLogged = [...logSpy.mock.calls, ...errSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .join(' ')
    expect(allLogged).not.toContain('secret-access')
    expect(allLogged).not.toContain('secret-refresh')
  })
})
