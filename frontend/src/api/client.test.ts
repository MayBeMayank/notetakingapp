import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './client'
import { REFRESH_KEY, getStoredRefreshToken, useAuthStore } from '@/stores/auth.store'
import { jsonResponse } from '@/test/utils'

function seedSession(access: string, refresh: string) {
  useAuthStore.getState().setSession({
    accessToken: access,
    refreshToken: refresh,
    user: { id: 'u1', email: 'a@b.com' },
  })
}

describe('frontend-app-shell › Authenticated API client', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null, accessToken: null, status: 'anonymous' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('attaches the Bearer access token on protected calls', async () => {
    seedSession('tok-1', 'refresh-1')
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await apiFetch('/notes')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
  })

  it('on 401 performs a single refresh and retries the original request once', async () => {
    seedSession('stale', 'refresh-1')
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'refresh-2' })
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
      return auth === 'Bearer fresh'
        ? jsonResponse(200, { id: 'n1' })
        : jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await apiFetch<{ id: string }>('/notes')

    expect(result).toEqual({ id: 'n1' })
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'))
    expect(refreshCalls).toHaveLength(1)
    expect(useAuthStore.getState().accessToken).toBe('fresh')
  })

  it('rotated refresh token replaces the old one in localStorage', async () => {
    seedSession('stale', 'refresh-1')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/auth/refresh')) {
          return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'refresh-2' })
        }
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
        return auth === 'Bearer fresh' ? jsonResponse(200, {}) : jsonResponse(401, {})
      }) as unknown as typeof fetch,
    )

    await apiFetch('/notes')

    expect(getStoredRefreshToken()).toBe('refresh-2')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-2')
  })

  it('clears the session when the refresh itself fails (401)', async () => {
    seedSession('stale', 'refresh-1')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/auth/refresh')) {
          return jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'revoked' } })
        }
        return jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } })
      }) as unknown as typeof fetch,
    )

    await expect(apiFetch('/notes')).rejects.toBeInstanceOf(ApiError)
    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(getStoredRefreshToken()).toBeNull()
  })

  it('parses the standard error envelope into code/message/fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Bad input',
            fields: [{ field: 'email', message: 'Must be a valid email' }],
          },
        }),
      ) as unknown as typeof fetch,
    )

    let err: ApiError | undefined
    try {
      await apiFetch('/auth/login', { method: 'POST', body: {}, auth: false })
    } catch (e) {
      err = e as ApiError
    }
    expect(err).toBeInstanceOf(ApiError)
    expect(err?.status).toBe(400)
    expect(err?.code).toBe('VALIDATION_ERROR')
    expect(err?.fields).toEqual([{ field: 'email', message: 'Must be a valid email' }])
  })

  it('coalesces concurrent 401s into a single refresh', async () => {
    seedSession('stale', 'refresh-1')
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'refresh-2' })
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
      return auth === 'Bearer fresh' ? jsonResponse(200, {}) : jsonResponse(401, {})
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await Promise.all([apiFetch('/notes'), apiFetch('/tags'), apiFetch('/search')])

    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/auth/refresh'))
    expect(refreshCalls).toHaveLength(1)
  })
})
