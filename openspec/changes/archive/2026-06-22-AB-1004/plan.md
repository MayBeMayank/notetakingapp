# Technical Plan — AB-1004: Notes CRUD + Soft Delete

**Capability:** `note-crud`
**Source artifacts:** [`proposal.md`](proposal.md), [`specs/note-crud/spec.md`](specs/note-crud/spec.md)
**SDS basis:** §3 (Note model), §5.1 (status codes), §5.2 (pagination), §6.3 (notes contracts), §10 (soft delete)
**Status:** awaiting approval — no implementation code is written by this plan.

---

## 1. Scope recap (binding)

Six endpoints, all behind the AB-1002 auth middleware, all scoped to `req.userId`:

| Method | Path | Success | Errors |
|---|---|---|---|
| POST | `/api/notes` | 201 `{ note }` | 400 |
| GET | `/api/notes` | 200 `{ data, page, limit, total }` | 400 (type-invalid query) |
| GET | `/api/notes/:id` | 200 `{ note }` | 404 |
| PATCH | `/api/notes/:id` | 200 `{ note }` | 400, 404, 422 `NOTE_DELETED` |
| DELETE | `/api/notes/:id` | 204 | 404 |
| POST | `/api/notes/:id/restore` | 200 `{ note }` | 404, 422 `RESTORE_WINDOW_EXPIRED` / `NOTE_NOT_DELETED` |

Deferred (not built here): version snapshots (AB-1009), `tagIds` (AB-1006), `sort`/`order`/`tags`/`status` query params (AB-1005), background purge (ops cron), search/tag-count exclusion halves (AB-1007/AB-1006).

---

## 2. File map

### Create

| Path | Purpose |
|---|---|
| `packages/shared/src/schemas/notes.ts` | All Zod schemas + inferred types for notes |
| `backend/src/lib/content.ts` | `deriveContentText()` (TipTap JSON → plaintext) + `EMPTY_TIPTAP_DOC` |
| `backend/src/repositories/notes.repository.ts` | Prisma access, all scoped by `userId` |
| `backend/src/services/notes.service.ts` | Business rules — owns every FRS rule |
| `backend/src/controllers/notes.controller.ts` | `req`/`res` mapping only |
| `backend/src/routes/notes.routes.ts` | Route registration |
| `backend/tests/unit/notes.service.test.ts` | Service unit tests (mocked repo + content lib) |
| `backend/tests/integration/notes.routes.test.ts` | Supertest, real DB, exact status codes |

### Modify

| Path | Change |
|---|---|
| [`packages/shared/src/schemas/index.ts`](../../../packages/shared/src/schemas/index.ts) | add `export * from './notes.js'` |
| [`backend/src/middleware/validate.middleware.ts`](../../../backend/src/middleware/validate.middleware.ts) | add `validateQuery()` (+ extract shared `zodErrorToFields`) |
| [`backend/src/types/express.d.ts`](../../../backend/src/types/express.d.ts) | add `validatedQuery?: unknown` to `Request` |
| [`backend/src/app.ts`](../../../backend/src/app.ts) | mount `app.use('/api/notes', notesRouter)` **after** `authMiddleware`, **before** `errorMiddleware` |

### DB

**No migration.** The `Note` table — `title`, `contentJson` (Json), `contentText` (default `""`), `deletedAt?`, `@@index([userId, deletedAt, updatedAt])` — already exists from the AB-1001 init migration (`20260619140044_init`). Fully backward compatible; nothing to add. `search_vector` remains an AB-1007 concern. No `prisma migrate` / `db push` needed — only the already-generated client is used.

---

## 3. Shared schemas (`packages/shared/src/schemas/notes.ts`)

Final shapes (mirrors the `auth.ts` style — Zod first, `z.infer` types at the bottom):

