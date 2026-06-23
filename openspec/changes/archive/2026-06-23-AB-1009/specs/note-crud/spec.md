# Delta Spec — note-crud (modified by AB-1009)
**Change:** AB-1009
**FRS coverage:** FRS-8.1 (snapshot on every save — closes the FRS-4.1.4 initial-version and FRS-4.3.2 update-version clauses deferred from AB-1004); cross-cutting §9.1–9.5
**SDS coverage:** §6.3 (notes contracts — behaviour only), §9 (version design — snapshot on save, atomicity), §3 (NoteVersion)
**ADR:** ADR-003 §3 (tag-only edits do not create a version; tags captured at the title/content save)

> This delta extends the existing `note-crud` capability so that **create** and **update** write a `NoteVersion` snapshot in the same transaction as the note write. It does **not** change the request or response shapes of `POST /api/notes` or `PATCH /api/notes/:id`. All other create/update behaviour (tag full-replace, ownership, soft-delete guards) is unchanged. The list/view/restore endpoints live in the new `version-history` capability.

---

## MODIFIED Requirements

### Requirement: Create a note
The system SHALL allow an authenticated user to create a note with an optional title, optional rich-text content, and an optional set of `tagIds`. The note SHALL be owned by the caller, be private, and be active (not deleted) on creation. The server SHALL derive `contentText` from `contentJson` and store both. Any supplied `tagIds` SHALL be attached to the note; only the caller's own tags may be attached. Creating a note SHALL capture an **initial version** (`versionNumber = 1`) recording the note's title, content, and tag-id snapshot, written in the **same transaction** as the note insert (FRS-8.1 / FRS-4.1.4).

#### Scenario: Create with title and content
- **WHEN** an authenticated user POSTs `{ title: "Groceries", content: <TipTap doc> }` to `/api/notes`
- **THEN** the system responds `201` with `{ note: { id, title, content, tagIds, createdAt, updatedAt } }`, the row's `userId` is the caller, `deletedAt` is null, and `contentText` is stored as the plaintext derived from `content`

#### Scenario: Create captures an initial version atomically
- **WHEN** an authenticated user creates a note
- **THEN** exactly one `NoteVersion` is written with `versionNumber = 1`, capturing the note's `title`, `contentJson`, `contentText`, and current `tagIds`, in the same transaction as the note insert — if the version write fails, the note is not created (FRS-8.1)

#### Scenario: Create a blank note (autosave-on-create) still versions
- **WHEN** an authenticated user POSTs an empty body `{}` (or omits `title`, `content`, and `tagIds`)
- **THEN** the system responds `201` with a note whose `title` is `""`, whose `content` is an empty TipTap document, whose `contentText` is `""`, and whose `tagIds` is `[]`; a `versionNumber = 1` snapshot of that blank state is recorded (FRS-4.1.2 / 8.1)

#### Scenario: Create with tag ids attaches the caller's tags and snapshots them
- **WHEN** an authenticated user POSTs `{ title, content, tagIds: ["tagA", "tagB"] }` where both ids are tags the caller owns
- **THEN** the system responds `201`, the note is associated with `tagA` and `tagB`, and version 1's `tagIds` snapshot is `["tagA", "tagB"]` (FRS-5.7 / 8.1)

#### Scenario: Create with a foreign or unknown tag id rejected atomically
- **WHEN** an authenticated user POSTs `tagIds` containing an id that does not exist or belongs to another user
- **THEN** the system responds `422` with `{ error: { code: "INVALID_TAG_IDS", … } }`, **no note is created**, and **no version is written** (FRS-5.7 / 9.1)

#### Scenario: Created note is private to the creator
- **WHEN** a note is created
- **THEN** it is associated only with the creating `userId`, carries no share link, and is not readable by any other user (FRS-4.1.3)

#### Scenario: contentText is derived server-side, both stored together
- **WHEN** a note is created with `content` containing nested rich-text nodes
- **THEN** the backend derives `contentText` (plaintext) from `contentJson` and writes `contentJson` and `contentText` (on the note and on version 1) in the same operation

