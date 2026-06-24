import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTES_VIEW,
  parseNotesView,
  serializeNotesView,
  type NotesViewState,
} from './notesQuery'

describe('notes-list-ui › view-state', () => {
  it('applies defaults when the URL has no params', () => {
    expect(parseNotesView(new URLSearchParams())).toEqual(DEFAULT_NOTES_VIEW)
  })

  it('parses status, sort, order, tags, page, and limit', () => {
    const view = parseNotesView(
      new URLSearchParams('status=trashed&sort=title&order=asc&tags=t1,t2&page=3&limit=50'),
    )
    expect(view).toEqual({
      status: 'trashed',
      sort: 'title',
      order: 'asc',
      tags: ['t1', 't2'],
      page: 3,
      limit: 50,
    })
  })

  it('clamps unknown enum values and out-of-range numbers to defaults', () => {
    const view = parseNotesView(
      new URLSearchParams('status=weird&sort=bogus&order=sideways&page=0&limit=-5'),
    )
    expect(view.status).toBe('active')
    expect(view.sort).toBe('updatedAt')
    expect(view.order).toBe('desc')
    expect(view.page).toBe(1)
    expect(view.limit).toBe(20)
  })

  it('drops blank tag entries and de-duplicates', () => {
    const view = parseNotesView(new URLSearchParams('tags=t1,,t1, ,t2'))
    expect(view.tags).toEqual(['t1', 't2'])
  })

  it('omits every default value when serializing (clean URL)', () => {
    expect(serializeNotesView(DEFAULT_NOTES_VIEW).toString()).toBe('')
  })

  it('serializes only the non-default values', () => {
    const sp = serializeNotesView({
      ...DEFAULT_NOTES_VIEW,
      sort: 'title',
      order: 'asc',
      tags: ['a', 'b'],
      page: 2,
      status: 'trashed',
    })
    expect(sp.get('sort')).toBe('title')
    expect(sp.get('order')).toBe('asc')
    expect(sp.get('tags')).toBe('a,b')
    expect(sp.get('page')).toBe('2')
    expect(sp.get('status')).toBe('trashed')
    expect(sp.get('limit')).toBeNull()
  })

  it('round-trips a non-default view through serialize → parse', () => {
    const view: NotesViewState = {
      status: 'trashed',
      sort: 'createdAt',
      order: 'asc',
      tags: ['x', 'y'],
      page: 4,
      limit: 30,
    }
    expect(parseNotesView(serializeNotesView(view))).toEqual(view)
  })
})
