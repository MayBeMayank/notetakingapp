# Delta Spec — note-crud

**Change:** AB-1005
**FRS coverage:** §4.5.2 (sort field + direction; default last-updated desc), §4.5.3 (multi-tag **OR** filter, de-duplicated), §4.5.4 (pagination + sorting + filtering compose); completes the active/trashed list halves of §4.4.2; cross-cutting §9.1 (ownership), §9.3 (validation), §9.6 (pagination)
**SDS coverage:** §6.3 (full `GET /api/notes` query contract), §5.2 (pagination clamp), §5.1 (200 / 400)

> Builds on AB-1004's default list (already in `openspec/specs/note-crud/spec.md`). This delta **modifies** the existing default-list requirement to reference the new query params and corrects its stale "multi-tag **AND**" note to **OR** (ADR-002), then **adds** requirements for sorting, tag filtering, the status switch, and composition.
>
> Not specified here (owned elsewhere): tag attach/detach and Tag CRUD → AB-1006; full-text search → AB-1007; version snapshots → AB-1009. AB-1005 implements only the *filter query* over the existing `NoteTag` relation — it creates no `Tag`/`NoteTag` rows.

---

## MODIFIED Requirements

### Requirement: List own active notes (default view)
The system SHALL allow an authenticated user to list their own active notes with pagination. When no `sort`, `order`, `tags`, or `status` query param is supplied, the list SHALL exclude soft-deleted notes and other users' notes, SHALL be sorted by last-updated descending, and SHALL report the total count. This default view is **extended, not replaced**, by the configurable sort, tag filter, and status switch defined below, all of which compose with pagination (FRS-4.5.4).

> This requirement defines the **default** list returned when the new query params are omitted. Configurable `sort`/`order` (see *Sort the note list*), OR-semantics multi-tag filtering (see *Filter the note list by tag*), and the `status` switch (see *List notes by status*) extend the same `GET /api/notes` endpoint. The multi-tag filter is **OR**, per `docs/decisions/ADR-002-tag-filter-or-semantics.md`.

#### Scenario: List returns only the caller's active notes
- **WHEN** an authenticated user GETs `/api/notes`
- **THEN** the system responds `200` with `{ data: [...], page, limit, total }` containing only that user's notes whose `deletedAt` is null; other users' notes and the caller's own soft-deleted notes are excluded (FRS-4.4.2 / 9.1)

#### Scenario: Default sort is last-updated descending
- **WHEN** an authenticated user lists notes without specifying `sort` or `order`
- **THEN** the returned `data` is ordered by `updatedAt` descending (FRS-4.5.2 default)

#### Scenario: Pagination is clamped, not rejected
- **WHEN** an authenticated user requests `?page=0&limit=999` (out of range)
- **THEN** the system clamps `page` to `1` and `limit` to `100` and responds `200` (SDS §5.2); a request with no params uses `page=1`, `limit=20`

#### Scenario: Total reflects all active notes regardless of page
- **WHEN** an authenticated user lists notes that span more than one page
- **THEN** `total` is the full count of the caller's active notes, while `data` contains at most `limit` items for the requested `page`

#### Scenario: Empty result set
- **WHEN** an authenticated user with no active notes lists `/api/notes`
- **THEN** the system responds `200` with `{ data: [], page: 1, limit: 20, total: 0 }` (not an error)

#### Scenario: Type-invalid query params rejected (FRS-9.3)
- **WHEN** an authenticated user GETs `/api/notes` with non-numeric values for `page` or `limit` (e.g. `?page=abc&limit=xyz`)
- **THEN** the system responds `400` with `{ error: { code: "VALIDATION_ERROR", fields: [{ field: "page", message: "…" }] } }` for each invalid parameter — type coercion failure is not silently clamped

---

## ADDED Requirements

### Requirement: Sort the note list
The system SHALL allow an authenticated user to order their note list by `updatedAt`, `createdAt`, or `title`, in `asc` or `desc` direction, via the `sort` and `order` query params. `title` SHALL be ordered **case-insensitively** (`lower(title)`). Every ordering SHALL include a stable secondary sort on note `id` so notes with equal sort values keep a deterministic order across page boundaries. An unrecognized `sort` or `order` value SHALL be rejected with `400`. (FRS-4.5.2)

#### Scenario: Sort by created date, ascending and descending
- **WHEN** an authenticated user GETs `/api/notes?sort=createdAt&order=asc`
- **THEN** `data` is ordered by `createdAt` ascending; the same request with `order=desc` returns the reverse order

#### Scenario: Sort by last-updated ascending (inverse of default)
- **WHEN** an authenticated user GETs `/api/notes?sort=updatedAt&order=asc`
- **THEN** `data` is ordered by `updatedAt` ascending — the inverse of the default last-updated-descending view

#### Scenario: Title sort is case-insensitive
- **WHEN** an authenticated user with notes titled `"Zebra"` and `"apple"` GETs `/api/notes?sort=title&order=asc`
- **THEN** `data` is ordered `"apple"` then `"Zebra"` — compared case-insensitively via `lower(title)`, **not** by raw byte order (which would place uppercase `"Zebra"` before lowercase `"apple"`)

#### Scenario: Stable ordering via id tiebreaker
- **WHEN** several notes share the same `updatedAt` (or the same `title`) and the result spans more than one page
- **THEN** the tie is broken by a deterministic secondary sort on `id`, so no note is skipped or duplicated across page boundaries

#### Scenario: order defaults to desc when omitted
- **WHEN** an authenticated user supplies `?sort=title` without an `order`
- **THEN** `order` defaults to `desc` (titles Z→A); a request with `order=asc` is required for A→Z

