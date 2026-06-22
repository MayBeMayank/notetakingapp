import { prisma } from '../lib/prisma.js'
import type { Tag } from '@prisma/client'

export type TagWithCount = Tag & { _count: { notes: number } }

export async function createTag(data: {
  userId: string
  name: string
  color: string
}): Promise<Tag> {
  return prisma.tag.create({ data })
}

export async function findTagByIdForUser(userId: string, id: string): Promise<Tag | null> {
  return prisma.tag.findFirst({ where: { id, userId } })
}

export async function findByName(
  userId: string,
  name: string,
  excludeId?: string,
): Promise<Tag | null> {
  return prisma.tag.findFirst({
    where: { userId, name, ...(excludeId ? { id: { not: excludeId } } : {}) },
  })
}

export async function listTagsWithCount(userId: string): Promise<TagWithCount[]> {
  return prisma.tag.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          notes: { where: { note: { deletedAt: null } } },
        },
      },
    },
  }) as Promise<TagWithCount[]>
}

export async function updateTag(
  userId: string,
  id: string,
  data: { name?: string; color?: string },
): Promise<Tag> {
  return prisma.tag.update({ where: { id, userId }, data })
}

export async function deleteTag(userId: string, id: string): Promise<void> {
  await prisma.tag.delete({ where: { id, userId } })
}

export async function countOwned(userId: string, ids: string[]): Promise<number> {
  return prisma.tag.count({ where: { userId, id: { in: ids } } })
}
