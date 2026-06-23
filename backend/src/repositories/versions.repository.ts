import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import type { NoteVersion } from '@prisma/client'
// type-only import — erased at runtime, so no import cycle with notes.repository
// (which imports `snapshotTx` from here as a runtime value).
import type { NoteWithTagIds } from './notes.repository.js'

// Locally defined (not imported from notes.repository) to keep the runtime
// dependency one-directional: notes.repository → versions.repository.
const TAG_IDS_INCLUDE = { tags: { select: { tagId: true } } } as const

// FRS-8.5: retain at most the most-recent 50 versions per note.
const MAX_VERSIONS_PER_NOTE = 50

export type VersionSnapshot = {
  noteId: string
  title: string
  contentJson: Record<string, unknown>
  contentText: string
  tagIds: string[]
}

// Insert a new version (next monotonic versionNumber) and purge anything beyond
// the most-recent 50 — all on the supplied transaction client so it is atomic
// with the caller's note write (FRS-8.1 / 8.5). Reused by create, update, restore.
export async function snapshotTx(
  tx: Prisma.TransactionClient,
  snap: VersionSnapshot,
): Promise<NoteVersion> {
  const last = await tx.noteVersion.findFirst({
    where: { noteId: snap.noteId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  })
  const versionNumber = (last?.versionNumber ?? 0) + 1

  const created = await tx.noteVersion.create({
    data: {
      noteId: snap.noteId,
      versionNumber,
      title: snap.title,
      contentJson: snap.contentJson as Prisma.InputJsonValue,
      contentText: snap.contentText,
      tagIds: snap.tagIds,
    },
  })

  // Purge older versions. versionNumber is monotonic, so "older" = lower number.
  // The 51st-newest row's number is the cutoff; delete everything <= it.
  const cutoff = await tx.noteVersion.findMany({
    where: { noteId: snap.noteId },
    orderBy: { versionNumber: 'desc' },
    skip: MAX_VERSIONS_PER_NOTE,
    take: 1,
    select: { versionNumber: true },
  })
  if (cutoff.length > 0) {
    await tx.noteVersion.deleteMany({
      where: { noteId: snap.noteId, versionNumber: { lte: cutoff[0]!.versionNumber } },
    })
  }

  return created
}

// Reverse-chronological list (FRS-8.2). versionNumber is monotonic, so ordering
// by it desc is equivalent to createdAt desc and is stable. No content returned.
export async function listVersions(
  noteId: string,
): Promise<Pick<NoteVersion, 'id' | 'versionNumber' | 'title' | 'createdAt'>[]> {
  return prisma.noteVersion.findMany({
    where: { noteId },
    orderBy: { versionNumber: 'desc' },
    select: { id: true, versionNumber: true, title: true, createdAt: true },
  })
}

// Scoped to the note: a versionId belonging to a different note resolves to null
// → the service returns 404 (no addressing a version through the wrong note).
export async function findVersionForNote(
  noteId: string,
  versionId: string,
): Promise<NoteVersion | null> {
  return prisma.noteVersion.findFirst({ where: { id: versionId, noteId } })
}

export async function getLatestVersionNumber(noteId: string): Promise<number | null> {
  const last = await prisma.noteVersion.findFirst({
    where: { noteId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  })
  return last?.versionNumber ?? null
}

// Non-destructive restore (FRS-8.4): set the note's current title/content and
// replace its tag associations with the surviving snapshot subset, then record
// the result as a NEW version. The chosen version row is never modified.
export async function restoreVersionTx(args: {
  userId: string
  noteId: string
  title: string
  contentJson: Record<string, unknown>
  contentText: string
  survivingTagIds: string[]
}): Promise<NoteWithTagIds> {
  return prisma.$transaction(async (tx) => {
    const note = await tx.note.update({
      where: { id: args.noteId, userId: args.userId },
      data: {
        title: args.title,
        contentJson: args.contentJson as Prisma.InputJsonValue,
        contentText: args.contentText,
        tags: {
          deleteMany: {},
          ...(args.survivingTagIds.length > 0
            ? { create: args.survivingTagIds.map((tagId) => ({ tagId })) }
            : {}),
        },
      },
      include: TAG_IDS_INCLUDE,
    })

    await snapshotTx(tx, {
      noteId: args.noteId,
      title: args.title,
      contentJson: args.contentJson,
      contentText: args.contentText,
      tagIds: args.survivingTagIds,
    })

    return note
  })
}
