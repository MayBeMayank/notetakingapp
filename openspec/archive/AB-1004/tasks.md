# Tasks — AB-1004: Notes CRUD + Soft Delete

**Capability:** `note-crud` · **Branch:** `feat/AB-1004-notes-crud-soft-delete`
**Source:** [`proposal.md`](proposal.md) · [`plan.md`](plan.md) · [`specs/note-crud/spec.md`](specs/note-crud/spec.md)

> Mark `- [x]` as each task lands and re-run that phase's checkpoint before moving on — do not batch at the end.
> `[PARALLEL]` = different files, no import/logical dependency, safe to do concurrently.

---

## Phase 1 — Foundation (shared types)

**No DB migration.** The `Note` table (`title`, `contentJson`, `contentText`, `deletedAt`, `@@index([userId, deletedAt, updatedAt])`) already exists from the AB-1001 init migration. Nothing to add.

- [x] **T1.1** Create `packages/shared/src/schemas/notes.ts` — `TipTapContentSchema`, `CreateNoteSchema`, `UpdateNoteSchema` (with `.refine` ≥1 field), `ListNotesQuerySchema` (coerced int, no min/max), `NoteResponseSchema`, `NoteEnvelopeSchema`, `NoteListResponseSchema` + `z.infer` types (shapes per plan §3).
- [x] **T1.2** Modify `packages/shared/src/schemas/index.ts` — add `export * from './notes.js'`. *(Sequential: imports T1.1.)*

### ✅ Checkpoint 1
```bash
pnpm --filter @note-app/shared build   # regenerate shared dist
pnpm -w build                          # 0 TS errors
pnpm -w lint --max-warnings 0          # 0 warnings
pnpm --filter backend test             # existing auth suite stays green
```

---

## Phase 2 — Core implementation

These three touch separate files with no interdependency → do concurrently:

- [x] **T2.1** `[PARALLEL]` Create `backend/src/lib/content.ts` — `deriveContentText(doc)` (walk TipTap JSON → plaintext, `""` for empty) + `EMPTY_TIPTAP_DOC = { type: 'doc', content: [] }`.
- [x] **T2.2** `[PARALLEL]` Create `backend/src/repositories/notes.repository.ts` — `createNote`, `findNoteByIdForUser(userId, id)` (no `deletedAt` filter), `updateNote`, `softDeleteNote`, `restoreNote`, `listActiveNotes(userId, {skip,take})`, `countActiveNotes`; list+count via `prisma.$transaction`. All scoped by `userId`. Prisma only.
- [x] **T2.3** `[PARALLEL]` Add query validation — `backend/src/middleware/validate.middleware.ts`: extract `zodErrorToFields()`, add `validateQuery(schema)` that sets `req.validatedQuery` (NOT `req.query` — read-only in Express 5); `backend/src/types/express.d.ts`: add `validatedQuery?: unknown` to `Request`.

Then sequentially (each imports the prior):

- [x] **T2.4** Create `backend/src/services/notes.service.ts` — depends on T2.1 + T2.2 + T1.1. Owns: empty-doc default, `contentText` derivation, the ownership/state branch matrix (plan §4.2), `RESTORE_WINDOW_MS` 30-day check, pagination defaults+clamp, private `toNoteResponse()` mapper (drops `contentText`/`userId`/`deletedAt`). Throws `NotFoundError` / `ConflictError('NOTE_DELETED' | 'RESTORE_WINDOW_EXPIRED' | 'NOTE_NOT_DELETED', …)`.
- [x] **T2.5** Create `backend/src/controllers/notes.controller.ts` — depends on T2.4. Thin `req`/`res` mapping: `create`→201, `list`→200 (reads `req.validatedQuery`), `get`→200, `update`→200, `remove`→204, `restore`→200.

### ✅ Checkpoint 2
```bash
pnpm -w build                          # 0 TS errors (no unused exports)
pnpm -w lint --max-warnings 0
pnpm --filter backend test             # existing suite stays green
```

---

