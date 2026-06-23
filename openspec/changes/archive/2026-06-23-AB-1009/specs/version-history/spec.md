# Delta Spec — version-history (new, AB-1009)
**Change:** AB-1009
**FRS coverage:** §8.2 (list reverse-chrono), §8.3 (view single version), §8.4 (non-destructive restore), §8.5 (retain 50 / auto-purge), §8.6 (owner-private, never via share); cross-cutting §9.1 (ownership), §9.2 (auth), §9.5 (consistent errors)
**SDS coverage:** §6.7 (version contracts), §9 (version design), §5.1 (status codes)
**ADRs:** ADR-003 (tag-id snapshot in versions / restore), ADR-004 (version reads allowed on a soft-deleted note; restore blocked)

> This is a new capability. The **snapshot-on-save** behaviour that produces these versions lives in the `note-crud` delta (create writes v1; update writes a version on title/content change). The version-detail `tagIds` snapshot relies on the `prisma-schema` delta that adds `NoteVersion.tagIds`.

---

## ADDED Requirements

### Requirement: List a note's versions
The system SHALL allow an authenticated user to list all versions of one of their own notes, returned as a bare array in **reverse chronological order** (most recent first). Each item SHALL carry `id`, `versionNumber`, `title`, and `createdAt`, and SHALL NOT include the version's content. The note SHALL be resolved scoped to the caller regardless of its `deletedAt` state.

#### Scenario: List versions of an own note newest-first
- **WHEN** an authenticated user GETs `/api/notes/:id/versions` for an own note that has versions 1, 2, and 3
- **THEN** the system responds `200` with a bare array `[ { id, versionNumber, title, createdAt }, … ]` ordered version 3, 2, 1 (reverse chronological) and each item omits `content`

#### Scenario: A freshly created note has exactly one version
- **WHEN** an authenticated user creates a note and then GETs its `/versions`
- **THEN** the response is a one-element array containing `versionNumber` 1 (the initial snapshot captured on create, FRS-8.1)

#### Scenario: Listing is not paginated
- **WHEN** an authenticated user GETs `/api/notes/:id/versions`
- **THEN** the response body is a bare JSON array (no `{ data, page, limit, total }` envelope), bounded by the 50-version retention cap

#### Scenario: List versions of a soft-deleted (trashed) note is allowed
- **WHEN** an authenticated user GETs `/api/notes/:id/versions` for an own note whose `deletedAt` is set
- **THEN** the system responds `200` with the note's version list (history may be previewed before recovery — clarification 2), even though `GET /api/notes/:id` would return `404` for the same note

#### Scenario: List versions of a note owned by another user
- **WHEN** an authenticated user GETs `/api/notes/:id/versions` for a note owned by a different user
- **THEN** the system responds `404` (no existence leak, FRS-9.1), not `403`

#### Scenario: List versions of a non-existent note
- **WHEN** an authenticated user GETs `/api/notes/:id/versions` for an id that matches no note
- **THEN** the system responds `404`

#### Scenario: Unauthenticated list rejected
- **WHEN** a request to `GET /api/notes/:id/versions` carries no valid access token
- **THEN** the auth middleware responds `401` and no data is returned (FRS-9.2)

---

### Requirement: View a single version
The system SHALL allow an authenticated user to view the full content of any single version of one of their own notes, returning `id`, `versionNumber`, `title`, the full `content` (TipTap document), the version's `tagIds` snapshot, and `createdAt`. The version SHALL belong to the addressed note; otherwise the request SHALL be rejected `404`.

#### Scenario: View an own version's full content
- **WHEN** an authenticated user GETs `/api/notes/:id/versions/:versionId` for a version of an own note
- **THEN** the system responds `200` with `{ version: { id, versionNumber, title, content, tagIds, createdAt } }`, where `content` is the version's full TipTap document and `tagIds` is the tag set captured at that version

#### Scenario: View a version of a trashed note is allowed
- **WHEN** an authenticated user GETs `/api/notes/:id/versions/:versionId` for an own note whose `deletedAt` is set
- **THEN** the system responds `200` with the version (read allowed on trashed notes — clarification 2)

#### Scenario: View a version that does not belong to the addressed note
- **WHEN** an authenticated user GETs `/api/notes/:id/versions/:versionId` where `:versionId` exists but belongs to a different note
- **THEN** the system responds `404` — the version is not addressable through a note that does not own it

#### Scenario: View a version of a note owned by another user
- **WHEN** an authenticated user GETs `/api/notes/:id/versions/:versionId` for a note owned by a different user
- **THEN** the system responds `404` (no existence leak), not `403`

#### Scenario: View a non-existent version
- **WHEN** an authenticated user GETs `/api/notes/:id/versions/:versionId` for a `:versionId` that matches no version of the note
- **THEN** the system responds `404`

---

### Requirement: Restore a version (non-destructive)
The system SHALL allow an authenticated user to restore any version of one of their own active notes. Restore SHALL set the note's current `title` and `content` to the chosen version, re-apply the version's `tagIds` snapshot (limited to tags that still exist and are owned by the caller), and record the result as a **new** version. History SHALL never be rewritten or deleted by a restore. Restore SHALL be rejected on a soft-deleted note and SHALL be rejected when the chosen version is already the note's most-recent version.

