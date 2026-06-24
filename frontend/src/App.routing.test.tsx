import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import App from './App'
import { useAuthStore } from '@/stores/auth.store'
import { renderWithProviders } from '@/test/utils'

describe('frontend-app-shell › Application routing', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null, accessToken: null, status: 'anonymous' })
  })

  it('renders public auth routes without a session', () => {
    renderWithProviders(<App />, { route: '/login' })
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()

    renderWithProviders(<App />, { route: '/register' })
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument()

    renderWithProviders(<App />, { route: '/forgot-password' })
    expect(screen.getByRole('heading', { name: 'Forgot password' })).toBeInTheDocument()

    renderWithProviders(<App />, { route: '/reset-password' })
    expect(screen.getByRole('heading', { name: 'Reset password' })).toBeInTheDocument()
  })

  it('redirects an unknown route to /login when anonymous', () => {
    renderWithProviders(<App />, { route: '/does-not-exist' })
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('redirects an unknown route to home when authenticated', () => {
    useAuthStore.setState({ status: 'authenticated' })
    renderWithProviders(<App />, { route: '/does-not-exist' })
    expect(screen.getByRole('heading', { name: 'Your notes' })).toBeInTheDocument()
  })

  it('redirects an authenticated visitor away from /login to home', () => {
    useAuthStore.setState({ status: 'authenticated' })
    renderWithProviders(<App />, { route: '/login' })
    expect(screen.getByRole('heading', { name: 'Your notes' })).toBeInTheDocument()
  })
})
