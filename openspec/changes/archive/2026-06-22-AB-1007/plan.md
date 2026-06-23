# Technical Plan — AB-1007 (Search: full-text + highlight + pagination)

**Change:** `openspec/changes/AB-1007/`
**Branch:** `feat/AB-1007-full-text-search`
**Status:** awaiting approval — no implementation yet.

Realizes one new capability — **`full-text-search`** (`GET /api/search`). No existing capability changes: the `search_vector` is a Postgres `GENERATED … STORED` column derived from the already-persisted `title`/`contentText`, so the AB-1004 note write path is untouched.

Follows the established stack patterns exactly: `routes → controllers → services → repositories → Prisma`, shared Zod schemas, `validateQuery` + `req.validatedQuery`, `AppError` subclasses via the central error middleware, and the **raw-SQL `$queryRaw` pattern already used by `notes.repository.listNotesWithCount`** (`Prisma.sql` fragments, bind-param values, `bigint`→`Number`).

---

## 1. Architecture decisions (with reasoning)

| # | Decision | Reasoning |
|---|----------|-----------|
| D1 | **New raw-SQL migration** adds the generated `search_vector tsvector` column (title→`A`, `contentText`→`B`) + `note_search_idx` GIN index. The Prisma `Note` model gains `searchVector Unsupported("tsvector")? @map("search_vector")`. | The column + index do **not** exist (verified: only `20260619140044_init`; no `tsvector`/GIN anywhere). SDS §7 mandates a generated column added via raw SQL. `Unsupported(...)?` keeps Prisma's schema in sync without it managing the `GENERATED` expression. Generated+STORED means Postgres backfills existing rows on `ALTER TABLE` and recomputes on every write — **no app code writes it** (backward compatible). |
| D2 | **Single `$queryRaw`** returns page rows **and** `total` via a `COUNT(*) OVER()` window column. | One round-trip (clarified decision). Mirrors the raw-SQL approach in `notes.repository`, but folds the count in rather than a second query, since FTS recomputes the tsquery. `total` is `bigint` → `Number()`. |
| D3 | **`q` is a bind parameter** to `websearch_to_tsquery('english', $1)` — never string-interpolated. | Parameterized = no SQL injection and special characters (`& | ! : * "…"`) are parsed safely by `websearch_to_tsquery`, never a 500 (spec: "special characters parsed safely"). Same safety model as `notes.repository`'s `Prisma.sql` values. |
| D4 | **Snippet via `ts_headline('english', "contentText", query, '…')`** with `StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=5, MaxWords=18` (SDS §7). | `ts_headline` wraps matched terms in `<mark>` (FRS-6.4). For a **title-only** match it finds no term in the content and by default returns the **leading fragment** of `contentText` — which *is* the "content-start fallback" (clarified). Service `trim()`s; truly-empty content → `""` snippet (the `title` field still shows the match). No second query, no app-side highlighting. |
| D5 | **`ORDER BY rank DESC, n."updatedAt" DESC`** (+ `n."id" DESC` as a final stabilizer). | Relevance first; `updatedAt DESC` is the clarified deterministic tie-breaker (matches FRS-4.5.2 default sort). `id` last guarantees a total order so pagination never skips/dupes. |
| D6 | **Empty / whitespace-only / missing `q` short-circuits in the service** → `{ data: [], page, limit, total: 0 }`, **no DB call**. | FRS-6.6 (empty query is not an error). Cheap, and avoids handing an empty tsquery to Postgres. Decided at the service layer (owns the FRS rule), not the schema. |
| D7 | **Clamp `page`/`limit` in the service** (`page` min 1; `limit` min 1, max 100; defaults 1/20). | SDS §5.2 — out-of-range clamped, not rejected. Mirrors `notes.service.listNotes` constants exactly. |
| D8 | **`SearchQuerySchema`** = `{ q: string ≤200 optional, page/limit coerced int optional }`. | `q` length-bound → 400 over 200 (clarified). `page`/`limit` coerced like `ListNotesQuerySchema` so `?page=abc` → 400, while range is clamped by the service. `q` optional so a missing param flows to the empty-result path (D6). |
| D9 | **Result item `{ noteId, title, snippet, rank }` built in the repo's SELECT** (`n."id" AS "noteId"`); service maps rows 1:1. | Exactly the SDS §6.5 shape — no `contentJson`/`contentText`/`tagIds`/owner/timestamps leak. `rank` (`ts_rank`, float) arrives as a JS `number`. |