## Phase 3 — Integration (wire-up)

Sequential — routes import the controller; `app.ts` mounts the router.

- [x] **T3.1** Create `backend/src/routes/notes.routes.ts` — register the 6 routes with `validateBody(CreateNoteSchema)` / `validateBody(UpdateNoteSchema)` / `validateQuery(ListNotesQuerySchema)` per plan §5.
- [x] **T3.2** Modify `backend/src/app.ts` — `app.use('/api/notes', notesRouter)` **after** `app.use(authMiddleware)` and **before** `errorMiddleware` (global guard → 401 on every notes route).

### ✅ Checkpoint 3
```bash
pnpm -w build
pnpm -w lint --max-warnings 0
pnpm --filter backend test             # existing suite stays green
```

---

## Phase 4 — Tests (one named test per spec scenario)

> Integration tests require a running Postgres via `backend/.env.test` (`DATABASE_URL`). Unit tests need no DB. Coverage ≥80% on new code (DoD).

- [x] **T4.1** `[PARALLEL]` Create `backend/tests/unit/notes.service.test.ts` (mock `notes.repository` + `lib/content`):
  - [ ] create: blank body → empty doc + `contentText:""`; derives `contentText`; response omits `contentText`/`userId`/`deletedAt`
  - [ ] get: `null`→404 · `deletedAt`→404 · active→200 mapping
  - [ ] update: `null`→404 · `deletedAt`→`NOTE_DELETED` · partial leaves omitted field · re-derives `contentText`
  - [ ] delete: `null`/`deletedAt`→404 · active→soft-delete
  - [ ] restore: ≤30d→success · >30d→`RESTORE_WINDOW_EXPIRED` · active→`NOTE_NOT_DELETED` · `null`→404
  - [ ] list: default `page=1/limit=20`; clamp `page=0→1`, `limit=999→100`; `orderBy updatedAt desc`; `total` independent of page

- [x] **T4.2** `[PARALLEL]` Create `backend/tests/integration/notes.routes.test.ts` (Supertest, real DB; register→login→Bearer; `beforeEach` adds `prisma.note.deleteMany()`):
  - [ ] POST: 201 with title+content · 201 blank `{}` · 400 malformed `content` · 401 no token
  - [ ] GET `/`: 200 envelope shape · only caller's active notes · default sort · `?page=abc`→400 · `?page=0&limit=999`→200 clamped · empty→`{data:[],total:0}` · 401 no token
  - [ ] GET `/:id`: 200 own · 404 other-user · 404 missing · 404 deleted · **404 body has no `fields`** · 401 no token
  - [ ] PATCH `/:id`: 200 · partial unchanged · 422 `NOTE_DELETED` · 404 other/missing · 400 malformed · 401 no token
  - [ ] DELETE `/:id`: 204 + row retained in DB · 404 other/missing/already-deleted · 401 no token
  - [ ] POST `/:id/restore`: 200 + reappears in list · 422 `RESTORE_WINDOW_EXPIRED` (seed `deletedAt` 31d ago) · 422 `NOTE_NOT_DELETED` · 404 other/missing · 401 no token
  - [ ] response never contains `contentText` (`JSON.stringify(res.body)` assertion)

### ✅ Checkpoint 4 (full gate)
```bash
pnpm -w build                          # 0 TS errors
pnpm -w lint --max-warnings 0          # 0 warnings
pnpm --filter backend test             # unit + integration ALL green, ≥80% on new code
# before commit:
npx commitlint --from HEAD~1
```

**Proposed commit:** `feat(notes): add CRUD with soft-delete and 30-day restore AB#1004`

---

## Dependency graph (quick reference)

```
T1.1 → T1.2 ─┐
             ├─ T2.4 → T2.5 → T3.1 → T3.2 → (T4.1 ∥ T4.2)
T2.1 ────────┤
T2.2 ────────┤
T2.3 ────────┘  (T2.1 ∥ T2.2 ∥ T2.3 concurrent)
```

No implementation begins until this breakdown is approved.
