# AB-1004 — Notes: CRUD + Soft Delete

## Why

AB-1002 and AB-1003 delivered authentication, so every request now carries a verified `userId` — but a user still has nothing to own. AB-1004 introduces the core domain object, the **Note**, giving an authenticated user the ability to create, read, update, soft-delete, and restore their own rich-text notes.

It is the foundation every later notes-domain ticket builds on: AB-1005 extends the list with sorting/filtering, AB-1006 attaches tag associations, AB-1007 indexes content for search, AB-1008 exposes notes through public share links, and AB-1009 snapshots every save into version history. None of those have a note to act on until AB-1004 lands.

## What Changes

**FRS coverage:** §4.1 (Create), §4.2 (Read), §4.3 (Update), §4.4 (Soft delete & recovery), plus the default slice of §4.5.1–4.5.2 (list + default sort).

**In scope:**
- `POST /api/notes` — create a note with an optional title and optional TipTap rich-text content; the note is owned by the creator and private. (FRS-4.1.1–4.1.3)
- `GET /api/notes/:id` — read one of the caller's own active notes by id. (FRS-4.2.1–4.2.2)
- `GET /api/notes` — **minimal** list of the caller's active notes: default sort last-updated descending, `page`/`limit` pagination clamped per SDS §5.2, response `{ data, page, limit, total }`. (FRS-4.5.1 + the default-sort half of FRS-4.5.2)
- `PATCH /api/notes/:id` — update the title and/or content of an own, non-deleted note. (FRS-4.3.1 title+content, FRS-4.3.3)
- `DELETE /api/notes/:id` — soft delete (set `deletedAt`; the row is never physically removed). (FRS-4.4.1)
- `POST /api/notes/:id/restore` — restore a soft-deleted note within the 30-day recovery window. (FRS-4.4.3, 4.4.5)
- `contentText` is derived server-side from `contentJson` on every write (consumed later by FTS); `contentJson` and `contentText` are always written together.
- New shared Zod schemas in `packages/shared/src/schemas/notes.ts` (create, update, list query, note response, list response) and their inferred types.

**Explicitly out of scope (deferred, with the ticket that owns each):**
- **Version snapshots on save** (FRS-4.1.4, FRS-4.3.2) and all version retention/history → **AB-1009**. AB-1004 mutates only the `Note` row; no `NoteVersion` rows are written.
- **`tagIds` attach/detach** on create/update and the "tag associations" clause of FRS-4.3.1 → **AB-1006**.
- **Full list query** — `sort`, `order`, multi-tag AND filter, `status=active|trashed` (FRS-4.5.2–4.5.4) → **AB-1005**. AB-1004 ships only the default active-notes list.
- **Background purge** of notes past the 30-day window (FRS-4.4.4) — a scheduled cron job, not a user endpoint and not owned by a feature ticket (ops concern; see SDS §10).
- The **search-results and tag-count halves of FRS-4.4.2** (exclude soft-deleted notes from search and from per-tag note counts) arrive with **AB-1007** and **AB-1006** respectively, since neither endpoint exists yet. AB-1004 implements only the default-**list** exclusion of FRS-4.4.2.
- Search, sharing, and the public read-only view — AB-1007 / AB-1008.

## Capabilities

### New Capabilities
- `note-crud`: Create, read (by id and a default list), update, soft-delete, and restore of a user's own private notes — with ownership isolation, the deleted-note action guard, and the 30-day recovery window.

### Modified Capabilities
_(none)_

## Impact

### API Delta (from SDS §6.3)

| Method | Path | Request | Success | Errors |
|--------|------|---------|---------|--------|
| POST | `/api/notes` | `{ title?, content? }` | 201 `{ note }` | 400 |
| GET | `/api/notes` | `?page&limit` (clamped) | 200 `{ data, page, limit, total }` | — |
| GET | `/api/notes/:id` | — | 200 `{ note }` | 404 |
| PATCH | `/api/notes/:id` | `{ title?, content? }` | 200 `{ note }` | 400, 404, 422 (note soft-deleted) |
| DELETE | `/api/notes/:id` | — | 204 | 404 |
| POST | `/api/notes/:id/restore` | — | 200 `{ note }` | 404, 422 (past 30d **or** not deleted) |

