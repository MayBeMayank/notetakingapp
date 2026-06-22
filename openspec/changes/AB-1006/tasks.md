# Tasks — AB-1006: Tags CRUD + note count + note associations

**Capabilities:** `tag-management` (new) · `note-crud` (modified) · **Branch:** `feat/AB-1006-tags-crud`
**Source:** [`proposal.md`](proposal.md) · [`plan.md`](plan.md) · [`specs/tag-management/spec.md`](specs/tag-management/spec.md) · [`specs/note-crud/spec.md`](specs/note-crud/spec.md)

> Mark `- [x]` as each task lands and re-run that phase's checkpoint before moving on — do not batch at the end.
> `[PARALLEL]` = different files, no import/logical dependency, safe to do concurrently.

---

## Phase 1 — Foundation (shared types)

**No DB migration.** `Tag` (`@@unique([userId, name])`) and `NoteTag` (PK `[noteId, tagId]`, `@@index([tagId])`, cascade from both sides) already exist from the AB-1001 init migration. FRS-5.5 is satisfied by the existing `onDelete: Cascade` on `NoteTag.tag`. Nothing to add.

- [x] **T1.1** `[PARALLEL]` Create `packages/shared/src/schemas/tags.ts` — `CreateTagSchema` (`name` trimmed 1–50, `color` `/^#[0-9a-fA-F]{6}$/`), `UpdateTagSchema` (both optional + `.refine` ≥1 field), `TagResponseSchema`, `TagWithCountSchema` (`.extend({ noteCount })`), `TagEnvelopeSchema`, `TagListResponseSchema` + `z.infer` types (shapes per plan §3).
- [x] **T1.2** `[PARALLEL]` Modify `packages/shared/src/schemas/notes.ts` — add optional `tagIds: z.array(z.string())` to `CreateNoteSchema` and `UpdateNoteSchema`; widen `UpdateNoteSchema.refine` to accept `tagIds`; add required `tagIds: z.array(z.string())` to `NoteResponseSchema`. *(Different file from T1.1, no dependency.)*
- [x] **T1.3** Modify `packages/shared/src/schemas/index.ts` — add `export * from './tags.js'`. *(Sequential: imports T1.1.)*

### ✅ Checkpoint 1
```bash
pnpm --filter @note-app/shared build        # shared compiles in isolation
pnpm --filter @note-app/shared lint
```
> ⚠️ `pnpm -w build` is **intentionally red after Phase 1**: adding `tagIds` to `NoteResponseSchema` forces the backend `toNoteResponse` update, which lands in Phase 2. The full workspace gate (build + backend test) goes green at **Checkpoint 2** — do not run it here expecting 0 errors.

---

## Phase 2 — Core implementation

Repositories first (data access), then services, then the tags controller.

- [x] **T2.1** `[PARALLEL]` Create `backend/src/repositories/tags.repository.ts` — `createTag`, `findTagByIdForUser(userId,id)`, `findByName(userId,name,excludeId?)`, `listTagsWithCount(userId)` (filtered `_count: { select: { notes: { where: { note: { deletedAt: null } } } } }`, `orderBy name asc`), `updateTag(userId,id,data)`, `deleteTag(userId,id)`, `countOwned(userId,ids)`. All scoped by `userId`. Prisma only.
- [x] **T2.2** `[PARALLEL]` Modify `backend/src/repositories/notes.repository.ts` — add `TAG_IDS_INCLUDE = { tags: { select: { tagId: true } } }` + `NoteWithTagIds` type; add `include: TAG_IDS_INCLUDE` to `findNoteByIdForUser`, `listNotesWithCount`, `createNote`, `updateNote`, `restoreNote`; `createNote` nests `tags: { create }` when `tagIds` given; `updateNote` nests `tags: { deleteMany: {}, create }` only when `tagIds !== undefined`. *(Different file from T2.1, no dependency.)*

Then (each imports the repos above — different files from each other, so concurrent):

- [x] **T2.3** `[PARALLEL]` Create `backend/src/services/tags.service.ts` — depends on **T2.1** + T1.1. Owns FRS-5 rules: lower-case `name` before dup-check/write; `createTag` pre-check `findByName` → `ConflictError('TAG_NAME_TAKEN')`; `listTags` maps `_count.notes` → `noteCount`; `updateTag` re-checks collision with `excludeId=id` (allows rename to own name) → 422, missing → `NotFoundError`; `deleteTag` missing → `NotFoundError`; `toTagResponse` mapper.
- [x] **T2.4** `[PARALLEL]` Modify `backend/src/services/notes.service.ts` — depends on **T2.1** (`countOwned`) + **T2.2** (`NoteWithTagIds`) + T1.1. Add `assertOwnedTags(userId, tagIds)` (de-dupe via `Set`, `countOwned !== ids.length` → `ConflictError('INVALID_TAG_IDS')`); call it in `createNote` (when `tagIds`) and `updateNote` (when `tagIds !== undefined`, allowing `[]`); add `tagIds: note.tags.map(t => t.tagId)` to `toNoteResponse`. **Also update the existing `backend/tests/unit/notes.service.test.ts` `fakeNote` fixture to include `tags: []`** so the existing unit suite still compiles/passes.
- [x] **T2.5** Create `backend/src/controllers/tags.controller.ts` — depends on **T2.3**. Thin `req`/`res`: `create`→201 `{ tag }`, `list`→200 array, `update`→200 `{ tag }`, `remove`→204.

