import { prisma } from '../lib/prisma.js'
import type { Note, Prisma } from '@prisma/client'

const TAG_IDS_INCLUDE = { tags: { select: { tagId: true } } } as const

export type NoteWithTagIds = Note & { tags: { tagId: string }[] }

export async function createNote(data: {
  userId: string
  title: string
  contentJson: Record<string, unknown>
  contentText: string
  tagIds?: string[]
}): Promise<NoteWithTagIds> {
  return prisma.note.create({
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
): Promise<NoteWithTagIds> {
  const { tagIds, ...fields } = data
  return prisma.note.update({
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

export async function listNotesWithCount(
  userId: string,
  opts: { skip: number; take: number },
): Promise<[NoteWithTagIds[], number]> {
  const [notes, total] = await prisma.$transaction([
    prisma.note.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
      include: TAG_IDS_INCLUDE,
    }),
    prisma.note.count({ where: { userId, deletedAt: null } }),
  ])
  return [notes as NoteWithTagIds[], total]
}
