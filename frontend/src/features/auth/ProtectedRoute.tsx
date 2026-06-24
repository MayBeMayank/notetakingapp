import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'

interface ProtectedRouteProps {
  children: ReactNode
}

/**
 * Gates authenticated content. While the session is rehydrating ('pending') it
 * shows a loading state so the login page never flashes; resolves to content
 * (authenticated) or a redirect to /login (anonymous).
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const status = useAuthStore((s) => s.status)

  if (status === 'pending') {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground" role="status">
        Loading…
      </div>
    )
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