---

## 2. Files to create / modify

### `packages/shared` (edit first — backend imports its built `dist`)

| Path | Action | Contents |
|------|--------|----------|
| `packages/shared/src/schemas/search.ts` | **create** | `SearchQuerySchema`, `SearchResultItemSchema`, `SearchListResponseSchema` + inferred types |
| `packages/shared/src/schemas/index.ts` | **modify** | add `export * from './search.js'` |

### `backend/src`

| Path | Action | Contents |
|------|--------|----------|
| `backend/src/prisma/schema.prisma` | **modify** | add `searchVector Unsupported("tsvector")? @map("search_vector")` to `model Note` |
| `backend/src/prisma/migrations/<ts>_add_note_search_vector/migration.sql` | **create** | `ALTER TABLE "Note" ADD COLUMN search_vector … GENERATED ALWAYS … STORED;` + `CREATE INDEX note_search_idx … USING GIN`. Scaffold with `prisma migrate dev --create-only` **[ASK FIRST]**, then hand-edit the SQL. |
| `backend/src/repositories/search.repository.ts` | **create** | `searchNotes(userId, { q, skip, take })` → `[items, total]` via one `$queryRaw` |
| `backend/src/services/search.service.ts` | **create** | empty-`q` short-circuit, page/limit clamp, snippet `trim`, row→item map |
| `backend/src/controllers/search.controller.ts` | **create** | `search` — read `req.validatedQuery`, call service, `res.status(200).json(result)` |
| `backend/src/routes/search.routes.ts` | **create** | `Router` with `validateQuery(SearchQuerySchema)` on `GET /` |
| `backend/src/app.ts` | **modify** | mount `app.use('/api/search', searchRouter)` after `authMiddleware` |

### `backend/tests`

| Path | Action |
|------|--------|
| `backend/tests/unit/search.service.test.ts` | **create** — empty/whitespace/missing `q` → empty + **no repo call** (mock repo); clamp page/limit; snippet trim; row→item mapping preserves order |
| `backend/tests/integration/search.routes.test.ts` | **create** — real Postgres: title & content match, rank order, tie-break, `<mark>` highlight, title-only fallback, ownership isolation, soft-delete exclusion, pagination + `total`, empty `q` → 200 `[]`, `q`>200 → 400, `page=abc` → 400, 401 without a token |

---

## 3. Final shapes (TypeScript / Zod)

### `packages/shared/src/schemas/search.ts`
```ts
import { z } from 'zod'

// q is optional and length-bounded. Missing/empty/whitespace q is NOT a 400 —
// the service returns an empty result (FRS-6.6). The 200-char cap guards the DB.
// page/limit are coerced ints (like ListNotesQuerySchema): non-numeric → 400;
// range is clamped by the service (SDS §5.2), not rejected here.
export const SearchQuerySchema = z.object({
  q: z.string().max(200, 'q must be at most 200 characters').optional(),
  page: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
})

export const SearchResultItemSchema = z.object({
  noteId: z.string(),
  title: z.string(),
  snippet: z.string(),
  rank: z.number(),
})

export const SearchListResponseSchema = z.object({
  data: z.array(SearchResultItemSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
})

export type SearchQuery = z.infer<typeof SearchQuerySchema>
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>
export type SearchListResponse = z.infer<typeof SearchListResponseSchema>
```

