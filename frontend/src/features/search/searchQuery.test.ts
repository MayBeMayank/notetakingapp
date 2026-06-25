import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEARCH_VIEW,
  parseSearchView,
  serializeSearchView,
  type SearchViewState,
} from './searchQuery'

describe('search-ui › view-state', () => {
  it('applies defaults when URL has no params', () => {
    expect(parseSearchView(new URLSearchParams())).toEqual(DEFAULT_SEARCH_VIEW)
  })

  it('parses q and page from URL params', () => {
    const view = parseSearchView(new URLSearchParams('q=meeting&page=3'))
    expect(view).toEqual({ q: 'meeting', page: 3 })
  })

  it('missing q defaults to empty string', () => {
    const view = parseSearchView(new URLSearchParams('page=2'))
    expect(view.q).toBe('')
    expect(view.page).toBe(2)
  })

  it('non-numeric page defaults to 1', () => {
    const view = parseSearchView(new URLSearchParams('q=test&page=abc'))
    expect(view.page).toBe(1)
  })

  it('page below 1 defaults to 1', () => {
    expect(parseSearchView(new URLSearchParams('page=0')).page).toBe(1)
    expect(parseSearchView(new URLSearchParams('page=-5')).page).toBe(1)
  })

  it('omits q from serialized params when empty', () => {
    const sp = serializeSearchView({ q: '', page: 1 })
    expect(sp.get('q')).toBeNull()
  })

  it('omits page from serialized params when page is 1', () => {
    const sp = serializeSearchView({ q: 'hello', page: 1 })
    expect(sp.get('page')).toBeNull()
  })

  it('serializes non-default q and page', () => {
    const sp = serializeSearchView({ q: 'react hooks', page: 4 })
    expect(sp.get('q')).toBe('react hooks')
    expect(sp.get('page')).toBe('4')
  })

  it('round-trips a non-default view through serialize → parse', () => {
    const view: SearchViewState = { q: 'typescript generics', page: 7 }
    expect(parseSearchView(serializeSearchView(view))).toEqual(view)
  })
})
