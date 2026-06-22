# AB-1005 — Tasks: Notes Pagination, Sorting, Tag Filtering

> **Source:** `proposal.md` + `specs/note-crud/spec.md` (this change). No `plan.md` exists (the `/plan` step was skipped); the proposal's *Affected layers* + *Key assumptions* stand in for it.
>
> **How to use:** tick `- [x]` after each **phase checkpoint passes** — do not batch at the end. Phases run in order. Within a phase, only `[PARALLEL]` tasks may run concurrently (they touch different files with no shared dependency); everything else is sequential.
>
> **Scope reminder:** backend-only change. Frontend (AB-1011) and tag attach/Tag-CRUD (AB-1006) are out of scope — AB-1005 implements only the *filter query* over the existing `NoteTag` relation, exercised in tests against directly-seeded rows.

---

## Phase 1 — Foundation (shared types, DB)

- [x] **1.1 Extend `ListNotesQuerySchema`** — `packages/shared/src/schemas/notes.ts`
  - Add `sort: z.enum(['updatedAt','createdAt','title']).optional()`
  - Add `order: z.enum(['asc','desc']).optional()`
  - Add `status: z.enum(['active','trashed']).optional()`
  - Add `tags: z.string().optional()` with a `.transform()` that splits on `,`, trims, and drops empties → `string[]` (so `?tags=`/`?tags=,,` → `[]`)
  - Leave `page`/`limit` unchanged; `ListNotesQuery` (z.infer) and `NoteListResponseSchema` update/stay automatically
  - Optionally export the sort-field enum as a shared const for backend reuse
- [x] **1.2 Confirm no migration needed** (read-only) — verify `backend/src/prisma/schema.prisma` already has `NoteTag`, `Tag`, and `Note @@index([userId, deletedAt, updatedAt])` from the AB-1001 init migration. **No new migration, column, or index** (per proposal *DB Changes: None*).

**✅ Checkpoint 1** (rebuild shared so backend sees the new types) — PASSED
- [x] `pnpm -w build` → 0 errors, 0 warnings
- [x] `pnpm -w lint --max-warnings 0`
- [x] `pnpm --filter backend test` → existing suite still green (124/124)

---

## Phase 2 — Core implementation

> Sequential: **2.2 imports/calls 2.1's new signature** → not parallel.

- [x] **2.1 Repository** — `backend/src/repositories/notes.repository.ts`
  - Add `findOwnedTagIds(userId, ids: string[]): Promise<string[]>` — returns the subset of `ids` that are `Tag` rows owned by `userId` (so the service can drop unknown/foreign IDs). _(Tag repo proper is AB-1006; keep this minimal read here.)_
  - Parameterize `listNotesWithCount(userId, { skip, take, sort, order, status, tagIds })`:
    - **orderBy:** map `sort`→column, `order`→direction, **always append `id` as a stable secondary sort** (pagination determinism)
    - **title sort:** Prisma `orderBy` has no case-insensitive mode for a plain String column — order `title` case-insensitively (`lower(title)`)
    - **status:** `where.deletedAt` = `null` for `active`, `{ not: null }` for `trashed`; always scope `where.userId`
    - **tag OR + de-dup:** `tags: { some: { tagId: { in: tagIds } } }` (the relation `some` filter returns each note once — no join multiplication); `count` uses the **same** `where` so `total` counts each note once
    - When `tagIds` is empty *and* a tag filter was requested with no owned matches → predicate must yield zero rows; when no tag filter was requested → omit the tag predicate entirely
  - **Decision point (flag for implementer):** a single parameterized `$queryRaw` for the whole list (dynamic `ORDER BY lower(title)`, OR-tag via `EXISTS`/`JOIN … DISTINCT`, status predicate, `LIMIT/OFFSET`) is likely cleaner than mixing a Prisma `findMany` with a raw title path. Pick one approach; keep the `count` predicate identical to the list predicate.
