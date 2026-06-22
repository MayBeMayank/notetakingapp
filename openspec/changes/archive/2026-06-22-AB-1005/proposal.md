# AB-1005 — Notes: Pagination, Sorting, Tag Filtering

## Why

AB-1004 shipped the **minimal** notes list: the caller's active notes, fixed to last-updated-descending, with clamped `page`/`limit` pagination. That is all the default view needs, but it is only half of FRS §4.5. The list cannot yet be re-sorted by another field, cannot be filtered to a subset of tags, and offers no way to see soft-deleted notes — even though the note list UI (AB-1011) and the restore flow both depend on those capabilities, and the SDS §6.3 `GET /api/notes` contract already declares the `sort`, `order`, `tags`, and `status` query params that AB-1004 deferred here.

AB-1005 completes FRS §4.5 by making the **existing** `GET /api/notes` endpoint fully queryable: configurable sort field and direction, OR-semantics multi-tag filtering, and a `status` switch to view the trash — all composing with pagination in a single request. No new endpoint is introduced; this extends the `note-crud` capability AB-1004 established.

## What Changes

**FRS coverage:** §4.5.2 (sortable by created / last-updated / title, asc or desc), §4.5.3 (filter by one or more tags, **OR** semantics, de-duplicated), §4.5.4 (pagination + sorting + filtering compose in one request). Completes the active/trashed halves of the default-list exclusion in §4.4.2 (the search-results and tag-count halves remain with AB-1007 / AB-1006). Cross-cutting: §9.1 (ownership isolation), §9.3 (validation), §9.6 (pagination contract).

**SDS coverage:** §6.3 (the full `GET /api/notes` query contract — `?page&limit&sort=updatedAt|createdAt|title&order=asc|desc&tags=a,b&status=active|trashed`), §5.2 (pagination clamping), §5.1 (200 success / 400 on invalid enum). Tag-filter OR semantics per `docs/decisions/ADR-002-tag-filter-or-semantics.md`.

**In scope:**
- **Sorting** — `sort=updatedAt|createdAt|title` × `order=asc|desc`. Default stays `updatedAt desc` (FRS-4.5.2). `title` sorts **case-insensitively** (`lower(title)`). All orderings get a stable secondary sort on `id` so equal sort values do not reshuffle across page boundaries.
- **Tag filtering** — `tags=<id>,<id>` (comma-separated tag IDs) with **OR** semantics: a note matches if it carries **any** supplied tag. A note carrying several supplied tags appears **once**, and `total` counts it once (FRS-4.5.3). Unknown or non-owned tag IDs are silently ignored; if no supplied tag is owned by the caller the result set is empty.
- **Status switch** — `status=active` (default, soft-deleted excluded) or `status=trashed` (only soft-deleted notes, regardless of age — purge of >30-day notes is a separate background job). The trashed view uses the **same** sort/order/tags contract and default ordering as the active view.
- **Composition** — `page`, `limit`, `sort`, `order`, `tags`, and `status` all combine in one request (FRS-4.5.4); `total` reflects the filtered set; pagination applies after filter + sort.
- **Validation** — `sort`, `order`, and `status` are Zod enums; an out-of-enum value is rejected with `400 + fields[]` (consistent with the existing `?page=abc → 400`). `page`/`limit` remain **clamped, not rejected** (SDS §5.2).
- **Shared schema** — extend `ListNotesQuerySchema` in `packages/shared/src/schemas/notes.ts` with the four new params; response shape (`NoteListResponseSchema`) is unchanged.

**Explicitly out of scope (deferred, with the ticket that owns each):**
- **Tag attach/detach on notes** and **Tag CRUD** (create/list/rename/delete, per-tag note count) → **AB-1006**. AB-1005 owns only the *filter query* over the existing `NoteTag` relation; it does not create `Tag` or `NoteTag` rows and adds no `tagIds` to create/update. Integration tests seed `Tag`/`NoteTag` rows directly via Prisma since no attach endpoint exists yet.
- **Full-text search** (`/api/search`) and the search-results half of FRS-4.4.2 → **AB-1007**.
- **Per-tag note-count** and the tag-count half of FRS-4.4.2 → **AB-1006**.
- **Version snapshots**, **sharing**, **public view** → AB-1009 / AB-1008.
- **Background purge** of notes past the 30-day window (FRS-4.4.4) — a scheduled job, not a user endpoint (ops concern; SDS §10). The trashed view therefore shows soft-deleted notes regardless of age until that job removes them.

## Capabilities

