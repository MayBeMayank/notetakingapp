import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { LogoutButton } from './LogoutButton'
import { useAuthStore } from '@/stores/auth.store'
import { jsonResponse, makeTestQueryClient } from '@/test/utils'

function renderLogout() {
  const client = makeTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<LogoutButton />} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('auth-ui › Logout control', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.getState().setSession({
      accessToken: 'a1',
      refreshToken: 'r1',
      user: { id: 'u1', email: 'a@b.com' },
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('clears the session and redirects to /login on success', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(204)) as unknown as typeof fetch)
    renderLogout()

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('clears the session even when the logout call fails', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } })) as unknown as typeof fetch,
    )
    renderLogout()

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('leaves the store anonymous so protected routes become inaccessible', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(204)) as unknown as typeof fetch)
    renderLogout()

    await user.click(screen.getByRole('button', { name: /sign out/i }))
    await screen.findByText('LOGIN PAGE')

    // The guard keys on this status; anonymous => redirect to /login on any protected route.
    expect(useAuthStore.getState().status).toBe('anonymous')
  })
})
