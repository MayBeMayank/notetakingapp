# Technical Plan — AB-1009 Version History

**Change:** `openspec/changes/AB-1009/`
**Branch:** `feat/AB-1009-version-history`
**Layer focus:** backend (+ `packages/shared`, + one Prisma migration)
**Reference contracts:** SDS §6.7 (version endpoints), §9 (version design), §5.1 (status codes); FRS §8.

---

## 1. Scope recap (what this plan implements)

1. **Snapshot on save** (retrofit into `note-crud`): create → version 1; update → new version **only when title/content changed**. Atomic with the note write.
2. **List / view / restore** version endpoints under `/api/notes/:id/versions`.
3. **Tag snapshot**: `NoteVersion.tagIds String[]` column (+ migration); restore re-applies the surviving owned subset.
4. **Retention**: keep most-recent 50, auto-purge oldest, monotonic numbering, current preserved.
5. **Guards**: trashed-note reads allowed, restore blocked (`422 NOTE_DELETED`); no-op restore of latest (`422 VERSION_ALREADY_CURRENT`); non-owned/unknown → `404`.

---

## 2. Architecture decisions (with reasoning)

### D1 — Transaction orchestration lives in the repository layer
Snapshot-on-save must be atomic (note write + version insert + purge). Services must not import Prisma (`backend/CLAUDE.md`), and `prisma.$transaction` is a Prisma construct, so the **transaction wrapper lives in `notes.repository` / `versions.repository`**. The service computes all *business decisions* (resolved title, derived `contentText`, owned `tagIds`, **whether** to snapshot) and hands the repo a fully-resolved instruction; the repo executes it in one `prisma.$transaction(async (tx) => …)`.

### D2 — A single `tx`-taking snapshot helper, reused by create / update / restore
`versions.repository.ts` exposes `snapshotTx(tx, payload)` that (a) computes `versionNumber = max(versionNumber)+1` *inside the transaction* (race-safe via the `@@unique([noteId, versionNumber])` guard), (b) inserts the `NoteVersion`, (c) purges rows beyond the most-recent 50. All three writers (create, update, restore) call it with the same shape, so numbering + retention live in exactly one place (DRY, FRS-8.5).

### D3 — Snapshot decision = "title or content changed"
Per clarification 1, a version is written on create (always) and on update **only** when `input.title !== undefined && differs` **or** `input.content !== undefined`. A tag-only or no-op PATCH writes no version. To keep it simple and predictable, the service treats *any supplied `content`* as a content change (re-deriving `contentText`), and a supplied `title` that differs from the stored title as a title change. Reasoning: TipTap deep-equality on JSON is fragile and the autosave client only sends `content` when the editor changed; treating a present `content` as "changed" matches the existing `updateNote` flow and avoids false negatives.

### D4 — `tagIds` is a denormalized snapshot column, not a join table
Versions must survive tag deletion (FRS-5.5) — a `NoteVersionTag` FK join would cascade-delete the snapshot when a tag is removed, defeating the purpose. A `String[]` column captures the ids as-of-save and is immune to later tag deletion. Restore reconciles against live tags via the existing `findOwnedTagIds` helper. **Recorded in `docs/decisions/ADR-003`; the trashed-note read/restore split is `docs/decisions/ADR-004`.**

### D5 — Restore re-applies only the *surviving owned* tag subset
Restore calls `notesRepo.findOwnedTagIds(userId, version.tagIds)` (existing reuse) → the subset still present and owned. Deleted tags are silently dropped (can't resurrect). The **new** version records the *applied* subset, so history stays truthful (version-history spec scenario "Restore drops tags that have since been deleted").

### D6 — Trashed reads allowed; restore blocked
Version `list`/`view` resolve the note via `findNoteByIdForUser` (which does **not** filter `deletedAt`) → `404` only when no such owned note exists. `restore` additionally asserts `deletedAt === null` → else `422 NOTE_DELETED`. This is exactly the divergence from `getNoteById` (which 404s trashed notes) called out in the proposal.

### D7 — No-op restore detection by max versionNumber
The service fetches the note's latest `versionNumber`; if the target equals it → `422 VERSION_ALREADY_CURRENT`. The most-recent version's title/content equal the note's current state (snapshots are post-save; tag-only edits don't version), so this is a true no-op for title/content.

