import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ApiError, apiFetch } from '@/api/client'
import type { NotesViewState } from '@/features/notes/notesQuery'
import type {
  CreateNoteInput,
  UpdateNoteInput,
  NoteEnvelope,
} from '@note-app/shared/schemas/notes'

// ── List hooks (AB-1011) ─────────────────────────────────────────────────────

/**
 * Read-only note shape rendered by the list. Date fields are `string` (ISO over
 * the wire) rather than the shared schema's `z.date()`, matching the documented
 * `src/api/auth.ts` precedent (AD-3). `content` is intentionally omitted — the
 * list never renders it.
 */
export interface NoteListItem {
  id: string
  title: string
  tagIds: string[]
  createdAt: string
  updatedAt: string
}

export interface NotesListResult {
  data: NoteListItem[]
  page: number
  limit: number
  total: number
}

/** Shared prefix so delete/restore invalidate every notes list (active + trashed). */
export const NOTES_QUERY_KEY = ['notes'] as const

/** Build the `GET /api/notes` query string explicitly (commas unencoded, per SDS §6.3). */
function buildNotesQuery(view: NotesViewState): string {
  const parts = [
    `status=${view.status}`,
    `sort=${view.sort}`,
    `order=${view.order}`,
    `page=${view.page}`,
    `limit=${view.limit}`,
  ]
  if (view.tags.length > 0) parts.push(`tags=${view.tags.join(',')}`)
  return parts.join('&')
}

/** List the user's notes for the current view (FRS-4.5). */
export function useNotesList(view: NotesViewState) {
  return useQuery<NotesListResult, ApiError>({
    queryKey: [...NOTES_QUERY_KEY, view],
    queryFn: () => apiFetch<NotesListResult>(`/notes?${buildNotesQuery(view)}`),
  })
}

/** Soft-delete a note (FRS-4.4.1): DELETE → 204, then refetch every notes list. */
export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => apiFetch<void>(`/notes/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY }),
  })
}

/** Restore a soft-deleted note (FRS-4.4.3): POST restore; a 422 means past the 30-day window. */
export function useRestoreNote() {
  const queryClient = useQueryClient()
  return useMutation<{ note: NoteListItem }, ApiError, string>({
    mutationFn: (id) => apiFetch<{ note: NoteListItem }>(`/notes/${id}/restore`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY }),
  })
}

// ── Editor hooks (AB-1012) ───────────────────────────────────────────────────

/** Create a new empty note and return its full envelope (FRS-4.1). */
export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation<NoteEnvelope, ApiError, CreateNoteInput>({
    mutationFn: (input) => apiFetch<NoteEnvelope>('/notes', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY }),
  })
}

/** Fetch a single note by id for the editor (FRS-4.2). retry:false so 404 surfaces immediately. */
export function useNote(id: string) {
  return useQuery<NoteEnvelope, ApiError>({
    queryKey: [...NOTES_QUERY_KEY, id],
    queryFn: () => apiFetch<NoteEnvelope>(`/notes/${id}`),
    retry: false,
  })
}

/** Autosave a note (FRS-4.3): PUT with changed fields; invalidates the per-note cache entry. */
export function useUpdateNote() {
  const queryClient = useQueryClient()
  return useMutation<NoteEnvelope, ApiError, { id: string } & UpdateNoteInput>({
    mutationFn: ({ id, ...input }) =>
      apiFetch<NoteEnvelope>(`/notes/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (_data, { id }) =>
      queryClient.invalidateQueries({ queryKey: [...NOTES_QUERY_KEY, id] }),
  })
}
