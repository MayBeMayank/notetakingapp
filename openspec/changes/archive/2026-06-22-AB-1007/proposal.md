# AB-1007 — Search: full-text search with highlight + pagination

## Why

AB-1004/1005 gave users notes and a sortable, tag-filterable list, and AB-1006 added tags — but there is still **no way to find a note by its words**. As a user's note count grows, browsing and tag-filtering stop being enough; FRS §6 requires full-text search across a note's **title and content**, ranked by relevance, with highlighted snippets so the user can see *why* each result matched.

This ticket delivers that search. Per FRS-6.2 / SDS §7 it uses **PostgreSQL's native full-text search** (a generated `tsvector` column + GIN index, queried with `websearch_to_tsquery`) — no external search service. This is the first ticket that actually exercises the FTS infrastructure the SDS designed, so it also adds the `search_vector` generated column and its GIN index, which no earlier migration created. The AB-1013 frontend search UI consumes this contract.

## What Changes

**FRS coverage:** §6.1 (full-text across own title + content), §6.2 (native DB FTS, no external service), §6.3 (relevance-ranked + paginated), §6.4 (highlighted snippet with matched terms in context), §6.5 (own notes only, soft-deleted excluded), §6.6 (empty/whitespace query → empty result, not an error). Cross-cutting §9.1 (ownership isolation), §9.2 (auth required), §9.3 (validation), §9.6 (pagination contract).

**In scope:**
- `GET /api/search?q&page&limit` — full-text search over the caller's **active** notes. Returns `{ data: [ { noteId, title, snippet, rank } ], page, limit, total }` (SDS §6.5). Ranked by `ts_rank` descending; `total` is the full match count, not the page size.
- **Native Postgres FTS:** a generated `search_vector tsvector` column on `Note` (title weighted `A`, `contentText` weighted `B`) plus a GIN index, added by a raw SQL migration (SDS §7). Queried via parameterized `prisma.$queryRaw` using `websearch_to_tsquery('english', $q)`.
- **Highlighted snippet (FRS-6.4):** `ts_headline` over `contentText` wraps matched terms in `<mark>…</mark>`.
- New shared Zod schemas in `packages/shared/src/schemas/search.ts` (search query params + search-result-item + search-list-response).

**Clarified edge-case decisions (this spec, see Key assumptions):**
- `total` is computed with a `COUNT(*) OVER()` window function in the **same** `$queryRaw` (single round-trip), not a second query.
- A **title-only** match (matched in the `A`-weighted title, nothing in content) yields an empty `ts_headline`; the snippet **falls back to a leading slice of `contentText`** so every result still shows context.
- Rank ties are broken by **`updatedAt DESC`** for deterministic, stable pagination.
- `q` is **capped at 200 characters** in the shared schema; longer input is rejected `400`.

**Explicitly out of scope (owned elsewhere):**
- The search **UI** (highlighted-result rendering, debounced query box) → **AB-1013**.
- Searching **trashed** notes, tags, version content, or shared notes — search is title+content of the caller's **active** notes only (FRS-6.5); soft-deleted notes, tags, and version history are never searched.
- The `tags=` / `sort=` filters of the note **list** (`GET /api/notes`) → AB-1005; `/api/search` takes only `q`, `page`, `limit`.
- Languages other than `english`; fuzzy/typo-tolerant matching; synonyms — v1 uses the `english` text-search config and `websearch_to_tsquery` parsing only.

## Capabilities

### New Capabilities
- `full-text-search`: Relevance-ranked, paginated full-text search across the title and content of the caller's own active notes, using PostgreSQL native FTS, returning a highlighted snippet per result and excluding other users' and soft-deleted notes.

### Modified Capabilities
- (none) — the `search_vector` column is **generated** by Postgres from the already-persisted `title` and `contentText`, so the AB-1004 note write path is unchanged; `note-crud` behaviour does not change.

## Impact

### API Delta (SDS §6.5)

| Method | Path | Query | Success | Errors |
|--------|------|-------|---------|--------|
| GET | `/api/search` | `?q&page&limit` | 200 `{ data: [ { noteId, title, snippet, rank } ], page, limit, total }` | 400 (q too long / bad page-limit), 401 |

- **Result item shape:** `{ noteId: string, title: string, snippet: string, rank: number }` — exactly these four fields. The note's `contentJson`, `contentText`, `tagIds`, ownership, and timestamps are **not** exposed in a search result.
- `snippet` contains zero or more `<mark>…</mark>` spans around matched terms (FRS-6.4).
- Empty / whitespace-only / missing `q` → **200** with `{ data: [], page, limit, total: 0 }` (FRS-6.6) — never a 400 for an empty query.
- Pagination follows SDS §5.2: `page` default 1 (min 1), `limit` default 20 (min 1, max 100), out-of-range **clamped** not rejected; `total` always reported.

