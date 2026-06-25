import { Card, CardContent } from '@/components/ui/card'
import { Link } from 'react-router-dom'
import type { SearchResultItem } from '@note-app/shared/schemas/search'

interface Props {
  item: SearchResultItem
}

export function SearchResultCard({ item }: Props) {
  const hasSnippet = item.snippet.trim().length > 0

  return (
    <Card>
      <Link to={`/notes/${item.noteId}`} className="block hover:bg-accent/50 transition-colors">
        <div className="p-4 pb-3">
          <h3 className="font-medium truncate">{item.title || 'Untitled'}</h3>
        </div>
        {hasSnippet && (
          <CardContent className="pt-0 pb-4">
            <p
              className="text-sm text-muted-foreground line-clamp-3"
              dangerouslySetInnerHTML={{ __html: item.snippet }}
            />
          </CardContent>
        )}
      </Link>
    </Card>
  )
}
