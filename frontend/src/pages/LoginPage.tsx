import { useLocation } from 'react-router-dom'
import { LoginForm } from '@/features/auth/LoginForm'

export default function LoginPage() {
  const notice = (useLocation().state as { notice?: string } | null)?.notice

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {notice && (
        <p role="status" className="w-full max-w-sm rounded-md bg-secondary px-4 py-2 text-sm text-secondary-foreground">
          {notice}
        </p>
      )}
      <LoginForm />
    </div>
  )
}
