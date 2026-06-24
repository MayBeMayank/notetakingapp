import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ForgotPasswordForm } from './ForgotPasswordForm'
import { jsonResponse, makeTestQueryClient } from '@/test/utils'

function ResetMarker() {
  const email = (useLocation().state as { email?: string } | null)?.email
  return <div>RESET PAGE for {email}</div>
}

function renderForgot() {
  const client = makeTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forgot-password']}>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordForm />} />
          <Route path="/reset-password" element={<ResetMarker />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('auth-ui › Forgot-password screen', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows a neutral confirmation on success (anti-enumeration)', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })) as unknown as typeof fetch)
    renderForgot()

    await user.type(screen.getByLabelText('Email'), 'maybe@b.com')
    await user.click(screen.getByRole('button', { name: /send reset code/i }))

    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument()
  })

  it('conveys the dev-mode console hint without leaking existence', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })) as unknown as typeof fetch)
    renderForgot()

    await user.type(screen.getByLabelText('Email'), 'maybe@b.com')
    await user.click(screen.getByRole('button', { name: /send reset code/i }))

    expect(await screen.findByText(/logged to the server console/i)).toBeInTheDocument()
  })

  it('hands off to /reset-password with the email prefilled', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })) as unknown as typeof fetch)
    renderForgot()

    await user.type(screen.getByLabelText('Email'), 'carry@b.com')
    await user.click(screen.getByRole('button', { name: /send reset code/i }))
    await user.click(await screen.findByRole('link', { name: /enter reset code/i }))

    expect(await screen.findByText('RESET PAGE for carry@b.com')).toBeInTheDocument()
  })

  it('blocks submit on an invalid email', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    renderForgot()

    await user.type(screen.getByLabelText('Email'), 'nope')
    await user.click(screen.getByRole('button', { name: /send reset code/i }))

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
