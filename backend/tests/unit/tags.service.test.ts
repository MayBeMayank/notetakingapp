import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError, ConflictError } from '../../src/lib/errors.js'

vi.mock('../../src/repositories/tags.repository.js')

import * as tagsRepo from '../../src/repositories/tags.repository.js'
import { createTag, listTags, updateTag, deleteTag } from '../../src/services/tags.service.js'

const mockedRepo = vi.mocked(tagsRepo)

const fakeTag = {
  id: 'tag-1',
  userId: 'user-1',
  name: 'work',
  color: '#3B82F6',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
}

const fakeTagWithCount = {
  ...fakeTag,
  _count: { notes: 3 },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedRepo.createTag.mockResolvedValue(fakeTag)
  mockedRepo.findTagByIdForUser.mockResolvedValue(fakeTag)
  mockedRepo.findByName.mockResolvedValue(null)
  mockedRepo.listTagsWithCount.mockResolvedValue([fakeTagWithCount] as tagsRepo.TagWithCount[])
  mockedRepo.updateTag.mockResolvedValue(fakeTag)
  mockedRepo.deleteTag.mockResolvedValue(undefined)
  mockedRepo.countOwned.mockResolvedValue(0)
})

// ── createTag ─────────────────────────────────────────────────────────────────

describe('createTag', () => {
  it('lower-cases name before dup-check and write', async () => {
    await createTag('user-1', { name: 'Work', color: '#3B82F6' })

    expect(mockedRepo.findByName).toHaveBeenCalledWith('user-1', 'work')
    expect(mockedRepo.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'work' }),
    )
  })

  it('dup name (findByName returns a tag) → throws ConflictError TAG_NAME_TAKEN (422)', async () => {
    mockedRepo.findByName.mockResolvedValue(fakeTag)

    await expect(createTag('user-1', { name: 'work', color: '#3B82F6' })).rejects.toThrow(ConflictError)
    await expect(createTag('user-1', { name: 'work', color: '#3B82F6' })).rejects.toMatchObject({
      code: 'TAG_NAME_TAKEN',
      statusCode: 422,
    })
  })

  it('case-insensitive dup check — "WORK" collides with existing "work"', async () => {
    mockedRepo.findByName.mockResolvedValue(fakeTag)

    await expect(createTag('user-1', { name: 'WORK', color: '#3B82F6' })).rejects.toMatchObject({
      code: 'TAG_NAME_TAKEN',
    })
    expect(mockedRepo.findByName).toHaveBeenCalledWith('user-1', 'work')
  })

  it('no dup → calls createTag with normalized name and passes color through', async () => {
    await createTag('user-1', { name: 'Design', color: '#10B981' })

    expect(mockedRepo.createTag).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'design',
      color: '#10B981',
    })
  })

  it('response omits userId and internal fields', async () => {
    const result = await createTag('user-1', { name: 'work', color: '#3B82F6' })

    expect(result).toMatchObject({ id: fakeTag.id, name: fakeTag.name, color: fakeTag.color })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('userId')
    expect(serialized).not.toContain('_count')
  })
})

// ── listTags ──────────────────────────────────────────────────────────────────

describe('listTags', () => {
  it('maps _count.notes to noteCount', async () => {
    const result = await listTags('user-1')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: fakeTag.id, noteCount: 3 })
  })

  it('empty repo → returns []', async () => {
    mockedRepo.listTagsWithCount.mockResolvedValue([])

    const result = await listTags('user-1')

    expect(result).toEqual([])
  })

  it('unused tag → noteCount is 0', async () => {
    mockedRepo.listTagsWithCount.mockResolvedValue([
      { ...fakeTagWithCount, _count: { notes: 0 } } as tagsRepo.TagWithCount,
    ])

    const result = await listTags('user-1')

    expect(result[0].noteCount).toBe(0)
  })
})

// ── updateTag ─────────────────────────────────────────────────────────────────

describe('updateTag', () => {
  it('missing tag (findTagByIdForUser returns null) → throws NotFoundError (404)', async () => {
    mockedRepo.findTagByIdForUser.mockResolvedValue(null)

    await expect(updateTag('user-1', 'tag-1', { name: 'new' })).rejects.toThrow(NotFoundError)
    await expect(updateTag('user-1', 'tag-1', { name: 'new' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('name collision via findByName (excluding own id) → throws TAG_NAME_TAKEN (422)', async () => {
    mockedRepo.findByName.mockResolvedValue({ ...fakeTag, id: 'tag-other' })

    await expect(updateTag('user-1', 'tag-1', { name: 'work' })).rejects.toMatchObject({
      code: 'TAG_NAME_TAKEN',
      statusCode: 422,
    })
    expect(mockedRepo.findByName).toHaveBeenCalledWith('user-1', 'work', 'tag-1')
  })

  it('rename to own current name (findByName returns null with excludeId) → succeeds', async () => {
    mockedRepo.findByName.mockResolvedValue(null)

    const result = await updateTag('user-1', 'tag-1', { name: 'work' })

    expect(result).toMatchObject({ id: fakeTag.id })
    expect(mockedRepo.updateTag).toHaveBeenCalledWith('user-1', 'tag-1', { name: 'work' })
  })

  it('lower-cases new name before collision check and write', async () => {
    await updateTag('user-1', 'tag-1', { name: 'MyTag' })

    expect(mockedRepo.findByName).toHaveBeenCalledWith('user-1', 'mytag', 'tag-1')
    expect(mockedRepo.updateTag).toHaveBeenCalledWith('user-1', 'tag-1', { name: 'mytag' })
  })

  it('color-only update → does not call findByName', async () => {
    await updateTag('user-1', 'tag-1', { color: '#10B981' })

    expect(mockedRepo.findByName).not.toHaveBeenCalled()
    expect(mockedRepo.updateTag).toHaveBeenCalledWith('user-1', 'tag-1', { color: '#10B981' })
  })
})

// ── deleteTag ─────────────────────────────────────────────────────────────────

describe('deleteTag', () => {
  it('missing tag → throws NotFoundError (404)', async () => {
    mockedRepo.findTagByIdForUser.mockResolvedValue(null)

    await expect(deleteTag('user-1', 'tag-1')).rejects.toThrow(NotFoundError)
    await expect(deleteTag('user-1', 'tag-1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('present tag → calls deleteTag, returns void', async () => {
    const result = await deleteTag('user-1', 'tag-1')

    expect(mockedRepo.deleteTag).toHaveBeenCalledWith('user-1', 'tag-1')
    expect(result).toBeUndefined()
  })
})
