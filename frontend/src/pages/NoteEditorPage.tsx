import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { NoteEditor } from '@/features/notes/NoteEditor'
import { useNote } from '@/api/notes'
import { ApiError } from '@/api/client'

export default function NoteEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useNote(id!)
  const redirectedRef = useRef(false)

  useEffect(() => {
    if (!isError || redirectedRef.current) return
    redirectedRef.current = true
    const e = error as ApiError
    if (e?.status === 404) {
      toast.error('Note not found')
      navigate('/notes', { replace: true })
    }
  }, [isError, error, navigate])

  if (isLoading) {
    return (
      <div className="flex h-screen flex-col gap-4 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (isError) {
    const e = error as ApiError
    if (e?.status === 404) return null // redirected by useEffect
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Failed to load note.</p>
      </div>
    )
  }

  if (!data) return null

  return <div className="relative h-screen"><NoteEditor note={data.note} /></div>
}
