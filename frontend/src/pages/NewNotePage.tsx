import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useCreateNote } from '@/api/notes'

export default function NewNotePage() {
  const navigate = useNavigate()
  const { mutate: createNote } = useCreateNote()
  const called = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true
    createNote(undefined, {
      onSuccess: (data) => navigate('/notes/' + data.note.id, { replace: true }),
      onError: () => {
        toast.error('Could not create note')
        navigate('/notes')
      },
    })
  }, []) // intentionally empty — runs once on mount via called.current guard

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}
