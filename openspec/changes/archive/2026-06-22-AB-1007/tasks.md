# Tasks — AB-1007: Full-text search (highlight + pagination)

**Capability:** `full-text-search` (new) · **Branch:** `feat/AB-1007-full-text-search`
**Source:** [`proposal.md`](proposal.md) · [`plan.md`](plan.md) · [`specs/full-text-search/spec.md`](specs/full-text-search/spec.md)

> Mark `- [x]` as each task lands and re-run that phase's checkpoint before moving on — do not batch at the end.
> `[PARALLEL]` = different files, no import/logical dependency, safe to do concurrently.

---

## Phase 1 — Foundation (shared types + DB migration)

- [x] **T1.1** `[PARALLEL]` Create `packages/shared/src/schemas/search.ts` — `SearchQuerySchema` (`q: z.string().max(200).optional()`, `page`/`limit` `z.coerce.number().int().optional()`), `SearchResultItemSchema` (`{ noteId, title, snippet, rank: z.number() }`), `SearchListResponseSchema` (`{ data, page, limit, total }`) + `z.infer` types (shapes per plan §3). *(Different file from T1.3, no dependency.)*
- [x] **T1.2** Modify `packages/shared/src/schemas/index.ts` — add `export * from './search.js'`. *(Sequential: imports T1.1.)*
- [x] **T1.3** `[PARALLEL]` **[ASK FIRST — mutates DB]** DB migration for the generated FTS column:
  - Add `searchVector Unsupported("tsvector")? @map("search_vector")` to `model Note` in `backend/src/prisma/schema.prisma`.
  - `prisma migrate dev --create-only --name add_note_search_vector`, then replace the migration body with the SQL from plan §3 (`ALTER TABLE "Note" ADD COLUMN search_vector … GENERATED ALWAYS AS (setweight(title,'A') || setweight("contentText",'B')) STORED;` + `CREATE INDEX note_search_idx … USING GIN (search_vector);`).
  - `prisma migrate dev` to apply, then `prisma generate` (safe). *(Different files from T1.1 — backend prisma vs shared — no dependency.)*

### ✅ Checkpoint 1
```bash
pnpm --filter @note-app/shared build         # shared compiles in isolation
pnpm --filter @note-app/shared lint
pnpm --filter backend prisma generate        # client regenerates with searchVector (Unsupported, read-only)
pnpm -w build                                # stays GREEN — search schema not consumed yet; searchVector is optional
```
> Unlike AB-1006, Phase 1 leaves `pnpm -w build` green: nothing imports `@note-app/shared/schemas/search` yet, and `searchVector?` is an optional Prisma field the backend never writes.

---

## Phase 2 — Core implementation

Linear chain in distinct files — each imports the previous, so **sequential** (no `[PARALLEL]`).

- [x] **T2.1** Create `backend/src/repositories/search.repository.ts` — depends on **T1.3** (column exists at runtime). `searchNotes(userId, { q, skip, take })` → `[SearchRow[], number]` via a single parameterized `prisma.$queryRaw` (`Prisma.sql`): selects `n."id" AS "noteId"`, `title`, `ts_headline('english', "contentText", websearch_to_tsquery('english', ${q}), 'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=5, MaxWords=18') AS "snippet"`, `ts_rank(search_vector, websearch_to_tsquery('english', ${q})) AS "rank"`, `COUNT(*) OVER() AS "total"`; `WHERE "userId" = ${userId} AND "deletedAt" IS NULL AND search_vector @@ websearch_to_tsquery('english', ${q})`; `ORDER BY "rank" DESC, n."updatedAt" DESC, n."id" DESC`; `LIMIT ${take} OFFSET ${skip}`. `total` = `Number(rows[0].total)`; **count-fallback**: when `rows.length === 0 && skip > 0`, run a lightweight `COUNT(*)` (same WHERE) so an over-paged request still reports the true `total` (plan §3 note). `q` is always a bind param. Prisma only.
- [x] **T2.2** Create `backend/src/services/search.service.ts` — depends on **T2.1** + T1.1. `search(userId, query)`: clamp `page` (min 1, default 1) and `limit` (min 1, max 100, default 20) mirroring `notes.service` constants; `const q = (query.q ?? '').trim()` → if `''` return `{ data: [], page, limit, total: 0 }` **without** calling the repo (FRS-6.6); else `skip = (page-1)*limit`, call `searchNotes`, map rows → items with `snippet: r.snippet.trim()`. No `req`/`res`.
- [x] **T2.3** Create `backend/src/controllers/search.controller.ts` — depends on **T2.2** + T1.1. Thin: `const query = (req.validatedQuery ?? {}) as SearchQuery; res.status(200).json(await searchService.search(req.userId, query))`.

### ✅ Checkpoint 2
```bash
pnpm -w build                                # 0 TS errors
pnpm -w lint --max-warnings 0
pnpm --filter backend test                   # existing auth/notes/tags suites stay green
```

---

## Phase 3 — Integration (wire-up)

