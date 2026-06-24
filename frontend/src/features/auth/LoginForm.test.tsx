import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { LoginForm } from './LoginForm'
import { useAuthStore } from '@/stores/auth.store'
import { jsonResponse, makeTestQueryClient } from '@/test/utils'

function renderLogin() {
  const client = makeTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginForm />} />
          <Route path="/" element={<div>HOME PAGE</div>} />
          <Route path="/register" element={<div>REGISTER PAGE</div>} />
          <Route path="/forgot-password" element={<div>FORGOT PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('auth-ui › Login screen', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null, accessToken: null, status: 'anonymous' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('establishes a session and navigates home on success', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, {
          accessToken: 'a1',
          refreshToken: 'r1',
          user: { id: 'u1', email: 'a@b.com' },
        }),
      ) as unknown as typeof fetch,
    )
    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('HOME PAGE')).toBeInTheDocument()
    expect(useAuthStore.getState().accessToken).toBe('a1')
  })

  it('shows a single generic message on 401 without a field hint', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }),
      ) as unknown as typeof fetch,
    )
    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'wrongpass')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('blocks submit on client-side validation failure', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disables the submit button while the request is pending', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as unknown as typeof fetch)
    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled(),
    )
  })

  it('offers links to register and forgot-password', () => {
    renderLogin()
    expect(screen.getByRole('link', { name: /create account/i })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })
})
