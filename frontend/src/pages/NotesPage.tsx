import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { LogoutButton } from '@/features/auth/LogoutButton'
import { NotesList } from '@/features/notes/NotesList'
import { Button } from '@/components/ui/button'

export default function NotesPage() {
  const user = useAuthStore(s => s.user)
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-semibold">Your notes</h1>
          <div className="flex items-center gap-3">
            {user && <span className="text-sm text-muted-foreground">{user.email}</span>}
            <Button size="sm" onClick={() => navigate('/notes/new')}>New note</Button>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <NotesList />
      </main>
    </div>
  )
}
