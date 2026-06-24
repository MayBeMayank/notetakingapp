import { getStoredRefreshToken, useAuthStore } from '@/stores/auth.store'

const API_URL = import.meta.env.VITE_API_URL ?? '/api'

export interface FieldError {
  field: string
  message: string
}

/** Normalized error surfaced to callers, parsed from the standard error envelope. */
export class ApiError extends Error {
  status: number
  code: string
  fields?: FieldError[]

  constructor(status: number, code: string, message: string, fields?: FieldError[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export interface RequestOptions {
  method?: string
  body?: unknown
  /** When true (default) the access token is attached and 401 triggers a refresh+retry. */
  auth?: boolean
}

/** Parse `{ error: { code, message, fields? } }` into an ApiError; tolerate non-JSON bodies. */
async function toApiError(res: Response): Promise<ApiError> {
  let code = 'UNKNOWN'
  let message = res.statusText || 'Request failed'
  let fields: FieldError[] | undefined
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; fields?: FieldError[] }
    }
    if (body?.error) {
      code = body.error.code ?? code
      message = body.error.message ?? message
      fields = body.error.fields
    }
  } catch {
    // non-JSON response — keep defaults
  }
  return new ApiError(res.status, code, message, fields)
}

// Single-flight refresh: concurrent 401s share one /auth/refresh call.
let refreshPromise: Promise<string> | null = null

async function performRefresh(): Promise<string> {
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) {
    throw new ApiError(401, 'UNAUTHORIZED', 'No refresh token')
  }
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  if (!res.ok) {
    throw await toApiError(res)
  }
  const data = (await res.json()) as { accessToken: string; refreshToken: string }
  useAuthStore.getState().setTokens(data)
  return data.accessToken
}

function refreshOnce(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

/**
 * On app boot, exchange a persisted refresh token for an access token so the
 * in-memory session is restored after a reload. Resolves the store status to
 * 'authenticated' on success or 'anonymous' on failure / no token.
 */
export async function bootstrapSession(): Promise<void> {
  if (!getStoredRefreshToken()) {
    useAuthStore.getState().setStatus('anonymous')
    return
  }
  try {
    await refreshOnce() // sets tokens + status 'authenticated' on success
  } catch {
    useAuthStore.getState().clear()
  }
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = opts

  const send = (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (auth && token) headers['Authorization'] = `Bearer ${token}`
    return fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  let res = await send(useAuthStore.getState().accessToken)

  // Expired access token on a protected call → refresh once, then retry once.
  if (res.status === 401 && auth && getStoredRefreshToken()) {
    try {
      const newToken = await refreshOnce()
      res = await send(newToken)
    } catch {
      // Refresh failed (expired/revoked/unknown): drop the session. The route guard
      // observes the cleared store and redirects to /login.
      useAuthStore.getState().clear()
      throw new ApiError(401, 'UNAUTHORIZED', 'Session expired')
    }
  }

  if (!res.ok) {
    throw await toApiError(res)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}
