import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAuthStore } from '@/stores/auth.store'
import { setUnauthorizedHandler } from '@/api/client'
import { useBootstrapSession } from '@/features/auth/useBootstrapSession'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/ResetPasswordPage'
import NotesPage from '@/pages/NotesPage'
import NewNotePage from '@/pages/NewNotePage'
import NoteEditorPage from '@/pages/NoteEditorPage'

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
  const navigate = useNavigate()
  const status = useAuthStore((s) => s.status)

  // Let the API client redirect to /login when a session can't be refreshed,
  // independent of which route is mounted.
  useEffect(() => {
    setUnauthorizedHandler(() => navigate('/login', { replace: true }))
    return () => setUnauthorizedHandler(null)
  }, [navigate])

  return (
    <>
      <Toaster position="bottom-right" richColors />
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
            <NotesPage />
          </ProtectedRoute>
        }
      />
      <Route path="/notes/new" element={<ProtectedRoute><NewNotePage /></ProtectedRoute>} />
      <Route path="/notes/:id" element={<ProtectedRoute><NoteEditorPage /></ProtectedRoute>} />
      <Route
        path="*"
        element={<Navigate to={status === 'authenticated' ? '/' : '/login'} replace />}
      />
    </Routes>
    </>
  )
}
