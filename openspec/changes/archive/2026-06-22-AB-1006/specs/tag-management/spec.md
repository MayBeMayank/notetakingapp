# Delta Spec — tag-management
**Change:** AB-1006
**FRS coverage:** §5.1–5.6 (FRS-5.1 user-scoped, FRS-5.2 create, FRS-5.3 case-insensitive uniqueness, FRS-5.4 rename/recolour/delete, FRS-5.5 delete keeps notes, FRS-5.6 per-tag active-note count); completes the **tag-count** half of FRS-4.4.2; cross-cutting §9.1–9.5
**SDS coverage:** §6.4 (tags contracts), §3 (Tag / NoteTag schema), §5.1 (status codes)

> FRS-5.7 (attach/detach tags on notes) is realized on the **notes** endpoints and is specified in the `note-crud` delta of this change. The `GET /api/notes?tags=` filter (FRS-4.5.3) is **AB-1005** and is not specified here.

---

## ADDED Requirements

### Requirement: Create a tag
The system SHALL allow an authenticated user to create a tag with a `name` and a hex `color`. The tag SHALL be owned by the caller and SHALL be private to them. The `name` SHALL be lower-cased before write, and a name that duplicates an existing tag of the same user (compared case-insensitively) SHALL be rejected.

#### Scenario: Create with name and colour
- **WHEN** an authenticated user POSTs `{ name: "Work", color: "#3B82F6" }` to `/api/tags`
- **THEN** the system responds `201` with `{ tag: { id, name: "work", color: "#3B82F6", createdAt, updatedAt } }`, the row's `userId` is the caller, and the stored `name` is lower-cased

#### Scenario: Name is lower-cased for uniqueness
- **WHEN** an authenticated user creates a tag named `"Work"` and later POSTs `{ name: "WORK", color: "#000000" }`
- **THEN** the second request responds `422` with `{ error: { code: "TAG_NAME_TAKEN", … } }` — names collide case-insensitively (FRS-5.3)

#### Scenario: Duplicate name for the same user rejected
- **WHEN** an authenticated user POSTs a `name` that already exists for that user
- **THEN** the system responds `422` with `{ error: { code: "TAG_NAME_TAKEN", … } }` and no second tag is created

#### Scenario: Same name allowed for a different user
- **WHEN** two different users each POST `{ name: "work", color: "#3B82F6" }`
- **THEN** both succeed `201` — uniqueness is scoped per user (FRS-5.1)

#### Scenario: Invalid colour rejected
- **WHEN** an authenticated user POSTs a `color` that is not a `#RRGGBB` hex value (e.g. `"blue"`, `"#FFF"`, `"3B82F6"`)
- **THEN** the system responds `400` with `{ error: { code: "VALIDATION_ERROR", fields: [{ field: "color", message: "…" }] } }`

#### Scenario: Missing name or colour rejected
- **WHEN** an authenticated user POSTs a body missing `name` or missing `color`
- **THEN** the system responds `400` with a `fields[]` entry for the missing field (both are required on create, FRS-5.2)

#### Scenario: Whitespace-only or empty name rejected
- **WHEN** an authenticated user POSTs `{ name: "   ", color: "#3B82F6" }`
- **THEN** the system responds `400` — the name is trimmed and must be 1–50 characters after trimming

#### Scenario: Unauthenticated create rejected
- **WHEN** a request to `POST /api/tags` carries no valid access token
- **THEN** the auth middleware responds `401` and no tag is created (FRS-9.2)

---

### Requirement: List tags with active-note count
The system SHALL allow an authenticated user to list their own tags. Each listed tag SHALL include `noteCount`, the number of that user's **active (non-deleted)** notes carrying the tag. The response SHALL be a bare array and SHALL contain only the caller's tags.

#### Scenario: List returns the caller's tags with note counts
- **WHEN** an authenticated user GETs `/api/tags`
- **THEN** the system responds `200` with an array `[ { id, name, color, createdAt, updatedAt, noteCount } ]` containing only that user's tags

#### Scenario: noteCount excludes soft-deleted notes
- **WHEN** a tag is attached to three of the user's notes and one of those notes is then soft-deleted
- **THEN** that tag's `noteCount` is `2` — soft-deleted notes are excluded from the count (FRS-5.6 / 4.4.2)

#### Scenario: noteCount is zero for an unused tag
- **WHEN** an authenticated user lists tags that include a tag attached to no active notes
- **THEN** that tag appears with `noteCount: 0`

#### Scenario: Other users' tags excluded
- **WHEN** an authenticated user GETs `/api/tags`
- **THEN** tags owned by other users never appear, and counts never include other users' notes (FRS-5.1 / 9.1)

#### Scenario: Empty list
- **WHEN** an authenticated user with no tags GETs `/api/tags`
- **THEN** the system responds `200` with `[]` (not an error)