#### Scenario: Malformed content rejected
- **WHEN** an authenticated user POSTs a `content` value that is not a valid TipTap JSON document object (e.g. a string or array)
- **THEN** the system responds `400` with `{ error: { code: "VALIDATION_ERROR", fields: [{ field: "content", message: "…" }] } }` and no note or version is written

#### Scenario: Unauthenticated create rejected
- **WHEN** a request to `POST /api/notes` carries no valid access token
- **THEN** the auth middleware responds `401` and neither a note nor a version is created (FRS-9.2)

---

### Requirement: Update a note
The system SHALL allow an authenticated user to update the title, content, and/or tag associations of one of their own non-deleted notes. Each successful content update SHALL re-derive `contentText` and bump `updatedAt`. When `tagIds` is supplied it SHALL **replace** the note's entire tag set; only the caller's own tags may be attached. Updating a soft-deleted note SHALL be rejected until it is restored. A successful update SHALL capture a **new version** snapshot — recording the post-save title, content, and tag-id set — in the **same transaction**, **but only when the `title` or `content` actually changed**; an update that changes only `tagIds` (or changes nothing) SHALL NOT create a version (FRS-8.1 / clarification 1).

> `tagIds` uses full-replace set semantics: present replaces the set, `[]` detaches all, omitting it leaves associations unchanged. The version snapshot deferred from AB-1004 (FRS-4.3.2) is delivered here. After a version insert, the note's versions are auto-purged to the most-recent 50 (FRS-8.5, specified in `version-history`).

#### Scenario: Update title and content captures a new version
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with `{ title, content }` on an own active note whose latest version is 2
- **THEN** the system responds `200` with the updated `{ note }`, `updatedAt` is advanced, `contentText` is re-derived, and a new `NoteVersion` 3 is written (capturing the new title, content, and current `tagIds`) in the same transaction (FRS-8.1)

#### Scenario: Tag-only update does not create a version
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with only `{ tagIds: ["tagB"] }` (no title/content change)
- **THEN** the note's tag set is replaced with `tagB`, the response `tagIds` is `["tagB"]`, and **no new version is created** — the version count is unchanged (clarification 1)

#### Scenario: No-op update does not create a version
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with a `title` / `content` identical to the stored values (or an empty effective change)
- **THEN** no new version is created

#### Scenario: Update changing both content and tags creates one version
- **WHEN** an authenticated user PATCHes `{ content: <new doc>, tagIds: ["tagA"] }`
- **THEN** exactly one new version is created capturing the new content and `tagIds` `["tagA"]` (not two)

#### Scenario: Partial update leaves omitted fields unchanged
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with only `{ title }` (no `content`, no `tagIds`)
- **THEN** the title is updated, the existing `content` / `contentText` and existing tag associations are preserved, and a new version is created (title changed)

#### Scenario: Empty tagIds detaches all tags
- **WHEN** an authenticated user PATCHes `/api/notes/:id` with `{ tagIds: [] }`
- **THEN** all of the note's tag associations are removed, the response `tagIds` is `[]`, and (tag-only change) no new version is created

#### Scenario: Update with a foreign or unknown tag id rejected atomically
- **WHEN** an authenticated user PATCHes `tagIds` containing an id that does not exist or belongs to another user
- **THEN** the system responds `422` with `{ error: { code: "INVALID_TAG_IDS", … } }`, and neither the note's fields, its associations, nor its versions change

#### Scenario: Update a soft-deleted note rejected
- **WHEN** an authenticated user PATCHes `/api/notes/:id` for one of their own notes whose `deletedAt` is set
- **THEN** the system responds `422` with `{ error: { code: "NOTE_DELETED", … } }`, and no change and no version are written (FRS-4.3.3)

#### Scenario: Update a note owned by another user
- **WHEN** an authenticated user PATCHes `/api/notes/:id` for a note owned by a different user
- **THEN** the system responds `404` (no existence leak), not `403`, and no version is written

#### Scenario: Update a non-existent note
- **WHEN** an authenticated user PATCHes `/api/notes/:id` for an id that matches no note
- **THEN** the system responds `404`

#### Scenario: Malformed update body rejected
- **WHEN** an authenticated user PATCHes an invalid body (e.g. `content` that is not a TipTap document, or `tagIds` that is not an array of strings)
- **THEN** the system responds `400` with `fields[]` and no change or version is written
