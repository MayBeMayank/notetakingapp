# Spec — note-crud

## Purpose

Define the CRUD operations (Create, Read, Update, Delete) and soft-delete restoration for authenticated users to manage their own notes.

---

## Coverage Notes

**FRS coverage:** §4.1–4.4 (FRS-4.1.1 – FRS-4.4.5) + the default slice of §4.5.1–4.5.2; cross-cutting §9.1–9.2

**SDS coverage:** §6.3 (notes contracts), §10 (soft-delete design), §5.1 (status codes), §5.2 (pagination)

> Deferred to other tickets: version snapshot-on-save (FRS-4.1.4 / 4.3.2 → AB-1009), tag associations on create/update (FRS-4.3.1 tags clause → AB-1006), full list sort/filter/status (FRS-4.5.2–4.5.4 → AB-1005), and background purge of expired-window notes (FRS-4.4.4 → ops / scheduled cron job). FRS-4.4.2 has three halves — this spec covers the default-**list** exclusion of soft-deleted notes; the **search-results** exclusion lands with AB-1007 and the **tag-count** exclusion with AB-1006.

---
## Requirements
### Requirement: Create a note
The system SHALL allow an authenticated user to create a note with an optional title, optional rich-text content, and an optional set of `tagIds`. The note SHALL be owned by the caller, be private, and be active (not deleted) on creation. The server SHALL derive `contentText` from `contentJson` and store both. Any supplied `tagIds` SHALL be attached to the note; only the caller's own tags may be attached.

#### Scenario: Create with title and content
- **WHEN** an authenticated user POSTs `{ title: "Groceries", content: <TipTap doc> }` to `/api/notes`
- **THEN** the system responds `201` with `{ note: { id, title, content, tagIds, createdAt, updatedAt } }`, the row's `userId` is the caller, `deletedAt` is null, and `contentText` is stored as the plaintext derived from `content`

#### Scenario: Create a blank note (autosave-on-create)
- **WHEN** an authenticated user POSTs an empty body `{}` (or omits `title`, `content`, and `tagIds`)
- **THEN** the system responds `201` with a note whose `title` is `""`, whose `content` is an empty TipTap document, whose `contentText` is `""`, and whose `tagIds` is `[]` (FRS-4.1.2)

#### Scenario: Create with tag ids attaches the caller's tags
- **WHEN** an authenticated user POSTs `{ title, content, tagIds: ["tagA", "tagB"] }` where both ids are tags the caller owns
- **THEN** the system responds `201` and the note is associated with `tagA` and `tagB` (FRS-5.7)

#### Scenario: Create with a foreign or unknown tag id rejected atomically
- **WHEN** an authenticated user POSTs `tagIds` containing an id that does not exist or belongs to another user
- **THEN** the system responds `422` with `{ error: { code: "INVALID_TAG_IDS", … } }`, **no note is created**, and no associations are written (FRS-5.7 / 9.1)

#### Scenario: Duplicate ids in tagIds are de-duplicated
- **WHEN** an authenticated user POSTs `tagIds: ["tagA", "tagA"]` for an owned tag
- **THEN** the note is associated with `tagA` exactly once and the response `tagIds` lists it once

#### Scenario: Created note is private to the creator
- **WHEN** a note is created
- **THEN** it is associated only with the creating `userId`, carries no share link, and is not readable by any other user (FRS-4.1.3)

#### Scenario: contentText is derived server-side, both stored together
- **WHEN** a note is created with `content` containing nested rich-text nodes
- **THEN** the backend derives `contentText` (plaintext) from `contentJson` and writes `contentJson` and `contentText` in the same operation; the client is not required to send `contentText`

#### Scenario: Malformed content rejected
- **WHEN** an authenticated user POSTs a `content` value that is not a valid TipTap JSON document object (e.g. a string or array)
- **THEN** the system responds `400` with `{ error: { code: "VALIDATION_ERROR", fields: [{ field: "content", message: "…" }] } }`

#### Scenario: Unauthenticated create rejected
- **WHEN** a request to `POST /api/notes` carries no valid access token
- **THEN** the auth middleware responds `401` and the note is not created (FRS-9.2)

---

### Requirement: Read a note by id
The system SHALL allow an authenticated user to read one of their own active notes by id. Notes that are missing, owned by another user, or soft-deleted SHALL be indistinguishable and return 404 — no existence SHALL be leaked.

