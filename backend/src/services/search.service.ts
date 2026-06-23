import * as searchRepo from '../repositories/search.repository.js'
import type { SearchQuery, SearchListResponse } from '@note-app/shared/schemas/search'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MIN_PAGE = 1
const MIN_LIMIT = 1
const MAX_LIMIT = 100

export async function search(userId: string, query: SearchQuery): Promise<SearchListResponse> {
  const page = Math.max(MIN_PAGE, query.page ?? DEFAULT_PAGE)
  const limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, query.limit ?? DEFAULT_LIMIT))

  // FRS-6.6: empty/whitespace/missing q → empty result, no DB hit.
  const q = (query.q ?? '').trim()
  if (q === '') {
    return { data: [], page, limit, total: 0 }
  }

  const skip = (page - 1) * limit
  const [rows, total] = await searchRepo.searchNotes(userId, { q, skip, take: limit })

  // Strip contentText (internal fallback field) and apply the title-only fallback:
  // ts_headline with MaxFragments>0 returns '' when the query has no match in
  // contentText (title-only hits). Fall back to a leading slice so every result
  // carries context (FRS-6.4).
  const data = rows.map(({ contentText, snippet, ...r }) => ({
    ...r,
    snippet: snippet.trim() || contentText.slice(0, 200),
  }))
  return { data, page, limit, total }
}