Sequential — routes import the controller; `app.ts` mounts the router.

- [x] **T3.1** Create `backend/src/routes/search.routes.ts` — `searchRouter` with `GET /` → `validateQuery(SearchQuerySchema)`, `searchController.search` (plan §3).
- [x] **T3.2** Modify `backend/src/app.ts` — `import { searchRouter }` and `app.use('/api/search', searchRouter)` **after** `app.use(authMiddleware)` and **before** `errorMiddleware` (global guard → 401 on every search request).

### ✅ Checkpoint 3
```bash
pnpm -w build
pnpm -w lint --max-warnings 0
pnpm --filter backend test                   # existing suites stay green
```

---

## Phase 4 — Tests (one named test per spec scenario)

> Unit tests need no DB. Integration tests require Postgres via `backend/.env.test` **with the T1.3 migration applied** (the `search_vector` column + GIN index must exist). Coverage ≥80% on new code (DoD). Reuse `registerAndLogin` + `beforeEach` cleanup order from `notes.routes.test.ts`.

- [x] **T4.1** `[PARALLEL]` Create `backend/tests/unit/search.service.test.ts` (mock `search.repository`):
  - [ ] empty `q` (`q: ''`) → `{ data: [], total: 0 }` and **repo NOT called** (FRS-6.6 / no-DB-hit scenario)
  - [ ] whitespace-only `q` (`'   '`) → empty + repo not called
  - [ ] missing `q` (`undefined`) → empty + repo not called
  - [ ] clamp: `page=0` → 1; `limit=500` → 100; `limit=0` → 1; negative → clamped (skip computed from clamped values)
  - [ ] default pagination: no `page`/`limit` → `page:1, limit:20`, `skip:0, take:20` passed to repo
  - [ ] mapping: repo rows → items preserve order; `snippet` is `trim()`med; `total` passed through

- [x] **T4.2** `[PARALLEL]` Create `backend/tests/integration/search.routes.test.ts` (Supertest, real DB; seed caller notes):
  - [ ] **match on title** → 200, note present (Requirement: full-text over own active notes)
  - [ ] **match on content** (term in body, not title) → 200, note present
  - [ ] non-matching term → 200 `{ data: [], total: 0 }`
  - [ ] **ownership isolation:** user B's matching note never appears for user A
  - [ ] **soft-deleted excluded:** delete a matching note → absent from `data` and `total`
  - [ ] **rank order:** more-relevant note sorts before less-relevant (`data[0].rank >= data[1].rank`)
  - [ ] **tie-break:** two equal-rank matches ordered by `updatedAt` desc (deterministic)
  - [ ] **pagination:** 25 matches, `page=2&limit=10` → 11th–20th, `page:2, limit:10`
  - [ ] **total:** `page=1&limit=10` over 25 matches → `data.length===10`, `total===25`
  - [ ] **page beyond last:** 5 matches, `page=3&limit=10` → `data:[]`, `total:5` (count-fallback)
  - [ ] **clamp:** `page=0`/`limit=500` → 200 (not 400)
  - [ ] **highlight:** content match → `snippet` contains `<mark>…</mark>` around the term
  - [ ] **title-only fallback:** match only in title → result present, `snippet` is a non-empty content slice (no `<mark>` required)
  - [ ] **snippet bounded:** long body → snippet is a fragment, not the whole content
  - [ ] **empty `q`** (`?q=`) → 200 `{ data: [], total: 0 }` (not 400); whitespace `?q=%20` → empty; missing `q` → empty
  - [ ] **validation:** `q` > 200 chars → 400 `VALIDATION_ERROR` with `fields:[{field:'q'}]`; `page=abc` → 400
  - [ ] **special chars** (`"quoted phrase" or foo -bar`, `&|!:*`) → 200, never 500
  - [ ] **result shape:** each item has exactly `noteId, title, snippet, rank`; response JSON does not contain `contentText`/`contentJson`/`tagIds`
  - [ ] **auth:** no/invalid token → 401

### ✅ Checkpoint 4 (full gate)
```bash
pnpm -w build                                # 0 TS errors
pnpm -w lint --max-warnings 0                # 0 warnings
pnpm --filter backend test                   # unit + integration ALL green, ≥80% on new code
# before commit:
npx commitlint --from HEAD~1
```

**Proposed commits:** `chore(db): add Note.search_vector tsvector + GIN index AB#1007` (T1.3) · `feat(search): add full-text search with highlight and pagination AB#1007`

---

## Dependency graph (quick reference)

```
T1.1 ── T1.2 ─┐
T1.3 ─────────┤  (T1.1 ∥ T1.3 concurrent — shared vs backend/prisma)
              │
              └─ T2.1 → T2.2 → T2.3 → T3.1 → T3.2 → (T4.1 ∥ T4.2)
```

Phase 2 is a strict import chain (repo → service → controller) — sequential. T2.1 also needs T1.3 applied so the FTS query runs. T4.1 (unit, mocked) ∥ T4.2 (integration, real DB) — different files, no dependency.