#### Scenario: Read own active note
- **WHEN** an authenticated user GETs `/api/notes/:id` for an active note they own
- **THEN** the system responds `200` with `{ note: { id, title, content, createdAt, updatedAt } }`

#### Scenario: Read a note owned by another user
- **WHEN** an authenticated user GETs `/api/notes/:id` for a note owned by a different user
- **THEN** the system responds `404` with `{ error: { code: "NOT_FOUND", … } }` — not `403`, and without revealing the note exists (FRS-4.2.2 / 9.1)

#### Scenario: Read a non-existent note
- **WHEN** an authenticated user GETs `/api/notes/:id` for an id that matches no note
- **THEN** the system responds `404`

#### Scenario: Read a soft-deleted note
- **WHEN** an authenticated user GETs `/api/notes/:id` for one of their own notes whose `deletedAt` is set
- **THEN** the system responds `404` — a deleted note is not readable; only restore may act on it (FRS-4.4.5)

---

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

### Requirement: Update a note
The system SHALL allow an authenticated user to update the title, content, and/or tag associations of one of their own non-deleted notes. Each successful content update SHALL re-derive `contentText` and bump `updatedAt`. When `tagIds` is supplied it SHALL **replace** the note's entire tag set; only the caller's own tags may be attached. Updating a soft-deleted note SHALL be rejected until it is restored.

> `tagIds` uses full-replace set semantics: present replaces the set, `[]` detaches all, omitting it leaves associations unchanged. The version snapshot of FRS-4.3.2 remains deferred to AB-1009.

#### Scenario: Update title and content
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with `{ title, content }` on an own active note
- **THEN** the system responds `200` with the updated `{ note }`, `updatedAt` is advanced, and `contentText` is re-derived from the new `content`

#### Scenario: Partial update leaves omitted fields unchanged
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with only `{ title }` (no `content`, no `tagIds`)
- **THEN** the title is updated and the existing `content` / `contentText` **and existing tag associations** are preserved unchanged

#### Scenario: tagIds replaces the note's entire tag set
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with `{ tagIds: ["tagB"] }` on a note currently tagged `tagA` and `tagB`
- **THEN** the note is left associated with `tagB` only — `tagA` is detached (full-replace semantics, FRS-5.7)

#### Scenario: Empty tagIds detaches all tags
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with `{ tagIds: [] }`
- **THEN** all of the note's tag associations are removed and the response `tagIds` is `[]`

#### Scenario: Update with a foreign or unknown tag id rejected atomically
- **WHEN** an authenticated user PATCHes `tagIds` containing an id that does not exist or belongs to another user
- **THEN** the system responds `422` with `{ error: { code: "INVALID_TAG_IDS", … } }`, and neither the note's fields nor its existing associations are changed

#### Scenario: Update a soft-deleted note rejected
- **WHEN** an authenticated user PATCHes `/api/notes/:id` for one of their own notes whose `deletedAt` is set
- **THEN** the system responds `422` with `{ error: { code: "NOTE_DELETED", … } }` and no change is made — the note must be restored first (FRS-4.3.3)

#### Scenario: Update a note owned by another user
- **WHEN** an authenticated user PATCHes `/api/notes/:id` for a note owned by a different user
- **THEN** the system responds `404` (no existence leak), not `403`

#### Scenario: Update a non-existent note
- **WHEN** an authenticated user PATCHes `/api/notes/:id` for an id that matches no note
- **THEN** the system responds `404`

#### Scenario: Malformed update body rejected
- **WHEN** an authenticated user PATCHes an invalid body (e.g. `content` that is not a TipTap document, or `tagIds` that is not an array of strings)
- **THEN** the system responds `400` with `fields[]` and no change is made

### Requirement: Soft-delete a note
The system SHALL allow an authenticated user to delete one of their own active notes. Deletion SHALL be a soft delete — `deletedAt` SHALL be set and the row SHALL never be physically removed within the recovery window. A soft-deleted note SHALL disappear from the default list and read.

#### Scenario: Soft-delete an own active note
- **WHEN** an authenticated user DELETEs `/api/notes/:id` for an own active note
- **THEN** the system responds `204`, sets `deletedAt = now()`, and the underlying row is retained (not physically deleted) (FRS-4.4.1)

#### Scenario: Deleted note is excluded from list and read
- **WHEN** a note has been soft-deleted
- **THEN** it no longer appears in `GET /api/notes` and `GET /api/notes/:id` returns `404` for it (FRS-4.4.2 / 4.4.5)

