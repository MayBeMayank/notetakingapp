import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { RegisterForm } from './RegisterForm'
import { useAuthStore } from '@/stores/auth.store'
import { jsonResponse, makeTestQueryClient } from '@/test/utils'

function renderRegister() {
  const client = makeTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterForm />} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('auth-ui › Registration screen', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null, accessToken: null, status: 'anonymous' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('routes to /login on success and stores no token', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(201, { user: { id: 'u1', email: 'new@b.com' } })) as unknown as typeof fetch,
    )
    renderRegister()

    await user.type(screen.getByLabelText('Email'), 'new@b.com')
    await user.type(screen.getByLabelText('Password'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('blocks submit when the password fails the policy', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    renderRegister()

    await user.type(screen.getByLabelText('Email'), 'new@b.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a duplicate-email conflict on the email field', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(422, { error: { code: 'DUPLICATE_EMAIL', message: 'Email already registered' } }),
      ) as unknown as typeof fetch,
    )
    renderRegister()

    await user.type(screen.getByLabelText('Email'), 'taken@b.com')
    await user.type(screen.getByLabelText('Password'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('Email already registered')).toBeInTheDocument()
  })

  it('maps server 400 field errors onto inputs', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            fields: [{ field: 'password', message: 'Server rejected the password' }],
          },
        }),
      ) as unknown as typeof fetch,
    )
    renderRegister()

    await user.type(screen.getByLabelText('Email'), 'new@b.com')
    await user.type(screen.getByLabelText('Password'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('Server rejected the password')).toBeInTheDocument()
  })

  it('disables the submit button while pending', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as unknown as typeof fetch)
    renderRegister()

    await user.type(screen.getByLabelText('Email'), 'new@b.com')
    await user.type(screen.getByLabelText('Password'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled())
  })

  it('never writes the plaintext password to the console', async () => {
    const user = userEvent.setup()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(201, { user: { id: 'u1', email: 'new@b.com' } })) as unknown as typeof fetch,
    )
    renderRegister()

    await user.type(screen.getByLabelText('Email'), 'new@b.com')
    await user.type(screen.getByLabelText('Password'), 'Sup3rSecret')
    await user.click(screen.getByRole('button', { name: /create account/i }))
    await screen.findByText('LOGIN PAGE')

    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().join(' ')
    expect(logged).not.toContain('Sup3rSecret')
  })
})