```ts
import { z } from 'zod'

// A TipTap/ProseMirror document. We validate only that it is a doc-shaped
// OBJECT (has a `type`), not the full node schema — rejects string/array/null
// so "malformed content" → 400 at the boundary.
export const TipTapContentSchema = z.object({ type: z.string() }).passthrough()

export const CreateNoteSchema = z.object({
  title: z.string().max(255).optional(),
  content: TipTapContentSchema.optional(),
})

export const UpdateNoteSchema = z
  .object({
    title: z.string().max(255).optional(),
    content: TipTapContentSchema.optional(),
  })
  .refine((d) => d.title !== undefined || d.content !== undefined, {
    message: 'At least one of title or content must be provided',
  })

// page/limit arrive as strings. coerce → number; z.number() rejects NaN, so
// `?page=abc` fails here → 400. Range (min/default) is NOT enforced here —
// clamping is the service's job (clamp, don't reject; SDS §5.2).
export const ListNotesQuerySchema = z.object({
  page: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
})

export const NoteResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: TipTapContentSchema, // = DB contentJson; contentText is NOT exposed
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const NoteEnvelopeSchema = z.object({ note: NoteResponseSchema })

export const NoteListResponseSchema = z.object({
  data: z.array(NoteResponseSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
})

export type CreateNoteInput = z.infer<typeof CreateNoteSchema>
export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>
export type ListNotesQuery = z.infer<typeof ListNotesQuerySchema>
export type NoteResponse = z.infer<typeof NoteResponseSchema>
export type NoteListResponse = z.infer<typeof NoteListResponseSchema>
```

After editing, `pnpm -w build` must run so `packages/shared/dist` regenerates before the backend can import `@note-app/shared/schemas/notes`.

---

## 4. Architecture decisions (with reasoning)

### 4.1 Note state → response is a service-layer mapping
The repository returns the raw Prisma `Note` row (`id, userId, title, contentJson, contentText, createdAt, updatedAt, deletedAt`). The **service** maps it to the public shape `{ id, title, content: row.contentJson, createdAt, updatedAt }` — dropping `userId`, `contentText`, and `deletedAt`. *Reason:* `contentText` is an internal FTS derivation and must never be serialized (AGENTS §11); `content` is the API name for `contentJson`. A single `toNoteResponse(row)` helper in the service enforces this in one place.

### 4.2 The ownership / state branch matrix (the core of the service)
Every `:id` operation fetches the row scoped to the caller first, then branches. This table is the spec made executable:

| Operation | not found / not owned | `deletedAt` set | active |
|---|---|---|---|
| `GET /:id` | **404** | **404** | 200 |
| `PATCH /:id` | **404** | **422 `NOTE_DELETED`** | 200 |
| `DELETE /:id` | **404** | **404** (already gone) | 204 |
| `POST /:id/restore` | **404** | 200 if ≤30d · **422 `RESTORE_WINDOW_EXPIRED`** if >30d | **422 `NOTE_NOT_DELETED`** |

*Reason:* not-owned is indistinguishable from absent → 404, never 403 (no existence leak, FRS-4.2.2/9.1). A deleted note is non-actionable except via restore, so read/delete treat it as absent (404) while update reports the specific business conflict (422). The `NOTE_NOT_DELETED` 422 is the spec's documented SDS errata (see proposal §Impact).

### 4.3 Ownership is enforced in the WHERE clause, not in JS
The repo finder is `findNoteByIdForUser(userId, id)` → `prisma.note.findFirst({ where: { id, userId } })` (no `deletedAt` filter — the service inspects `deletedAt` to choose 404 vs 422). A row owned by another user simply isn't returned → the service sees `null` → 404. *Reason:* makes leak-prevention structural, not a forgotten `if`.

### 4.4 `contentText` derivation lives in `lib/content.ts`, called on every write
`deriveContentText(doc)` walks the TipTap JSON depth-first, concatenating `text` nodes with a space/newline between block-level nodes, returns `""` for an empty doc. Create and update both call it and write `contentJson` + `contentText` **together** (AGENTS §6, §11). A blank create (`{}` or omitted `content`) defaults to `EMPTY_TIPTAP_DOC = { type: 'doc', content: [] }` and `contentText = ""` (FRS-4.1.2). *Reason:* one derivation path keeps the two fields from ever drifting; FTS (AB-1007) consumes `contentText` later.

### 4.5 Pagination: validate type in the schema, clamp range in the service
Two-layer split:
- **Schema** (`ListNotesQuerySchema`): coerce to int; non-numeric → `NaN` → `z.number()` rejects → **400** (satisfies "type-invalid query params rejected", FRS-9.3).
- **Service**: apply defaults (`page=1`, `limit=20`) for `undefined`, then clamp (`page = max(1, page)`, `limit = min(100, max(1, limit))`). Out-of-range values are **clamped, not rejected** (SDS §5.2).

