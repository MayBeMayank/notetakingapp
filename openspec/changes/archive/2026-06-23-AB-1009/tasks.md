# Tasks — AB-1009 Version History

**Branch:** `feat/AB-1009-version-history`
**Plan:** `openspec/changes/AB-1009/plan.md` · **Specs:** `specs/{version-history,note-crud,prisma-schema}/spec.md`
**Convention:** check `- [x]` as each task lands; run the phase checkpoint before moving on (don't batch at the end). `[PARALLEL]` = different files, no import dependency.

---

## Phase 1 — Foundation (shared types + DB)

- [x] **1.1 [PARALLEL] Shared `versions.ts` schema** — create `packages/shared/src/schemas/versions.ts` with `VersionListItemSchema`, `VersionListResponseSchema`, `VersionDetailSchema`, `VersionEnvelopeSchema` (+ `z.infer` types), importing `TipTapContentSchema` from `./notes.js`. Add `export * from './versions.js'` to `packages/shared/src/schemas/index.ts`. (No request schema — version routes are param-only. Restore reuses `NoteResponseSchema`.)
- [x] **1.2 [PARALLEL] `NoteVersion.tagIds` column + migration** — applied non-destructively via hand-authored SQL + `migrate deploy` (dev DB had unmerged AB-1007 `search_vector` drift; `migrate dev` reset declined) — add `tagIds String[] @default([])` to `NoteVersion` in `backend/src/prisma/schema.prisma`. **[ASK FIRST]** run `pnpm --filter backend prisma migrate dev --name note_version_tag_ids` (mutates DB), then `pnpm --filter backend prisma generate`. (ADR-003.)

> 1.1 and 1.2 touch disjoint files (shared package vs. backend prisma) with no dependency → parallel. 1.2 pauses for the migration `[y/n]`.

**Checkpoint 1:** `pnpm -w build` → 0 errors · `pnpm -w lint --max-warnings 0` → 0 · (no tests yet)

---

## Phase 2 — Core implementation (services + repositories)

> Sequential chain — each step imports the previous (versions.repo → notes.repo → notes.service → versions.service). No `[PARALLEL]` here.

- [x] **2.1 `versions.repository.ts`** — new `backend/src/repositories/versions.repository.ts`:
  - `snapshotTx(tx, { noteId, title, contentJson, contentText, tagIds })` — compute `versionNumber = max+1` on `tx`, insert `NoteVersion`, purge rows beyond most-recent 50 (`ORDER BY versionNumber DESC OFFSET 50`). (FRS-8.1 / 8.5)
  - `listVersions(noteId)` → `id, versionNumber, title, createdAt` ordered `versionNumber DESC`. (FRS-8.2)
  - `findVersionForNote(noteId, versionId)` → full row or null. (FRS-8.3)
  - `getLatestVersionNumber(noteId)` → number | null. (no-op guard, D7)
  - `restoreVersionTx({ userId, noteId, title, contentJson, contentText, survivingTagIds })` — one `prisma.$transaction`: update note (title/content + replace tags with `survivingTagIds`), then `snapshotTx` the restored state; return `NoteWithTagIds`. (FRS-8.4)
- [x] **2.2 Retrofit `notes.repository.ts` transactions** — wrap `createNote` in `prisma.$transaction` (note create → `snapshotTx` v1 with `tagIds ?? []`); change `updateNote` to accept `opts: { snapshot: boolean; snapshotTagIds: string[] }` and, inside one transaction, update the note and (when `snapshot`) `snapshotTx` the post-update state. Keep return type `NoteWithTagIds` unchanged.
- [x] **2.3 `notes.service.ts` snapshot wiring** — `createNote` already resolves owned `tagIds`; pass them through for the v1 snapshot. `updateNote`: compute `shouldSnapshot = (title supplied & differs) || content supplied` (D3); compute the resolved post-update `tagIds` for the snapshot; pass `{ snapshot, snapshotTagIds }` to the repo. **Export `toNoteResponse`** (lift to a pure exported fn / `notes.mapper.ts`) for reuse — no behavior change.
- [x] **2.4 `versions.service.ts`** — new `backend/src/services/versions.service.ts`:
  - `listVersions(userId, noteId)` — `findNoteByIdForUser` (trashed allowed); null → `NotFoundError`; map rows → `VersionListResponse`. (ADR-004)
  - `getVersion(userId, noteId, versionId)` — note 404 guard; `findVersionForNote` null → 404; map → `VersionDetail` (content + tagIds).
  - `restoreVersion(userId, noteId, versionId)` — note 404; `note.deletedAt` → `ConflictError('NOTE_DELETED')` (ADR-004); version 404; `versionNumber === latest` → `ConflictError('VERSION_ALREADY_CURRENT')` (D7); `survivingTagIds = notesRepo.findOwnedTagIds(userId, version.tagIds)` (D5); `restoreVersionTx(...)`; return `toNoteResponse`.

**Checkpoint 2:** `pnpm -w build` → 0 · `pnpm -w lint --max-warnings 0` → 0 · `pnpm --filter backend test` (existing suites stay green — verify the notes-repo retrofit didn't change response shapes)

---

## Phase 3 — Integration (controller + routes + mount)

> 3.2 imports 3.1 → sequential.

- [x] **3.1 `versions.controller.ts`** — new `backend/src/controllers/versions.controller.ts`: `list` → `200` bare array; `get` → `200 { version }`; `restore` → `200 { note }`. Read `req.userId`, `req.params['id']`, `req.params['versionId']`.
- [x] **3.2 `versions.routes.ts` + mount** — new `backend/src/routes/versions.routes.ts` using `Router({ mergeParams: true })` with `GET /`, `GET /:versionId`, `POST /:versionId/restore`. Mount in `notes.routes.ts`: `notesRouter.use('/:id/versions', versionsRouter)`. (D8 — `app.ts` unchanged.)

**Checkpoint 3:** `pnpm -w build` → 0 · `pnpm -w lint --max-warnings 0` → 0 · `pnpm --filter backend test`

---

## Phase 4 — Tests (one named test per spec scenario)

> All Phase-4 files are disjoint with no cross-imports → parallel.

- [x] **4.1 [PARALLEL] Unit — `backend/tests/unit/versions.service.test.ts`** (mock repos). One test per business-rule scenario:
  - snapshot trigger (FRS-8.1): create→v1; content update→+1; tag-only update→+0; no-op→+0; content+tags→exactly one version.
  - retention (FRS-8.5): 51st insert purges lowest; numbering monotonic with gaps; current preserved.
  - restore (FRS-8.4): copies title/content; appends new version; original untouched; re-applies surviving tags; **drops since-deleted tag** (ADR-003/D5).
  - guards: restore latest → `VERSION_ALREADY_CURRENT` (D7); restore on trashed → `NOTE_DELETED` (ADR-004); note/version not found → `NotFoundError`.
- [x] **4.2 [PARALLEL] Integration — `backend/tests/integration/versions.routes.test.ts`** (Supertest + test DB). One test per HTTP scenario, asserting exact §5.1 codes:
  - list: `200` reverse-chrono array; freshly-created note → 1 item; trashed note → `200` (ADR-004); other user → `404`; no token → `401`.
  - view: `200` detail w/ `content`+`tagIds`; version of wrong note → `404`; unknown → `404`; trashed note → `200`.
  - restore: `200 { note }` + new version present + tags re-applied; latest → `422 VERSION_ALREADY_CURRENT`; trashed → `422 NOTE_DELETED`; other user → `404`; unknown/wrong-note version → `404`.
- [x] **4.3 [PARALLEL] Extend notes tests** — in `backend/tests/integration/notes.routes.test.ts` (+ `unit/notes.service.test.ts` as needed): create produces v1; content update adds a version; **tag-only update adds none**; no-op adds none; foreign-tag create/update → `422` with **no** version written. Confirm note response shapes unchanged.

**Checkpoint 4 (final):** `pnpm -w build` → 0 · `pnpm -w lint --max-warnings 0` → 0 · `pnpm --filter backend test` → all green · coverage ≥ 80% on new code · `npx commitlint --from HEAD~1` passes · Husky pre-commit green (never `--no-verify`).

---

## Traceability

| Spec / ADR | Tasks |
|---|---|
| version-history: list/view (FRS-8.2/8.3) | 2.1, 2.4, 3.1–3.2, 4.1–4.2 |
| version-history: restore (FRS-8.4) | 2.1, 2.4, 3.1–3.2, 4.1–4.2 |
| version-history: retention (FRS-8.5) | 2.1, 4.1 |
| version-history: privacy (FRS-8.6) | 3.2 (auth mount), 4.2 |
| note-crud: snapshot-on-save (FRS-8.1) | 2.2, 2.3, 4.1, 4.3 |
| prisma-schema: `tagIds` (ADR-003) | 1.2 |
| shared schema | 1.1 |
| ADR-003 (tag snapshot) | 1.2, 2.1, 2.4, 4.1 |
| ADR-004 (trashed reads/restore) | 2.4, 4.2 |

## Out of scope (asserted, not built here)
- Public share-link enforcement of FRS-8.6 → AB-1008 (router absent on this branch).
- FRS §12 / SDS §3 doc propagation → at `/openspec-sync-specs` / archive time (ADR-003/004 authoritative meanwhile).
