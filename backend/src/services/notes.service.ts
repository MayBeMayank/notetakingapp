import { NotFoundError, ConflictError } from '../lib/errors.js'
import { EMPTY_TIPTAP_DOC, deriveContentText } from '../lib/content.js'
import * as notesRepo from '../repositories/notes.repository.js'
import * as tagsRepo from '../repositories/tags.repository.js'
import type {
  CreateNoteInput,
  UpdateNoteInput,
  ListNotesQuery,
  NoteResponse,
  NoteListResponse,
  NoteSortField,
  NoteSortOrder,
  NoteListStatus,
} from '@note-app/shared/schemas/notes'
import type { NoteWithTagIds } from '../repositories/notes.repository.js'

const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MIN_PAGE = 1
const MIN_LIMIT = 1
const MAX_LIMIT = 100

// FRS-4.5.2 default: last-updated, descending; FRS-4.4.2 default: active only.
const DEFAULT_SORT: NoteSortField = 'updatedAt'
const DEFAULT_ORDER: NoteSortOrder = 'desc'
const DEFAULT_STATUS: NoteListStatus = 'active'

// Exported for reuse by versions.service (restore returns an identical `{ note }`
// shape). Pure mapper — no behaviour change.
export function toNoteResponse(note: NoteWithTagIds): NoteResponse {
  return {
    id: note.id,
    title: note.title,
    content: note.contentJson as unknown as NoteResponse['content'],
    tagIds: note.tags.map((t) => t.tagId),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
}

async function assertOwnedTags(userId: string, tagIds: string[]): Promise<string[]> {
  const ids = [...new Set(tagIds)]
  if (ids.length === 0) return ids
  const owned = await tagsRepo.countOwned(userId, ids)
  if (owned !== ids.length) {
    throw new ConflictError('INVALID_TAG_IDS', 'One or more tag IDs are invalid or do not belong to you')
  }
  return ids
}

export async function createNote(
  userId: string,
  input: CreateNoteInput,
): Promise<NoteResponse> {
  const contentJson: Record<string, unknown> = input.content
    ? (input.content as Record<string, unknown>)
    : EMPTY_TIPTAP_DOC
  const contentText = deriveContentText(contentJson)
  const title = input.title ?? ''

  let tagIds: string[] | undefined
  if (input.tagIds !== undefined) {
    tagIds = await assertOwnedTags(userId, input.tagIds)
  }

  const note = await notesRepo.createNote({ userId, title, contentJson, contentText, tagIds })
  return toNoteResponse(note)
}

export async function getNoteById(userId: string, id: string): Promise<NoteResponse> {
  const note = await notesRepo.findNoteByIdForUser(userId, id)
  if (!note || note.deletedAt) throw new NotFoundError('Note not found')
  return toNoteResponse(note)
}

export async function updateNote(
  userId: string,
  id: string,
  input: UpdateNoteInput,
): Promise<NoteResponse> {
  const note = await notesRepo.findNoteByIdForUser(userId, id)
  if (!note) throw new NotFoundError('Note not found')
  if (note.deletedAt) throw new ConflictError('NOTE_DELETED', 'Cannot update a deleted note')

  const updateData: {
    title?: string
    contentJson?: Record<string, unknown>
    contentText?: string
    tagIds?: string[]
  } = {}

  // FRS-8.1 / ADR-003 §3 / clarification 1: snapshot a new version only when the
  // title or content actually changes. A tag-only or no-op PATCH writes no version.
  let titleChanged = false
  let contentChanged = false

  if (input.title !== undefined) {
    updateData.title = input.title
    titleChanged = input.title !== note.title
  }
  if (input.content !== undefined) {
    updateData.contentJson = input.content as Record<string, unknown>
    updateData.contentText = deriveContentText(input.content)
    contentChanged = true
  }
  if (input.tagIds !== undefined) {
    updateData.tagIds = await assertOwnedTags(userId, input.tagIds)
  }

  const updated = await notesRepo.updateNote(userId, id, updateData, {
    snapshot: titleChanged || contentChanged,
  })
  return toNoteResponse(updated)
}

export async function deleteNote(userId: string, id: string): Promise<void> {
  const note = await notesRepo.findNoteByIdForUser(userId, id)
  if (!note || note.deletedAt) throw new NotFoundError('Note not found')
  await notesRepo.softDeleteNote(userId, id)
}

export async function restoreNote(userId: string, id: string): Promise<NoteResponse> {
  const note = await notesRepo.findNoteByIdForUser(userId, id)
  if (!note) throw new NotFoundError('Note not found')
  if (!note.deletedAt) throw new ConflictError('NOTE_NOT_DELETED', 'Note is not deleted')
  const elapsed = Date.now() - note.deletedAt.getTime()
  if (elapsed > RESTORE_WINDOW_MS) {
    throw new ConflictError('RESTORE_WINDOW_EXPIRED', 'Restore window of 30 days has expired')
  }
  const restored = await notesRepo.restoreNote(userId, id)
  return toNoteResponse(restored)
}

export async function listNotes(
  userId: string,
  query: ListNotesQuery,
): Promise<NoteListResponse> {
  const page = Math.max(MIN_PAGE, query.page ?? DEFAULT_PAGE)
  const limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, query.limit ?? DEFAULT_LIMIT))
  const skip = (page - 1) * limit

  const sort = query.sort ?? DEFAULT_SORT
  const order = query.order ?? DEFAULT_ORDER
  const status = query.status ?? DEFAULT_STATUS

  // Resolve the tag filter to the caller's OWNED tag IDs; unknown / another user's
  // IDs are dropped (FRS-4.5.3 / 9.1). A filter that was requested but resolves to
  // no owned tag yields an empty page — never the full list, never a leak.
  const requestedTags = query.tags ?? []
  let tagIds: string[] | undefined
  if (requestedTags.length > 0) {
    const owned = await notesRepo.findOwnedTagIds(userId, requestedTags)
    if (owned.length === 0) {
      return { data: [], page, limit, total: 0 }
    }
    tagIds = owned
  }

  const [notes, total] = await notesRepo.listNotesWithCount(userId, {
    skip,
    take: limit,
    sort,
    order,
    status,
    tagIds,
  })

  return {
    data: notes.map(toNoteResponse),
    page,
    limit,
    total,
  }
}
