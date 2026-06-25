import { Button } from '@/components/ui/button'
import { useRestoreNote } from '@/api/notes'
import type { ApiError } from '@/api/client'

export function RestoreNoteButton({ noteId }: { noteId: string }) {
  const mutation = useRestoreNote()
  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" disabled={mutation.isPending}
        onClick={() => mutation.mutate(noteId)}>
        {mutation.isPending ? 'Restoring…' : 'Restore'}
      </Button>
      {mutation.isError && (mutation.error as ApiError)?.status === 422 && (
        <p className="text-sm text-muted-foreground text-center">Recovery window has expired.</p>
      )}
      {mutation.isError && (mutation.error as ApiError)?.status !== 422 && (
        <p className="text-sm text-destructive">Failed to restore. Please try again.</p>
      )}
    </div>
  )
}