#### Scenario: Unauthenticated list rejected
- **WHEN** a request to `GET /api/tags` carries no valid access token
- **THEN** the auth middleware responds `401`

---

### Requirement: Update a tag
The system SHALL allow an authenticated user to rename and/or recolour one of their own tags. A rename SHALL be lower-cased before write and SHALL be rejected if it collides (case-insensitively) with another of the user's tags. A request that changes neither field SHALL be rejected.

#### Scenario: Rename a tag
- **WHEN** an authenticated user PATCHes `/api/tags/:id` with `{ name: "Personal" }` on an own tag
- **THEN** the system responds `200` with `{ tag }` whose stored `name` is `"personal"` (FRS-5.4)

#### Scenario: Change a tag's colour
- **WHEN** an authenticated user PATCHes `/api/tags/:id` with `{ color: "#10B981" }`
- **THEN** the system responds `200` with the recoloured `{ tag }`

#### Scenario: Rename and recolour together
- **WHEN** an authenticated user PATCHes `/api/tags/:id` with both `{ name, color }`
- **THEN** both fields are updated and the system responds `200`

#### Scenario: Rename to a name owned by another of the user's tags rejected
- **WHEN** an authenticated user PATCHes `/api/tags/:id` with a `name` that already belongs to a **different** tag of theirs (case-insensitive)
- **THEN** the system responds `422` with `{ error: { code: "TAG_NAME_TAKEN", … } }` and the tag is unchanged (FRS-5.3)

#### Scenario: Renaming a tag to its own current name is allowed
- **WHEN** an authenticated user PATCHes `/api/tags/:id` with a `name` equal to the tag's own current name (including a case-only variant)
- **THEN** the system responds `200` — the collision check excludes the tag being updated

#### Scenario: Empty update body rejected
- **WHEN** an authenticated user PATCHes `/api/tags/:id` with `{}` (neither `name` nor `color`)
- **THEN** the system responds `400` — at least one of `name` or `color` must be provided

#### Scenario: Invalid colour or whitespace-only name rejected
- **WHEN** an authenticated user PATCHes `/api/tags/:id` with an invalid `color` or a whitespace-only `name`
- **THEN** the system responds `400` with `fields[]` and the tag is unchanged

#### Scenario: Update a tag owned by another user
- **WHEN** an authenticated user PATCHes `/api/tags/:id` for a tag owned by a different user, or for an id that matches no tag
- **THEN** the system responds `404` (no existence leak), not `403`

---

### Requirement: Delete a tag
The system SHALL allow an authenticated user to delete one of their own tags. Deleting a tag SHALL remove its association from all of the user's notes but SHALL NOT delete those notes.

#### Scenario: Delete an own tag
- **WHEN** an authenticated user DELETEs `/api/tags/:id` for an own tag
- **THEN** the system responds `204` and the tag no longer appears in `GET /api/tags`

#### Scenario: Associations removed, notes kept
- **WHEN** a tag attached to several notes is deleted
- **THEN** the corresponding `NoteTag` rows are removed (cascade) and every previously-tagged note still exists and is otherwise unchanged (FRS-5.5)

#### Scenario: Delete a tag owned by another user
- **WHEN** an authenticated user DELETEs `/api/tags/:id` for a tag owned by a different user, or for an id that matches no tag
- **THEN** the system responds `404` (no existence leak), and the other user's tag is untouched

#### Scenario: Unauthenticated delete rejected
- **WHEN** a request to `DELETE /api/tags/:id` carries no valid access token
- **THEN** the auth middleware responds `401`

---

### Requirement: Tag ownership isolation and authentication
Every `/api/tags` operation SHALL require a valid access token and SHALL be scoped to the authenticated user. No user SHALL be able to read or affect another user's tag, and the existence of another user's tag SHALL never be leaked.

#### Scenario: Missing or invalid token rejected on every tags route
- **WHEN** any request to `POST /api/tags`, `GET /api/tags`, `PATCH /api/tags/:id`, or `DELETE /api/tags/:id` carries a missing, malformed, or expired access token
- **THEN** the auth middleware responds `401` with `{ error: { code: "UNAUTHORIZED", … } }` and the handler is not reached (FRS-9.2)

#### Scenario: Every query is scoped to the caller
- **WHEN** any tag operation runs
- **THEN** the underlying repository query filters by `userId = req.userId`, so a tag belonging to another user is treated as absent (404) for update/delete (FRS-9.1)

#### Scenario: 404 response uses the standard error envelope
- **WHEN** a tags route returns a 404 (absent tag or not-owned tag)
- **THEN** the response body is `{ "error": { "code": "NOT_FOUND", "message": "…" } }` — no `fields` array, no internal detail, and no hint that the tag exists under a different user (FRS-9.5)
