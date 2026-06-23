import { prisma } from '../lib/prisma.js'
import type { ShareLink, Note } from '@prisma/client'

export type ShareWithNote = ShareLink & { note: Note }

export async function createShare(data: {
  noteId: string
  token: string
  expiresAt: Date | null
}): Promise<ShareLink> {
  return prisma.shareLink.create({
    data: {
      noteId: data.noteId,
      token: data.token,
      expiresAt: data.expiresAt,
    },
  })
}

// All of a user's non-revoked links across all their own notes, newest first.
// Filters on `revokedAt` only — NEVER the note's `deletedAt` — so expired and
// soft-deleted-note links remain listed (clarifications 5 & 6, FRS-7.7).
export async function listSharesForUser(userId: string): Promise<ShareLink[]> {
  return prisma.shareLink.findMany({
    where: { revokedAt: null, note: { userId } },
    orderBy: { createdAt: 'desc' },
  })
}

// A share scoped to its owner via the note relation; null if absent or not owned
// (so a foreign share is indistinguishable from a missing one → 404, FRS-9.1).
export async function findShareByIdForUser(
  userId: string,
  id: string,
): Promise<ShareLink | null> {
  return prisma.shareLink.findFirst({ where: { id, note: { userId } } })
}

export async function revokeShare(id: string): Promise<void> {
  await prisma.shareLink.update({ where: { id }, data: { revokedAt: new Date() } })
}

// Resolve a token to its share + underlying note (the public view needs the
// note's `deletedAt`, `title`, and `contentJson`).
export async function findShareByToken(token: string): Promise<ShareWithNote | null> {
  return prisma.shareLink.findUnique({ where: { token }, include: { note: true } })
}

// Atomic increment — compiles to `SET view_count = view_count + 1`; never
// read-modify-write, so concurrent views don't lose updates (FRS-7.4, SDS §8).
export async function incrementViewCount(id: string): Promise<void> {
  await prisma.shareLink.update({ where: { id }, data: { viewCount: { increment: 1 } } })
}
