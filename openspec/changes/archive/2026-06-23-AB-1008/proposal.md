# AB-1008 — Sharing: public share links, revoke, public read-only view, atomic view count

## Why

Every note in the system is **private by default** — AB-1004 made notes owner-only, and AB-1002's auth middleware guards every existing route. There is, as yet, **no way for a user to let anyone else read a note**. AB-1008 adds the one sanctioned escape hatch: an explicit, owner-minted, **revocable public share link** that exposes a single note's current title and content read-only, with no authentication and no edit controls.

This is the backend contract the **AB-1014 frontend share modal** consumes (share button → mint link → copy `/s/<token>` → list active links → revoke). It is deliberately narrow: sharing exposes *only* a note's current title and content — never its tags, version history, owner identity, or any other note (FRS-7.8). The `ShareLink` model already exists in the schema (AB-1001 init migration), so this ticket is purely the API + business-rule layer on top of it.

## What Changes

**FRS coverage (§7 Sharing):** §7.1 (generate a public read-only link for an own active note), §7.2 (unguessable token + optional expiry; after expiry inaccessible), §7.3 (public viewer sees current title + content, read-only, no auth, no edit controls), §7.4 (atomic view-count increment per successful view), §7.5 (revoke → immediately inaccessible), §7.6 (underlying note soft-deleted → all its links inaccessible; and create-side: cannot share a deleted note), §7.7 (list active links with expiry + view count), §7.8 (never leak tags / version history / owner identity / any other note). Cross-cutting §9.1 (ownership isolation), §9.2 (auth required on owner routes; public route exempt), §9.3 (validation), §9.4 (no secret leakage), §9.5 (consistent error envelope + binding codes).

