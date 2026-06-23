import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError } from '../../src/lib/errors.js'

vi.mock('../../src/repositories/notes.repository.js')
vi.mock('../../src/repositories/versions.repository.js')

import * as notesRepo from '../../src/repositories/notes.repository.js'
import * as versionsRepo from '../../src/repositories/versions.repository.js'
import { listVersions, getVersion, restoreVersion } from '../../src/services/versions.service.js'

const mockedNotesRepo = vi.mocked(notesRepo)
const mockedVersionsRepo = vi.mocked(versionsRepo)

const activeNote = {
  id: 'note-1',
  userId: 'user-1',
  title: 'Current',
  contentJson: { type: 'doc', content: [] },
  contentText: '',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
  deletedAt: null,
  tags: [] as { tagId: string }[],
}

const trashedNote = { ...activeNote, deletedAt: new Date('2024-02-01T00:00:00.000Z') }

// Target version 2; the note's latest is 3 (so restore is NOT a no-op by default).
const version = {
  id: 'ver-2',
  noteId: 'note-1',
  versionNumber: 2,
  title: 'Old Title',
  contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
  contentText: 'old',
  tagIds: ['tagA', 'tagB'],
  createdAt: new Date('2024-01-01T12:00:00.000Z'),
}

const restoredNote = {
  ...activeNote,
  title: 'Old Title',
  contentJson: version.contentJson,
  contentText: 'old',
  tags: [{ tagId: 'tagA' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedNotesRepo.findNoteByIdForUser.mockResolvedValue(activeNote)
  mockedNotesRepo.findOwnedTagIds.mockResolvedValue(['tagA'])
  mockedVersionsRepo.listVersions.mockResolvedValue([
    { id: 'ver-3', versionNumber: 3, title: 'Current', createdAt: new Date('2024-01-03T00:00:00.000Z') },
    { id: 'ver-2', versionNumber: 2, title: 'Old Title', createdAt: new Date('2024-01-02T00:00:00.000Z') },
    { id: 'ver-1', versionNumber: 1, title: 'First', createdAt: new Date('2024-01-01T00:00:00.000Z') },
  ])
  mockedVersionsRepo.findVersionForNote.mockResolvedValue(version)
  mockedVersionsRepo.getLatestVersionNumber.mockResolvedValue(3)
  mockedVersionsRepo.restoreVersionTx.mockResolvedValue(restoredNote)
})

// ── listVersions ───────────────────────────────────────────────────────────────

describe('listVersions', () => {
  it('returns the note versions newest-first (FRS-8.2)', async () => {
    const result = await listVersions('user-1', 'note-1')
    expect(result.map((v) => v.versionNumber)).toEqual([3, 2, 1])
  })

  it('throws NotFoundError when the note is missing or not owned (FRS-9.1)', async () => {
    mockedNotesRepo.findNoteByIdForUser.mockResolvedValue(null)
    await expect(listVersions('user-1', 'note-x')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('allows listing versions of a soft-deleted note (ADR-004)', async () => {
    mockedNotesRepo.findNoteByIdForUser.mockResolvedValue(trashedNote)
    const result = await listVersions('user-1', 'note-1')
    expect(result).toHaveLength(3)
  })
})

// ── getVersion ───────────────────────────────────────────────────────────────

describe('getVersion', () => {
  it('returns detail with content + tagIds (FRS-8.3)', async () => {
    const result = await getVersion('user-1', 'note-1', 'ver-2')
    expect(result).toMatchObject({
      id: 'ver-2',
      versionNumber: 2,
      title: 'Old Title',
      content: version.contentJson,
      tagIds: ['tagA', 'tagB'],
    })
  })

  it('throws NotFoundError when the note is missing', async () => {
    mockedNotesRepo.findNoteByIdForUser.mockResolvedValue(null)
    await expect(getVersion('user-1', 'note-x', 'ver-2')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when the version does not belong to the note', async () => {
    mockedVersionsRepo.findVersionForNote.mockResolvedValue(null)
    await expect(getVersion('user-1', 'note-1', 'ver-x')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('allows viewing a version of a soft-deleted note (ADR-004)', async () => {
    mockedNotesRepo.findNoteByIdForUser.mockResolvedValue(trashedNote)
    const result = await getVersion('user-1', 'note-1', 'ver-2')
    expect(result.id).toBe('ver-2')
  })
})

// ── restoreVersion ───────────────────────────────────────────────────────────

describe('restoreVersion', () => {
  it('throws NotFoundError when the note is missing', async () => {
    mockedNotesRepo.findNoteByIdForUser.mockResolvedValue(null)
    await expect(restoreVersion('user-1', 'note-x', 'ver-2')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ConflictError NOTE_DELETED when the note is soft-deleted (ADR-004)', async () => {
    mockedNotesRepo.findNoteByIdForUser.mockResolvedValue(trashedNote)
    await expect(restoreVersion('user-1', 'note-1', 'ver-2')).rejects.toMatchObject({
      code: 'NOTE_DELETED',
      statusCode: 422,
    })
    expect(mockedVersionsRepo.restoreVersionTx).not.toHaveBeenCalled()
  })

  it('throws NotFoundError when the version does not exist', async () => {
    mockedVersionsRepo.findVersionForNote.mockResolvedValue(null)
    await expect(restoreVersion('user-1', 'note-1', 'ver-x')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ConflictError VERSION_ALREADY_CURRENT when restoring the latest version (D7)', async () => {
    mockedVersionsRepo.getLatestVersionNumber.mockResolvedValue(2) // == target version
    await expect(restoreVersion('user-1', 'note-1', 'ver-2')).rejects.toMatchObject({
      code: 'VERSION_ALREADY_CURRENT',
      statusCode: 422,
    })
    expect(mockedVersionsRepo.restoreVersionTx).not.toHaveBeenCalled()
  })

  it('re-applies only the surviving owned tags and records them (ADR-003 / FRS-5.5)', async () => {
    // version.tagIds = [tagA, tagB]; findOwnedTagIds returns [tagA] (tagB deleted)
    await restoreVersion('user-1', 'note-1', 'ver-2')
    expect(mockedNotesRepo.findOwnedTagIds).toHaveBeenCalledWith('user-1', ['tagA', 'tagB'])
    expect(mockedVersionsRepo.restoreVersionTx).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        noteId: 'note-1',
        title: 'Old Title',
        survivingTagIds: ['tagA'],
      }),
    )
  })

  it('returns the restored note as a note response (FRS-8.4)', async () => {
    const result = await restoreVersion('user-1', 'note-1', 'ver-2')
    expect(result).toMatchObject({ id: 'note-1', title: 'Old Title', tagIds: ['tagA'] })
    expect(JSON.stringify(result)).not.toContain('contentText')
  })
})
