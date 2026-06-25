import { useQuery } from '@tanstack/react-query'
import { type ApiError, apiFetch } from '@/api/client'
import type { SearchListResponse } from '@note-app/shared/schemas/search'

export const SEARCH_QUERY_KEY = ['search'] as const

/**
 * Full-text search hook (FRS-6.1, FRS-6.3, FRS-6.6).
 * When q is empty/whitespace the query is disabled and returns undefined data
 * without a network round-trip — callers show the idle state instead.
 */
export function useSearch(q: string, page = 1, limit = 20) {
  const trimmedQ = q.trim()
  return useQuery<SearchListResponse, ApiError>({
    queryKey: [...SEARCH_QUERY_KEY, trimmedQ, page],
    queryFn: () => {
      const params = new URLSearchParams({
        q: trimmedQ,
        page: String(page),
        limit: String(limit),
      })
      return apiFetch<SearchListResponse>(`/search?${params.toString()}`)
    },
    enabled: trimmedQ.length > 0,
    staleTime: 30_000,
  })
}