*Reason:* the spec demands both behaviors at once (`?page=abc` → 400, `?page=0&limit=999` → 200 clamped). Enforcing `min(1)` in Zod would wrongly 400 the clamp case; doing type-checking in the service would duplicate Zod. The boundary owns "is it a number"; the rule owns "what's a sane number".

### 4.6 `validateQuery` writes to `req.validatedQuery`, NOT `req.query`
New middleware mirrors `validateBody` (same `400 + fields[]` envelope) but on success assigns `req.validatedQuery = result.data`. **It must not reassign `req.query`** — in Express 5 `req.query` is a getter with no setter, so assignment throws at runtime. We augment `Express.Request` with `validatedQuery?: unknown`; the controller reads `req.validatedQuery as ListNotesQuery`. *Reason:* keeps the route-chain validation pattern (`validateQuery(ListNotesQuerySchema)`) consistent with bodies while respecting the Express 5 breaking change. Extract `zodErrorToFields(error)` so `validateBody` and `validateQuery` share the field-mapping.

### 4.7 No per-route auth guard — rely on the global middleware
`app.ts` applies `app.use(authMiddleware)` globally after the public `/api/auth` router. Mounting `app.use('/api/notes', notesRouter)` **after** that line means every notes route is already guarded → 401 on missing/invalid/expired token, handler never reached (FRS-9.2). *Reason:* matches the existing wiring; avoids redundant `authMiddleware` on each route.

### 4.8 Update by id after ownership check; `updatedAt` auto-bumps
Service verifies ownership + non-deleted, then `prisma.note.update({ where: { id }, data })`. `@updatedAt` advances automatically. Partial PATCH only sets provided fields (omitted `content` leaves `contentJson`/`contentText` untouched). *Decision flagged:* `UpdateNoteSchema` rejects an empty `{}` PATCH (400) via `.refine` — FRS is silent here; recommended because a no-op PATCH that still bumps `updatedAt` would silently reorder the default list. Confirm or drop the refine at review.

---

## 5. Layer-by-layer detail

**`repositories/notes.repository.ts`** (Prisma only, every query takes `userId`):
- `createNote({ userId, title, contentJson, contentText }) → Note`
- `findNoteByIdForUser(userId, id) → Note | null` — `findFirst({ where: { id, userId } })`, no `deletedAt` filter
- `updateNote(id, data: { title?; contentJson?; contentText? }) → Note`
- `softDeleteNote(id) → Note` — `data: { deletedAt: new Date() }`
- `restoreNote(id) → Note` — `data: { deletedAt: null }`
- `listActiveNotes(userId, { skip, take }) → Note[]` — `where: { userId, deletedAt: null }`, `orderBy: { updatedAt: 'desc' }`
- `countActiveNotes(userId) → number`
- list + count run together via `prisma.$transaction([...])` for a consistent `total`.

**`services/notes.service.ts`** (no `req`/`res`; throws typed errors):
- `RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000`
- `createNote(userId, input)` → default empty doc, derive text, persist, map → `{ note }`
- `getNote(userId, id)` → fetch; `null` or `deletedAt` → `NotFoundError`; else `{ note }`
- `listNotes(userId, query)` → resolve defaults + clamp → skip/take → `{ data, page, limit, total }`
- `updateNote(userId, id, input)` → `null`→404; `deletedAt`→`ConflictError('NOTE_DELETED', …)`; else derive (if content present) + update
- `deleteNote(userId, id)` → `null` or `deletedAt`→404; else soft-delete
- `restoreNote(userId, id)` → `null`→404; `deletedAt===null`→`ConflictError('NOTE_NOT_DELETED', …)`; age>30d→`ConflictError('RESTORE_WINDOW_EXPIRED', …)`; else restore
- private `toNoteResponse(row)` mapper (§4.1)

**`controllers/notes.controller.ts`** — thin, mirrors `auth.controller.ts`: `create`→201, `list`→200 (reads `req.validatedQuery`), `get`→200, `update`→200, `remove`→204 `.send()`, `restore`→200. All pass `req.userId` + `req.params.id`.

**`routes/notes.routes.ts`:**
```ts
notesRouter.post('/',            validateBody(CreateNoteSchema),  notesController.create)
notesRouter.get('/',             validateQuery(ListNotesQuerySchema), notesController.list)
notesRouter.get('/:id',                                           notesController.get)
notesRouter.patch('/:id',        validateBody(UpdateNoteSchema),  notesController.update)
notesRouter.delete('/:id',                                        notesController.remove)
notesRouter.post('/:id/restore',                                  notesController.restore)
```