#### Scenario: Delete a note owned by another user
- **WHEN** an authenticated user DELETEs `/api/notes/:id` for a note owned by a different user
- **THEN** the system responds `404` (no existence leak), and the other user's note is untouched

#### Scenario: Delete a non-existent or already-deleted note
- **WHEN** an authenticated user DELETEs `/api/notes/:id` for an id that matches no note, or for one of their own notes that is already soft-deleted
- **THEN** the system responds `404` — an already-deleted note is no longer an actionable active note

---

### Requirement: Restore a soft-deleted note
The system SHALL allow an authenticated user to restore one of their own soft-deleted notes within the 30-day recovery window, returning it to active state. Restore SHALL be rejected past the window and SHALL be rejected when the note is not currently deleted.

#### Scenario: Restore within the 30-day window
- **WHEN** an authenticated user POSTs `/api/notes/:id/restore` for an own note soft-deleted less than 30 days ago
- **THEN** the system responds `200` with the restored `{ note }`, `deletedAt` is cleared (null), and the note reappears in the default list (FRS-4.4.3)

#### Scenario: Restore past the 30-day window rejected
- **WHEN** an authenticated user POSTs `/api/notes/:id/restore` for an own note whose `deletedAt` is more than 30 days in the past
- **THEN** the system responds `422` with `{ error: { code: "RESTORE_WINDOW_EXPIRED", … } }` and the note stays deleted (FRS-4.4.3)

#### Scenario: Restore a note that is not deleted rejected
- **WHEN** an authenticated user POSTs `/api/notes/:id/restore` for an own note whose `deletedAt` is null (already active)
- **THEN** the system responds `422` with `{ error: { code: "NOTE_NOT_DELETED", … } }` — there is nothing to restore

#### Scenario: Restore a note owned by another user
- **WHEN** an authenticated user POSTs `/api/notes/:id/restore` for a note owned by a different user
- **THEN** the system responds `404` (no existence leak)

#### Scenario: Restore a non-existent note
- **WHEN** an authenticated user POSTs `/api/notes/:id/restore` for an id that matches no note
- **THEN** the system responds `404`

---

### Requirement: Ownership isolation and authentication
Every `/api/notes` operation SHALL require a valid access token and SHALL be scoped to the authenticated user. No user SHALL be able to read or affect another user's note, and the existence of another user's note SHALL never be leaked.

#### Scenario: Missing or invalid token rejected on every notes route
- **WHEN** any request to `POST /api/notes`, `GET /api/notes`, `GET /api/notes/:id`, `PATCH /api/notes/:id`, `DELETE /api/notes/:id`, or `POST /api/notes/:id/restore` carries a missing, malformed, or expired access token
- **THEN** the auth middleware responds `401` with `{ error: { code: "UNAUTHORIZED", … } }` and the handler is not reached (FRS-9.2)

#### Scenario: Every query is scoped to the caller
- **WHEN** any notes operation runs
- **THEN** the underlying repository query filters by `userId = req.userId`, so a note belonging to another user is treated as absent (404) for read/update/delete/restore (FRS-9.1 / 4.2.2)

#### Scenario: 404 response uses the standard error envelope (FRS-9.5)
- **WHEN** any notes route returns a 404 (absent note, not-owned note, or soft-deleted note)
- **THEN** the response body is `{ "error": { "code": "NOT_FOUND", "message": "…" } }` — no `fields` array, no internal detail, and no hint that the resource exists under a different user

### Requirement: Note responses expose attached tag ids
Every note object returned by the API — on create, read, list, update, and restore — SHALL include a `tagIds` array listing the ids of the tags currently associated with that note. The array SHALL reflect the note's live associations and SHALL be empty for a note carrying no tags.

#### Scenario: Created note reports its tag ids
- **WHEN** an authenticated user creates a note with `tagIds: ["tagA", "tagB"]`
- **THEN** the `201` response note includes `tagIds` containing exactly `tagA` and `tagB` (order not significant)

#### Scenario: Note with no tags reports an empty array
- **WHEN** an authenticated user reads or creates a note that carries no tags
- **THEN** the response note includes `tagIds: []` — never `null` and never an omitted field

#### Scenario: Read and list include tag ids
- **WHEN** an authenticated user GETs `/api/notes/:id` or `/api/notes`
- **THEN** each returned note object includes its current `tagIds` array

#### Scenario: tagIds reflects associations only for the caller's own tags
- **WHEN** a note's `tagIds` is returned
- **THEN** it contains only ids of tags owned by the caller (a note can only ever be associated with its owner's tags)

---

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
