import { useNotesQueryParams } from './useNotesQueryParams'
import { useNotesList } from '@/api/notes'
import { useTags } from '@/api/tags'
import { NotesSortControl } from './NotesSortControl'
import { TagFilter } from './TagFilter'
import { StatusTabs } from './StatusTabs'
import { NotesPagination } from './NotesPagination'
import { NoteCard } from './NoteCard'
import {
  NotesLoadingState,
  NotesErrorState,
  NotesEmptyState,
  NotesEmptyFilterState,
  NotesEmptyTrashState,
} from './NotesStates'

export function NotesList() {
  const [view, setView] = useNotesQueryParams()
  const notesQuery = useNotesList(view)
  const tagsQuery = useTags()
  const tags = tagsQuery.data ?? []

  return (
    <div className="flex flex-col gap-6">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        <StatusTabs status={view.status} onStatusChange={(s) => setView({ status: s })} />
        <NotesSortControl view={view} setView={setView} />
        <TagFilter tags={tags} selectedTags={view.tags} onTagsChange={(t) => setView({ tags: t })} />
      </div>
      {/* State + grid */}
      {notesQuery.isPending && <NotesLoadingState />}
      {notesQuery.isError && <NotesErrorState onRetry={() => notesQuery.refetch()} />}
      {notesQuery.data && (() => {
        const { data: notes, page, total, limit } = notesQuery.data
        if (notes.length === 0) {
          if (view.tags.length > 0) return <NotesEmptyFilterState onClearFilter={() => setView({ tags: [] })} />
          if (view.status === 'trashed') return <NotesEmptyTrashState />
          return <NotesEmptyState />
        }
        return (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {notes.map((n) => <NoteCard key={n.id} note={n} tags={tags} status={view.status} />)}
            </div>
            <NotesPagination page={page} total={total} limit={limit} onPageChange={(p) => setView({ page: p })} />
          </>
        )
      })()}
    </div>
  )
}
