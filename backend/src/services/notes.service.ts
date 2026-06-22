import { NotFoundError, ConflictError } from '../lib/errors.js'
import { EMPTY_TIPTAP_DOC, deriveContentText } from '../lib/content.js'
import * as notesRepo from '../repositories/notes.repository.js'
import type {
  CreateNoteInput,
  UpdateNoteInput,
  ListNotesQuery,
  NoteResponse,
  NoteListResponse,
} from '@note-app/shared/schemas/notes'
import type { Note } from '@prisma/client'

const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MIN_PAGE = 1
const MIN_LIMIT = 1
const MAX_LIMIT = 100

function toNoteResponse(note: Note): NoteResponse {
  return {
    id: note.id,
    title: note.title,
    content: note.contentJson as unknown as NoteResponse['content'],
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
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
  const note = await notesRepo.createNote({ userId, title, contentJson, contentText })
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

  const updateData: { title?: string; contentJson?: Record<string, unknown>; contentText?: string } = {}
  if (input.title !== undefined) updateData.title = input.title
  if (input.content !== undefined) {
    updateData.contentJson = input.content as Record<string, unknown>
    updateData.contentText = deriveContentText(input.content)
  }

  const updated = await notesRepo.updateNote(userId, id, updateData)
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

  const [notes, total] = await notesRepo.listNotesWithCount(userId, { skip, take: limit })

  return {
    data: notes.map(toNoteResponse),
    page,
    limit,
    total,
  }
}
