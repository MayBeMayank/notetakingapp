import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { useBootstrapSession } from '@/features/auth/useBootstrapSession'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/ResetPasswordPage'
import HomePage from '@/pages/HomePage'

/** Keeps authenticated users off the auth screens; waits during rehydration. */
function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status)
  if (status === 'pending') {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground" role="status">
        Loading…
      </div>
    )
  }
  if (status === 'authenticated') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  useBootstrapSession()
  const status = useAuthStore((s) => s.status)

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnlyRoute>
            <RegisterPage />
          </PublicOnlyRoute>
        }
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="*"
        element={<Navigate to={status === 'authenticated' ? '/' : '/login'} replace />}
      />
    </Routes>
  )
}
