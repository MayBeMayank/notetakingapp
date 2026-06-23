# AB-1009 — Version history: snapshot, list, view, restore, auto-purge

## Why

AB-1004 gave a user full notes CRUD but **explicitly deferred version snapshots to this ticket** — its delta spec records that "the version snapshot of FRS-4.3.2 remains deferred to AB-1009," and FRS-4.1.4 (capture an initial version on create) was likewise left open. Today the `NoteVersion` table exists (created by the AB-1001 init migration) but **nothing ever writes a row to it**: create and update mutate only the `Note` row.

AB-1009 closes that gap and delivers the full version-history domain (FRS §8): every save snapshots the note, the owner can list and view past versions, and can **non-destructively restore** any version. It also enforces the **50-version retention cap** with auto-purge and guarantees version history is owner-private and never reachable through a share link. This is the contract the AB-1015 frontend "version history drawer + restore" consumes.

## What Changes

**FRS coverage:** §8.1 (snapshot on every save — closes the deferred FRS-4.1.4 / FRS-4.3.2), §8.2 (list in reverse chronological order), §8.3 (view a single version's full content), §8.4 (non-destructive restore — sets current + records a new version), §8.5 (retain most-recent 50 per note, auto-purge older, current always preserved), §8.6 (owner-private; never exposed via a share link). Cross-cutting §9.1 (ownership isolation), §9.2 (auth required), §9.5 (consistent error codes).

**In scope:**
- **Snapshot on save (retrofit into note-crud):**
  - **Create** (`POST /api/notes`) writes the note's **initial version** (`versionNumber = 1`) in the *same transaction* as the note insert. (FRS-8.1 / closes FRS-4.1.4)
  - **Update** (`PATCH /api/notes/:id`) writes a **new version** in the same transaction — **only when `title` or `content` actually changes** (per clarification). A PATCH that changes only `tagIds`, or is a no-op, does **not** create a version. (FRS-8.1 / closes FRS-4.3.2)
  - Each version captures the **post-save** `title`, `contentJson`, `contentText`, **and a snapshot of the note's current `tagIds`** (see clarification 3) at that save.
- **List versions** — `GET /api/notes/:id/versions` → `200` bare array `[ { id, versionNumber, title, createdAt } ]`, **reverse chronological** (newest first). (FRS-8.2)
- **View a version** — `GET /api/notes/:id/versions/:versionId` → `200 { version }` including full `content` and the version's `tagIds`. (FRS-8.3)
- **Restore a version** — `POST /api/notes/:id/versions/:versionId/restore` → `200 { note }`. Copies the chosen version's `title` / `content` onto the note, re-applies the version's tag snapshot (filtered to tags that still exist and are owned by the caller), and records the result as a **new** version. History is append-only. (FRS-8.4)
- **Retention / auto-purge** — after every version insert, rows beyond the most-recent 50 for that note are deleted. `versionNumber` is monotonic per note and never reused (gaps may appear after purge). Current note content lives on the `Note` row and is never affected by purge. (FRS-8.5)
- **Ownership / privacy** — every version endpoint sits behind the auth middleware and is scoped to the caller; a version of a note the caller does not own (or that does not exist) → `404` (no existence leak). No unauthenticated route exposes any version. (FRS-8.6 / 9.1 / 9.2)
- New shared Zod schemas in `packages/shared/src/schemas/versions.ts` (version list item, version detail) + `z.infer` types.
- **Schema extension:** `NoteVersion` gains a `tagIds String[]` snapshot column (new migration) — required to satisfy clarification 3 (restore brings back the exact tag set).

**Explicitly out of scope (owned elsewhere):**
- The **public share view** that must never expose version history (FRS-8.6 enforcement on the public route) → **AB-1008**. That router is not yet mounted on this branch; AB-1009 asserts the privacy requirement and adds no public route, but the share endpoint that must honour it is AB-1008's. See *Key assumptions*.
- **Background purge of soft-deleted notes** past the 30-day window (FRS-4.4.4) → unchanged, not part of this ticket. (Version retention here is the per-note 50-cap purge, a different concern.)
- **Frontend** version drawer + restore UI → **AB-1015**.
- **Tag resurrection** — a tag captured in a version that has since been deleted cannot be recreated on restore (see clarification 3 / *Key assumptions*).

## Capabilities

### New Capabilities
- `version-history`: List, view, and non-destructively restore a note's versions, with 50-version retention/auto-purge and owner-only privacy.

### Modified Capabilities
- `note-crud`: Note **create** and **update** now write a version snapshot in the same transaction — create always (v1); update only when `title`/`content` changes. Each snapshot also captures the note's current `tagIds`.
- `prisma-schema`: The `NoteVersion` model gains a denormalized `tagIds String[]` snapshot column (new migration), so a restore can reapply the exact tag set captured at that version.

## Impact

### API Delta (new — Version history, SDS §6.7)

Mounted at `/api/notes/:id/versions` (behind auth):

| Method | Path | Request | Success | Errors |
|--------|------|---------|---------|--------|
| GET | `/api/notes/:id/versions` | — | `200` `[ { id, versionNumber, title, createdAt } ]` (reverse chrono, bare array) | 404 |
| GET | `/api/notes/:id/versions/:versionId` | — | `200` `{ version: { id, versionNumber, title, content, tagIds, createdAt } }` | 404 |
| POST | `/api/notes/:id/versions/:versionId/restore` | — | `200` `{ note }` (current set; new version appended) | 404, 422 (`NOTE_DELETED` \| `VERSION_ALREADY_CURRENT`) |

**Modified — Notes (SDS §6.3), behaviour only (no contract shape change):**

| Method | Path | Behaviour added |
|--------|------|-----------------|
| POST | `/api/notes` | Now also inserts `NoteVersion` #1 (title, content, tagIds) atomically with the note. |
| PATCH | `/api/notes/:id` | Now also inserts a new `NoteVersion` atomically **when title/content changed**; tag-only / no-op edits insert none. |

**Deviations from / additions to the SDS (clarified during this spec — flagged for review):**
- **`NoteVersion.tagIds` snapshot** — SDS §3 / §6.7 / §9 model `NoteVersion` with only `title` + `content`. Per clarification 3 (restore must bring back the exact tag set), this spec **adds a `tagIds String[]` column** and a migration. SDS §3 (NoteVersion model), §6.7 (version detail shape), and §9 (version design) SHOULD be updated to reflect the tag snapshot when this change is synced to main specs. **Recorded in `docs/decisions/ADR-003-note-version-tag-snapshot.md`.**
- **Reads allowed on a soft-deleted note** — FRS-4.4.5 says a deleted note may not be read. Per clarification 2, **version list and view are permitted on a soft-deleted (trashed) note** the caller owns (to preview history before recovering); only **restore** is blocked (`422 NOTE_DELETED`). This is a deliberate, owner-only refinement of FRS-4.4.5 scoped to version reads. **Recorded in `docs/decisions/ADR-004-version-reads-on-soft-deleted-notes.md`.**
- **No-op restore rejected** — per clarification 4, restoring the note's **most-recent version** (highest `versionNumber`, identical title/content to current) is rejected `422 VERSION_ALREADY_CURRENT` rather than appending a duplicate.
- **Error codes** — SDS §5.1 enumerates the 422 *conditions* but not code strings; this spec introduces `VERSION_ALREADY_CURRENT` and reuses the existing `NOTE_DELETED`, both via `ConflictError(code, message)` → 422.
- **List is a bare array, not paginated** — per SDS §6.7 the list returns `[ … ]` (no `{ data, page, limit, total }` envelope). It is bounded by the 50-version retention cap, so pagination is unnecessary.

### DB Changes

A **new migration** adds one column:

```sql
ALTER TABLE "NoteVersion" ADD COLUMN "tagIds" TEXT[] NOT NULL DEFAULT '{}';
```

Prisma model change: `NoteVersion` gains `tagIds String[] @default([])`. The column is a **denormalized snapshot** (an array of tag-id strings), intentionally **not** FK-constrained — so the snapshot survives later deletion of a tag (FRS-5.5). No other table, column, or index changes. The `@@unique([noteId, versionNumber])` and `@@index([noteId, createdAt])` already present are sufficient for monotonic numbering and reverse-chronological listing.

### Affected layers

| Layer | Change |
|-------|--------|
| `backend/src/prisma` | Add `tagIds String[] @default([])` to `NoteVersion`; new migration (`prisma migrate dev` — **ask before running**). |
| `packages/shared` | New `schemas/versions.ts`: `VersionListItemSchema`, `VersionListResponseSchema`, `VersionDetailSchema` (+ `z.infer` types); re-export from `schemas/index.ts`. Restore response reuses the existing `NoteResponseSchema`. |
| `backend/src/repositories` | New `versions.repository.ts` — Prisma ops scoped via the parent note: next `versionNumber`, insert version, list (reverse chrono), find version-by-id within a note, purge-beyond-50. Extend `notes.repository.ts` so create/update write the note **and** its version inside one `prisma.$transaction`. |
| `backend/src/services` | New `versions.service.ts` — owns FRS rules: ownership/trashed resolution, restore (apply title/content + surviving tag set, append new version, purge), no-op (`VERSION_ALREADY_CURRENT`) and trashed (`NOTE_DELETED`) guards. Extend `notes.service.ts` to compute the initial/next version and the title/content-changed check that gates update snapshots. |
| `backend/src/controllers` | New `versions.controller.ts` (list / get / restore). |
| `backend/src/routes` | New `versions.routes.ts` mounted under `notesRouter` at `/:id/versions` (or a router with `mergeParams`), behind the existing auth middleware. |
| `backend/src/app.ts` | Wire the versions sub-router (modified). |
| `backend/tests` | Unit (version numbering, retention 50-cap purge, restore non-destructive + tag re-apply + surviving-tag filter, no-op + trashed guards) + Supertest integration asserting exact SDS §5.1 codes (200/404/422). |

### Key assumptions

- **Snapshot timing & content.** A version captures the **post-save** state. Create writes `versionNumber = 1`; update writes `max(versionNumber) + 1` only when `title` or `contentJson` differs from the stored note. Because tag-only edits don't snapshot (clarification 1), a version's `tagIds` reflect the note's associations **as of that title/content save** (or restore).
- **Atomicity.** The note write and its version insert happen in a single `prisma.$transaction`; if either fails, neither is persisted.
- **Restore is non-destructive (FRS-8.4).** The chosen version row is never modified or deleted; restore appends a brand-new version capturing the restored title/content + the applied tag set.
- **Restore + deleted tags.** Restore re-attaches only tag ids in the snapshot that **still exist and are owned by the caller**; ids for tags deleted since are silently dropped (a deleted tag cannot be resurrected — FRS-5.5). The new version records the **applied** (surviving) tag set, so history stays truthful.
- **Trashed note (clarification 2).** Version **list / view** resolve the parent note by id scoped to the caller **regardless of `deletedAt`** → `404` only when no such note exists for the caller. **Restore** additionally requires `deletedAt IS NULL` → `422 NOTE_DELETED` otherwise.
- **No-op restore (clarification 4).** Restoring the note's most-recent version (highest `versionNumber`) → `422 VERSION_ALREADY_CURRENT`.
- **Retention (FRS-8.5).** After each insert, versions beyond the most-recent 50 (`ORDER BY versionNumber DESC OFFSET 50`) are deleted in the same transaction. `versionNumber` is never reused, so gaps are expected after purge. Current content on `Note` is unaffected.
- **Privacy (FRS-8.6).** Every version route is behind auth and ownership-scoped (`404`, never `403`, for non-owned/unknown). AB-1009 adds **no** public route. The public share endpoint that must also omit versions is **AB-1008** (not yet mounted on this branch) — the requirement is asserted here for traceability and verified when sharing lands.
- **Versions follow notes on cascade.** `NoteVersion.note` already cascades on delete, so a future hard-purge of a note removes its versions automatically (unchanged).
