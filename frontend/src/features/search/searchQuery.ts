/** Client-side search view-state, mirrored onto the GET /api/search query params. */
export interface SearchViewState {
  q: string
  page: number
}

export const DEFAULT_SEARCH_VIEW: SearchViewState = { q: '', page: 1 }

function positiveInt(value: string | null, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 ? n : fallback
}

/**
 * Parse URL search params into a sanitized SearchViewState.
 * Invalid page values fall back to 1; missing q falls back to ''.
 */
export function parseSearchView(sp: URLSearchParams): SearchViewState {
  return {
    q: sp.get('q') ?? DEFAULT_SEARCH_VIEW.q,
    page: positiveInt(sp.get('page'), DEFAULT_SEARCH_VIEW.page),
  }
}

/** Serialize a view to URL search params, omitting defaults so the URL stays clean. */
export function serializeSearchView(view: SearchViewState): URLSearchParams {
  const sp = new URLSearchParams()
  if (view.q !== DEFAULT_SEARCH_VIEW.q) sp.set('q', view.q)
  if (view.page !== DEFAULT_SEARCH_VIEW.page) sp.set('page', String(view.page))
  return sp
}