### `backend/src/prisma/schema.prisma` (Note model addition)
```prisma
model Note {
  // … existing fields …
  searchVector Unsupported("tsvector")? @map("search_vector")
  // … relations + @@index([userId, deletedAt, updatedAt]) …
}
```

### Migration SQL (`migration.sql`)
```sql
ALTER TABLE "Note" ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce("contentText",'')), 'B')
  ) STORED;
CREATE INDEX note_search_idx ON "Note" USING GIN (search_vector);
```

### `backend/src/repositories/search.repository.ts`
```ts
import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'

export type SearchRow = { noteId: string; title: string; snippet: string; rank: number }

// Caller guarantees `q` is non-empty/trimmed (service short-circuits empty q).
export async function searchNotes(
  userId: string,
  opts: { q: string; skip: number; take: number },
): Promise<[SearchRow[], number]> {
  const { q, skip, take } = opts
  const rows = await prisma.$queryRaw<(SearchRow & { total: bigint })[]>(Prisma.sql`
    SELECT n."id"   AS "noteId",
           n."title" AS "title",
           ts_headline('english', n."contentText",
             websearch_to_tsquery('english', ${q}),
             'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=5, MaxWords=18'
           ) AS "snippet",
           ts_rank(n.search_vector, websearch_to_tsquery('english', ${q})) AS "rank",
           COUNT(*) OVER() AS "total"
    FROM "Note" n
    WHERE n."userId" = ${userId}
      AND n."deletedAt" IS NULL
      AND n.search_vector @@ websearch_to_tsquery('english', ${q})
    ORDER BY "rank" DESC, n."updatedAt" DESC, n."id" DESC
    LIMIT ${take} OFFSET ${skip}
  `)
  const total = rows.length > 0 ? Number(rows[0]!.total) : 0
  const items = rows.map(({ total: _t, ...item }) => item)
  return [items, total]
}
```
> Note: `total` from `COUNT(*) OVER()` is the full match count, but it only rides along on returned rows. When `skip` lands past the last match, zero rows return and `total` reads `0` — for a "page beyond results" request that still needs the real `total`. **Mitigation:** the service caps `skip` so the count is always observable, **or** the repo falls back to a lightweight `COUNT(*)` when `rows.length === 0 && skip > 0`. Plan adopts the **count-fallback** (one extra query only on empty over-paged results) — see service note. (Resolves the "page beyond last → correct total" scenario.)

### `backend/src/services/search.service.ts`
```ts
import * as searchRepo from '../repositories/search.repository.js'
import type { SearchQuery, SearchListResponse } from '@note-app/shared/schemas/search'

const DEFAULT_PAGE = 1, DEFAULT_LIMIT = 20
const MIN_PAGE = 1, MIN_LIMIT = 1, MAX_LIMIT = 100

export async function search(userId: string, query: SearchQuery): Promise<SearchListResponse> {
  const page  = Math.max(MIN_PAGE, query.page ?? DEFAULT_PAGE)
  const limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, query.limit ?? DEFAULT_LIMIT))

  const q = (query.q ?? '').trim()
  if (q === '') return { data: [], page, limit, total: 0 }   // FRS-6.6 — no DB hit

  const skip = (page - 1) * limit
  const [rows, total] = await searchRepo.searchNotes(userId, { q, skip, take: limit })
  const data = rows.map((r) => ({ ...r, snippet: r.snippet.trim() }))
  return { data, page, limit, total }
}
```

### `backend/src/controllers/search.controller.ts`
```ts
import type { Request, Response } from 'express'
import * as searchService from '../services/search.service.js'
import type { SearchQuery } from '@note-app/shared/schemas/search'

export async function search(req: Request, res: Response): Promise<void> {
  const query = (req.validatedQuery ?? {}) as SearchQuery
  const result = await searchService.search(req.userId, query)
  res.status(200).json(result)
}
```

