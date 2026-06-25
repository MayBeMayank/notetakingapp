import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parseNotesView, serializeNotesView, type NotesViewState } from './notesQuery'

/**
 * The URL search params are the single source of truth for list view-state (AD-1).
 * Returns the parsed view and a patch setter. Changing the sort, order, tag filter,
 * or status resets `page` to 1 (unless the same patch sets `page`) so results are
 * never silently skipped (FRS-4.5.4).
 */
export function useNotesQueryParams(): [NotesViewState, (patch: Partial<NotesViewState>) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parseNotesView(searchParams)

  const setView = useCallback(
    (patch: Partial<NotesViewState>) => {
      const next: NotesViewState = { ...parseNotesView(searchParams), ...patch }
      const resetsPage =
        patch.sort !== undefined ||
        patch.order !== undefined ||
        patch.tags !== undefined ||
        patch.status !== undefined
      if (resetsPage && patch.page === undefined) {
        next.page = 1
      }
      setSearchParams(serializeNotesView(next))
    },
    [searchParams, setSearchParams],
  )

  return [view, setView]
}