- [x] **2.2 Service** — `backend/src/services/notes.service.ts` *(depends on 2.1)*
  - Default `sort=updatedAt`, `order=desc`, `status=active` when omitted
  - Resolve tags: if the parsed `tags[]` is empty → no tag filter; else call `findOwnedTagIds` → pass only owned IDs; if a filter was supplied but resolves to `[]` owned → return empty (`{ data: [], total: 0, page, limit }`) without leaking foreign-tag existence
  - Reuse the existing page/limit clamp; compute `skip`
  - Pass `{ skip, take, sort, order, status, tagIds }` to `listNotesWithCount`; map rows via `toNoteResponse`

**✅ Checkpoint 2** — PASSED (also updated 4 AB-1004 listNotes unit tests to `objectContaining` for the widened repo call)
- [x] `pnpm -w build` → 0 errors, 0 warnings
- [x] `pnpm -w lint --max-warnings 0`
- [x] `pnpm --filter backend test` → all green (124/124)

---

## Phase 3 — Integration / wiring

> Expected to be **verification-only** — the proposal records no controller/route code change. Make a change here only if a type/cast needs widening.

- [x] **3.1 Controller** — `backend/src/controllers/notes.controller.ts`: confirmed — `list` forwards `req.validatedQuery as ListNotesQuery` unchanged; typechecks against the widened schema (build green). No code change.
- [x] **3.2 Route validation** — `backend/src/routes/notes.routes.ts`: confirmed — `validateQuery(ListNotesQuerySchema)` rejects invalid enums (needed only the middleware generic widening, done in Phase 1). No route change.
- [x] **3.3 Smoke** — ran a DB-free schema contract smoke: tags split/trim/drop-blanks, valid enums accepted, invalid `sort`/`order`/`status`/`page` rejected with correct field path. Full HTTP 400 path is covered by the Phase 4 integration tests (live dev-server run skipped — dev DB state unknown, integration suite exercises the real path).

