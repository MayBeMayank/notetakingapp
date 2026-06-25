import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Link } from 'react-router-dom'
import { DeleteNoteButton } from './DeleteNoteButton'
import { RestoreNoteButton } from './RestoreNoteButton'
import { ShareButton } from '@/features/share/ShareButton'
import type { NoteListItem } from '@/api/notes'
import type { TagOption } from '@/api/tags'

interface NoteCardProps {
  note: NoteListItem
  tags: TagOption[]
  status: 'active' | 'trashed'
}

export function NoteCard({ note, tags, status }: NoteCardProps) {
  const header = (
    <div className="p-6 pb-3">
      <h3 className="font-medium truncate">{note.title || 'Untitled'}</h3>
      <p className="text-xs text-muted-foreground">
        Updated {new Date(note.updatedAt).toLocaleDateString()}
      </p>
    </div>
  )

  const body = (
    <CardContent className="pt-0 pb-3">
      {note.tagIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {note.tagIds.map((id) => {
            const tag = tags.find((t) => t.id === id)
            return tag ? (
              <span
                key={id}
                className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: tag.color, color: '#fff' }}
              >
                {tag.name}
              </span>
            ) : null
          })}
        </div>
      )}
    </CardContent>
  )

  if (status === 'active') {
    return (
      <Card>
        <Link to={`/notes/${note.id}`} className="block hover:bg-accent/50 transition-colors">
          {header}
          {body}
        </Link>
        <CardFooter className="flex items-center gap-2 pt-0">
          <ShareButton noteId={note.id} />
          <DeleteNoteButton noteId={note.id} noteTitle={note.title} />
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      {header}
      {body}
      <CardFooter className="pt-0">
        <RestoreNoteButton noteId={note.id} />
      </CardFooter>
    </Card>
  )
}