### D8 — Sub-router with `mergeParams`
`versions.routes.ts` uses `Router({ mergeParams: true })` and is mounted on the existing `notesRouter` via `notesRouter.use('/:id/versions', versionsRouter)`. This keeps the `/api/notes` prefix centralized in `app.ts` (unchanged) and lets version handlers read both `req.params['id']` and `req.params['versionId']`. Routes sit behind the auth middleware already applied before `notesRouter`.

### D9 — List returns a bare array (no pagination envelope)
Per SDS §6.7; bounded by the 50-cap. Matches the `GET /api/tags` bare-array precedent.

---

## 3. Files to create / modify

### Create
| Path | Purpose |
|------|---------|
| `packages/shared/src/schemas/versions.ts` | Zod: version list item, version detail, list response (+ `z.infer` types). |
| `backend/src/repositories/versions.repository.ts` | `snapshotTx`, `listVersions`, `findVersionForNote`, `getLatestVersionNumber`, `restoreVersionTx`. |
| `backend/src/services/versions.service.ts` | `listVersions`, `getVersion`, `restoreVersion` — owns FRS guards. |
| `backend/src/controllers/versions.controller.ts` | `list`, `get`, `restore` (req → service → res). |
| `backend/src/routes/versions.routes.ts` | `Router({ mergeParams: true })` with the three routes. |
| `backend/src/prisma/migrations/<ts>_note_version_tag_ids/migration.sql` | `ALTER TABLE "NoteVersion" ADD COLUMN "tagIds" TEXT[] NOT NULL DEFAULT '{}';` |
| `backend/tests/unit/versions.service.test.ts` | numbering, retention, restore (tags + surviving filter), no-op/trashed guards. |
| `backend/tests/integration/versions.routes.test.ts` | exact §5.1 codes for list/view/restore; snapshot-on-save end-to-end. |

### Modify
| Path | Change |
|------|--------|
| `packages/shared/src/schemas/index.ts` | `export * from './versions.js'`. |
| `backend/src/prisma/schema.prisma` | `NoteVersion` gains `tagIds String[] @default([])`. |
| `backend/src/repositories/notes.repository.ts` | `createNote` and `updateNote` wrap their write + `snapshotTx` in `prisma.$transaction`; `updateNote` gains a `snapshot: boolean` instruction + the snapshot payload. |
| `backend/src/services/notes.service.ts` | `createNote` passes the v1 snapshot payload; `updateNote` computes `shouldSnapshot` (D3) and the post-update payload. |
| `backend/src/routes/notes.routes.ts` | Mount `notesRouter.use('/:id/versions', versionsRouter)`. |
| `backend/tests/integration/notes.routes.test.ts` | Add assertions that create/update produce versions (and tag-only update does not). |

> `app.ts`, the auth middleware, and the error middleware need **no** changes (versions inherit the guard + the existing `AppError` → HTTP mapping; `ConflictError` already maps to 422, `NotFoundError` to 404).

---

## 4. Final shapes — Zod schemas (`packages/shared/src/schemas/versions.ts`)

```ts
import { z } from 'zod'
import { TipTapContentSchema } from './notes.js'

// List item — no content (SDS §6.7 list shape), reverse-chrono ordering applied by the query.
export const VersionListItemSchema = z.object({
  id: z.string(),
  versionNumber: z.number().int(),
  title: z.string(),
  createdAt: z.date(),
})
export const VersionListResponseSchema = z.array(VersionListItemSchema)

// Detail — full content + tag snapshot.
export const VersionDetailSchema = z.object({
  id: z.string(),
  versionNumber: z.number().int(),
  title: z.string(),
  content: TipTapContentSchema,   // API name for contentJson, mirrors NoteResponse
  tagIds: z.array(z.string()),
  createdAt: z.date(),
})
export const VersionEnvelopeSchema = z.object({ version: VersionDetailSchema })

export type VersionListItem = z.infer<typeof VersionListItemSchema>
export type VersionListResponse = z.infer<typeof VersionListResponseSchema>
export type VersionDetail = z.infer<typeof VersionDetailSchema>
export type VersionEnvelope = z.infer<typeof VersionEnvelopeSchema>
```

> Restore responds `{ note }` — it **reuses** `NoteResponseSchema` / `toNoteResponse`; no new schema. There is **no request body** on any version route (params only), so no request schemas / `validateBody`.

---

## 5. Final shapes — backend signatures (no implementation here)

