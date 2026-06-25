import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parseSearchView, serializeSearchView, type SearchViewState } from './searchQuery'

/**
 * URL search params are the single source of truth for search view-state.
 * Changing q resets page to 1 (unless the patch also sets page explicitly).
 */
export function useSearchQueryParams(): [SearchViewState, (patch: Partial<SearchViewState>) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parseSearchView(searchParams)

  const setView = useCallback(
    (patch: Partial<SearchViewState>) => {
      const next: SearchViewState = { ...parseSearchView(searchParams), ...patch }
      if (patch.q !== undefined && patch.page === undefined) {
        next.page = 1
      }
      setSearchParams(serializeSearchView(next))
    },
    [searchParams, setSearchParams],
  )

  return [view, setView]
}
