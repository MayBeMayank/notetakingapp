import { useAuthStore } from '@/stores/auth.store'
import { LogoutButton } from '@/features/auth/LogoutButton'

// Minimal authenticated placeholder. AB-1011 replaces this with the notes list.
export default function HomePage() {
  const user = useAuthStore((s) => s.user)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Your notes</h1>
      {user && <p className="text-muted-foreground">Signed in as {user.email}</p>}
      <LogoutButton />
    </div>
  )
}
