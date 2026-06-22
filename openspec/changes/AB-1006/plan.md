# Technical Plan — AB-1006 (Tags: CRUD + note count + note associations)

**Change:** `openspec/changes/AB-1006/`
**Branch:** `feat/AB-1006-tags-crud`
**Status:** awaiting approval — no implementation yet.

This plan realizes the two capability deltas:
- **`tag-management`** (new) — `POST/GET/PATCH/DELETE /api/tags`.
- **`note-crud`** (modified) — `tagIds` on note create/update + `tagIds` in every note response.

It follows the established `auth`/`notes` stack patterns exactly: `routes → controllers → services → repositories → Prisma`, shared Zod schemas, `AppError` subclasses mapped by the central error middleware, pre-check duplicate handling, and Vitest/Supertest tests.

---

## 1. Architecture decisions (with reasoning)

| # | Decision | Reasoning |
|---|----------|-----------|
| D1 | **No DB migration.** `Tag` (`@@unique([userId, name])`) and `NoteTag` (PK `[noteId, tagId]`, cascade from both sides) already exist (AB-1001 init). | Schema already covers everything; FRS-5.5 (delete tag → keep notes) is satisfied by the existing `onDelete: Cascade` on `NoteTag.tag`. Backward compatible — zero schema risk. |
| D2 | **Duplicate tag name → pre-check, not P2002 catch.** Service lower-cases the name, calls `tagsRepo.findByName(userId, name)` (excluding own id on rename), throws `ConflictError('TAG_NAME_TAKEN')`. | Matches the existing `auth.service.register` dup-email pattern (consistency). The `@@unique([userId, name])` constraint remains the DB-level backstop. |
| D3 | **`name` normalization split:** Zod schema **trims + length-checks**; service **lower-cases** before dup-check and write. | Trim/length is input validation (boundary, shared with frontend); lower-casing is a business rule (SDS §3: v1 stores normalized) → belongs in the service. Whitespace-only name trims to `""` → `min(1)` fails → 400. |
| D4 | **`noteCount` via filtered `_count`** in one query: `_count: { select: { notes: { where: { note: { deletedAt: null } } } } }`. | Prisma 6.19.3 supports filtered relation counts (GA). One round-trip, excludes soft-deleted notes (FRS-5.6 / 4.4.2). No N+1. |
| D5 | **`tagIds` write is atomic & full-replace.** Ownership validated first (`tagsRepo.countOwned(userId, ids) === uniqueIds.length`, else `ConflictError('INVALID_TAG_IDS')`); then a **single** Prisma `create`/`update` with nested `tags: { create }` (create) or `tags: { deleteMany: {}, create }` (update). | Nested writes run in one implicit transaction → no partial application (atomicity requirement from the spec). Validating ownership up front gives the 422 before any write. |
| D6 | **Note reads include `tags: { select: { tagId: true } }`;** service maps `tagIds = note.tags.map(t => t.tagId)`. | Cheapest way to surface `tagIds` on every note response without a second query. Only `tagId` is selected (no tag rows hydrated). |
| D7 | **`tagIds` de-duplicated** in the service (`[...new Set(input.tagIds)]`) before count/apply. | Idempotent attach; satisfies the "duplicate ids de-duplicated" scenario; keeps the ownership count check correct. |
| D8 | **`GET /api/tags` returns a bare array** (no pagination envelope); single-tag responses (`POST`/`PATCH`) return `{ tag }` **without** `noteCount`. | Matches SDS §6.4 exactly (binding). |

---

## 2. Files to create / modify

### `packages/shared` (edit first — backend imports its built `dist`)

| Path | Action | Contents |
|------|--------|----------|
| `packages/shared/src/schemas/tags.ts` | **create** | `CreateTagSchema`, `UpdateTagSchema`, `TagResponseSchema`, `TagWithCountSchema`, `TagEnvelopeSchema`, `TagListResponseSchema` + inferred types |
| `packages/shared/src/schemas/notes.ts` | **modify** | add `tagIds` to `CreateNoteSchema` & `UpdateNoteSchema` (+ update the `UpdateNoteSchema` `.refine`); add `tagIds` to `NoteResponseSchema` |
| `packages/shared/src/schemas/index.ts` | **modify** | add `export * from './tags.js'` |

### `backend/src`

| Path | Action | Contents |
|------|--------|----------|
| `backend/src/repositories/tags.repository.ts` | **create** | `createTag`, `findTagByIdForUser`, `findByName`, `listTagsWithCount`, `updateTag`, `deleteTag`, `countOwned` |
| `backend/src/repositories/notes.repository.ts` | **modify** | add `tags: { select: { tagId: true } }` include to reads; accept/apply `tagIds` on `createNote`/`updateNote`; return `NoteWithTagIds` |
| `backend/src/services/tags.service.ts` | **create** | owns FRS-5 rules: lower-case, dup → 422, ownership → 404, `noteCount`, `toTagResponse` |
| `backend/src/services/notes.service.ts` | **modify** | validate `tagIds` ownership (→ 422 `INVALID_TAG_IDS`), de-dupe, pass to repo, add `tagIds` to `toNoteResponse` |
| `backend/src/controllers/tags.controller.ts` | **create** | `create`/`list`/`update`/`remove` — `req`/`res` mapping only |
| `backend/src/controllers/notes.controller.ts` | **no change** | already forwards `req.body`; the extended schema flows through |
| `backend/src/routes/tags.routes.ts` | **create** | `Router` with `validateBody` on POST/PATCH |
| `backend/src/app.ts` | **modify** | mount `app.use('/api/tags', tagsRouter)` after `authMiddleware` |

