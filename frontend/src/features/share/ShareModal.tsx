import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useNoteShares } from '@/api/shares'
import { CreateShareForm } from './CreateShareForm'
import { ShareLinkRow } from './ShareLinkRow'

interface ShareModalProps {
  noteId: string
  open: boolean
  onClose: () => void
}

function LinkListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  )
}

export function ShareModal({ noteId, open, onClose }: ShareModalProps) {
  const { data: links, isLoading, isError, refetch } = useNoteShares(noteId)

  // Dismiss on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share note"
        className="flex w-full max-w-md flex-col gap-0 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Share note</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Generate a public read-only link
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </Button>
        </div>

        {/* Generate section */}
        <div className="border-b px-5 py-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            New link
          </p>
          <CreateShareForm noteId={noteId} />
        </div>

        {/* Active links section */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Active links
          </p>

          {isLoading && <LinkListSkeleton />}

          {isError && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">Failed to load links</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          )}

          {!isLoading && !isError && links && links.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <div className="rounded-full bg-muted p-3">
                <svg
                  className="h-5 w-5 text-muted-foreground"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium">No active links</p>
              <p className="text-xs text-muted-foreground">
                Generate one above to share this note
              </p>
            </div>
          )}

          {!isLoading && !isError && links && links.length > 0 && (
            <div className="space-y-2">
              {links.map((share) => (
                <ShareLinkRow key={share.id} share={share} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
