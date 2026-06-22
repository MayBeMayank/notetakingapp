import { prisma } from '../lib/prisma.js';
import type { Note, Prisma } from '@prisma/client';

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

export async function listNotesWithCount(
  userId: string,
  opts: { skip: number; take: number },
): Promise<[Note[], number]> {
  const [notes, total] = await prisma.$transaction([
    prisma.note.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.note.count({ where: { userId, deletedAt: null } }),
  ])
  return [notes, total]
}
