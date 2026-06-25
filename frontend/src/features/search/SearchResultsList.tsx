import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useSearch } from '@/api/search'
import { useSearchQueryParams } from './useSearchQueryParams'
import { SearchResultCard } from './SearchResultCard'
import { NotesPagination } from '@/features/notes/NotesPagination'
import {
  SearchLoadingState,
  SearchErrorState,
  SearchIdleState,
  SearchNoResultsState,
} from './SearchStates'

const DEBOUNCE_MS = 300

export function SearchResultsList() {
  const [view, setView] = useSearchQueryParams()
  const [inputValue, setInputValue] = useState(view.q)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep input in sync when the URL changes externally (e.g. browser back/forward).
  useEffect(() => {
    setInputValue(view.q)
  }, [view.q])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setInputValue(val)

    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      setView({ q: val })
    }, DEBOUNCE_MS)
  }

  // Clear the timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  const query = useSearch(view.q, view.page)
  const data = query.data

  return (
    <div className="flex flex-col gap-6">
      <Input
        type="search"
        placeholder="Search notes…"
        value={inputValue}
        onChange={handleInputChange}
        maxLength={200}
        className="max-w-xl"
        aria-label="Search notes"
      />

      {view.q.trim() === '' && <SearchIdleState />}

      {view.q.trim() !== '' && query.isPending && <SearchLoadingState />}

      {view.q.trim() !== '' && query.isError && (
        <SearchErrorState onRetry={() => query.refetch()} />
      )}

      {view.q.trim() !== '' && data && data.total === 0 && (
        <SearchNoResultsState q={view.q} />
      )}

      {view.q.trim() !== '' && data && data.total > 0 && (
        <>
          <div className="flex flex-col gap-3">
            {data.data.map((item) => (
              <SearchResultCard key={item.noteId} item={item} />
            ))}
          </div>
          <NotesPagination
            page={data.page}
            total={data.total}
            limit={data.limit}
            onPageChange={(p) => setView({ page: p })}
          />
        </>
      )}
    </div>
  )
}
