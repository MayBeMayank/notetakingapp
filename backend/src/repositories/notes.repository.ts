import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import type { Note } from '@prisma/client';
import type {
  NoteSortField,
  NoteSortOrder,
  NoteListStatus,
} from '@note-app/shared/schemas/notes';

export async function createNote(data: {
  userId: string;
  title: string;
  contentJson: Record<string, unknown>;
  contentText: string;
}): Promise<Note> {
  return prisma.note.create({
    data: {
      userId: data.userId,
      title: data.title,
      contentJson: data.contentJson as Prisma.InputJsonValue,
      contentText: data.contentText,
    },
  });
}

export async function findNoteByIdForUser(
  userId: string,
  id: string,
): Promise<Note | null> {
  return prisma.note.findFirst({ where: { id, userId } });
}

export async function updateNote(
  userId: string,
  id: string,
  data: {
    title?: string;
    contentJson?: Record<string, unknown>;
    contentText?: string;
  },
): Promise<Note> {
  return prisma.note.update({
    where: { id, userId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.contentJson !== undefined && { contentJson: data.contentJson as Prisma.InputJsonValue }),
      ...(data.contentText !== undefined && { contentText: data.contentText }),
    },
  });
}

export async function softDeleteNote(userId: string, id: string): Promise<Note> {
  return prisma.note.update({ where: { id, userId }, data: { deletedAt: new Date() } });
}

export async function restoreNote(userId: string, id: string): Promise<Note> {
  return prisma.note.update({ where: { id, userId }, data: { deletedAt: null } });
}

export async function listActiveNotes(
  userId: string,
  opts: { skip: number; take: number },
): Promise<Note[]> {
  return prisma.note.findMany({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    skip: opts.skip,
    take: opts.take,
  });
}

export async function countActiveNotes(userId: string): Promise<number> {
  return prisma.note.count({ where: { userId, deletedAt: null } });
}

export type ListNotesOptions = {
  skip: number;
  take: number;
  sort: NoteSortField;
  order: NoteSortOrder;
  status: NoteListStatus;
  tagIds?: string[]; // undefined = no tag filter; non-empty = OR filter on these owned tag IDs
};

// Returns the subset of `ids` that are tags owned by `userId`, so the service can
// drop unknown / another user's tag IDs from a filter (FRS-4.5.3 / 9.1).
export async function findOwnedTagIds(
  userId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.tag.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function listNotesWithCount(
  userId: string,
  opts: ListNotesOptions,
): Promise<[Note[], number]> {
  const { skip, take, sort, order, status, tagIds } = opts;

  // Whitelisted ORDER BY column (case-insensitive for title) + direction. `sort`
  // and `order` are validated enums, so these fragments never carry user input.
  // Every ordering gets a secondary sort on id for stable pagination (FRS-4.5.2).
  let sortColumn: Prisma.Sql;
  if (sort === 'title') sortColumn = Prisma.sql`lower(n."title")`;
  else if (sort === 'createdAt') sortColumn = Prisma.sql`n."createdAt"`;
  else sortColumn = Prisma.sql`n."updatedAt"`;
  const dir = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

  // status → soft-delete predicate (FRS-4.4.2)
  const statusSql =
    status === 'trashed'
      ? Prisma.sql`n."deletedAt" IS NOT NULL`
      : Prisma.sql`n."deletedAt" IS NULL`;

  // Optional tag OR filter, de-duplicated via EXISTS so a note carrying several of
  // the supplied tags is returned once (FRS-4.5.3). Applied only for a non-empty
  // owned-tag set; "no filter" is `tagIds === undefined`.
  const tagSql =
    tagIds && tagIds.length > 0
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "NoteTag" nt WHERE nt."noteId" = n."id" AND nt."tagId" IN (${Prisma.join(tagIds)}))`
      : Prisma.empty;

  const whereSql = Prisma.sql`WHERE n."userId" = ${userId} AND ${statusSql} ${tagSql}`;

  // 1) ordered + filtered + paginated IDs — raw is required for lower(title)
  //    ordering, which Prisma's orderBy cannot express on a plain String column.
  const idRows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT n."id" FROM "Note" n
    ${whereSql}
    ORDER BY ${sortColumn} ${dir}, n."id" ${dir}
    LIMIT ${take} OFFSET ${skip}
  `);

  // 2) total over the same predicate (counts each matching note once)
  const countRows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS count FROM "Note" n
    ${whereSql}
  `);
  const total = Number(countRows[0]?.count ?? 0);

  if (idRows.length === 0) return [[], total];

  // 3) hydrate full rows via Prisma (correct JSON/Date typing), preserving raw order.
  const ids = idRows.map((r) => r.id);
  const notes = await prisma.note.findMany({ where: { id: { in: ids } } });
  const byId = new Map(notes.map((n) => [n.id, n]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((n): n is Note => n !== undefined);

  return [ordered, total];
}
