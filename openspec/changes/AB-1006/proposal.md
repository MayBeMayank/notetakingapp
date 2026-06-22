# AB-1006 — Tags: CRUD + per-tag note count + note associations

## Why

AB-1004 gave a user notes to own and AB-1005 made the note list sortable and tag-filterable, but the **tags themselves cannot yet be created or managed**, and notes still cannot carry tags. AB-1004 explicitly deferred two things to this ticket:

1. The `tagIds` attach/detach clause of FRS-4.3.1 / FRS-5.7 on note create and update.
2. The **tag-count** half of FRS-4.4.2 (per-tag counts must exclude soft-deleted notes).

AB-1006 closes both. It introduces the **Tag** as a first-class, user-scoped domain object — create, list (with a live per-tag note count), rename, recolour, and delete — and wires tag associations into the existing notes endpoints so a user can attach and detach their own tags on their own notes. This is the contract AB-1005's tag filter and the AB-1011/AB-1013 frontend depend on.

## What Changes

**FRS coverage:** §5.1 (user-scoped), §5.2 (create with name + hex colour), §5.3 (case-insensitive per-user uniqueness), §5.4 (rename / recolour / delete), §5.5 (delete removes associations, keeps notes), §5.6 (list with active-note count), §5.7 (attach/detach own tags on own notes). Also completes the **tag-count** half of FRS-4.4.2. Cross-cutting §9.1–9.5.

**In scope:**
- `POST /api/tags` — create a tag with `name` + hex `color`; user-scoped; duplicate name (case-insensitive) → 422. (FRS-5.1–5.3)
- `GET /api/tags` — list the caller's tags, each carrying `noteCount` = the count of that user's **active (non-deleted)** notes carrying the tag. (FRS-5.6, 4.4.2)
- `PATCH /api/tags/:id` — rename and/or recolour an own tag; rename collision → 422. (FRS-5.4, 5.3)
- `DELETE /api/tags/:id` — delete an own tag; its `NoteTag` associations are removed (DB cascade) but the notes are untouched. (FRS-5.4, 5.5)
- **Tag associations on notes (FRS-5.7):** `POST` / `PATCH /api/notes` accept an optional `tagIds: string[]`. `tagIds` uses **full-replace set semantics** — present replaces the note's entire tag set, `[]` detaches all, omitting it leaves associations unchanged. Only the caller's own tags may be attached; any unknown or foreign id rejects the whole request atomically with **422 `INVALID_TAG_IDS`** (no partial application).
- **Note response gains `tagIds: string[]`** — every note response (create / read / list / update / restore) now reports the note's current tag-id associations.
- New shared Zod schemas in `packages/shared/src/schemas/tags.ts` (create, update, tag response, tag-with-count response) plus a `tagIds` field added to the notes request/response schemas.

**Explicitly out of scope (owned elsewhere):**
- The **list tag-filter** (`GET /api/notes?tags=a,b`, OR semantics, FRS-4.5.3) → **AB-1005**. AB-1006 supplies the associations the filter reads but does not implement the filter query.
- **Full-text search**, **sharing**, **version history** → AB-1007 / AB-1008 / AB-1009. Tags are never exposed through a public share link (FRS-7.8) — enforced when sharing lands.
- **Tag colour as a display concern** on the frontend → AB-1011 / AB-1013.
- A separate display-name field: per SDS §3, v1 stores the **normalized lower-cased** name and returns it as-is.

## Capabilities

### New Capabilities
- `tag-management`: Create, list (with per-tag active-note count), rename, recolour, and delete a user's own tags, with case-insensitive per-user name uniqueness and ownership isolation.

### Modified Capabilities
- `note-crud`: Note create and update additionally accept `tagIds` (full-replace, owner-only → 422 on foreign ids), and every note response now includes the note's current `tagIds`.

## Impact

### API Delta

**New — Tags (SDS §6.4):**

| Method | Path | Request | Success | Errors |
|--------|------|---------|---------|--------|
| POST | `/api/tags` | `{ name, color }` | 201 `{ tag }` | 400, 422 (`TAG_NAME_TAKEN`) |
| GET | `/api/tags` | — | 200 `[ { id, name, color, createdAt, updatedAt, noteCount } ]` | — |
| PATCH | `/api/tags/:id` | `{ name?, color? }` (≥1 required) | 200 `{ tag }` | 400, 404, 422 (`TAG_NAME_TAKEN`) |
| DELETE | `/api/tags/:id` | — | 204 | 404 |

- **Tag response shape:** `{ id, name, color, createdAt, updatedAt }`. `noteCount` is added **only on the list endpoint** (`GET /api/tags`), matching SDS §6.4; single-tag responses (POST/PATCH) omit it.
- `GET /api/tags` returns a **bare array**, not the `{ data, page, limit, total }` envelope — tags are not paginated (SDS §6.4).
- `name` is lower-cased before write; uniqueness is enforced by the existing `@@unique([userId, name])` constraint (P2002 → 422).