### `backend/src/routes/search.routes.ts`
```ts
import { Router, type Router as RouterType } from 'express'
import { validateQuery } from '../middleware/validate.middleware.js'
import * as searchController from '../controllers/search.controller.js'
import { SearchQuerySchema } from '@note-app/shared/schemas/search'

export const searchRouter: RouterType = Router()
searchRouter.get('/', validateQuery(SearchQuerySchema), searchController.search)
```

### `backend/src/app.ts` (addition)
```ts
import { searchRouter } from './routes/search.routes.js'
// … after authMiddleware …
app.use('/api/search', searchRouter)
```

---

## 4. Reuse of existing code (no duplication)

- **`prisma.$queryRaw` + `Prisma.sql`** — exact pattern from `notes.repository.listNotesWithCount` (bind-param values are injection-safe; `bigint`→`Number`).
- **`middleware/validate.middleware.ts`** `validateQuery` + `req.validatedQuery` (typed in `types/express.d.ts`) — **as-is** (same as notes list).
- **`middleware/auth.middleware.ts`** → `req.userId`; **`middleware/error.middleware.ts`** → maps `AppError`/Zod-400 envelope — **as-is**. (No new error classes; over-long `q` is a plain `validateQuery` 400.)
- **`lib/prisma.ts`** shared client — **as-is**.
- **Pagination constants/clamp** mirror `notes.service.listNotes` (same SDS §5.2 contract). Kept local rather than extracting a helper, to match the existing per-service style.
- **Tests:** `registerAndLogin` helper + `beforeEach` cleanup order from `notes.routes.test.ts` (already deletes `note`/`noteTag`/`user`) — reuse verbatim.

---

## 5. DB changes

**One new migration — backward compatible.**
- Adds generated `search_vector` column + `note_search_idx` GIN index (SDS §7). Existing rows are backfilled automatically by `ALTER TABLE` (generated+STORED); no data migration, no app write-path change.
- Prisma `Note` gains `searchVector Unsupported("tsvector")? @map("search_vector")` (read-never-written by Prisma).
- **Procedure (requires DB — ASK FIRST):** `prisma migrate dev --create-only --name add_note_search_vector` to scaffold the empty migration, replace its body with the SQL in §3, then `prisma migrate dev` to apply. `prisma generate` afterward is safe/no-prompt.

---

## 6. Build / test / lint checkpoints

Run in this order (CLAUDE.md quality gates). **Shared builds first** so the backend resolves `@note-app/shared/schemas/search`.

```bash
pnpm --filter @note-app/shared build      # emit dist for consumers
# migration step (ASK FIRST): prisma migrate dev --create-only … → edit SQL → prisma migrate dev
pnpm --filter backend prisma generate      # regenerate client (safe)
pnpm -w lint                               # zero errors
pnpm --filter backend test                 # Vitest unit + Supertest integration (needs test Postgres + applied migration)
pnpm -w build                              # zero TS errors across workspace
```

Before commit: `npx commitlint --from HEAD~1` + Husky pre-commit must pass. Commit style: `feat(search): …`, `chore(db): …` for the migration. **≥ 80 % coverage on new code.**

> Integration tests require the test PostgreSQL instance (`.env.test`) **with the new migration applied** — confirm before `pnpm --filter backend test`. FTS uses the `english` config (available in a default Postgres 16).

---

## 7. Suggested implementation order (feeds `/tasks`)

1. `packages/shared` — `schemas/search.ts` + index export → build shared.
2. DB — add `searchVector` to `schema.prisma`; create + hand-edit the raw-SQL migration; apply **[ASK FIRST]**; `prisma generate`.
3. `search.repository.ts` — the single `$queryRaw` (rank, headline, `COUNT(*) OVER()`, count-fallback on over-paged empty).
4. `search.service.ts` — empty-`q` short-circuit, clamp, snippet trim, map.
5. `search.controller.ts` + `search.routes.ts` + mount in `app.ts`.
6. Unit tests (service) → integration tests (routes) against test Postgres.
7. Full quality-gate pass + coverage check.

Each step ends green (lint + build + relevant tests) before the next, per the workspace checkpoint rule.
