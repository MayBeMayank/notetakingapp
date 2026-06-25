import type {
  NoteListStatus,
  NoteSortField,
  NoteSortOrder,
} from '@note-app/shared/schemas/notes'

/** Client-side list view-state, mirrored 1:1 onto the `GET /api/notes` query (AD-1). */
export interface NotesViewState {
  status: NoteListStatus
  sort: NoteSortField
  order: NoteSortOrder
  tags: string[]
  page: number
  limit: number
}

export const DEFAULT_NOTES_VIEW: NotesViewState = {
  status: 'active',
  sort: 'updatedAt',
  order: 'desc',
  tags: [],
  page: 1,
  limit: 20,
}

const SORTS: readonly NoteSortField[] = ['updatedAt', 'createdAt', 'title']
const ORDERS: readonly NoteSortOrder[] = ['asc', 'desc']
const STATUSES: readonly NoteListStatus[] = ['active', 'trashed']

function oneOf<T extends string>(allowed: readonly T[], value: string | null, fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function positiveInt(value: string | null, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 ? n : fallback
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)]
}

/**
 * Parse URL search params into a sanitized view. Unknown enum values and
 * out-of-range/non-numeric page/limit fall back to defaults so a stale or
 * hand-edited URL never crashes the page.
 */
export function parseNotesView(sp: URLSearchParams): NotesViewState {
  const rawTags = (sp.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  return {
    status: oneOf(STATUSES, sp.get('status'), DEFAULT_NOTES_VIEW.status),
    sort: oneOf(SORTS, sp.get('sort'), DEFAULT_NOTES_VIEW.sort),
    order: oneOf(ORDERS, sp.get('order'), DEFAULT_NOTES_VIEW.order),
    tags: dedupe(rawTags),
    page: positiveInt(sp.get('page'), DEFAULT_NOTES_VIEW.page),
    limit: positiveInt(sp.get('limit'), DEFAULT_NOTES_VIEW.limit),
  }
}

/** Serialize a view to URL search params, omitting defaults so the URL stays clean. */
export function serializeNotesView(view: NotesViewState): URLSearchParams {
  const sp = new URLSearchParams()
  if (view.status !== DEFAULT_NOTES_VIEW.status) sp.set('status', view.status)
  if (view.sort !== DEFAULT_NOTES_VIEW.sort) sp.set('sort', view.sort)
  if (view.order !== DEFAULT_NOTES_VIEW.order) sp.set('order', view.order)
  if (view.tags.length > 0) sp.set('tags', dedupe(view.tags).join(','))
  if (view.page !== DEFAULT_NOTES_VIEW.page) sp.set('page', String(view.page))
  if (view.limit !== DEFAULT_NOTES_VIEW.limit) sp.set('limit', String(view.limit))
  return sp
}