**Note response shape:** `{ id, title, content, createdAt, updatedAt }` — `content` is the TipTap JSON document; `contentText` is internal (derived for FTS) and is **not** returned.

**Deviations from the SDS §6.3 table (by design, clarified during spec):**
- `GET /api/notes` ships only the default active-list slice; the `sort` / `order` / `tags` / `status` query params shown in SDS §6.3 are **AB-1005**.
- `POST` / `PATCH` omit `tagIds` (→ AB-1006).
- `POST` / `PATCH` do **not** create version snapshots (→ AB-1009).
- `POST /:id/restore` adds a 422 for "note is not currently deleted" (nothing to restore) alongside the 422 for the elapsed 30-day window.

**422 error codes (via `ConflictError(code, message)`):**
- `NOTE_DELETED` — update (PATCH) of a soft-deleted note (FRS-4.3.3). Listed in SDS §5.1 as "update of a deleted note".
- `RESTORE_WINDOW_EXPIRED` — restore attempted past the 30-day window (FRS-4.4.3). Listed in SDS §5.1 as "restore past 30-day window".
- `NOTE_NOT_DELETED` — restore attempted on a note that is not soft-deleted. **SDS errata:** this sub-case is not enumerated in SDS §6.3 (which only lists `422 (past 30d)`) or §5.1. It is introduced by this spec as a necessary business-rule constraint. The SDS §6.3 restore row and §5.1 catalog MUST be updated to include this trigger when this change is synced to main specs.

### DB Changes

**None.** The `Note` table — with `deletedAt`, `contentJson`, `contentText`, and the `@@index([userId, deletedAt, updatedAt])` — was created by the AB-1001 init migration (`20260619140044_init`). No new migration, column, or index is required for AB-1004. The `search_vector` generated column remains an AB-1007 concern.

### Affected layers

| Layer | Change |
|-------|--------|
| `packages/shared` | New `schemas/notes.ts`: `CreateNoteSchema`, `UpdateNoteSchema`, `ListNotesQuerySchema`, `NoteResponseSchema`, `NoteListResponseSchema` + `z.infer` types |
| `backend/src/lib` | New `contentText`-derivation helper (walk TipTap JSON → plaintext) |
| `backend/src/repositories` | New `notes.repository.ts` — Prisma CRUD scoped by `userId`, soft-delete / restore, paginated active list + count |
| `backend/src/services` | New `notes.service.ts` — owns the FRS rules (ownership → 404, deleted-note guard → 422, 30-day window, `contentText` derivation, default sort, pagination clamp) |
| `backend/src/controllers` | New `notes.controller.ts` — `req`/`res` mapping, validation entry point |
| `backend/src/routes` | New `notes.routes.ts` — mounted behind the auth middleware |
| `backend/src/middleware` | Reuse `validate.middleware` for bodies; add a `validateQuery` path for the list query if not already present |
| `backend/src/app.ts` | Mount the `/api/notes` router (modified) |
| `backend/tests` | Unit tests (service rules) + Supertest integration tests asserting the exact status codes from SDS §5.1 |

### Key assumptions

- `contentText` is derived by the backend from `contentJson`; the client sends only `content` (TipTap JSON). Blank notes are valid (FRS-4.1.2): a missing `content` defaults to an empty TipTap doc and `contentText = ""`.
- A soft-deleted note is **not actionable** except via restore: `GET /:id`, `PATCH`, and `DELETE` on a deleted note return **404** (no existence leak); `DELETE` of an already-deleted note is therefore also 404.
- Every query is scoped to `req.userId`; a note owned by another user is indistinguishable from a missing note → **404, never 403** (FRS-4.2.2 / 9.1).
- All `/api/notes` routes sit behind the AB-1002 auth middleware → **401** on a missing/invalid/expired token (FRS-9.2).
- Pagination follows SDS §5.2: `page` default 1 / min 1, `limit` default 20 / min 1 / max 100, out-of-range values clamped (not rejected); `total` always reported.
