# AB-1008 — Implementation Tasks: Sharing

> Source: `openspec/changes/AB-1008/proposal.md` + `specs/share-links/spec.md` + `specs/public-share-view/spec.md`.
> No `plan.md` exists; tasks derive directly from the approved proposal and the two delta specs.
>
> **Conventions:** mark each `- [ ]` → `- [x]` as it passes (per-task, not batched at the end). `[PARALLEL]` marks tasks that touch **different files** with **no import/logical dependency** — they may run concurrently. Everything else is sequential. Run the checkpoint gates at the end of each phase before moving on.
>
> **DB note:** the `ShareLink` model already exists in `schema.prisma` (token `@unique`, `expiresAt?`, `revokedAt?`, `viewCount`, cascade from `Note`). **No migration is required** — `prisma generate` is already current.

---

## Phase 1 — Foundation (shared types + error code)

- [x] **1.1 `packages/shared/src/schemas/shares.ts`** — new module (mirror the `tags.ts`/`notes.ts` shape: Zod schema → co-located `z.infer` type):
  - `CreateShareSchema` = `z.object({ expiresAt: z.string().datetime().nullish() }).refine(...)` — if `expiresAt` is present and non-null it MUST be **strictly future** (`new Date(v) > new Date()`); the refine error `path` is `['expiresAt']` so it surfaces as `fields:[{ field:"expiresAt" }]`. `null`/omitted = no expiry.
  - `ShareResponseSchema` = `z.object({ id, noteId, token, url, expiresAt: z.date().nullable(), viewCount: z.number(), createdAt: z.date() })`.
  - `ShareEnvelopeSchema` = `z.object({ share: ShareResponseSchema })` (the `201 { share }` create body — matches the `{ note }`/`{ tag }` envelope convention).
  - `ShareListResponseSchema` = `z.array(ShareResponseSchema)` (bare array — no `{ data, page, limit, total }`).
  - `PublicNoteViewSchema` = `z.object({ title: z.string(), content: z.unknown() })` (`content` = the note's `contentJson` TipTap document; `contentText` is NOT exposed).
  - Export inferred types: `CreateShareInput`, `ShareResponse`, `ShareListResponse`, `PublicNoteView`.
- [x] **1.2 `packages/shared/src/schemas/index.ts`** — add `export * from './shares.js'` (after 1.1; same package).
- [x] **1.3 [PARALLEL] `backend/src/lib/errors.ts`** — widen `GoneError` to accept an optional code: `constructor(message = 'Gone', code = 'GONE')` → `super(410, code, message)`. Lets the public view throw `new GoneError('…', 'SHARE_GONE')` while keeping the existing default. (Different file from 1.1/1.2, no dependency → may run alongside 1.1.)
- [x] **1.4 [PARALLEL] `backend/src/lib/token.ts`** — add `generateShareToken()` (`randomBytes(32).toString('base64url')`), mirroring `generateRefreshToken`, so the service stays free of direct crypto (same pattern as `auth.service`).

**Checkpoint 1:** `pnpm -w build` (rebuilds `@note-app/shared` so backend resolves `@note-app/shared/schemas/shares`) → 0 errors · `pnpm -w lint --max-warnings 0` · `pnpm -w test` → green.

---

## Phase 2 — Core implementation (backend layers, strictly `repo → service → controller`)

- [x] **2.1 `backend/src/repositories/shares.repository.ts`** — Prisma access only (no business rules):
  - `create(noteId, token, expiresAt)` → insert `ShareLink`, return the row.
  - `listForUser(userId)` → shares where `note.userId = userId` **AND `revokedAt = null`** (filter `revokedAt` only — **never** the note's `deletedAt`), `orderBy: { createdAt: 'desc' }`.
  - `findByIdForOwner(id, userId)` → share scoped via `note.userId`; returns `null` if absent or not owned.
  - `revoke(id)` → set `revokedAt = now()`.
  - `findByToken(token)` → resolve a share **with its note** (need `note.deletedAt`, `note.title`, `note.contentJson`) for the public view.
  - `incrementViewCount(id)` → atomic `update({ where: { id }, data: { viewCount: { increment: 1 } } })` (never read-modify-write).
- [x] **2.2 `backend/src/services/shares.service.ts`** — owns all FRS rules; no `req`/`res`; imports 2.1:
  - `createShare(userId, noteId, expiresAt)` → load note scoped to `userId`; absent/not-owned → `NotFoundError` (404); `deletedAt` set → `new ConflictError('NOTE_DELETED', …)` (422); else generate token = `crypto.randomBytes(32).toString('base64url')`, persist, map row → response with `url = `/s/${token}``.
  - `listShares(userId)` → repo `listForUser`, map each row → `ShareResponse` (incl. `url`).
  - `revokeShare(userId, id)` → `findByIdForOwner`; null → `NotFoundError` (404); else `revoke` (idempotent — already-revoked own link still 204).
  - `viewByToken(token)` → `findByToken`; unknown → `NotFoundError` (404); `revokedAt` set OR `expiresAt != null && expiresAt <= now` OR `note.deletedAt != null` → `new GoneError('…', 'SHARE_GONE')` (410); else `incrementViewCount` **then** return `{ title, content: note.contentJson }` only.
- [x] **2.3 [PARALLEL] `backend/src/controllers/shares.controller.ts`** — owner: `create` (reads `req.userId` + `req.params.id` + validated `req.body.expiresAt` → 201 `{ share }`), `list` (→ 200 bare array), `revoke` (→ 204). No Prisma. (After 2.2; different file from 2.4.)
- [x] **2.4 [PARALLEL] `backend/src/controllers/public.controller.ts`** — `view` (reads `req.params.token`, no auth context) → 200 `{ title, content }`. (After 2.2; different file from 2.3 → may run alongside it.)

**Checkpoint 2:** `pnpm -w build` → 0 errors · `pnpm -w lint --max-warnings 0` · `pnpm -w test` → green.

---

## Phase 3 — Integration (routes + app wiring)

- [x] **3.1 [PARALLEL] `backend/src/routes/shares.routes.ts`** — `sharesRouter`: `GET '/'` → `sharesController.list`; `DELETE '/:id'` → `sharesController.revoke`. (Mounted at `/api/shares`.)
- [x] **3.2 [PARALLEL] `backend/src/routes/notes.routes.ts`** — add the note-scoped create: `notesRouter.post('/:id/shares', validateBody(CreateShareSchema), sharesController.create)`. Reuses the existing `/api/notes` mount so the path resolves as `/api/notes/:id/shares`. (Different file from 3.1/3.3, no dep between them.)
- [x] **3.3 [PARALLEL] `backend/src/routes/public.routes.ts`** — `publicRouter`: `GET '/notes/:token'` → `publicController.view`. (Mounted at `/api/public`, **before** the auth guard.)
- [x] **3.4 `backend/src/app.ts`** — wire mounts (after 3.1–3.3; single file, depends on all three):
  - Add `app.use('/api/public', publicRouter)` **before** `app.use(authMiddleware)` (next to `/api/auth`).
  - Add `app.use('/api/shares', sharesRouter)` **after** `app.use(authMiddleware)`.
  - (The `/api/notes/:id/shares` create route comes for free via the already-mounted `notesRouter`.)

**Checkpoint 3:** `pnpm -w build` → 0 errors · `pnpm -w lint --max-warnings 0` · `pnpm -w test` → green. Smoke-check route ordering: public route reachable without a token; owner routes 401 without one.

---

## Phase 4 — Tests (one named test per spec scenario)

> Traceability: every `#### Scenario` in the two delta specs maps to exactly one named test below. Backend target ≥ 80% coverage on new code.

- [x] **4.1 [PARALLEL] `backend/tests/unit/shares.service.test.ts`** — Vitest unit (service in isolation, repo mocked/seeded):
  - share-links · *Generate*: link with no expiry · link with valid future expiry · multiple links → distinct tokens · token is unguessable (32-byte base64url, unique) · `url` is relative `/s/<token>`.
  - share-links · *Reject create*: note not found → 404 · not-owned → 404 (not 403) · soft-deleted note → 422 `NOTE_DELETED` · past-or-present `expiresAt` → 400 (schema) · malformed `expiresAt` → 400.
  - share-links · *List*: across all own notes · excludes revoked · **includes expired-but-not-revoked** · **includes soft-deleted-note links** · **ordered `createdAt` DESC** · excludes other users' · empty → `[]`.
  - share-links · *Revoke*: revokes own link · unknown → 404 · not-owned → 404 (not 403) · idempotent on already-revoked.
  - public-share-view · *View*: valid → `{ title, content }` · serves **current** content not a snapshot · no-expiry link viewable.
  - public-share-view · *Status*: unknown token → 404 · revoked → 410 `SHARE_GONE` · `expiresAt <= now` → 410 · soft-deleted note → 410.
  - public-share-view · *View count*: increments by exactly 1 on success · **not** incremented on 404/410.
  - public-share-view · *No leak*: payload has only `title` + `content` (no id/owner/tags/versions/timestamps/share-metadata).
- [x] **4.2 [PARALLEL] `backend/tests/integration/shares.routes.test.ts`** — Supertest integration, owner routes (assert exact SDS §5.1 codes):
  - `POST /api/notes/:id/shares`: 201 `{ share }` (no expiry) · 201 (future expiry) · 400 (past/present/malformed `expiresAt`, `fields[]` for `expiresAt`) · 404 (unknown/not-owned note) · 422 `NOTE_DELETED` (soft-deleted note) · 401 (no token).
  - `GET /api/shares`: 200 bare array · revoked excluded · expired included · soft-deleted-note link included · ordered newest-first · other users' excluded · `[]` when none · 401 (no token).
  - `DELETE /api/shares/:id`: 204 (own) · removed from subsequent list · 404 (unknown) · 404 (not-owned, not 403) · 204 idempotent (already revoked) · 401 (no token).
  - 404 body = `{ error: { code: "NOT_FOUND", message } }` (no `fields`, no existence leak).
- [x] **4.3 [PARALLEL] `backend/tests/integration/public.routes.test.ts`** — Supertest integration, `GET /api/public/notes/:token`:
  - 200 `{ title, content }` without `Authorization` header · identical result **with** a Bearer token (token neither helps nor required) · reflects current content after an edit.
  - No-leak assertions: response keys are exactly `title` + `content` (tags / versions / owner / note id / timestamps / share metadata all absent), and no other note is reachable.
  - 404 (unknown token) · 410 `SHARE_GONE` (revoked) · 410 (expired) · 410 (soft-deleted note) · 410 body = `{ error: { code: "SHARE_GONE", message } }` (no `fields`, no content, indistinguishable cause).
  - `viewCount` increments by exactly 1 on a 200; concurrent N views → +N (atomic); no increment on 404/410.

**Checkpoint 4 (final gate) — RESULTS:**
- [x] `pnpm -w build` → 0 errors · `pnpm -w lint --max-warnings 0` → 0 warnings.
- [x] `pnpm --filter backend test` → **267/267 green** (54 new: 19 unit + 22 owner-route + 13 public-route).
- [x] Coverage on new code ~100% line (repositories/services/controllers/routes all 100%; overall 96.64%) — exceeds the ≥80% DoD.
- [x] Every spec scenario maps to one named test (traceability).
- [x] `npx commitlint --from HEAD~1` + Husky pre-commit — run at commit time (awaiting user go-ahead; no `--no-verify`).

> Note: one unrelated **pre-existing flaky test** surfaced — `auth.otp.routes.test.ts` T4.19. Its helper `getLatestOtpFromConsole` extracts the OTP via `/\d{6}/` from a log line that prints the userId (a base36 cuid) *before* the OTP; when a cuid contains 6 consecutive digits it grabs those instead. Probabilistic per-run, independent of AB-1008. Flagged as a separate task.

---

## Out of scope (do not implement here)
- Version history (AB-1009) — never exposed through a share link; enforced by the minimal public payload only.
- Frontend share modal + active-links UI (AB-1014) — consumes this contract.
- Soft-delete purge job (FRS-4.4.4) — background cron; AB-1008 only honours `deletedAt` when serving/listing, never deletes.
- Real email/notification of a share (FRS §10).
