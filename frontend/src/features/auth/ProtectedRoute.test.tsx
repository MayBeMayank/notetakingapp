import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { useAuthStore, type AuthStatus } from '@/stores/auth.store'

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route
          path="/secret"
          element={
            <ProtectedRoute>
              <div>SECRET CONTENT</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('frontend-app-shell › Protected route guard', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null, accessToken: null, status: 'anonymous' })
  })

  it('redirects an unauthenticated visitor to /login', () => {
    useAuthStore.setState({ status: 'anonymous' as AuthStatus })
    renderGuard()
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument()
    expect(screen.queryByText('SECRET CONTENT')).not.toBeInTheDocument()
  })

  it('renders protected content for an authenticated visitor', () => {
    useAuthStore.setState({ status: 'authenticated' as AuthStatus })
    renderGuard()
    expect(screen.getByText('SECRET CONTENT')).toBeInTheDocument()
  })

  it('shows a loading state during rehydration without flashing login', () => {
    useAuthStore.setState({ status: 'pending' as AuthStatus })
    renderGuard()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('LOGIN PAGE')).not.toBeInTheDocument()
    expect(screen.queryByText('SECRET CONTENT')).not.toBeInTheDocument()
  })
})