---

## 6. Reuse of existing code (no duplication)

| Reused | From |
|---|---|
| `validateBody`, error envelope | [`validate.middleware.ts`](../../../backend/src/middleware/validate.middleware.ts) |
| `authMiddleware` (global guard, `req.userId`) | [`auth.middleware.ts`](../../../backend/src/middleware/auth.middleware.ts) |
| `NotFoundError`, `ConflictError(code, message)` | [`lib/errors.ts`](../../../backend/src/lib/errors.ts) |
| Central error → HTTP mapping | [`error.middleware.ts`](../../../backend/src/middleware/error.middleware.ts) |
| `prisma` client singleton | [`lib/prisma.ts`](../../../backend/src/lib/prisma.ts) |
| Controller/service/repo layering & file style | `auth.*` trio |
| Supertest harness (register→login→Bearer, `beforeEach` cleanup) | [`auth.routes.test.ts`](../../../backend/tests/integration/auth.routes.test.ts) |

No new error class is needed — `NOTE_DELETED` / `RESTORE_WINDOW_EXPIRED` / `NOTE_NOT_DELETED` are all `ConflictError(code, message)` (422).

---

## 7. Test plan (every spec scenario → one named test)

**Unit — `notes.service.test.ts`** (mock `notes.repository` + `lib/content`, pattern from `auth.service.test.ts`):
- create: empty body → empty doc + `contentText:""`; derives `contentText`; writes both fields; response omits `contentText`/`userId`/`deletedAt`
- get/update/delete/restore: full branch matrix from §4.2 (404 vs 422 vs success)
- restore: ≤30d success · >30d `RESTORE_WINDOW_EXPIRED` · active `NOTE_NOT_DELETED`
- list: default `page=1/limit=20`; clamp `page=0→1`, `limit=999→100`; `orderBy updatedAt desc`; `total` independent of page

**Integration — `notes.routes.test.ts`** (real test Postgres, asserts exact §5.1 codes):
- 401 on every route with missing/expired token
- POST 201 (with + blank body); 400 malformed `content`
- GET list 200 envelope shape; only caller's active notes; `?page=abc` → 400; `?page=0&limit=999` → 200 clamped; empty → `{ data:[], total:0 }`
- GET/:id 200 own · 404 other-user · 404 missing · 404 deleted; assert 404 body is `{ error: { code:"NOT_FOUND", message } }` with **no** `fields`
- PATCH 200 · partial leaves fields · 422 `NOTE_DELETED` · 404 other/missing · 400 malformed
- DELETE 204 + row retained (query DB) · 404 other/missing/already-deleted
- restore 200 + reappears in list · 422 `RESTORE_WINDOW_EXPIRED` (seed `deletedAt` 31d ago) · 422 `NOTE_NOT_DELETED` · 404 other/missing
- response never contains `contentText` (`JSON.stringify(res.body)` assertion, like the auth `passwordHash` test)

`beforeEach`: add `await prisma.note.deleteMany()` before the user delete (or rely on `User` cascade). Coverage target ≥80% on new code (SDS §12 DoD).

---

## 8. Build / test / lint checkpoints

Run after implementation, in order (CLAUDE.md quality gates):

```bash
pnpm --filter @note-app/shared build   # regenerate shared dist (schemas/notes) first
pnpm -w build                          # 0 TS errors across all packages
pnpm -w lint --max-warnings 0          # 0 errors, 0 warnings
pnpm --filter backend test             # unit + integration green
# before commit:
npx commitlint --from HEAD~1           # message format
```

**Prereq for integration tests:** a running Postgres reachable via `backend/.env.test` `DATABASE_URL` (SDS §12; AGENTS testing notes). Unit tests need no DB.

**Proposed commit (on branch `feat/AB-1004-notes-soft-delete`):**
`feat(notes): add CRUD with soft-delete and 30-day restore AB#1004`

---

## 9. Open items for reviewer confirmation

1. **Empty `{}` PATCH → 400** via `.refine` (§4.8) — FRS-silent; recommended. Approve or drop.
2. **`title` max 255** — not specified by FRS; sane guard, easy to change/remove.
3. **`validatedQuery` typing** — `unknown` + controller cast vs. a typed augmentation. Recommending the cast for minimal surface; flag if you want stricter typing.

No implementation begins until this plan is approved.