### `backend/tests`

| Path | Action |
|------|--------|
| `backend/tests/unit/tags.service.test.ts` | **create** — lower-case dedup, dup → 422, ownership → 404, noteCount excludes deleted |
| `backend/tests/integration/tags.routes.test.ts` | **create** — exact SDS §5.1 codes for all 4 tag routes |
| `backend/tests/unit/notes.service.test.ts` | **modify** — `tagIds` validation, dedupe, full-replace, foreign → 422 |
| `backend/tests/integration/notes.routes.test.ts` | **modify** — create/patch with `tagIds`, `[]` detaches, foreign id → 422, response carries `tagIds` |

---

## 3. Final shapes (TypeScript / Zod)

### `packages/shared/src/schemas/tags.ts`
```ts
import { z } from 'zod'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export const CreateTagSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(50, 'name must be at most 50 characters'),
  color: z.string().regex(HEX_COLOR, 'color must be a #RRGGBB hex value'),
})

export const UpdateTagSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    color: z.string().regex(HEX_COLOR, 'color must be a #RRGGBB hex value').optional(),
  })
  .refine((d) => d.name !== undefined || d.color !== undefined, {
    message: 'At least one of name or color must be provided',
  })

export const TagResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const TagWithCountSchema = TagResponseSchema.extend({ noteCount: z.number() })
export const TagEnvelopeSchema = z.object({ tag: TagResponseSchema })
export const TagListResponseSchema = z.array(TagWithCountSchema)

export type CreateTagInput = z.infer<typeof CreateTagSchema>
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>
export type TagResponse = z.infer<typeof TagResponseSchema>
export type TagWithCount = z.infer<typeof TagWithCountSchema>
export type TagListResponse = z.infer<typeof TagListResponseSchema>
```

### `packages/shared/src/schemas/notes.ts` (additions)
```ts
// new: optional tag-id set on create/update
const TagIdsSchema = z.array(z.string()).optional()

export const CreateNoteSchema = z.object({
  title: z.string().max(255).optional(),
  content: TipTapContentSchema.optional(),
  tagIds: TagIdsSchema,                       // ← added
})

export const UpdateNoteSchema = z
  .object({
    title: z.string().max(255).optional(),
    content: TipTapContentSchema.optional(),
    tagIds: TagIdsSchema,                      // ← added
  })
  .refine(
    (d) => d.title !== undefined || d.content !== undefined || d.tagIds !== undefined,
    { message: 'At least one of title, content, or tagIds must be provided' },
  )

export const NoteResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: TipTapContentSchema,
  tagIds: z.array(z.string()),                 // ← added (always present, [] when none)
  createdAt: z.date(),
  updatedAt: z.date(),
})
```

### `backend/src/repositories/tags.repository.ts` (signatures)
```ts
import { prisma } from '../lib/prisma.js'
import type { Tag } from '@prisma/client'

export type TagWithCount = Tag & { _count: { notes: number } }

export function createTag(data: { userId: string; name: string; color: string }): Promise<Tag>
export function findTagByIdForUser(userId: string, id: string): Promise<Tag | null>
// excludeId lets PATCH allow renaming a tag to its own current name
export function findByName(userId: string, name: string, excludeId?: string): Promise<Tag | null>
export function listTagsWithCount(userId: string): Promise<TagWithCount[]>   // filtered _count, orderBy name asc
export function updateTag(userId: string, id: string, data: { name?: string; color?: string }): Promise<Tag>
export function deleteTag(userId: string, id: string): Promise<void>         // cascade removes NoteTag rows
export function countOwned(userId: string, ids: string[]): Promise<number>   // tag.count where userId, id in ids
```
`listTagsWithCount` body:
```ts
prisma.tag.findMany({
  where: { userId },
  orderBy: { name: 'asc' },
  include: { _count: { select: { notes: { where: { note: { deletedAt: null } } } } } },
})
```

### `backend/src/repositories/notes.repository.ts` (changes)
```ts
const TAG_IDS_INCLUDE = { tags: { select: { tagId: true } } } as const
export type NoteWithTagIds = Note & { tags: { tagId: string }[] }

// create: nest tag rows when ids provided
prisma.note.create({
  data: { userId, title, contentJson, contentText,
    ...(tagIds && { tags: { create: tagIds.map((tagId) => ({ tagId })) } }) },
  include: TAG_IDS_INCLUDE,
})

// update: full-replace only when tagIds supplied
prisma.note.update({
  where: { id, userId },
  data: { ...fields,
    ...(tagIds !== undefined && { tags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) } }) },
  include: TAG_IDS_INCLUDE,
})
// findNoteByIdForUser / listNotesWithCount also add include: TAG_IDS_INCLUDE
```

