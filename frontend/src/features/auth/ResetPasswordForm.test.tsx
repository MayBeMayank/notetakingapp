import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ResetPasswordForm } from './ResetPasswordForm'
import { jsonResponse, makeTestQueryClient } from '@/test/utils'

function renderReset() {
  const client = makeTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/reset-password', state: { email: 'pre@b.com' } }]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordForm />} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route path="/forgot-password" element={<div>FORGOT PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('auth-ui › Reset-password screen', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('prefills the email from route state and routes to /login on success', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })) as unknown as typeof fetch)
    renderReset()

    expect(screen.getByLabelText('Email')).toHaveValue('pre@b.com')
    await user.type(screen.getByLabelText('Reset code'), '123456')
    await user.type(screen.getByLabelText('New password'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
  })

  it('blocks submit on invalid OTP or weak password', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    renderReset()

    await user.type(screen.getByLabelText('Reset code'), '123')
    await user.type(screen.getByLabelText('New password'), 'short')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a bad/expired OTP error', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(422, { error: { code: 'INVALID_OTP', message: 'Invalid or expired OTP' } }),
      ) as unknown as typeof fetch,
    )
    renderReset()

    await user.type(screen.getByLabelText('Reset code'), '999999')
    await user.type(screen.getByLabelText('New password'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText('Invalid or expired OTP')).toBeInTheDocument()
  })

  it('shows the attempts-exhausted message with a link back to forgot-password', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(422, {
          error: { code: 'OTP_ATTEMPT_LIMIT_REACHED', message: 'Too many failed attempts.' },
        }),
      ) as unknown as typeof fetch,
    )
    renderReset()

    await user.type(screen.getByLabelText('Reset code'), '999999')
    await user.type(screen.getByLabelText('New password'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText(/too many failed attempts/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /request a new code/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('disables the submit button while pending', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as unknown as typeof fetch)
    renderReset()

    await user.type(screen.getByLabelText('Reset code'), '123456')
    await user.type(screen.getByLabelText('New password'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /resetting/i })).toBeDisabled())
  })
})