### ✅ Checkpoint 2 (full workspace now green)
```bash
pnpm -w build                          # 0 TS errors (backend consumes tagIds)
pnpm -w lint --max-warnings 0
pnpm --filter backend test             # existing auth + notes suites stay green (notes fixture updated in T2.4)
```

---

## Phase 3 — Integration (wire-up)

Sequential — routes import the controller; `app.ts` mounts the router.

- [x] **T3.1** Create `backend/src/routes/tags.routes.ts` — `tagsRouter` with `POST /` `validateBody(CreateTagSchema)`, `GET /`, `PATCH /:id` `validateBody(UpdateTagSchema)`, `DELETE /:id` per plan §3.
- [x] **T3.2** Modify `backend/src/app.ts` — `app.use('/api/tags', tagsRouter)` **after** `app.use(authMiddleware)` and **before** `errorMiddleware` (global guard → 401 on every tags route).

### ✅ Checkpoint 3
```bash
pnpm -w build
pnpm -w lint --max-warnings 0
pnpm --filter backend test             # existing suites stay green
```

---

## Phase 4 — Tests (one named test per spec scenario)

> Integration tests require a running Postgres via `backend/.env.test` (`DATABASE_URL`). Unit tests need no DB. Coverage ≥80% on new code (DoD). The `notes.routes.test.ts` `beforeEach` already deletes `noteTag`/`tag` — no cleanup change needed.

- [x] **T4.1** `[PARALLEL]` Create `backend/tests/unit/tags.service.test.ts` (mock `tags.repository`):
  - [x] create: lower-cases `name` before write; dup (`findByName` hit) → `TAG_NAME_TAKEN`; passes color through
  - [x] update: missing → 404; collision via `findByName(excludeId)` → `TAG_NAME_TAKEN`; rename to own name (same id) → ok; lower-cases new name
  - [x] delete: missing → 404; present → calls `deleteTag`
  - [x] list: maps `_count.notes` → `noteCount`; empty repo → `[]`

- [x] **T4.2** `[PARALLEL]` Create `backend/tests/integration/tags.routes.test.ts` (Supertest, real DB; `registerAndLogin` helper):
  - [x] POST: 201 `{ tag }` (name stored lower-cased) · 422 `TAG_NAME_TAKEN` dup (incl. case-insensitive) · same name for 2nd user → 201 · 400 invalid color (`#FFF`, `blue`) · 400 missing name/color · 400 whitespace-only name · 401 no token
  - [x] GET: 200 **bare array** with `noteCount` · `noteCount` excludes a soft-deleted note · `0` for unused tag · other users' tags absent · empty → `[]` · 401 no token
  - [x] PATCH: 200 rename · 200 recolor · 200 both · 422 collision · 200 rename-to-own-name · 400 empty body · 404 other/missing · 401 no token
  - [x] DELETE: 204 + tag gone · `NoteTag` rows removed but notes retained (DB assertion) · 404 other/missing · 401 no token
  - [x] 404 body has **no `fields`** array

- [x] **T4.3** `[PARALLEL]` Extend `backend/tests/unit/notes.service.test.ts` — mock `tags.repository.countOwned`:
  - [x] create with `tagIds` → `countOwned` checked, deduped, passed to repo
  - [x] create/update with foreign id (`countOwned` < unique len) → `INVALID_TAG_IDS`, repo write not called
  - [x] update `tagIds: []` → repo called with `[]` (detach-all); omitted `tagIds` → repo not asked to touch tags
  - [x] `toNoteResponse` maps `tags` → `tagIds`

- [x] **T4.4** `[PARALLEL]` Extend `backend/tests/integration/notes.routes.test.ts` (real DB; seed caller-owned tags):
  - [x] POST with owned `tagIds` → 201, response `tagIds` matches (deduped) · POST foreign/unknown `tagId` → 422 `INVALID_TAG_IDS` + **no note created** (DB count assertion)
  - [x] PATCH `{ tagIds:["B"] }` on note tagged A,B → leaves B only · PATCH `{ tagIds:[] }` → detaches all · PATCH foreign id → 422 + associations unchanged
  - [x] every note response (`POST`/`GET /:id`/`GET /`/`PATCH`) includes `tagIds` (and `[]` when none)

### ✅ Checkpoint 4 (full gate)
```bash
pnpm -w build                          # 0 TS errors
pnpm -w lint --max-warnings 0          # 0 warnings
pnpm --filter backend test             # unit + integration ALL green, ≥80% on new code
# before commit:
npx commitlint --from HEAD~1
```

**Proposed commit:** `feat(tags): add CRUD, per-tag note count, and note associations AB#1006`

---

## Dependency graph (quick reference)

```
T1.1 ─┬─ T1.3 ─────────────────────────────────────────────┐
T1.2 ─┘                                                     │
                                                            │
T2.1 ─┬─ T2.3 ── T2.5 ──┐                                   │
T2.2 ─┘                  ├─ T3.1 → T3.2 → (T4.1 ∥ T4.2 ∥ T4.3 ∥ T4.4)
   └──── T2.4 ───────────┘
   (T1.1 ∥ T1.2 · T2.1 ∥ T2.2 · T2.3 ∥ T2.4 concurrent)
```

`T2.4` needs both repos (T2.1 + T2.2); `T2.3` needs only T2.1; they touch different files so run concurrently once their deps land.

All tasks complete. ✅
