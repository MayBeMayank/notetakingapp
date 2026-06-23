import { NotFoundError, ConflictError, GoneError } from '../lib/errors.js'
import { generateShareToken } from '../lib/token.js'
import * as notesRepo from '../repositories/notes.repository.js'
import * as sharesRepo from '../repositories/shares.repository.js'
import type {
  CreateShareInput,
  ShareResponse,
  ShareListResponse,
  PublicNoteView,
} from '@note-app/shared/schemas/shares'
import type { ShareLink } from '@prisma/client'

function toShareResponse(share: ShareLink): ShareResponse {
  return {
    id: share.id,
    noteId: share.noteId,
    token: share.token,
    url: `/s/${share.token}`, // relative path only — no host, no base URL (clarification 4)
    expiresAt: share.expiresAt,
    viewCount: share.viewCount,
    createdAt: share.createdAt,
  }
}

// FRS-7.1/7.2: mint a NEW independent link for an own ACTIVE note. A note may
// carry many active links — there is no per-note upsert (clarification 1).
export async function createShare(
  userId: string,
  noteId: string,
  input: CreateShareInput,
): Promise<ShareResponse> {
  const note = await notesRepo.findNoteByIdForUser(userId, noteId)
  if (!note) throw new NotFoundError('Note not found') // absent or not owned → 404, never 403
  if (note.deletedAt) throw new ConflictError('NOTE_DELETED', 'Cannot share a deleted note')

  // expiresAt is already validated future-or-null by CreateShareSchema.
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  const share = await sharesRepo.createShare({ noteId, token: generateShareToken(), expiresAt })
  return toShareResponse(share)
}

// FRS-7.7: all of the caller's non-revoked links, newest first (clarifications 5 & 6).
export async function listShares(userId: string): Promise<ShareListResponse> {
  const shares = await sharesRepo.listSharesForUser(userId)
  return shares.map(toShareResponse)
}

// FRS-7.5: revoke an own link. Idempotent — re-revoking an already-revoked own
// link is a no-op 204, not an error.
export async function revokeShare(userId: string, id: string): Promise<void> {
  const share = await sharesRepo.findShareByIdForUser(userId, id)
  if (!share) throw new NotFoundError('Share link not found') // absent or not owned → 404
  await sharesRepo.revokeShare(id)
}

// Public view: resolve token → 404 unknown / 410 SHARE_GONE (revoked, expired, or
// underlying note soft-deleted) → otherwise atomically increment then return ONLY
// the note's current title + content (FRS-7.3/7.4/7.6/7.8, SDS §8).
export async function viewByToken(token: string): Promise<PublicNoteView> {
  const share = await sharesRepo.findShareByToken(token)
  if (!share) throw new NotFoundError('Share link not found')

  const isRevoked = share.revokedAt !== null
  const isExpired = share.expiresAt !== null && share.expiresAt.getTime() <= Date.now()
  const isNoteDeleted = share.note.deletedAt !== null
  if (isRevoked || isExpired || isNoteDeleted) {
    // One indistinguishable 410 — the cause (revoked/expired/deleted) is never leaked.
    throw new GoneError('This share link is no longer available', 'SHARE_GONE')
  }

  // Increment only on a successful view — never on a 404/410 (FRS-7.4).
  await sharesRepo.incrementViewCount(share.id)
  return {
    title: share.note.title,
    content: share.note.contentJson,
  }
}
