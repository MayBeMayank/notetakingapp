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
The system SHALL allow an authenticated user to create a note with an optional title and optional rich-text content. The note SHALL be owned by the caller, be private, and be active (not deleted) on creation. The server SHALL derive `contentText` from `contentJson` and store both.

#### Scenario: Create with title and content
- **WHEN** an authenticated user POSTs `{ title: "Groceries", content: <TipTap doc> }` to `/api/notes`
- **THEN** the system responds `201` with `{ note: { id, title, content, createdAt, updatedAt } }`, the row's `userId` is the caller, `deletedAt` is null, and `contentText` is stored as the plaintext derived from `content`

#### Scenario: Create a blank note (autosave-on-create)
- **WHEN** an authenticated user POSTs an empty body `{}` (or omits both `title` and `content`)
- **THEN** the system responds `201` with a note whose `title` is `""`, whose `content` is an empty TipTap document, and whose `contentText` is `""` (FRS-4.1.2)

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
The system SHALL allow an authenticated user to list their own active notes with pagination. The list SHALL exclude soft-deleted notes and other users' notes, SHALL be sorted by last-updated descending by default, and SHALL report the total count.

> Default list only. Configurable `sort` / `order`, multi-tag AND filtering, and `status=trashed` are added later.

#### Scenario: List returns only the caller's active notes
- **WHEN** an authenticated user GETs `/api/notes`
- **THEN** the system responds `200` with `{ data: [...], page, limit, total }` containing only that user's notes whose `deletedAt` is null; other users' notes and the caller's own soft-deleted notes are excluded (FRS-4.4.2 / 9.1)

#### Scenario: Default sort is last-updated descending
- **WHEN** an authenticated user lists notes without specifying a sort
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
The system SHALL allow an authenticated user to update the title and/or content of one of their own non-deleted notes. Each successful update SHALL re-derive `contentText` and bump `updatedAt`. Updating a soft-deleted note SHALL be rejected until it is restored.

> Tag associations (FRS-4.3.1) and version snapshot (FRS-4.3.2) are deferred.

#### Scenario: Update title and content
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with `{ title, content }` on an own active note
- **THEN** the system responds `200` with the updated `{ note }`, `updatedAt` is advanced, and `contentText` is re-derived from the new `content`

#### Scenario: Partial update leaves omitted fields unchanged
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with only `{ title }` (no `content`)
- **THEN** the title is updated and the existing `content` / `contentText` are preserved unchanged; likewise a `{ content }`-only patch leaves the title unchanged

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
- **WHEN** an authenticated user PATCHes an invalid body (e.g. `content` that is not a TipTap document)
- **THEN** the system responds `400` with `fields[]` and no change is made

---

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