**✅ Checkpoint 3** — PASSED (no backend source changed since Checkpoint 2's green run; schema smoke green)
- [x] `pnpm -w build` → 0 errors, 0 warnings
- [x] `pnpm -w lint --max-warnings 0`
- [x] `pnpm --filter backend test` → all green (124/124)

---

## Phase 4 — Tests (one test per spec scenario)

> 4.1 and 4.2 touch different files with no shared dependency → `[PARALLEL]`. The integration task owns any new Tag/NoteTag seed helper (so there's no shared-file write conflict).

- [ ] **4.1 [PARALLEL] Unit tests** — service rules, mocked repo — `backend/tests/unit/notes.service.test.ts`
  - `it('defaults order to desc when sort is supplied without order')` ← *Sort: order defaults to desc*
  - `it('maps omitted/active status to the deletedAt:null repo option')` ← *Status: active is the default*
  - `it('maps status=trashed to the deletedAt:{not:null} repo option')` ← *Status: trashed mapping (service half)*
  - `it('drops unknown/foreign tag ids and calls repo with only owned ids')` ← *Tag: unknown/non-owned ignored*
  - `it('returns empty when a tag filter resolves to no owned tag')` ← *Tag: filter naming no owned tag returns empty*
  - `it('applies no tag filter for blank or separator-only tags')` ← *Tag: blank tags applies no filter*
  - Re-run: existing `listNotes` unit tests (pagination clamp, defaults) stay green
- [ ] **4.2 [PARALLEL] Integration tests** — HTTP + real test Postgres — `backend/tests/integration/notes.routes.test.ts` (seed `Tag`/`NoteTag` via Prisma)
  - **Sort (5):**
    - `it('?sort=createdAt&order=asc|desc orders by created date both directions')` ← *Sort by created date asc/desc*
    - `it('?sort=updatedAt&order=asc returns inverse of default')` ← *Sort by last-updated ascending*
    - `it('?sort=title&order=asc is case-insensitive (apple before Zebra)')` ← *Title sort case-insensitive*
    - `it('breaks ties on id so paging is stable when sort values are equal')` ← *Stable ordering via id tiebreaker*
    - `it('?sort=foo or ?order=sideways → 400 VALIDATION_ERROR + fields[]')` ← *Invalid sort/order rejected*
  - **Tag filter (4):**
    - `it('?tags=<tagA> returns only notes carrying tagA')` ← *Filter by a single tag*
    - `it('?tags=<tagA>,<tagB> returns the union (OR)')` ← *Multiple tags use OR*
    - `it('a note carrying both tagA and tagB appears once and counts once in total')` ← *Note with several supplied tags appears once*
    - `it('?tags=<tagA> with status omitted excludes a soft-deleted tagged note')` ← *Tag filter respects active default*
  - **Status (4):**
    - `it('?status=trashed returns only soft-deleted notes')` ← *trashed returns only soft-deleted*
    - `it('?status=trashed includes notes deleted >30 days ago (not yet purged)')` ← *trashed regardless of age*
    - `it('?status=trashed shows only the caller\'s notes, default updatedAt desc')` ← *trashed ownership + sort default*
    - `it('?status=archived → 400 VALIDATION_ERROR + fields[]')` ← *Invalid status rejected*
  - **Compose (2):**
    - `it('combines status+tags+sort+order+page+limit in one request')` ← *All query params combine*
    - `it('total reflects the filtered set across pages, data ≤ limit')` ← *total reflects the filtered set*
  - Re-run: existing `GET /api/notes` default-view integration tests stay green

**✅ Checkpoint 4 (final — pre-commit gate)**
- [ ] `pnpm -w build` → 0 errors, 0 warnings
- [ ] `pnpm -w lint --max-warnings 0`
- [ ] `pnpm --filter backend test` → all green, **≥ 80% coverage on new code**
- [ ] `npx commitlint --from HEAD~1` passes · Husky pre-commit passes (never `--no-verify`)

---

## Traceability — spec scenario → test

| Spec requirement | Scenario | Test | Layer |
|---|---|---|---|
| List (default view) | 6 scenarios | existing AB-1004 tests (re-run, unchanged) | int + unit |
| Sort the note list | created asc/desc | `sort=createdAt …both directions` | int |
| Sort the note list | updatedAt ascending | `sort=updatedAt&order=asc inverse of default` | int |
| Sort the note list | title case-insensitive | `sort=title … apple before Zebra` | int |
| Sort the note list | id tiebreaker | `breaks ties on id … paging stable` | int |
| Sort the note list | order defaults to desc | `defaults order to desc …` | unit |
| Sort the note list | invalid sort/order | `?sort=foo or ?order=sideways → 400` | int |
| Filter by tag (OR) | single tag | `?tags=<tagA> … only tagA` | int |
| Filter by tag (OR) | multiple OR | `?tags=<tagA>,<tagB> … union` | int |
| Filter by tag (OR) | de-dup once + total | `… appears once and counts once` | int |
| Filter by tag (OR) | unknown/foreign ignored | `drops unknown/foreign … owned ids only` | unit |
| Filter by tag (OR) | none owned → empty | `returns empty when … no owned tag` | unit |
| Filter by tag (OR) | blank tags = no filter | `applies no tag filter for blank …` | unit |
| Filter by tag (OR) | respects active default | `?tags=<tagA> … excludes soft-deleted tagged` | int |
| List by status | active is default | `maps omitted/active status …` | unit |
| List by status | trashed only soft-deleted | `?status=trashed … only soft-deleted` | int |
| List by status | trashed regardless of age | `?status=trashed includes >30 days` | int |
| List by status | trashed ownership + sort | `?status=trashed … caller's, updatedAt desc` | int |
| List by status | invalid status | `?status=archived → 400` | int |
| List by status | trashed mapping (service) | `maps status=trashed to deletedAt:{not:null}` | unit |
| Compose | all params combine | `combines status+tags+sort+order+page+limit` | int |
| Compose | total reflects filtered | `total reflects … across pages` | int |

**Totals:** 20 new scenarios → 20 new tests (15 integration + 5 unit) + the modified requirement's 6 scenarios covered by re-run existing tests.
