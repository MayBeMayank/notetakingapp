import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ApiError, apiFetch } from '@/api/client'
import type { CreateShareInput, ShareEnvelope } from '@note-app/shared/schemas/shares'

export const SHARES_QUERY_KEY = ['shares'] as const

/**
 * Wire-format share resource — dates arrive as ISO strings (matches the
 * notes-list NoteListItem precedent, AD-2).
 */
export interface ShareLinkItem {
  id: string
  noteId: string
  token: string
  url: string            // relative "/s/<token>"
  expiresAt: string | null
  viewCount: number
  createdAt: string
}

/** Public note payload from GET /api/public/notes/:token */
export interface PublicNotePayload {
  title: string
  content: unknown
}

/**
 * All of the caller's non-revoked share links, filtered to a single note
 * client-side (AD-3: no per-note endpoint exists; GET /api/shares returns a
 * bare array across all notes).
 */
export function useNoteShares(noteId: string) {
  return useQuery<ShareLinkItem[], ApiError>({
    queryKey: SHARES_QUERY_KEY,
    queryFn: () => apiFetch<ShareLinkItem[]>('/shares'),
    select: (data) => data.filter((s) => s.noteId === noteId),
    staleTime: 30_000,
  })
}

/** Create a new share link for the given note (FRS-7.1). */
export function useCreateShare(noteId: string) {
  const queryClient = useQueryClient()
  return useMutation<ShareEnvelope, ApiError, CreateShareInput>({
    mutationFn: (input) =>
      apiFetch<ShareEnvelope>(`/notes/${noteId}/shares`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SHARES_QUERY_KEY }),
  })
}

/** Revoke a share link by its id (FRS-7.5). Returns 204 → void. */
export function useRevokeShare() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: (shareId) =>
      apiFetch<void>(`/shares/${shareId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SHARES_QUERY_KEY }),
  })
}

/**
 * Fetch the public view of a shared note without authentication (FRS-7.3).
 * retry: false so 404/410 surface immediately without retrying.
 */
export function usePublicNote(token: string) {
  return useQuery<PublicNotePayload, ApiError>({
    queryKey: ['public-note', token],
    queryFn: () => apiFetch<PublicNotePayload>(`/public/notes/${token}`, { auth: false }),
    retry: false,
    staleTime: 60_000,
  })
}