#### Scenario: Restore an earlier version sets current and appends a new version
- **WHEN** an authenticated user POSTs `/api/notes/:id/versions/:versionId/restore` for version 1 of an own note whose latest version is 3
- **THEN** the system responds `200` with `{ note }` whose `title` / `content` now equal version 1, and a **new** version 4 is created capturing the restored state; versions 1, 2, and 3 are left unchanged (FRS-8.4)

#### Scenario: Restore re-applies the version's tag snapshot
- **WHEN** an authenticated user restores a version whose `tagIds` snapshot was `["tagA", "tagB"]`, and both tags still exist and are owned by the caller
- **THEN** the note's tag associations are set to exactly `tagA` and `tagB` (full-replace), and the new version records `tagIds` `["tagA", "tagB"]`

#### Scenario: Restore drops tags that have since been deleted
- **WHEN** an authenticated user restores a version whose `tagIds` snapshot was `["tagA", "tagB"]` but `tagB` has since been deleted
- **THEN** the note is re-associated with `tagA` only (the surviving owned tag), `tagB` is silently dropped (a deleted tag cannot be resurrected, FRS-5.5), and the new version records `tagIds` `["tagA"]`

#### Scenario: Restore is non-destructive — history is append-only
- **WHEN** any version is restored
- **THEN** the chosen version row is neither modified nor deleted, and the restore is recorded as a brand-new version with the next `versionNumber` (FRS-8.4)

#### Scenario: Restore the most-recent version rejected as a no-op
- **WHEN** an authenticated user POSTs restore for the version whose `versionNumber` is the highest for that note (identical to the note's current content)
- **THEN** the system responds `422` with `{ error: { code: "VERSION_ALREADY_CURRENT", … } }` and no new version is created (clarification 4)

#### Scenario: Restore on a soft-deleted note rejected
- **WHEN** an authenticated user POSTs restore for a version of an own note whose `deletedAt` is set
- **THEN** the system responds `422` with `{ error: { code: "NOTE_DELETED", … } }` — the note must be restored to active state first (clarification 2)

#### Scenario: Restored version triggers retention purge
- **WHEN** a restore appends a new version to a note that already holds 50 versions
- **THEN** the oldest version (lowest `versionNumber`) is purged so at most 50 remain, and the restored content on the `Note` row is unaffected (FRS-8.5)

#### Scenario: Restore a version of a note owned by another user
- **WHEN** an authenticated user POSTs restore for a note owned by a different user
- **THEN** the system responds `404` (no existence leak), not `403`

#### Scenario: Restore a version that does not belong to the note / does not exist
- **WHEN** an authenticated user POSTs restore for a `:versionId` that matches no version of the addressed note (unknown, or belonging to another note)
- **THEN** the system responds `404` and the note is unchanged

---

### Requirement: Version retention and auto-purge
The system SHALL retain at most the most-recent **50** versions per note. After each version insert, versions beyond the most-recent 50 SHALL be auto-purged. `versionNumber` SHALL be monotonically increasing per note and SHALL never be reused; the note's current content (on the `Note` row) SHALL always be preserved regardless of purge.

#### Scenario: Versions beyond 50 are purged oldest-first
- **WHEN** a note that already holds 50 versions receives a save that creates version 51
- **THEN** the version with the lowest `versionNumber` is deleted so exactly 50 remain, and the listing's newest entries are unaffected (FRS-8.5)

#### Scenario: Version numbers are monotonic and may have gaps after purge
- **WHEN** versions have been purged (e.g. versions 1–10 removed) and a new save occurs
- **THEN** the new version takes `max(versionNumber) + 1` (never a reused number), so the retained set may be a contiguous-or-gapped run ending at the latest number

#### Scenario: Current content survives purge
- **WHEN** purge removes old versions
- **THEN** the `Note` row's current `title` / `contentJson` / `contentText` are untouched — purge only deletes `NoteVersion` rows (FRS-8.5)

---

### Requirement: Version history is private to the owner
Version history SHALL be accessible only to the note's owner through authenticated, ownership-scoped routes, and SHALL NOT be exposed through any unauthenticated or public route. The capability SHALL introduce no public endpoint that returns versions.

#### Scenario: All version routes require authentication
- **WHEN** any version route (`list`, `view`, `restore`) is called without a valid access token
- **THEN** the auth middleware responds `401` (FRS-9.2)

#### Scenario: Versions are never returned by a public share route
- **WHEN** the public share view of a note is served (the share endpoint owned by AB-1008)
- **THEN** it returns only the note's current `title` and `content` and SHALL NOT include any version, version list, or version metadata (FRS-8.6 / 7.8) — and AB-1009 adds no public route that would expose them

#### Scenario: A non-owner cannot reach another user's versions
- **WHEN** an authenticated user targets any version route for a note they do not own
- **THEN** the system responds `404` (no existence leak), never `403` and never the version data (FRS-9.1)
