# Delta Spec — prisma-schema (modified by AB-1009)
**Change:** AB-1009
**FRS coverage:** FRS-8.4 (restore brings back the exact tag set — clarification 3), FRS-8.5 (retention)
**SDS coverage:** §3 (data model — NoteVersion), §9 (version design)
**ADR:** ADR-003 (NoteVersion tag-id snapshot)

> This delta extends the `NoteVersion` model with a denormalized `tagIds` snapshot column so a restore can re-apply the exact tag set captured at a version. This is a deliberate extension beyond the SDS §3 `NoteVersion` definition (which models only title + content); the SDS SHOULD be synced to match when this change is applied. A new migration is required.

---

## MODIFIED Requirements

### Requirement: NoteVersion model
The schema SHALL define a `NoteVersion` model with fields `id` (cuid, PK),
`noteId` (FK → Note, cascade delete), `versionNumber` (Int), `title` (String),
`contentJson` (Json), `contentText` (String), `tagIds` (String array, default
empty) holding a denormalized snapshot of the tag ids associated with the note
at the moment the version was captured, and `createdAt`. A unique constraint on
`[noteId, versionNumber]` and an index on `[noteId, createdAt]` SHALL be present.
The `tagIds` snapshot is intentionally **not** foreign-key constrained so that it
survives later deletion of a tag (FRS-5.5).

#### Scenario: note-version table created
- **WHEN** the migrations are applied
- **THEN** the `NoteVersion` table exists with unique constraint on
  `[noteId, versionNumber]` and index on `[noteId, createdAt]`

#### Scenario: tagIds snapshot column present
- **WHEN** the AB-1009 migration is applied
- **THEN** the `NoteVersion` table has a `tagIds` text-array column that is `NOT NULL`
  and defaults to an empty array, and is not bound by a foreign key to `Tag`

#### Scenario: tag snapshot survives tag deletion
- **WHEN** a `Tag` referenced by a version's `tagIds` snapshot is later deleted
- **THEN** the version row and its `tagIds` array are unaffected (the deleted id simply
  no longer resolves to an existing tag on restore — clarification 3 / FRS-5.5)

#### Scenario: cascade delete from note removes versions
- **WHEN** a `Note` row is deleted
- **THEN** all associated `NoteVersion` rows are automatically deleted
