import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useDeleteNote } from '@/api/notes'

export function DeleteNoteButton({ noteId, noteTitle }: { noteId: string; noteTitle: string }) {
  const [open, setOpen] = useState(false)
  const mutation = useDeleteNote()
  return (
    <>
      <Button variant="destructive" size="sm" disabled={mutation.isPending}
        onClick={() => { mutation.reset(); setOpen(true) }}>
        {mutation.isPending ? 'Deleting…' : 'Delete'}
      </Button>
      {mutation.isError && (
        <p className="text-sm text-destructive mt-1">Failed to delete. Please try again.</p>
      )}
      <ConfirmDialog
        open={open}
        title="Delete note?"
        description={'Move "' + (noteTitle || 'Untitled') + '" to Trash.'}
        confirmLabel="Move to Trash"
        onConfirm={() => mutation.mutate(noteId, { onSuccess: () => setOpen(false) })}
        onCancel={() => { setOpen(false); mutation.reset() }}
      />
    </>
  )
}