**In scope:**
- `POST /api/notes/:id/shares` — mint a **new** public share link for one of the caller's **own active** notes. Body `{ expiresAt? }`. Each call mints an independent token, so a note may carry **many active links at once** (clarification 1). Returns `201 { share }`. Note not found / not owned → **404** (no existence leak). Note soft-deleted → **422 `NOTE_DELETED`** (FRS-7.6, create side). (FRS-7.1, 7.2)
- `GET /api/shares` — list **all** of the caller's share links across **all their own notes**. "Active" excludes **revoked links only** (`revokedAt IS NULL`): an expired-but-not-revoked link IS still listed (with its `expiresAt` + `viewCount`) so the user can see and clean it up (clarification 3), and a link whose underlying note is **soft-deleted is also still listed** — the list filters on `revokedAt` only, never on the note's `deletedAt`, so the link resumes public viewing if its note is later restored (clarification 5). Bare array, no pagination envelope, ordered `createdAt` **descending** (newest first) (clarification 6). (FRS-7.7)
- `DELETE /api/shares/:id` — revoke one of the caller's own share links by setting `revokedAt`; the link is immediately inaccessible to public viewers. Returns `204`. Share not found / not owned → **404**. (FRS-7.5)
- `GET /api/public/notes/:token` — **no auth**. Resolve the token and return `200 { title, content }` (content = the note's current `contentJson`, a TipTap JSON document). On a **successful 200 only**, atomically increment `viewCount` via Prisma `{ increment: 1 }`. Unknown token → **404**; revoked / past `expiresAt` / underlying note soft-deleted → **410**. Payload is **minimal** — no id, owner, tags, versions, timestamps, or any other note (FRS-7.3, 7.4, 7.6, 7.8).
- **`expiresAt` rule (clarification 2):** `null` or omitted = **no expiry** (link never expires). If provided it MUST be a **future** datetime; a past-or-present `expiresAt` is rejected at create time with **400 `VALIDATION_ERROR` + `fields[]`**.
- **Share `url` field (clarification 4):** a **relative path string** `"/s/<token>"`. No absolute base URL, no new env var.
- New shared Zod schemas in `packages/shared/src/schemas/shares.ts` (create-share request, share response, share-list response, public-view response).

**Explicitly out of scope (owned elsewhere):**
- **Version history** (snapshot / list / view / restore / purge) → **AB-1009**. A share link never exposes version history (FRS-7.8 / 8.6) — enforced here by the minimal public payload.
- **Exposing tags, versions, or owner identity** through a share link — these are deliberately **never** present in the public response (FRS-7.8); there is no endpoint or field that surfaces them.
- The **frontend share modal + active-links UI** (consumes this contract) → **AB-1014**.
- The **soft-delete purge job** (FRS-4.4.4) — a background cron concern, not part of this ticket. AB-1008 only honours `deletedAt IS NULL` when serving a link; it never deletes notes or links.
- **Real email / notification** of a share — out of scope per FRS §10 (nothing is ever emailed).

## Capabilities

### New Capabilities
- `share-links`: Owner-side, authenticated management of a note's public share links — mint a new link (optional future expiry) for an own active note, list all of the caller's non-revoked links with expiry + view count, and revoke a link; ownership-isolated (404 not 403), and minting on a soft-deleted note is rejected 422.
- `public-share-view`: Public, unauthenticated read-only view of a single note by share token — returns only the note's current title + content, atomically increments the view count on a successful view, and is inaccessible (404/410) for unknown, revoked, expired, or soft-deleted-note tokens; never leaks tags, versions, owner identity, or any other note.

### Modified Capabilities
- None — note and tag response shapes are unchanged.

## Impact

### API Delta

**New — Sharing, owner side (SDS §6.6) `/api/notes/:id/shares` & `/api/shares` (auth):**

| Method | Path | Request | Success | Errors |
|--------|------|---------|---------|--------|
| POST | `/api/notes/:id/shares` | `{ expiresAt? }` (null/omitted = no expiry; if present must be future) | 201 `{ share }` where share = `{ id, noteId, token, url, expiresAt, viewCount, createdAt }` | 400 (bad/past `expiresAt`), 404 (note unknown or not owned), 422 (`NOTE_DELETED` — note is soft-deleted) |
| GET | `/api/shares` | — | 200 `[ { id, noteId, token, url, expiresAt, viewCount, createdAt } ]` (bare array, ordered `createdAt` DESC; excludes revoked only — expired and soft-deleted-note links are still listed) | — |
| DELETE | `/api/shares/:id` | — | 204 (sets `revokedAt`) | 404 (share unknown or not owned) |

**New — Public share view (SDS §6.2 + §8) `/api/public/notes/:token` (NO auth):**

| Method | Path | Request | Success | Errors |
|--------|------|---------|---------|--------|
| GET | `/api/public/notes/:token` | — (token in path) | 200 `{ title, content }` (content = note's `contentJson`) + atomic `viewCount` increment | 404 (unknown token), 410 (revoked OR past `expiresAt` OR underlying note soft-deleted) |

- **404 vs 403 (FRS-9.1):** a note or share that is unknown **or not owned by the caller** returns **404**, never 403 — no existence leak. The owner routes scope every query to `req.userId`; a foreign share/note is indistinguishable from a missing one.
- **404 vs 410 on the public route:** an **unknown** token → 404 (the link never existed). A token that *did* exist but is now revoked, past its `expiresAt`, or whose note was soft-deleted → **410 Gone**.

**Deviations from / additions to the SDS (clarified for this change):**
- **Share response field set** — SDS §6.6 sketches `{ share }` as "(token, url, expiresAt, viewCount)". This change pins the full shape to **`{ id, noteId, token, url, expiresAt: string|null, viewCount: number, createdAt }`**. `id` and `noteId` are required by the owner UI (revoke targets `id`; the modal groups links by `noteId`); `createdAt` lets the UI order links. SDS §6.6 SHOULD be updated to list these fields when this change is synced to main specs.
- **`url` is a relative path** — `"/s/<token>"` (clarification 4). SDS §8 defines the public *frontend* route as `/s/:token`; this change serves it back as a relative `url` string. No absolute base URL is constructed and **no new env var** is introduced.
- **`expiresAt` must be a future datetime** — SDS §3 only says `expiresAt?` (`null = no expiry`); SDS §5.1 lists 400 for failed validation generically. This change hardens "if present, must be future" into a **create-time 400 `VALIDATION_ERROR` + `fields:[{ field:"expiresAt" }]`** (clarification 2). A past-or-present value is a validation failure, not a business conflict (so 400, not 422).
- **Multiple active links per note** — neither FRS nor SDS limits link count; this change makes it explicit that each POST mints a **new independent token** and a note may carry many simultaneously (clarification 1). There is no "one link per note" upsert.
- **`GET /api/shares` excludes revoked only, ordered newest-first** — SDS §6.6 labels it "list active share links". This change defines "active" precisely as **`revokedAt IS NULL`**; expired-but-not-revoked links remain listed with their `expiresAt` + `viewCount` so the user can prune them (clarification 3), and links on **soft-deleted notes are also listed** (the list never filters on the note's `deletedAt`), so such a link resumes serving if its note is restored (clarification 5). The array is ordered by `createdAt` **descending** (newest first) since there is no pagination envelope (clarification 6). Scope is **all** of the caller's shares across **all** their own notes.
- **Error-code strings introduced** — SDS §5.1 enumerates the *condition* (share on a soft-deleted note → 422; expired/revoked/note-deleted view → 410) but not code strings. This change introduces **`NOTE_DELETED`** (422, minting a share on a soft-deleted note, surfaced via `ConflictError(code, message)`) and **`SHARE_GONE`** (410, the public-view access guard for revoked/expired/note-deleted, surfaced via a `GoneError`). Unknown tokens use the standard `NOT_FOUND` (404).
- **Public payload is minimal** — `{ title, content }` only. No `id`, owner, tags, versions, timestamps, or any other note ever appears (FRS-7.8). `content` is the raw `contentJson` TipTap document; `contentText` is **not** returned.

### DB Changes

**None.** The `ShareLink` model already exists in `backend/src/prisma/schema.prisma` — `id` (cuid), `noteId`, `token` (`@unique`, the 32-byte base64url value), `expiresAt DateTime?` (`null = no expiry`), `revokedAt DateTime?`, `viewCount Int @default(0)`, `createdAt`, plus `@@index([noteId])` and a cascade relation to `Note` — created by the AB-1001 init migration. Every field this change needs is already present:
- optional expiry → `expiresAt?`; revoke → set `revokedAt`; view count → `viewCount` with atomic `{ increment: 1 }`; unguessable address → unique `token`; note-soft-delete cascade is the existing `onDelete: Cascade` from `Note`.

No new migration, column, or index is required.

### Affected layers

| Layer | Change |
|-------|--------|
| `packages/shared` | New `schemas/shares.ts`: `CreateShareSchema` (`{ expiresAt?: string|null }` with future-datetime refinement), `ShareResponseSchema` (`{ id, noteId, token, url, expiresAt, viewCount, createdAt }`), `ShareListResponseSchema` (bare array of `ShareResponseSchema`), `PublicNoteViewSchema` (`{ title, content }`) + `z.infer` types. No existing notes/tags schema is touched. |
| `backend/src/repositories` | New `shares.repository.ts` — Prisma access only: create a `ShareLink` for a noteId; list a user's shares (join through `Note.userId`, filter `revokedAt IS NULL` only — **not** the note's `deletedAt` — ordered `createdAt` DESC); find a share by id scoped to owner; set `revokedAt`; resolve a token to its share + note; atomic `update … { viewCount: { increment: 1 } }`. |
| `backend/src/services` | New `shares.service.ts` — owns all FRS rules: verify note ownership + active (404 / 422 `NOTE_DELETED`); generate token via `crypto.randomBytes(32).toString('base64url')`; build relative `url`; map share rows to the response shape; revoke (404 if not owned). Public-view logic: resolve token → 404 unknown / 410 (`SHARE_GONE`) if revoked, past expiry, or note soft-deleted → otherwise increment then return `{ title, content }`. No `req`/`res`. |
| `backend/src/controllers` | New `shares.controller.ts` (owner: create / list / revoke, validates `CreateShareSchema`, scopes to `req.userId`) and `public.controller.ts` (public view by token, no auth context). |
| `backend/src/routes` | New `shares.routes.ts` — `POST /api/notes/:id/shares`, `GET /api/shares`, `DELETE /api/shares/:id`, mounted **behind** the auth middleware. New `public.routes.ts` — `GET /api/public/notes/:token`, mounted **before** the auth middleware. |
| `backend/src/app.ts` | Mount `publicRouter` at `/api/public` **before** `app.use(authMiddleware)` (alongside `/api/auth`); mount `sharesRouter` (carrying both `/api/notes/:id/shares` and `/api/shares`) **after** the auth guard. |
| `backend/tests` | Unit tests (token unguessability + uniqueness, future-only `expiresAt`, 404-not-403 ownership, `NOTE_DELETED` on deleted note, list excludes revoked but keeps expired, atomic increment only on 200, minimal public payload, 410 on revoked/expired/note-deleted). Supertest integration tests asserting the exact SDS §5.1 codes (201/200/204/400/404/410/422) and that no tags/versions/owner leak through the public route. |

### Key assumptions

- **Token generation** — `crypto.randomBytes(32).toString('base64url')`, stored in the unique `token` column (SDS §8). Unguessable; uniqueness is also enforced by the `@unique` constraint.
- **Atomic view count** — `viewCount` is incremented with Prisma's atomic `{ increment: 1 }` (compiles to `SET view_count = view_count + 1`), **only** on a successful 200 view — never on a 404 (unknown) or 410 (revoked/expired/note-deleted). No read-modify-write.
- **Ownership isolation** — owner routes scope every query to `req.userId`; a note or share not owned by the caller returns **404**, never 403 (FRS-9.1 / 9.5).
- **`expiresAt` future-only** — `null`/omitted = no expiry; a present value must be a future datetime, else **400** with a `fields[]` entry for `expiresAt` (clarification 2). Expiry on *view* (a once-valid link now past `expiresAt`) is a **410**, distinct from the create-time 400.
- **Relative `url`** — `"/s/<token>"`; no absolute base URL and no new env var (clarification 4).
- **Multiple links allowed** — each POST mints a new independent token; a note may carry many active links simultaneously; there is no per-note upsert or cap (clarification 1).
- **Public payload minimal** — `{ title, content }` (content = `contentJson`) only; no id, owner, tags, versions, timestamps, or any other note (FRS-7.8). The public route requires **no** access token (FRS-9.2 exemption).
- **"Active" for the list = `revokedAt IS NULL`** — `GET /api/shares` returns all of the caller's non-revoked links across all their own notes, ordered `createdAt` DESC (clarification 6). This includes expired-but-not-revoked links (clarification 3) **and** links whose underlying note is soft-deleted (clarification 5); the list filters only on `revokedAt`, never on the note's `deletedAt`, so a trashed note's link resumes public viewing if the note is restored. Only revocation removes a link from the list.
