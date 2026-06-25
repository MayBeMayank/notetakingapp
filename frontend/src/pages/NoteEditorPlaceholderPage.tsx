import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function NoteEditorPlaceholderPage() {
  const { id } = useParams<{ id?: string }>()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">{id ? 'Edit note' : 'New note'}</h1>
      <p className="text-muted-foreground">Editor coming in AB-1012.</p>
      <Button asChild variant="outline"><Link to="/">← Back to notes</Link></Button>
    </div>
  )
}
