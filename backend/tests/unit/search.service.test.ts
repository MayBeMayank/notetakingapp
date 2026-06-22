import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/repositories/search.repository.js')

import * as searchRepo from '../../src/repositories/search.repository.js'
import { search } from '../../src/services/search.service.js'
import type { SearchRow } from '../../src/repositories/search.repository.js'

const mockedRepo = vi.mocked(searchRepo)

const fakeRow: SearchRow = {
  noteId: 'note-1',
  title: 'My Note',
  snippet: '  found <mark>term</mark> here  ',
  rank: 0.5,
  contentText: 'Fallback content text for the note.',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedRepo.searchNotes.mockResolvedValue([[fakeRow], 1])
})

// ── Empty / whitespace / missing q — FRS-6.6 ─────────────────────────────────

describe('empty q returns empty result without calling the repo', () => {
  it('empty string q → { data: [], total: 0 }, repo not called', async () => {
    const result = await search('user-1', { q: '' })

    expect(result).toEqual({ data: [], page: 1, limit: 20, total: 0 })
    expect(mockedRepo.searchNotes).not.toHaveBeenCalled()
  })

  it('whitespace-only q → empty, repo not called', async () => {
    const result = await search('user-1', { q: '   ' })

    expect(result).toEqual({ data: [], page: 1, limit: 20, total: 0 })
    expect(mockedRepo.searchNotes).not.toHaveBeenCalled()
  })

  it('missing q (undefined) → empty, repo not called', async () => {
    const result = await search('user-1', {})

    expect(result).toEqual({ data: [], page: 1, limit: 20, total: 0 })
    expect(mockedRepo.searchNotes).not.toHaveBeenCalled()
  })
})

// ── Page / limit clamping (SDS §5.2) ─────────────────────────────────────────

describe('page and limit clamping', () => {
  it('page=0 is clamped to 1, skip passed to repo is 0', async () => {
    await search('user-1', { q: 'term', page: 0 })

    expect(mockedRepo.searchNotes).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ skip: 0 }),
    )
  })

  it('page=-5 is clamped to 1', async () => {
    await search('user-1', { q: 'term', page: -5 })

    expect(mockedRepo.searchNotes).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ skip: 0 }),
    )
  })

  it('limit=500 is clamped to 100', async () => {
    await search('user-1', { q: 'term', limit: 500 })

    expect(mockedRepo.searchNotes).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ take: 100 }),
    )
  })

  it('limit=0 is clamped to 1', async () => {
    await search('user-1', { q: 'term', limit: 0 })

    expect(mockedRepo.searchNotes).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ take: 1 }),
    )
  })

  it('limit=-10 is clamped to 1', async () => {
    await search('user-1', { q: 'term', limit: -10 })

    expect(mockedRepo.searchNotes).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ take: 1 }),
    )
  })
})

// ── Default pagination ────────────────────────────────────────────────────────

describe('default pagination when page/limit omitted', () => {
  it('no page/limit → page:1, limit:20, skip:0, take:20 passed to repo', async () => {
    await search('user-1', { q: 'term' })

    expect(mockedRepo.searchNotes).toHaveBeenCalledWith('user-1', {
      q: 'term',
      skip: 0,
      take: 20,
    })
  })

  it('response includes page:1 and limit:20', async () => {
    const result = await search('user-1', { q: 'term' })

    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)
  })

  it('skip is derived from clamped page/limit: page=2, limit=10 → skip=10', async () => {
    await search('user-1', { q: 'term', page: 2, limit: 10 })

    expect(mockedRepo.searchNotes).toHaveBeenCalledWith('user-1', {
      q: 'term',
      skip: 10,
      take: 10,
    })
  })
})

// ── Row mapping ───────────────────────────────────────────────────────────────

describe('row-to-item mapping', () => {
  it('snippet is trimmed', async () => {
    const result = await search('user-1', { q: 'term' })

    expect(result.data[0]?.snippet).toBe('found <mark>term</mark> here')
  })

  it('total is passed through from repo', async () => {
    mockedRepo.searchNotes.mockResolvedValue([[fakeRow, { ...fakeRow, noteId: 'note-2' }], 42])

    const result = await search('user-1', { q: 'term' })

    expect(result.total).toBe(42)
    expect(result.data).toHaveLength(2)
  })

  it('empty snippet falls back to leading slice of contentText (title-only match, FRS-6.4)', async () => {
    const titleOnlyRow: SearchRow = {
      noteId: 'note-3',
      title: 'Title Only Match',
      snippet: '',
      rank: 0.1,
      contentText: 'This is the content of the note that was matched only by title.',
    }
    mockedRepo.searchNotes.mockResolvedValue([[titleOnlyRow], 1])

    const result = await search('user-1', { q: 'title' })

    expect(result.data[0]?.snippet).toBe(
      'This is the content of the note that was matched only by title.',
    )
    expect(result.data[0]?.snippet.length).toBeGreaterThan(0)
  })

  it('whitespace-only snippet also falls back to contentText', async () => {
    const wsRow: SearchRow = {
      noteId: 'note-4',
      title: 'WS Match',
      snippet: '   ',
      rank: 0.1,
      contentText: 'Content for whitespace snippet fallback.',
    }
    mockedRepo.searchNotes.mockResolvedValue([[wsRow], 1])

    const result = await search('user-1', { q: 'ws' })

    expect(result.data[0]?.snippet).toBe('Content for whitespace snippet fallback.')
  })

  it('result order matches repo order (rank desc preserved)', async () => {
    const row1: SearchRow = { noteId: 'a', title: 'A', snippet: 's', rank: 0.9, contentText: '' }
    const row2: SearchRow = { noteId: 'b', title: 'B', snippet: 's', rank: 0.3, contentText: '' }
    mockedRepo.searchNotes.mockResolvedValue([[row1, row2], 2])

    const result = await search('user-1', { q: 'term' })

    expect(result.data[0]?.noteId).toBe('a')
    expect(result.data[1]?.noteId).toBe('b')
  })

  it('item has exactly noteId, title, snippet, rank (no other fields)', async () => {
    const result = await search('user-1', { q: 'term' })
    const item = result.data[0]!
    const keys = Object.keys(item).sort()

    expect(keys).toEqual(['noteId', 'rank', 'snippet', 'title'])
  })
})
