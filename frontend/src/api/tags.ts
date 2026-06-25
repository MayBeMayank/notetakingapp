import { useQuery } from '@tanstack/react-query'
import { type ApiError, apiFetch } from '@/api/client'

/**
 * Read-only tag shape used by the list page (filter + per-card chips). Typed
 * locally (not from the shared `z.date()` schema) since date fields arrive as
 * JSON strings over the wire — the same precedent as `src/api/auth.ts` (AD-3).
 * Only the date-free fields the UI needs are declared.
 */
export interface TagOption {
  id: string
  name: string
  color: string
  noteCount: number
}

export const TAGS_QUERY_KEY = ['tags'] as const

/** Fetch the signed-in user's own tags (FRS-5.6, read-only consumption). */
export function useTags() {
  return useQuery<TagOption[], ApiError>({
    queryKey: TAGS_QUERY_KEY,
    queryFn: () => apiFetch<TagOption[]>('/tags'),
  })
}