### DB Changes

**New — raw SQL migration (SDS §7), required by this ticket (no earlier migration created it):**

```sql
ALTER TABLE "Note" ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce("contentText",'')), 'B')
  ) STORED;
CREATE INDEX note_search_idx ON "Note" USING GIN (search_vector);
```

- The column is added to the Prisma schema as `searchVector Unsupported("tsvector")? @map("search_vector")` so `prisma generate`/`migrate` keep the schema in sync without Prisma managing the generated expression (the expression lives in the raw migration).
- Because the column is `GENERATED ALWAYS … STORED`, Postgres recomputes it automatically on every insert/update of `title` or `contentText` — **no application code writes it**, and existing rows are backfilled by the `ALTER TABLE`.

### Affected layers

| Layer | Change |
|-------|--------|
| `backend/src/prisma` | New raw SQL migration adding `search_vector` (generated tsvector) + `note_search_idx` GIN index. `Note` model gains `searchVector Unsupported("tsvector")? @map("search_vector")`. |
| `packages/shared` | New `schemas/search.ts`: `SearchQuerySchema` (`q` ≤200, `page`/`limit` coerced), `SearchResultItemSchema` (`{ noteId, title, snippet, rank }`), `SearchListResponseSchema` (`{ data, page, limit, total }`) + `z.infer` types. |
| `backend/src/repositories` | New `search.repository.ts` — a single parameterized `prisma.$queryRaw` with `websearch_to_tsquery`, `ts_headline`, `ts_rank`, `COUNT(*) OVER()`, `WHERE "userId" = $ AND "deletedAt" IS NULL`, `ORDER BY rank DESC, "updatedAt" DESC`, `LIMIT/OFFSET`. |
| `backend/src/services` | New `search.service.ts` — owns FRS rules: empty/whitespace `q` short-circuits to an empty result (no DB hit), clamps `page`/`limit` (SDS §5.2), maps rows → result items, derives the content-start snippet fallback for title-only matches. No `req`/`res`. |
| `backend/src/controllers` | New `search.controller.ts` — validate query via `SearchQuerySchema`, call service, send 200. |
| `backend/src/routes` | New `search.routes.ts` behind the auth middleware. |
| `backend/src/app.ts` | Mount the `/api/search` router. |
| `backend/tests` | Unit tests (empty/whitespace `q` → empty, no DB hit; clamping; title-only snippet fallback; rank ordering + tie-break mapping) + Supertest integration tests against a real Postgres DB asserting ranking, highlight, ownership isolation, soft-delete exclusion, pagination/`total`, and exact SDS §5.1 codes. |

### Key assumptions

- **Native FTS only (FRS-6.2):** all matching is done in Postgres via the generated `search_vector` + `websearch_to_tsquery('english', …)`; no application-side text matching and no external search service.
- **`total` via window function:** `COUNT(*) OVER()` is selected alongside the page rows in one `$queryRaw`, so `total` is the full match count even though the page is `LIMIT`ed.
- **Title-only snippet fallback:** when `ts_headline('english', "contentText", …)` returns no `<mark>` (the match was in the title), the service substitutes a plain leading slice of `contentText` (truncated, e.g. ~30 words) so the result still carries context.
- **Deterministic ordering:** `ORDER BY rank DESC, "updatedAt" DESC` — equal-rank rows are stably ordered newest-updated-first, matching the default note-list sort (FRS-4.5.2).
- **Empty query is not an error (FRS-6.6):** `q` that is missing, empty, or whitespace-only returns `200 { data: [], total: 0 }` and does **not** touch the DB.
- **Query bound:** `q` longer than 200 characters → `400 VALIDATION_ERROR`; within bound, `websearch_to_tsquery` parses the string safely (special characters never cause a 500 or injection — the query is parameterized).
- **Ownership & auth (FRS-9.1/9.2):** `/api/search` sits behind the AB-1002 auth middleware → 401 without a valid token; the WHERE clause is always scoped to `req.userId`, so another user's matching note is never returned and its existence is never leaked.
- **Soft-delete exclusion (FRS-6.5):** the WHERE clause includes `"deletedAt" IS NULL`; soft-deleted notes never appear in results or `total`.
- **Snippet is server-generated HTML containing only `<mark>` tags;** `contentText` is plaintext derived from TipTap text nodes. The consuming frontend (AB-1013) is responsible for rendering only the sanctioned `<mark>` markup safely.