### `backend/src/services/notes.service.ts` (`toNoteResponse` + validation)
```ts
function toNoteResponse(note: NoteWithTagIds): NoteResponse {
  return { id, title, content: note.contentJson, tagIds: note.tags.map((t) => t.tagId), createdAt, updatedAt }
}

async function assertOwnedTags(userId: string, tagIds: string[]): Promise<string[]> {
  const ids = [...new Set(tagIds)]
  if (ids.length === 0) return ids
  const owned = await tagsRepo.countOwned(userId, ids)
  if (owned !== ids.length) throw new ConflictError('INVALID_TAG_IDS', 'One or more tags are invalid')
  return ids
}
// createNote: if input.tagIds -> assertOwnedTags then pass deduped ids to repo
// updateNote: if input.tagIds !== undefined -> assertOwnedTags (allows []) then pass to repo
```

### `backend/src/services/tags.service.ts` (rules)
```ts
const norm = (name: string) => name.toLowerCase()   // already trimmed by Zod

createTag(userId, input):  name = norm(input.name); if findByName(userId,name) -> ConflictError('TAG_NAME_TAKEN'); create
listTags(userId):          map listTagsWithCount -> { ...toTagResponse(t), noteCount: t._count.notes }
updateTag(userId, id, in): tag = findTagByIdForUser || NotFoundError;
                           if in.name: name = norm(in.name); if findByName(userId,name,id) -> ConflictError('TAG_NAME_TAKEN')
                           updateTag(...)
deleteTag(userId, id):     if !findTagByIdForUser -> NotFoundError; deleteTag(...)  // 204
```

### `backend/src/routes/tags.routes.ts`
```ts
export const tagsRouter: RouterType = Router()
tagsRouter.post('/',     validateBody(CreateTagSchema), tagsController.create)
tagsRouter.get('/',      tagsController.list)
tagsRouter.patch('/:id', validateBody(UpdateTagSchema), tagsController.update)
tagsRouter.delete('/:id', tagsController.remove)
```

---

## 4. Reuse of existing code (no duplication)

- `lib/errors.ts` — `NotFoundError` (404), `ConflictError(code,msg)` (422). New codes: `TAG_NAME_TAKEN`, `INVALID_TAG_IDS`. **No new error class.**
- `middleware/validate.middleware.ts` — `validateBody`. **As-is.**
- `middleware/auth.middleware.ts` + `types/express.d.ts` — `req.userId`. **As-is.**
- `middleware/error.middleware.ts` — maps `AppError` → envelope. **As-is.**
- `lib/prisma.ts` — shared client. **As-is.**
- Controller/service/repo layering, `import … from '@note-app/shared/schemas/*'`, `.js` ESM specifiers — mirror `notes.*`.
- Tests: `registerAndLogin` helper + `beforeEach` cleanup order (already deletes `noteTag`/`tag`) — reuse from `notes.routes.test.ts`.

---

## 5. DB changes

**None — backward compatible.** No migration, column, or index. Verified `Tag`, `NoteTag` exist in `schema.prisma` with the required `@@unique([userId, name])`, composite PK, `@@index([tagId])`, and cascade deletes.

---

## 6. Build / test / lint checkpoints

Run in this order (CLAUDE.md quality gates). **Shared builds first** so the backend can resolve the new `@note-app/shared/schemas/tags` types.

```bash
# after editing packages/shared
pnpm --filter @note-app/shared build      # emit dist for consumers

# after backend edits, at each checkpoint
pnpm -w lint                               # zero errors
pnpm --filter backend test                 # Vitest unit + Supertest integration (needs test Postgres)
pnpm -w build                              # zero TS errors across workspace
```

Before commit: `npx commitlint --from HEAD~1` + Husky pre-commit must pass. Commit style: `feat(tags): …`. **≥ 80 % coverage on new code.**

> Integration tests require the test PostgreSQL instance (`.env.test`) — confirm it is populated before `pnpm --filter backend test`.

---

## 7. Suggested implementation order (feeds `/tasks`)

1. `packages/shared` — `schemas/tags.ts`, notes schema additions, index export → build shared.
2. `tags.repository.ts` (+ notes repo `tagIds`/include changes).
3. `tags.service.ts` (+ notes service `assertOwnedTags` & `toNoteResponse`).
4. `tags.controller.ts` + `tags.routes.ts` + mount in `app.ts`.
5. Unit tests (tags service, notes service tagIds) → integration tests (tags routes, notes routes tagIds).
6. Full quality-gate pass + coverage check.

Each step ends green (lint + build + relevant tests) before the next, per the workspace checkpoint rule.
