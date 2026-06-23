import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import type { Note } from '@prisma/client'
import { snapshotTx } from './versions.repository.js'
import type {
  NoteSortField,
  NoteSortOrder,
  NoteListStatus,
} from '@note-app/shared/schemas/notes'

const TAG_IDS_INCLUDE = { tags: { select: { tagId: true } } } as const

export type NoteWithTagIds = Note & { tags: { tagId: string }[] }

export async function createNote(data: {
  userId: string
  title: string
  contentJson: Record<string, unknown>
  contentText: string
  tagIds?: string[]
}): Promise<NoteWithTagIds> {
  // Create the note and capture its initial version (v1) atomically (FRS-8.1).
  return prisma.$transaction(async (tx) => {
    const note = await tx.note.create({
      data: {
        userId: data.userId,
        title: data.title,
        contentJson: data.contentJson as Prisma.InputJsonValue,
        contentText: data.contentText,
        ...(data.tagIds && data.tagIds.length > 0
          ? { tags: { create: data.tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
      include: TAG_IDS_INCLUDE,
    })

    await snapshotTx(tx, {
      noteId: note.id,
      title: note.title,
      contentJson: note.contentJson as Record<string, unknown>,
      contentText: note.contentText,
      tagIds: note.tags.map((t) => t.tagId),
    })

    return note
  })
}

export async function findNoteByIdForUser(
  userId: string,
  id: string,
): Promise<NoteWithTagIds | null> {
  return prisma.note.findFirst({ where: { id, userId }, include: TAG_IDS_INCLUDE })
}

export async function updateNote(
  userId: string,
  id: string,
  data: {
    title?: string
    contentJson?: Record<string, unknown>
    contentText?: string
    tagIds?: string[]
  },
  opts: { snapshot: boolean },
): Promise<NoteWithTagIds> {
  const { tagIds, ...fields } = data
  // Update the note and (when title/content changed) capture a new version
  // atomically (FRS-8.1 / ADR-003 §3). The snapshot mirrors the persisted
  // post-update state, including the note's resulting tag associations.
  return prisma.$transaction(async (tx) => {
    const updated = await tx.note.update({
      where: { id, userId },
      data: {
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.contentJson !== undefined && {
          contentJson: fields.contentJson as Prisma.InputJsonValue,
        }),
        ...(fields.contentText !== undefined && { contentText: fields.contentText }),
        ...(tagIds !== undefined && {
          tags: {
            deleteMany: {},
            ...(tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : {}),
          },
        }),
      },
      include: TAG_IDS_INCLUDE,
    })

    if (opts.snapshot) {
      await snapshotTx(tx, {
        noteId: updated.id,
        title: updated.title,
        contentJson: updated.contentJson as Record<string, unknown>,
        contentText: updated.contentText,
        tagIds: updated.tags.map((t) => t.tagId),
      })
    }

    return updated
  })
}

export async function softDeleteNote(userId: string, id: string): Promise<NoteWithTagIds> {
  return prisma.note.update({
    where: { id, userId },
    data: { deletedAt: new Date() },
    include: TAG_IDS_INCLUDE,
  })
}

export async function restoreNote(userId: string, id: string): Promise<NoteWithTagIds> {
  return prisma.note.update({
    where: { id, userId },
    data: { deletedAt: null },
    include: TAG_IDS_INCLUDE,
  })
}

export type ListNotesOptions = {
  skip: number
  take: number
  sort: NoteSortField
  order: NoteSortOrder
  status: NoteListStatus
  tagIds?: string[] // undefined = no tag filter; non-empty = OR filter on these owned tag IDs
}

// Returns the subset of `ids` that are tags owned by `userId`, so the service can
// drop unknown / another user's tag IDs from a filter (FRS-4.5.3 / 9.1).
export async function findOwnedTagIds(userId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await prisma.tag.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

export async function listNotesWithCount(
  userId: string,
  opts: ListNotesOptions,
): Promise<[NoteWithTagIds[], number]> {
  const { skip, take, sort, order, status, tagIds } = opts

  // Whitelisted ORDER BY column (case-insensitive for title) + direction. `sort`
  // and `order` are validated enums, so these fragments never carry user input.
  // Every ordering gets a secondary sort on id for stable pagination (FRS-4.5.2).
  let sortColumn: Prisma.Sql
  if (sort === 'title') sortColumn = Prisma.sql`lower(n."title")`
  else if (sort === 'createdAt') sortColumn = Prisma.sql`n."createdAt"`
  else sortColumn = Prisma.sql`n."updatedAt"`
  const dir = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`

  // status → soft-delete predicate (FRS-4.4.2)
  const statusSql =
    status === 'trashed'
      ? Prisma.sql`n."deletedAt" IS NOT NULL`
      : Prisma.sql`n."deletedAt" IS NULL`

  // Optional tag OR filter, de-duplicated via EXISTS so a note carrying several of
  // the supplied tags is returned once (FRS-4.5.3).
  const tagSql =
    tagIds && tagIds.length > 0
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "NoteTag" nt WHERE nt."noteId" = n."id" AND nt."tagId" IN (${Prisma.join(tagIds)}))`
      : Prisma.empty

  const whereSql = Prisma.sql`WHERE n."userId" = ${userId} AND ${statusSql} ${tagSql}`

  // 1) ordered + filtered + paginated IDs — raw is required for lower(title)
  //    ordering, which Prisma's orderBy cannot express on a plain String column.
  const idRows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT n."id" FROM "Note" n
    ${whereSql}
    ORDER BY ${sortColumn} ${dir}, n."id" ${dir}
    LIMIT ${take} OFFSET ${skip}
  `)

  // 2) total over the same predicate (counts each matching note once)
  const countRows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS count FROM "Note" n
    ${whereSql}
  `)
  const total = Number(countRows[0]?.count ?? 0)

  if (idRows.length === 0) return [[], total]

  // 3) hydrate full rows via Prisma (correct JSON/Date typing + tag associations),
  //    preserving raw-SQL order.
  const ids = idRows.map((r) => r.id)
  const notes = await prisma.note.findMany({
    where: { id: { in: ids } },
    include: TAG_IDS_INCLUDE,
  })
  const byId = new Map(notes.map((n) => [n.id, n]))
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((n): n is NoteWithTagIds => n !== undefined)

  return [ordered, total]
}
