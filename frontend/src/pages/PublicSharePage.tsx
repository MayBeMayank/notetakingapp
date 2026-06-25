import { useParams } from 'react-router-dom'
import { usePublicNote } from '@/api/shares'
import { PublicNoteView } from '@/features/share/PublicNoteView'
import { ApiError } from '@/api/client'

function PublicShareLoading() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-8 h-9 w-2/3 animate-pulse rounded-lg bg-muted" />
      <div className="space-y-3">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
        <div className="h-4 w-4/6 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}

function PublicShareError({ status }: { status: number }) {
  const isGone = status === 410
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="rounded-full bg-muted p-5">
        <svg
          className="h-8 w-8 text-muted-foreground"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          {isGone ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
            />
          )}
        </svg>
      </div>
      <div>
        <h1 className="text-xl font-semibold">
          {isGone ? 'Link no longer available' : "This link doesn't exist"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isGone
            ? 'This share link has expired or been revoked by its owner.'
            : 'The share link you followed was not found.'}
        </p>
      </div>
    </div>
  )
}

export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>()
  const { data, isLoading, isError, error } = usePublicNote(token!)

  if (isLoading) return <PublicShareLoading />

  if (isError) {
    const status = (error as ApiError)?.status ?? 404
    return <PublicShareError status={status} />
  }

  if (!data) return null

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal public header — no app navigation */}
      <header className="border-b px-6 py-3">
        <span className="text-sm font-medium text-muted-foreground">Shared note</span>
      </header>
      <PublicNoteView title={data.title} content={data.content} />
    </div>
  )
}