### `repositories/versions.repository.ts`
```ts
import type { Prisma, NoteVersion } from '@prisma/client'

type SnapshotPayload = {
  noteId: string
  title: string
  contentJson: Record<string, unknown>
  contentText: string
  tagIds: string[]
}
// computes next versionNumber, inserts, purges beyond most-recent 50 — all on `tx`
export function snapshotTx(tx: Prisma.TransactionClient, p: SnapshotPayload): Promise<NoteVersion>

export function listVersions(noteId: string): Promise<
  Pick<NoteVersion, 'id' | 'versionNumber' | 'title' | 'createdAt'>[]   // ORDER BY versionNumber DESC
>
export function findVersionForNote(noteId: string, versionId: string): Promise<NoteVersion | null>
export function getLatestVersionNumber(noteId: string): Promise<number | null>

// restore: in one tx — update note (title/content + replace tags with survivingTagIds), then snapshotTx(restored state)
export function restoreVersionTx(args: {
  userId: string
  noteId: string
  title: string
  contentJson: Record<string, unknown>
  contentText: string
  survivingTagIds: string[]
}): Promise<NoteWithTagIds>   // reuse the NoteWithTagIds type from notes.repository
```

### `repositories/notes.repository.ts` (modified)
```ts
// createNote: prisma.$transaction(tx => { note = tx.note.create(...); snapshotTx(tx, {title, contentJson, contentText, tagIds: tagIds ?? []}); return note })
// updateNote(userId, id, data, opts: { snapshot: boolean; snapshotTagIds: string[] }):
//   prisma.$transaction(tx => { updated = tx.note.update(...); if (opts.snapshot) snapshotTx(tx, post-update state); return updated })
```

### `services/versions.service.ts`
```ts
export function listVersions(userId: string, noteId: string): Promise<VersionListResponse>
//   note = findNoteByIdForUser(userId, noteId); if (!note) 404; return listVersions(noteId) mapped to items

export function getVersion(userId: string, noteId: string, versionId: string): Promise<VersionDetail>
//   note = findNoteByIdForUser(...); if (!note) 404; v = findVersionForNote(noteId, versionId); if (!v) 404; map → detail

export function restoreVersion(userId: string, noteId: string, versionId: string): Promise<NoteResponse>
//   note = findNoteByIdForUser(...); if (!note) 404
//   if (note.deletedAt) throw ConflictError('NOTE_DELETED', …)            // 422 (D6)
//   v = findVersionForNote(noteId, versionId); if (!v) 404
//   latest = getLatestVersionNumber(noteId); if (v.versionNumber === latest) throw ConflictError('VERSION_ALREADY_CURRENT', …)  // 422 (D7)
//   surviving = notesRepo.findOwnedTagIds(userId, v.tagIds)               // D5 reuse
//   restored = restoreVersionTx({ userId, noteId, title: v.title, contentJson: v.contentJson, contentText: v.contentText, survivingTagIds: surviving })
//   return toNoteResponse(restored)   // reuse — may need to export toNoteResponse from notes.service or a small shared mapper
```

> **Mapper reuse note:** `toNoteResponse` is currently a private fn in `notes.service.ts`. Plan: export it (or lift it to a tiny `notes.mapper.ts`) so `versions.service` returns an identical `{ note }` shape without duplication.

### `controllers/versions.controller.ts`
```ts
export async function list(req, res)    { res.status(200).json(await versionsService.listVersions(req.userId, req.params.id)) }            // bare array
export async function get(req, res)     { res.status(200).json({ version: await versionsService.getVersion(req.userId, req.params.id, req.params.versionId) }) }
export async function restore(req, res) { res.status(200).json({ note: await versionsService.restoreVersion(req.userId, req.params.id, req.params.versionId) }) }
```

### `routes/versions.routes.ts`
```ts
export const versionsRouter = Router({ mergeParams: true })
versionsRouter.get('/', versionsController.list)
versionsRouter.get('/:versionId', versionsController.get)
versionsRouter.post('/:versionId/restore', versionsController.restore)
```

---

## 6. DB change — backward compatibility

- **Additive, non-breaking.** New column `tagIds TEXT[] NOT NULL DEFAULT '{}'`. Existing `NoteVersion` rows (there are none in any real flow yet, since nothing writes them) get the default empty array. No data backfill required.
- Generated via `pnpm --filter backend prisma migrate dev --name note_version_tag_ids` — **[ASK FIRST]** (mutates DB schema). Then `prisma generate` regenerates the client (so `tagIds` appears on the `NoteVersion` type).
- No index needed on `tagIds` (never queried by tag; only read back on restore for a specific version).
- The existing `@@unique([noteId, versionNumber])` and `@@index([noteId, createdAt])` are sufficient for numbering + reverse-chrono listing.