#### Scenario: Invalid sort or order value rejected
- **WHEN** an authenticated user GETs `/api/notes?sort=foo` or `?order=sideways`
- **THEN** the system responds `400` with `{ error: { code: "VALIDATION_ERROR", fields: [{ field: "sort"|"order", message: "…" }] } }` — an unknown enum value is not silently defaulted

---

### Requirement: Filter the note list by tag (OR semantics)
The system SHALL allow an authenticated user to filter their note list to notes carrying **any** of one or more supplied tags, via `tags` (a comma-separated list of tag IDs). Filtering SHALL use **OR** semantics; a note carrying several of the supplied tags SHALL appear **exactly once** and SHALL be counted once in `total`. Tag IDs not owned by the caller (unknown or belonging to another user) SHALL be silently ignored. (FRS-4.5.3, ADR-002)

#### Scenario: Filter by a single tag
- **WHEN** an authenticated user GETs `/api/notes?tags=<tagA>` where `tagA` is one of their own tags
- **THEN** only their notes carrying `tagA` are returned, and `total` counts those notes

#### Scenario: Multiple tags use OR (union)
- **WHEN** an authenticated user GETs `/api/notes?tags=<tagA>,<tagB>`
- **THEN** notes carrying `tagA` **or** `tagB` are returned (the union) — not only notes carrying both

#### Scenario: A note carrying several supplied tags appears once
- **WHEN** a note carries both `tagA` and `tagB` and the user GETs `/api/notes?tags=<tagA>,<tagB>`
- **THEN** that note appears **exactly once** in `data` and contributes `1` to `total` — the result is de-duplicated (FRS-4.5.3)

#### Scenario: Unknown or non-owned tag IDs are ignored
- **WHEN** an authenticated user GETs `/api/notes?tags=<tagA>,<unknownOrForeignId>` where `tagA` is owned by the caller
- **THEN** the filter resolves to `tagA` only; the unknown or another user's tag id is dropped without error and without revealing whether it exists (FRS-9.1)

#### Scenario: A filter naming no owned tag returns empty
- **WHEN** every id in `?tags` resolves to no tag owned by the caller
- **THEN** the system responds `200` with `{ data: [], total: 0 }` — not an error (the OR set is empty)

#### Scenario: Blank tags param applies no filter
- **WHEN** an authenticated user GETs `/api/notes?tags=` (empty) or `?tags=,,` (separators only)
- **THEN** no tag filter is applied and the full status-appropriate list is returned

#### Scenario: Tag filter respects the active default
- **WHEN** an authenticated user GETs `/api/notes?tags=<tagA>` with `status` omitted
- **THEN** only **active** (deletedAt null) notes carrying `tagA` are returned; a soft-deleted note carrying `tagA` is excluded (FRS-4.4.2) — the tag filter composes with the active default

---

### Requirement: List notes by status (active or trashed)
The system SHALL allow an authenticated user to select which notes the list returns via the `status` query param: `active` (default — soft-deleted excluded) or `trashed` (only soft-deleted notes). The trashed view SHALL show **all** of the caller's soft-deleted notes regardless of how long ago they were deleted, under the same ownership, sort, order, and tag-filter contract as the active view. An unrecognized `status` value SHALL be rejected with `400`. (FRS-4.4.2; SDS §6.3)

#### Scenario: status=active is the default
- **WHEN** an authenticated user GETs `/api/notes` with `status` omitted, or `?status=active`
- **THEN** only notes whose `deletedAt` is null are returned — identical to the default view (FRS-4.4.2)

#### Scenario: status=trashed returns only soft-deleted notes
- **WHEN** an authenticated user GETs `/api/notes?status=trashed`
- **THEN** only the caller's notes whose `deletedAt` is set are returned; active notes are excluded

#### Scenario: Trashed view shows soft-deleted notes regardless of age
- **WHEN** an authenticated user GETs `/api/notes?status=trashed` and has notes deleted both within and beyond the 30-day window (not yet purged)
- **THEN** all such soft-deleted notes are returned — the 30-day window governs restore eligibility, not list visibility (purge is a separate background job, SDS §10)

#### Scenario: Trashed view respects ownership and the same sort default
- **WHEN** an authenticated user GETs `/api/notes?status=trashed`
- **THEN** only the caller's own soft-deleted notes appear (never another user's), ordered by `updatedAt` descending by default, and `sort`/`order`/`tags` compose identically to the active list

#### Scenario: Invalid status value rejected
- **WHEN** an authenticated user GETs `/api/notes?status=archived`
- **THEN** the system responds `400` with `{ error: { code: "VALIDATION_ERROR", fields: [{ field: "status", message: "…" }] } }` — not silently defaulted

---

### Requirement: Compose pagination, sorting, and filtering
The system SHALL apply `page`, `limit`, `sort`, `order`, `tags`, and `status` together in a single request. The tag filter and status predicate determine the matching set; sorting orders it; pagination slices it; and `total` reflects the full matching set independent of the current page. (FRS-4.5.4)

#### Scenario: All query params combine in one request
- **WHEN** an authenticated user GETs `/api/notes?status=active&tags=<tagA>,<tagB>&sort=title&order=asc&page=2&limit=10`
- **THEN** the result is the caller's active notes carrying `tagA` or `tagB` (de-duplicated), ordered by `title` case-insensitive ascending with an `id` tiebreaker, returning items 11–20, with `total` = the full count of matching notes

#### Scenario: total reflects the filtered set, not the whole table
- **WHEN** a tag filter and/or `status` narrows the matching set across multiple pages
- **THEN** `total` is the count of the matching set (after filter + status, before pagination), while `data` holds at most `limit` items for the requested `page`