**Modified — Notes (SDS §6.3):**

| Method | Path | Request | Success | Errors |
|--------|------|---------|---------|--------|
| POST | `/api/notes` | `{ title?, content?, tagIds? }` | 201 `{ note }` (now incl. `tagIds`) | 400, 422 (`INVALID_TAG_IDS`) |
| PATCH | `/api/notes/:id` | `{ title?, content?, tagIds? }` | 200 `{ note }` (now incl. `tagIds`) | 400, 404, 422 (`NOTE_DELETED` \| `INVALID_TAG_IDS`) |
| GET | `/api/notes`, `/api/notes/:id` | — | 200 — note objects now include `tagIds` | (unchanged) |

**Deviations from / additions to the SDS (clarified during spec):**
- **`tagIds` in the note response** — SDS §6.3's note shape (`{ id, title, content, createdAt, updatedAt }`) does not list `tagIds`. This spec adds it; SDS §6.3 SHOULD be updated to include `tagIds` when this change is synced to main specs.
- **`tagIds` write semantics** — SDS §6.3 says associations are "set by passing `tagIds` on create/update"; this spec hardens that to **full-replace set semantics** (`[]` = detach all, omitted = unchanged).
- **Error codes** — SDS §5.1 enumerates the *conditions* (duplicate tag name; foreign tag) as 422 but not the code strings. This spec introduces `TAG_NAME_TAKEN` (duplicate tag name) and `INVALID_TAG_IDS` (unknown/foreign tag id on a note write), both surfaced via `ConflictError(code, message)` → 422.
- **PATCH with empty body** — `PATCH /api/tags/:id` with neither `name` nor `color` → 400 (nothing to update), mirroring the existing `UpdateNoteSchema` refinement.

### DB Changes

**None.** The `Tag` (`@@unique([userId, name])`) and `NoteTag` (composite PK `[noteId, tagId]`, `@@index([tagId])`, cascade delete from both `Note` and `Tag`) models were created by the AB-1001 init migration. FRS-5.5 (delete a tag → associations removed, notes kept) is satisfied by the existing `onDelete: Cascade` on `NoteTag.tag`. No new migration, column, or index is required.

### Affected layers

| Layer | Change |
|-------|--------|
| `packages/shared` | New `schemas/tags.ts`: `CreateTagSchema`, `UpdateTagSchema`, `TagResponseSchema`, `TagWithCountSchema`, `TagListResponseSchema` + `z.infer` types. Add `tagIds` to `CreateNoteSchema` / `UpdateNoteSchema` and to `NoteResponseSchema`. |
| `backend/src/repositories` | New `tags.repository.ts` — Prisma CRUD scoped by `userId`, list with active-note count, association set/replace. Extend `notes.repository.ts` to read/write `NoteTag` rows and include `tagIds` on note reads. |
| `backend/src/services` | New `tags.service.ts` — owns FRS rules (lower-casing, dup → 422, ownership → 404, noteCount excludes soft-deleted). Extend `notes.service.ts` — validate `tagIds` ownership (foreign → 422 atomic), apply full-replace, surface `tagIds` in `toNoteResponse`. |
| `backend/src/controllers` | New `tags.controller.ts`. Reuse the existing notes controller for the extended note schemas. |
| `backend/src/routes` | New `tags.routes.ts` behind auth middleware. |
| `backend/src/app.ts` | Mount the `/api/tags` router (modified). |
| `backend/tests` | Unit tests (tag rules: lower-case dedup, dup → 422, noteCount excludes deleted, foreign-tag rejection, full-replace semantics) + Supertest integration tests asserting exact SDS §5.1 codes. |

### Key assumptions

- Tags are stored and returned **lower-cased** (SDS §3, v1 normalized); the client is responsible for any display casing.
- `color` is validated as `#RRGGBB` (6 hex digits, `#` required, case-insensitive) and is **required** on create; on `PATCH` it is optional.
- `name` is trimmed, must be 1–50 characters after trimming, and a whitespace-only name is rejected with 400.
- `tagIds` is de-duplicated before application; attaching a tag a note already carries is idempotent.
- Foreign/unknown tag ids on a note write are rejected **atomically** — the note is not created/updated and no associations change (422 `INVALID_TAG_IDS`).
- Every `/api/tags` route sits behind the AB-1002 auth middleware → 401 on a missing/invalid/expired token; a tag owned by another user is indistinguishable from a missing tag → 404, never 403 (FRS-9.1).
- `noteCount` counts only the owner's notes whose `deletedAt IS NULL` (FRS-5.6 / 4.4.2).