---

## 7. Reuse of existing shared code (no duplication)

| Reused | From | Used for |
|--------|------|----------|
| `deriveContentText`, `EMPTY_TIPTAP_DOC` | `backend/src/lib/content.ts` | snapshot `contentText`; already used by create/update |
| `findOwnedTagIds(userId, ids)` | `notes.repository.ts` | restore surviving-tag filter (D5) |
| `toNoteResponse` / `NoteResponseSchema` | `notes.service.ts` / shared `notes.ts` | restore `{ note }` response |
| `TipTapContentSchema` | shared `notes.ts` | version `content` field |
| `NotFoundError`, `ConflictError`, `AppError` middleware | `lib/errors.ts`, `error.middleware.ts` | 404 / 422 mapping (no new error infra) |
| auth middleware (`req.userId`) | `middleware/auth.middleware.ts` | ownership scoping; 401 |
| `NoteWithTagIds` type | `notes.repository.ts` | restore return type |

---

## 8. Test plan (one named test per FRS criterion)

**Unit — `versions.service.test.ts`** (mock repo):
- FRS-8.1: create writes v1; update on content change writes next version; tag-only/no-op update writes none (D3).
- FRS-8.5: 51st insert purges lowest; numbering monotonic with gaps; current preserved.
- FRS-8.4: restore copies title/content; appends new version; original untouched; surviving-tag filter drops deleted tag (D5).
- D7: restore latest → `VERSION_ALREADY_CURRENT`. D6: restore on trashed → `NOTE_DELETED`.

**Integration — `versions.routes.test.ts`** (Supertest + test DB):
- `GET /versions` → 200 reverse-chrono array; trashed note → 200 (D6); non-owned → 404; no token → 401.
- `GET /versions/:versionId` → 200 detail w/ content+tagIds; wrong note → 404; unknown → 404.
- `POST /versions/:versionId/restore` → 200 `{ note }` (new version present); latest → 422; trashed → 422; non-owned → 404.
- Snapshot-on-save: create then list → 1 version; content update → +1; tag-only update → +0.

**Coverage:** ≥ 80% on new code (DoD). Every version-history + modified note-crud scenario maps to one test.

---

## 9. Checkpoints (run in order)

**After schema + migration:**
```bash
pnpm --filter backend prisma generate          # safe — regenerate client with tagIds
```

**After each phase + before commit:**
```bash
pnpm -w build                                   # 0 TS errors (shared types propagate)
pnpm -w lint --max-warnings 0                   # 0 lint errors
pnpm --filter backend test                      # unit + integration green (needs test Postgres)
```

**Before commit:**
```bash
npx commitlint --from HEAD~1                     # message format
# Husky pre-commit must pass — never --no-verify
```

Commit scope: `feat(versions): …` (and the schema commit may use `feat(db): …` / `chore(db): …`). Branch already `feat/AB-1009-version-history`.

---

## 10. Risks & watch-items

- **Test DB required** — integration tests need a running test Postgres with the new migration applied (`.env.test`). Confirm before running `pnpm --filter backend test`.
- **Transaction retrofit** — wrapping create/update changes their internals; the existing `notes.routes.test.ts` must stay green (response shapes unchanged). Run the full notes suite after the retrofit.
- **`toNoteResponse` export** — small refactor to share the mapper; keep it a pure function (no behavior change) so existing notes tests are unaffected.
- **`mergeParams`** — without it, `req.params.id` is undefined in the sub-router. Covered by an integration test hitting the nested path.
- **Build order** — AB-1007/1008 routers absent on this branch; FRS-8.6's share-link enforcement is asserted only (verified when AB-1008 lands). No functional dependency for AB-1009.

---

## 11. Suggested implementation order (for `/tasks`)

1. Shared `versions.ts` schema + index export → `pnpm -w build`.
2. Prisma `tagIds` column + migration **[ASK]** → `prisma generate`.
3. `versions.repository.ts` (`snapshotTx`, list, find, latest, restoreTx).
4. Retrofit `notes.repository.ts` create/update transactions + `notes.service.ts` snapshot decision; export `toNoteResponse`.
5. `versions.service.ts` (list/get/restore guards).
6. `versions.controller.ts` + `versions.routes.ts` + mount on `notesRouter`.
7. Unit tests → integration tests → full suite + lint + build.
