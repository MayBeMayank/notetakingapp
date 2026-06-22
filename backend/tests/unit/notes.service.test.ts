import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError, ConflictError } from '../../src/lib/errors.js'

vi.mock('../../src/repositories/notes.repository.js')
vi.mock('../../src/lib/content.js')

import * as notesRepo from '../../src/repositories/notes.repository.js'
import * as contentLib from '../../src/lib/content.js'
import { createNote, getNoteById, updateNote, deleteNote, restoreNote, listNotes } from '../../src/services/notes.service.js'

const mockedRepo = vi.mocked(notesRepo)
const mockedContent = vi.mocked(contentLib)

const fakeNote = {
  id: 'note-1',
  userId: 'user-1',
  title: 'My Note',
  contentJson: { type: 'doc', content: [] },
  contentText: '',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  deletedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedContent.deriveContentText.mockReturnValue('derived text')
  mockedRepo.createNote.mockResolvedValue(fakeNote)
  mockedRepo.findNoteByIdForUser.mockResolvedValue(fakeNote)
  mockedRepo.updateNote.mockResolvedValue(fakeNote)
  mockedRepo.softDeleteNote.mockResolvedValue(fakeNote)
  mockedRepo.restoreNote.mockResolvedValue(fakeNote)
  mockedRepo.listNotesWithCount.mockResolvedValue([[fakeNote], 1])
})

// ── createNote ────────────────────────────────────────────────────────────────

describe('createNote', () => {
  it('blank input {} → uses EMPTY_TIPTAP_DOC as contentJson, calls deriveContentText, title defaults to empty string', async () => {
    await createNote('user-1', {})

    expect(mockedContent.deriveContentText).toHaveBeenCalled()
    const callArgs = mockedRepo.createNote.mock.calls[0][0]
    expect(callArgs.title).toBe('')
    expect(callArgs.contentJson).toEqual(contentLib.EMPTY_TIPTAP_DOC)
  })

  it('with title+content → passes them to repo, derives contentText from provided content', async () => {
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }

    await createNote('user-1', { title: 'Hello', content })

    expect(mockedContent.deriveContentText).toHaveBeenCalledWith(content)
    expect(mockedRepo.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Hello', contentJson: content, contentText: 'derived text' })
    )
  })

  it('response object has id, title, content, createdAt, updatedAt — does NOT contain contentText, userId, or deletedAt', async () => {
    const result = await createNote('user-1', { title: 'My Note' })

    expect(result).toMatchObject({ id: fakeNote.id, title: fakeNote.title, createdAt: fakeNote.createdAt, updatedAt: fakeNote.updatedAt })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('contentText')
    expect(serialized).not.toContain('userId')
    expect(serialized).not.toContain('deletedAt')
  })
})

// ── getNoteById ───────────────────────────────────────────────────────────────

