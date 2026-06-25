import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { LogoutButton } from '@/features/auth/LogoutButton'
import { SearchResultsList } from '@/features/search/SearchResultsList'

export default function SearchPage() {
  const user = useAuthStore(s => s.user)
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              ← Notes
            </Link>
            <h1 className="text-xl font-semibold">Search</h1>
          </div>
          <div className="flex items-center gap-3">
            {user && <span className="text-sm text-muted-foreground">{user.email}</span>}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <SearchResultsList />
      </main>
    </div>
  )
}
