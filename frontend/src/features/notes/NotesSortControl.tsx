import { Select } from '@/components/ui/select'
import type { NotesViewState } from './notesQuery'

export function NotesSortControl({
  view,
  setView,
}: {
  view: NotesViewState
  setView(patch: Partial<NotesViewState>): void
}) {
  return (
    <div className="flex items-center gap-4">
      <label>
        Sort by
        <Select
          value={view.sort}
          onChange={(e) => setView({ sort: e.target.value as NotesViewState['sort'] })}
        >
          <option value="updatedAt">Last updated</option>
          <option value="createdAt">Created</option>
          <option value="title">Title</option>
        </Select>
      </label>
      <label>
        Order
        <Select
          value={view.order}
          onChange={(e) => setView({ order: e.target.value as NotesViewState['order'] })}
        >
          {view.sort === 'title' ? (
            <>
              <option value="asc">A → Z</option>
              <option value="desc">Z → A</option>
            </>
          ) : (
            <>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </>
          )}
        </Select>
      </label>
    </div>
  )
}
