# Frontend — Claude Code Guide

## Commands
```bash
pnpm --filter frontend dev         # Vite dev server
pnpm --filter frontend test        # Vitest unit tests
pnpm --filter frontend e2e         # Playwright E2E (required for user-facing features)
pnpm --filter frontend build       # tsc + Vite build
pnpm -w lint                       # ESLint (run before every commit)
```

## Feature structure
```
src/features/<domain>/   # auth | notes | tags | search | share | versions
src/pages/               # route-level screens (thin — delegate to features)
src/components/          # shadcn/ui-based reusable primitives
src/api/                 # TanStack Query hooks → backend calls
src/stores/              # Zustand — client-only state (not server state)
```

## State management
- **Server state** (notes, tags, search results): TanStack Query only. No manual fetch + useState.
- **Client state** (UI toggles, editor draft, modal open): Zustand stores.
- Do not mix the two: don't store API responses in Zustand.

## Validation
- Import Zod schemas from `@note-app/shared/schemas/*` for all form validation.
- Never redefine a shape that already exists in shared.

## TipTap (rich-text editor)
- Store content as `contentJson` (TipTap JSON) and send `contentText` (plaintext) to the backend.
- Always derive `contentText` from the editor state before sending a save request.
- Autosave triggers an update; blank notes are valid (FRS-4.1.2).

## Routing
- Public share view: `/s/:token` → calls `GET /api/public/notes/:token` (no auth).
- All other note routes require an authenticated session.

## Anti-patterns
- ❌ Fetch calls outside `src/api/` hooks
- ❌ Server state in Zustand
- ❌ Hand-authored types that duplicate a shared Zod schema (`z.infer<>` only)
- ❌ Exposing tags, versions, or owner info on the public share view
- ❌ Skipping E2E tests for user-facing feature changes
- ❌ Business logic in pages — push it into feature modules
