import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError, ConflictError, GoneError } from '../../src/lib/errors.js'

vi.mock('../../src/repositories/shares.repository.js')
vi.mock('../../src/repositories/notes.repository.js')

import * as sharesRepo from '../../src/repositories/shares.repository.js'
import * as notesRepo from '../../src/repositories/notes.repository.js'
import {
  createShare,
  listShares,
  revokeShare,
  viewByToken,
} from '../../src/services/shares.service.js'

const mockedSharesRepo = vi.mocked(sharesRepo)
const mockedNotesRepo = vi.mocked(notesRepo)

const fakeNote = {
  id: 'note-1',
  userId: 'user-1',
  title: 'My Note',
  contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
  contentText: 'plain',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null as Date | null,
  tags: [] as { tagId: string }[],
}

const fakeShare = {
  id: 'share-1',
  noteId: 'note-1',
  token: 'tok_fixed_value',
  expiresAt: null as Date | null,
  revokedAt: null as Date | null,
  viewCount: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

const fakeShareWithNote = { ...fakeShare, note: fakeNote }

beforeEach(() => {
  vi.clearAllMocks()
  mockedNotesRepo.findNoteByIdForUser.mockResolvedValue(fakeNote)
  mockedSharesRepo.createShare.mockResolvedValue(fakeShare)
  mockedSharesRepo.listSharesForUser.mockResolvedValue([fakeShare])
  mockedSharesRepo.findShareByIdForUser.mockResolvedValue(fakeShare)
  mockedSharesRepo.revokeShare.mockResolvedValue(undefined)
  mockedSharesRepo.findShareByToken.mockResolvedValue(fakeShareWithNote)
  mockedSharesRepo.incrementViewCount.mockResolvedValue(undefined)
})

// ── createShare (FRS-7.1, 7.2) ─────────────────────────────────────────────────

describe('createShare', () => {
  it('Create a link with no expiry → persists expiresAt=null, returns viewCount 0 and relative url', async () => {
    const res = await createShare('user-1', 'note-1', {})

    const callArgs = mockedSharesRepo.createShare.mock.calls[0][0]
    expect(callArgs.noteId).toBe('note-1')
    expect(callArgs.expiresAt).toBeNull()
    expect(res).toMatchObject({ id: 'share-1', noteId: 'note-1', expiresAt: null, viewCount: 0 })
    expect(res.url).toBe(`/s/${res.token}`)
  })

  it('Create a link with a valid future expiry → passes a Date to the repo', async () => {
    const future = new Date('2099-01-01T00:00:00.000Z').toISOString()

    await createShare('user-1', 'note-1', { expiresAt: future })

    const callArgs = mockedSharesRepo.createShare.mock.calls[0][0]
    expect(callArgs.expiresAt).toEqual(new Date(future))
  })

  it('Token is unguessable → 32-byte base64url string', async () => {
    await createShare('user-1', 'note-1', {})
    const token = mockedSharesRepo.createShare.mock.calls[0][0].token
    // base64url of 32 random bytes → 43 chars, alphabet [A-Za-z0-9_-]
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('Multiple links → each call mints a distinct token (no per-note upsert)', async () => {
    await createShare('user-1', 'note-1', {})
    await createShare('user-1', 'note-1', {})
    const t1 = mockedSharesRepo.createShare.mock.calls[0][0].token
    const t2 = mockedSharesRepo.createShare.mock.calls[1][0].token
    expect(t1).not.toBe(t2)
  })

  it('url is a relative path "/s/<token>"', async () => {
    const res = await createShare('user-1', 'note-1', {})
    expect(res.url).toBe('/s/tok_fixed_value')
    expect(res.url.startsWith('/s/')).toBe(true)
  })

  it('Note not found (or not owned) → NotFoundError 404, no share created', async () => {
    mockedNotesRepo.findNoteByIdForUser.mockResolvedValue(null)

    await expect(createShare('user-1', 'missing', {})).rejects.toThrow(NotFoundError)
    await expect(createShare('user-1', 'missing', {})).rejects.toMatchObject({ statusCode: 404 })
    expect(mockedSharesRepo.createShare).not.toHaveBeenCalled()
  })

  it('Note is soft-deleted → ConflictError NOTE_DELETED 422, no share created', async () => {
    mockedNotesRepo.findNoteByIdForUser.mockResolvedValue({ ...fakeNote, deletedAt: new Date() })

    await expect(createShare('user-1', 'note-1', {})).rejects.toThrow(ConflictError)
    await expect(createShare('user-1', 'note-1', {})).rejects.toMatchObject({
      statusCode: 422,
      code: 'NOTE_DELETED',
    })
    expect(mockedSharesRepo.createShare).not.toHaveBeenCalled()
  })
})

// ── listShares (FRS-7.7) ───────────────────────────────────────────────────────

describe('listShares', () => {
  it('maps repo rows to share responses with relative url (ordering/filtering owned by repo)', async () => {
    const res = await listShares('user-1')

    expect(mockedSharesRepo.listSharesForUser).toHaveBeenCalledWith('user-1')
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ id: 'share-1', noteId: 'note-1', url: '/s/tok_fixed_value' })
  })

  it('empty repo result → empty array (not an error)', async () => {
    mockedSharesRepo.listSharesForUser.mockResolvedValue([])
    await expect(listShares('user-1')).resolves.toEqual([])
  })
})

// ── revokeShare (FRS-7.5) ──────────────────────────────────────────────────────

describe('revokeShare', () => {
  it('own link → calls repo.revokeShare with the id', async () => {
    await revokeShare('user-1', 'share-1')
    expect(mockedSharesRepo.revokeShare).toHaveBeenCalledWith('share-1')
  })

  it('unknown / not-owned link → NotFoundError 404, nothing revoked', async () => {
    mockedSharesRepo.findShareByIdForUser.mockResolvedValue(null)

    await expect(revokeShare('user-1', 'nope')).rejects.toThrow(NotFoundError)
    await expect(revokeShare('user-1', 'nope')).rejects.toMatchObject({ statusCode: 404 })
    expect(mockedSharesRepo.revokeShare).not.toHaveBeenCalled()
  })

  it('already-revoked own link → idempotent, still revokes without error', async () => {
    mockedSharesRepo.findShareByIdForUser.mockResolvedValue({ ...fakeShare, revokedAt: new Date() })
    await expect(revokeShare('user-1', 'share-1')).resolves.toBeUndefined()
    expect(mockedSharesRepo.revokeShare).toHaveBeenCalledWith('share-1')
  })
})

// ── viewByToken (FRS-7.3, 7.4, 7.6, 7.8) ───────────────────────────────────────

describe('viewByToken', () => {
  it('valid link → increments view count once and returns ONLY title + content', async () => {
    const res = await viewByToken('tok_fixed_value')

    expect(mockedSharesRepo.incrementViewCount).toHaveBeenCalledTimes(1)
    expect(mockedSharesRepo.incrementViewCount).toHaveBeenCalledWith('share-1')
    expect(Object.keys(res).sort()).toEqual(['content', 'title'])
    expect(res.title).toBe('My Note')
    expect(res.content).toEqual(fakeNote.contentJson)
  })

  it('serves the note current content (whatever the note currently holds)', async () => {
    const edited = { ...fakeNote, title: 'Edited', contentJson: { type: 'doc', content: [{ type: 'heading' }] } }
    mockedSharesRepo.findShareByToken.mockResolvedValue({ ...fakeShare, note: edited })

    const res = await viewByToken('tok_fixed_value')
    expect(res.title).toBe('Edited')
    expect(res.content).toEqual(edited.contentJson)
  })

  it('no-leak: payload exposes no id/userId/tags/timestamps/share metadata', async () => {
    const res = await viewByToken('tok_fixed_value')
    const serialized = JSON.stringify(res)
    for (const leak of ['userId', 'noteId', 'deletedAt', 'contentText', 'token', 'viewCount', 'createdAt', 'tagId']) {
      expect(serialized).not.toContain(leak)
    }
  })

  it('unknown token → NotFoundError 404, no increment', async () => {
    mockedSharesRepo.findShareByToken.mockResolvedValue(null)

    await expect(viewByToken('nope')).rejects.toThrow(NotFoundError)
    await expect(viewByToken('nope')).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
    expect(mockedSharesRepo.incrementViewCount).not.toHaveBeenCalled()
  })

  it('revoked link → GoneError 410 SHARE_GONE, no increment', async () => {
    mockedSharesRepo.findShareByToken.mockResolvedValue({ ...fakeShareWithNote, revokedAt: new Date() })

    await expect(viewByToken('tok_fixed_value')).rejects.toThrow(GoneError)
    await expect(viewByToken('tok_fixed_value')).rejects.toMatchObject({ statusCode: 410, code: 'SHARE_GONE' })
    expect(mockedSharesRepo.incrementViewCount).not.toHaveBeenCalled()
  })

  it('expired link (expiresAt <= now) → GoneError 410, no increment', async () => {
    mockedSharesRepo.findShareByToken.mockResolvedValue({
      ...fakeShareWithNote,
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    })

    await expect(viewByToken('tok_fixed_value')).rejects.toMatchObject({ statusCode: 410, code: 'SHARE_GONE' })
    expect(mockedSharesRepo.incrementViewCount).not.toHaveBeenCalled()
  })

  it('link on a soft-deleted note → GoneError 410, no increment', async () => {
    mockedSharesRepo.findShareByToken.mockResolvedValue({
      ...fakeShare,
      note: { ...fakeNote, deletedAt: new Date() },
    })

    await expect(viewByToken('tok_fixed_value')).rejects.toMatchObject({ statusCode: 410, code: 'SHARE_GONE' })
    expect(mockedSharesRepo.incrementViewCount).not.toHaveBeenCalled()
  })
})
