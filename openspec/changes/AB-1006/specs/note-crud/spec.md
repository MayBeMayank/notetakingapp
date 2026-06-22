# Delta Spec — note-crud (modified by AB-1006)
**Change:** AB-1006
**FRS coverage:** FRS-5.7 (attach/detach own tags on own notes — the clause of FRS-4.3.1 deferred from AB-1004); cross-cutting §9.1–9.5
**SDS coverage:** §6.3 (notes contracts — `tagIds` on create/update; note response), §3 (NoteTag), §5.1 (status codes)

> This delta extends the existing `note-crud` capability. It adds `tagIds` (full-replace, owner-only) to note **create** and **update**, and adds the note's current `tagIds` to every note **response**. All other `note-crud` requirements (read, list, soft-delete, restore, ownership) are unchanged except that the note object they return now carries `tagIds`, which is captured by the ADDED requirement below. The `GET /api/notes?tags=` filter (FRS-4.5.3) remains **AB-1005** and is not specified here.

---

## ADDED Requirements

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

## MODIFIED Requirements

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
