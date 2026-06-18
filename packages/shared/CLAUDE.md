# packages/shared — Claude Code Guide

## What lives here
```
src/schemas/    # Zod schemas for every API request body, query params, and response shape
src/types/      # TypeScript types inferred from schemas via z.infer<> — no hand-authored types
```

### Current schema modules (one file per domain)
| File | Covers |
|---|---|
| `schemas/auth.ts` | register, login, refresh, logout, forgot-password, reset-password |
| `schemas/notes.ts` | create, update, list query params, note response shape |
| `schemas/tags.ts` | create, update, tag response (with noteCount) |
| `schemas/search.ts` | search query params, search result item |
| `schemas/shares.ts` | create share, share response, public note view |
| `schemas/versions.ts` | version list item, version detail, restore |

## Import pattern
```ts
import { CreateNoteSchema, type CreateNoteInput } from '@note-app/shared/schemas/notes'
```

## Rule: never duplicate what's already here
- Neither `backend` nor `frontend` may define a type or Zod schema that exists in this package.
- If a type exists here and you need it elsewhere, import it — do not redefine it.
- Before adding a new schema, search this package first.

## How to add a new shared item
1. Add the Zod schema to the appropriate `schemas/<domain>.ts` file (or create one for a new domain).
2. Export the inferred type: `export type MyInput = z.infer<typeof MySchema>`.
3. Run `pnpm -w build` to confirm no type errors propagate to consumers.
4. Import in `backend` and `frontend` — never copy-paste the definition.

## Anti-patterns
- ❌ Hand-authored TypeScript interfaces that duplicate a Zod schema
- ❌ Business logic or runtime code — schemas and types only
- ❌ Importing from `backend` or `frontend` (dependency direction is one-way)