### New Capabilities
_(none)_ — AB-1005 introduces no new capability; it completes the list query on the existing endpoint.

### Modified Capabilities
- `note-crud`: extend the existing "List own active notes (default view)" requirement and add requirements for configurable sorting, OR-semantics tag filtering, and the active/trashed status switch. Delta in `specs/note-crud/spec.md`.

## Impact

### API Delta (from SDS §6.3)

No new route. `GET /api/notes` gains query params (additive, all optional; defaults preserve AB-1004 behavior):

| Method | Path | Query (new params **bold**) | Success | Errors |
|--------|------|------------------------------|---------|--------|
| GET | `/api/notes` | `?page&limit` **`&sort=updatedAt\|createdAt\|title&order=asc\|desc&tags=<id>,<id>&status=active\|trashed`** | 200 `{ data, page, limit, total }` | 400 (invalid `sort`/`order`/`status` enum, or non-numeric `page`/`limit`) |

- **Defaults (unchanged from AB-1004):** `page=1`, `limit=20`, `sort=updatedAt`, `order=desc`, `status=active`, no tag filter.
- **Response shape unchanged:** `{ data: NoteResponse[], page, limit, total }`; `NoteResponse = { id, title, content, createdAt, updatedAt }`.
- **Clamp vs reject:** `page`/`limit` out of range are **clamped** (SDS §5.2); `sort`/`order`/`status` out of enum are **rejected 400**.

### DB Changes

**None.** The `NoteTag` join table, the `Tag` table, and `Note`'s `@@index([userId, deletedAt, updatedAt])` all exist from the AB-1001 init migration. No new migration, column, or index is required.

> Non-blocking note: case-insensitive `title` sort uses a `lower(title)` ordering expression that the existing index does not cover. Acceptable at v1 scale; a `lower(title)` functional index is a possible future optimization, not part of this change.

### Affected layers

| Layer | Change |
|-------|--------|
| `packages/shared` | Extend `ListNotesQuerySchema`: add `sort` (enum `updatedAt\|createdAt\|title`), `order` (enum `asc\|desc`), `status` (enum `active\|trashed`), `tags` (comma-separated string → parsed to `string[]`). All optional. `NoteListResponseSchema` unchanged. |
| `backend/src/repositories` | Parameterize `listNotesWithCount`: dynamic `orderBy` (sort field + direction + `id` tiebreaker; `lower(title)` for title), `where.deletedAt` driven by `status`, and an OR tag predicate (`tags: { some: { tagId: { in: ownedTagIds } } }`) with de-duplicated count. |
| `backend/src/services` | Extend `listNotes`: default/parse `sort`/`order`/`status`, resolve the supplied tag IDs to the caller's **owned** subset (ignore unknown/foreign), and pass options to the repo. Pagination clamp logic is reused. |
| `backend/src/controllers` | No change — already forwards the validated query to the service. |
| `backend/src/routes` | No change — `validateQuery(ListNotesQuerySchema)` now validates the new enums automatically. |
| `backend/tests` | Unit tests for sort/order resolution, tag-subset resolution, and status mapping; Supertest integration tests asserting sort orders, OR de-dup + `total`, trashed view, composition, and `400` on invalid enums. Test setup seeds `Tag`/`NoteTag` rows via Prisma. |

### Key assumptions

- **`tags` = comma-separated tag IDs (cuids)**, consistent with `tagIds` on create/update (SDS §6.3). An empty or blank `tags` value (`?tags=` or `?tags=,,`) means "no filter".
- **Owned-tag resolution:** a supplied tag ID counts only if it belongs to the caller (`Tag.userId = req.userId`). Unknown or foreign IDs are silently dropped; an all-invalid set yields an empty result (a filter never errors the list and never leaks another user's tag existence).
- **Stable pagination:** every ordering appends a secondary sort on `id`, so notes with equal `updatedAt`/`createdAt`/`title` keep a deterministic order across pages.
- **Title sort is case-insensitive** (`lower(title)`), ascending = A→Z.
- **`order` defaults to `desc`** when `sort` is supplied without `order`.
- **Trashed view** shows every note with `deletedAt` set regardless of age (purge is a separate ops job, SDS §10), under the same sort/order/tags contract and the same `updatedAt desc` default as the active view.
- **Invalid enums reject (400), page/limit clamp** — the one deliberate asymmetry, because an enum cannot be meaningfully clamped.
- Tag attach/detach and Tag CRUD remain **AB-1006**; AB-1005 implements only the filter query, exercised in tests against directly-seeded `Tag`/`NoteTag` rows.
