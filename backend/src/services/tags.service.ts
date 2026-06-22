import { NotFoundError, ConflictError } from '../lib/errors.js'
import * as tagsRepo from '../repositories/tags.repository.js'
import type { CreateTagInput, UpdateTagInput, TagResponse, TagWithCount } from '@note-app/shared/schemas/tags'
import type { Tag } from '@prisma/client'

function norm(name: string): string {
  return name.toLowerCase()
}

function toTagResponse(tag: Tag): TagResponse {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  }
}

export async function createTag(userId: string, input: CreateTagInput): Promise<TagResponse> {
  const name = norm(input.name)
  const existing = await tagsRepo.findByName(userId, name)
  if (existing) throw new ConflictError('TAG_NAME_TAKEN', 'A tag with that name already exists')
  const tag = await tagsRepo.createTag({ userId, name, color: input.color })
  return toTagResponse(tag)
}

export async function listTags(userId: string): Promise<TagWithCount[]> {
  const tags = await tagsRepo.listTagsWithCount(userId)
  return tags.map((t) => ({
    ...toTagResponse(t),
    noteCount: t._count.notes,
  }))
}

export async function updateTag(
  userId: string,
  id: string,
  input: UpdateTagInput,
): Promise<TagResponse> {
  const tag = await tagsRepo.findTagByIdForUser(userId, id)
  if (!tag) throw new NotFoundError('Tag not found')

  const updateData: { name?: string; color?: string } = {}

  if (input.name !== undefined) {
    const name = norm(input.name)
    const collision = await tagsRepo.findByName(userId, name, id)
    if (collision) throw new ConflictError('TAG_NAME_TAKEN', 'A tag with that name already exists')
    updateData.name = name
  }

  if (input.color !== undefined) {
    updateData.color = input.color
  }

  const updated = await tagsRepo.updateTag(userId, id, updateData)
  return toTagResponse(updated)
}

export async function deleteTag(userId: string, id: string): Promise<void> {
  const tag = await tagsRepo.findTagByIdForUser(userId, id)
  if (!tag) throw new NotFoundError('Tag not found')
  await tagsRepo.deleteTag(userId, id)
}