describe('getNoteById', () => {
  it('repo returns null → throws NotFoundError (statusCode 404)', async () => {
    mockedRepo.findNoteByIdForUser.mockResolvedValue(null)

    await expect(getNoteById('user-1', 'note-1')).rejects.toThrow(NotFoundError)
    await expect(getNoteById('user-1', 'note-1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('repo returns note with deletedAt set → throws NotFoundError (404, not 422)', async () => {
    mockedRepo.findNoteByIdForUser.mockResolvedValue({ ...fakeNote, deletedAt: new Date() })

    await expect(getNoteById('user-1', 'note-1')).rejects.toThrow(NotFoundError)
    await expect(getNoteById('user-1', 'note-1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('repo returns active note (deletedAt null) → returns note response', async () => {
    const result = await getNoteById('user-1', 'note-1')

    expect(result).toMatchObject({ id: fakeNote.id, title: fakeNote.title })
  })
})

// ── updateNote ────────────────────────────────────────────────────────────────

describe('updateNote', () => {
  it('repo returns null → throws NotFoundError (404)', async () => {
    mockedRepo.findNoteByIdForUser.mockResolvedValue(null)

    await expect(updateNote('user-1', 'note-1', { title: 'New' })).rejects.toThrow(NotFoundError)
    await expect(updateNote('user-1', 'note-1', { title: 'New' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('repo returns note with deletedAt set → throws ConflictError with code NOTE_DELETED (statusCode 422)', async () => {
    mockedRepo.findNoteByIdForUser.mockResolvedValue({ ...fakeNote, deletedAt: new Date() })

    await expect(updateNote('user-1', 'note-1', { title: 'New' })).rejects.toThrow(ConflictError)
    await expect(updateNote('user-1', 'note-1', { title: 'New' })).rejects.toMatchObject({
      code: 'NOTE_DELETED',
      statusCode: 422,
    })
  })

  it('partial update with only title → repo updateNote called with { title } only, contentJson/contentText not passed', async () => {
    await updateNote('user-1', 'note-1', { title: 'Updated Title' })

    const callArgs = mockedRepo.updateNote.mock.calls[0][2]
    expect(callArgs).toMatchObject({ title: 'Updated Title' })
    expect(callArgs).not.toHaveProperty('contentJson')
    expect(callArgs).not.toHaveProperty('contentText')
  })

  it('update with content → re-derives contentText, repo called with { contentJson, contentText }', async () => {
    const content = { type: 'doc', content: [] }

    await updateNote('user-1', 'note-1', { content })

    expect(mockedContent.deriveContentText).toHaveBeenCalledWith(content)
    const callArgs = mockedRepo.updateNote.mock.calls[0][2]
    expect(callArgs).toMatchObject({ contentJson: content, contentText: 'derived text' })
  })
})

// ── deleteNote ────────────────────────────────────────────────────────────────

describe('deleteNote', () => {
  it('repo returns null → throws NotFoundError (404)', async () => {
    mockedRepo.findNoteByIdForUser.mockResolvedValue(null)

    await expect(deleteNote('user-1', 'note-1')).rejects.toThrow(NotFoundError)
    await expect(deleteNote('user-1', 'note-1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('repo returns already-deleted note (deletedAt set) → throws NotFoundError (404)', async () => {
    mockedRepo.findNoteByIdForUser.mockResolvedValue({ ...fakeNote, deletedAt: new Date() })

    await expect(deleteNote('user-1', 'note-1')).rejects.toThrow(NotFoundError)
    await expect(deleteNote('user-1', 'note-1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('repo returns active note → calls softDeleteNote, returns void (no error)', async () => {
    const result = await deleteNote('user-1', 'note-1')

    expect(mockedRepo.softDeleteNote).toHaveBeenCalledWith('user-1', 'note-1')
    expect(result).toBeUndefined()
  })
})

// ── restoreNote ───────────────────────────────────────────────────────────────

describe('restoreNote', () => {
  it('repo returns null → throws NotFoundError (404)', async () => {
    mockedRepo.findNoteByIdForUser.mockResolvedValue(null)

    await expect(restoreNote('user-1', 'note-1')).rejects.toThrow(NotFoundError)
    await expect(restoreNote('user-1', 'note-1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('repo returns active note (deletedAt null) → throws ConflictError with code NOTE_NOT_DELETED (statusCode 422)', async () => {
    mockedRepo.findNoteByIdForUser.mockResolvedValue({ ...fakeNote, deletedAt: null })

    await expect(restoreNote('user-1', 'note-1')).rejects.toThrow(ConflictError)
    await expect(restoreNote('user-1', 'note-1')).rejects.toMatchObject({
      code: 'NOTE_NOT_DELETED',
      statusCode: 422,
    })
  })

  it('deletedAt is within 30 days → calls restoreNote, returns note response', async () => {
    mockedRepo.findNoteByIdForUser.mockResolvedValue({
      ...fakeNote,
      deletedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    })

    const result = await restoreNote('user-1', 'note-1')

    expect(mockedRepo.restoreNote).toHaveBeenCalledWith('user-1', 'note-1')
    expect(result).toMatchObject({ id: fakeNote.id, title: fakeNote.title })
  })

  it('deletedAt is 31 days ago → throws ConflictError with code RESTORE_WINDOW_EXPIRED (statusCode 422)', async () => {
    mockedRepo.findNoteByIdForUser.mockResolvedValue({
      ...fakeNote,
      deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), // 31 days ago
    })

    await expect(restoreNote('user-1', 'note-1')).rejects.toThrow(ConflictError)
    await expect(restoreNote('user-1', 'note-1')).rejects.toMatchObject({
      code: 'RESTORE_WINDOW_EXPIRED',
      statusCode: 422,
    })
  })
})

// ── listNotes ─────────────────────────────────────────────────────────────────

describe('listNotes', () => {
  it('default page/limit (empty query {}) → calls listNotesWithCount with { skip: 0, take: 20 }, returns { data, page: 1, limit: 20, total }', async () => {
    const result = await listNotes('user-1', {})

    expect(mockedRepo.listNotesWithCount).toHaveBeenCalledWith('user-1', expect.objectContaining({ skip: 0, take: 20 }))
    expect(result).toMatchObject({ page: 1, limit: 20, total: 1 })
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('page=0 is clamped to 1 (skip stays 0)', async () => {
    await listNotes('user-1', { page: 0 })

    expect(mockedRepo.listNotesWithCount).toHaveBeenCalledWith('user-1', expect.objectContaining({ skip: 0, take: 20 }))
  })

  it('limit=999 is clamped to 100', async () => {
    await listNotes('user-1', { limit: 999 })

    expect(mockedRepo.listNotesWithCount).toHaveBeenCalledWith('user-1', expect.objectContaining({ skip: 0, take: 100 }))
  })

  it('page=3, limit=10 → skip=20', async () => {
    await listNotes('user-1', { page: 3, limit: 10 })

    expect(mockedRepo.listNotesWithCount).toHaveBeenCalledWith('user-1', expect.objectContaining({ skip: 20, take: 10 }))
  })

  it('total comes from listNotesWithCount independently of page', async () => {
    mockedRepo.listNotesWithCount.mockResolvedValue([[fakeNote], 42])

    const result = await listNotes('user-1', { page: 3, limit: 10 })

    expect(result.total).toBe(42)
    expect(result.data).toHaveLength(1)
  })

  it('results are returned in the order provided by the repository (updatedAt desc)', async () => {
    const olderNote = { ...fakeNote, id: 'note-old', updatedAt: new Date('2024-01-01T00:00:00.000Z') }
    const newerNote = { ...fakeNote, id: 'note-new', updatedAt: new Date('2024-06-01T00:00:00.000Z') }
    mockedRepo.listNotesWithCount.mockResolvedValue([[newerNote, olderNote], 2])

    const result = await listNotes('user-1', {})

    expect(result.data[0].id).toBe('note-new')
    expect(result.data[1].id).toBe('note-old')
  })
})

// ── listNotes — AB-1005 sort/filter/status ─────────────────────────────────────

describe('listNotes — AB-1005 sort/filter/status', () => {
  it('defaults order to desc when sort is supplied without order', async () => {
    await listNotes('user-1', { sort: 'title' })

    expect(mockedRepo.listNotesWithCount).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ sort: 'title', order: 'desc' }),
    )
  })

  it('maps omitted status to the active option', async () => {
    await listNotes('user-1', {})

    expect(mockedRepo.listNotesWithCount).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ status: 'active' }),
    )
  })

  it('maps status=trashed through to the repo option', async () => {
    await listNotes('user-1', { status: 'trashed' })

    expect(mockedRepo.listNotesWithCount).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ status: 'trashed' }),
    )
  })

  it('drops unknown/foreign tag ids and queries with only owned ids', async () => {
    mockedRepo.findOwnedTagIds.mockResolvedValue(['t1'])

    await listNotes('user-1', { tags: ['t1', 't2'] })

    expect(mockedRepo.findOwnedTagIds).toHaveBeenCalledWith('user-1', ['t1', 't2'])
    expect(mockedRepo.listNotesWithCount).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ tagIds: ['t1'] }),
    )
  })

  it('returns an empty page when a tag filter resolves to no owned tag', async () => {
    mockedRepo.findOwnedTagIds.mockResolvedValue([])

    const result = await listNotes('user-1', { tags: ['x'] })

    expect(result).toEqual({ data: [], page: 1, limit: 20, total: 0 })
    expect(mockedRepo.listNotesWithCount).not.toHaveBeenCalled()
  })

  it('applies no tag filter (tagIds undefined) for an empty tags array', async () => {
    await listNotes('user-1', { tags: [] })

    expect(mockedRepo.findOwnedTagIds).not.toHaveBeenCalled()
    expect(mockedRepo.listNotesWithCount).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ tagIds: undefined }),
    )
  })
})
