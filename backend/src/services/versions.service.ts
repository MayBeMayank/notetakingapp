import { NotFoundError, ConflictError } from '../lib/errors.js'
import * as notesRepo from '../repositories/notes.repository.js'
import * as versionsRepo from '../repositories/versions.repository.js'
import { toNoteResponse } from './notes.service.js'
import type { NoteResponse } from '@note-app/shared/schemas/notes'
import type { VersionDetail, VersionListResponse } from '@note-app/shared/schemas/versions'
import type { NoteWithTagIds } from '../repositories/notes.repository.js'

// Resolve a note the caller owns, INCLUDING soft-deleted ones — version reads are
// allowed on a trashed note (ADR-004); `findNoteByIdForUser` does not filter
// `deletedAt`. A non-owned/unknown note is indistinguishable → 404 (FRS-9.1).
async function getOwnedNoteOrThrow(userId: string, noteId: string): Promise<NoteWithTagIds> {
  const note = await notesRepo.findNoteByIdForUser(userId, noteId)
  if (!note) throw new NotFoundError('Note not found')
  return note
}

export async function listVersions(
  userId: string,
  noteId: string,
): Promise<VersionListResponse> {
  await getOwnedNoteOrThrow(userId, noteId)
  return versionsRepo.listVersions(noteId)
}

export async function getVersion(
  userId: string,
  noteId: string,
  versionId: string,
): Promise<VersionDetail> {
  await getOwnedNoteOrThrow(userId, noteId)
  const version = await versionsRepo.findVersionForNote(noteId, versionId)
  if (!version) throw new NotFoundError('Version not found')
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    title: version.title,
    content: version.contentJson as unknown as VersionDetail['content'],
    tagIds: version.tagIds,
    createdAt: version.createdAt,
  }
}

export async function restoreVersion(
  userId: string,
  noteId: string,
  versionId: string,
): Promise<NoteResponse> {
  const note = await getOwnedNoteOrThrow(userId, noteId)
  // Restore mutates the note → reject on a trashed note (ADR-004); restore the
  // note to active state first.
  if (note.deletedAt) {
    throw new ConflictError('NOTE_DELETED', 'Cannot restore a version of a deleted note')
  }

  const version = await versionsRepo.findVersionForNote(noteId, versionId)
  if (!version) throw new NotFoundError('Version not found')

  // Restoring the most-recent version is a no-op (its title/content already equal
  // the note's current state) → 422 (clarification 4 / D7).
  const latest = await versionsRepo.getLatestVersionNumber(noteId)
  if (version.versionNumber === latest) {
    throw new ConflictError(
      'VERSION_ALREADY_CURRENT',
      'This version is already the note\'s current version',
    )
  }

  // Re-apply only the tags from the snapshot that still exist and are owned by the
  // caller; tags deleted since are silently dropped (ADR-003 / FRS-5.5).
  const survivingTagIds = await notesRepo.findOwnedTagIds(userId, version.tagIds)

  const restored = await versionsRepo.restoreVersionTx({
    userId,
    noteId,
    title: version.title,
    contentJson: version.contentJson as Record<string, unknown>,
    contentText: version.contentText,
    survivingTagIds,
  })

  return toNoteResponse(restored)
}
