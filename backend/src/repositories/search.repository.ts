import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'

export type SearchRow = {
  noteId: string
  title: string
  snippet: string
  rank: number
  // Leading slice of contentText — used by the service as a snippet fallback for
  // title-only matches (where ts_headline returns '' with MaxFragments>0). Stripped
  // from the API response by the service before returning SearchResultItem[].
  contentText: string
}

type SearchRowWithTotal = SearchRow & { total: bigint }

// Caller guarantees `q` is non-empty and trimmed (service short-circuits empty q — FRS-6.6).
// Returns [page-items, full-match-count].
// total is derived from COUNT(*) OVER() on returned rows — this is the full match count
// regardless of LIMIT. Exception: when the requested page is beyond the last match
// (rows.length === 0 && skip > 0), COUNT(*) OVER() has no rows to ride on, so we
// fall back to a lightweight COUNT(*) query to still report the correct total.
export async function searchNotes(
  userId: string,
  opts: { q: string; skip: number; take: number },
): Promise<[SearchRow[], number]> {
  const { q, skip, take } = opts

  const rows = await prisma.$queryRaw<SearchRowWithTotal[]>(Prisma.sql`
    SELECT
      n."id"    AS "noteId",
      n."title" AS "title",
      ts_headline(
        'english',
        n."contentText",
        websearch_to_tsquery('english', ${q}),
        'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=5, MaxWords=18'
      ) AS "snippet",
      ts_rank(n.search_vector, websearch_to_tsquery('english', ${q})) AS "rank",
      LEFT(n."contentText", 300) AS "contentText",
      COUNT(*) OVER() AS "total"
    FROM "Note" n
    WHERE
      n."userId"    = ${userId}
      AND n."deletedAt" IS NULL
      AND n.search_vector @@ websearch_to_tsquery('english', ${q})
    ORDER BY "rank" DESC, n."updatedAt" DESC, n."id" DESC
    LIMIT  ${take}
    OFFSET ${skip}
  `)

  if (rows.length > 0) {
    const total = Number(rows[0]!.total)
    const items = rows.map(({ total: _t, ...item }) => item)
    return [items, total]
  }

  // Count-fallback: page is beyond the last result — rows are empty but total > 0.
  if (skip > 0) {
    const countRows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM "Note" n
      WHERE
        n."userId"    = ${userId}
        AND n."deletedAt" IS NULL
        AND n.search_vector @@ websearch_to_tsquery('english', ${q})
    `)
    const total = Number(countRows[0]?.count ?? 0)
    return [[], total]
  }

  return [[], 0]
}
