# Implementation Plan — AB-1014: Share Modal + Active Links

## Overview

Frontend-only change. No DB migrations, no backend endpoints, no new shared Zod
schemas. AB-1014 wires the existing AB-1008 sharing contracts into the SPA:

- **Owner surface** (`share-ui`): a per-note Share modal — generate link with a
  preset expiry, copy URL, list that note's active links + view counts, revoke —
  launched from the editor header and from note cards.
- **Public surface** (`public-share-view-ui`): an unauthenticated `/s/:token` page
  rendering the note's current title + read-only content.

It follows patterns already established by the notes editor (TipTap setup),
`DeleteNoteButton` (mutation + `ConfirmDialog`), and the `api/*.ts` TanStack Query
hooks.

---

## Files to Create / Modify

### New files

| File | Purpose |
|---|---|
| `frontend/src/api/shares.ts` | TanStack Query hooks: `useNoteShares`, `useCreateShare`, `useRevokeShare`, `usePublicNote` |
| `frontend/src/features/share/expiryPresets.ts` | Preset durations → strictly-future ISO datetime (`null` for "Never") |
| `frontend/src/features/share/shareUrl.ts` | `toAbsoluteShareUrl(relativeUrl)` — prepend `window.location.origin` |
| `frontend/src/features/share/ShareModal.tsx` | Overlay: create control + active-links list + states |
| `frontend/src/features/share/CreateShareForm.tsx` | Expiry `<Select>` + Generate button |
| `frontend/src/features/share/ShareLinkRow.tsx` | One link: URL, expiry, viewCount, Copy, Revoke |
| `frontend/src/features/share/ShareButton.tsx` | Entry-point button that opens `ShareModal` |
| `frontend/src/features/share/PublicNoteView.tsx` | Read-only TipTap render of `{ title, content }` |
| `frontend/src/pages/PublicSharePage.tsx` | Route-level `/s/:token` (loading / not-found / gone / loaded) |

### New test files (Vitest, co-located)

| File | Asserts |
|---|---|
| `frontend/src/features/share/expiryPresets.test.ts` | Never → null; "7 days" → future ISO ~+7d |
| `frontend/src/features/share/shareUrl.test.ts` | relative `/s/x` → `origin + /s/x` |
| `frontend/src/api/shares.test.tsx` | `useNoteShares` filters by `noteId`; create/revoke invalidate |
| `frontend/src/features/share/ShareModal.test.tsx` | empty state, list render, generate, 422→message |
| `frontend/src/features/share/ShareLinkRow.test.tsx` | copy + revoke-with-confirm |
| `frontend/src/pages/PublicSharePage.test.tsx` | loading / 404 / 410 / loaded states |

### Modified files

| File | Change |
|---|---|
| `frontend/src/App.tsx` | Add **unguarded** `<Route path="/s/:token" element={<PublicSharePage />} />` before the `*` catch-all |
| `frontend/src/features/notes/NoteEditor.tsx` | Add `<ShareButton noteId={note.id} />` in the header row |
| `frontend/src/features/notes/NoteCard.tsx` | Add `<ShareButton noteId={note.id} />` in the **active** branch `CardFooter` only |

No changes to `packages/shared`, `backend`, or any `.env` file.

---

## Architecture Decisions

### AD-1: One domain API module `api/shares.ts`; public fetch is `auth: false`

All share hooks live in `frontend/src/api/shares.ts` (one-file-per-domain
precedent). Owner hooks (`useNoteShares`, `useCreateShare`, `useRevokeShare`) use
the authenticated `apiFetch` (token + 401-refresh). `usePublicNote(token)` calls
`apiFetch('/public/notes/:token', { auth: false })` so no `Authorization` header is
sent (FRS-7.3 — no auth required). The public read consumes `PublicNoteViewSchema`,
already exported from the shares schema module.

### AD-2: Frontend read types use `string` dates (notes-list precedent)

`ShareResponseSchema` declares `expiresAt`/`createdAt` as `z.date()`, but JSON over
the wire delivers ISO **strings**. Following the documented AB-1011 precedent
(`NoteListItem` in `api/notes.ts`, AD-3), `api/shares.ts` defines a local read type
with string dates rather than coercing. This is the established, accepted deviation
— not a duplicate business shape.

```ts
// frontend/src/api/shares.ts
export interface ShareLinkItem {
  id: string
  noteId: string
  token: string
  url: string            // relative "/s/<token>"
  expiresAt: string | null
  viewCount: number
  createdAt: string
}
```

### AD-3: Active-links list scoped client-side by `noteId`

`GET /api/shares` returns a **bare array** spanning all the caller's notes
(no per-note endpoint exists). `useNoteShares(noteId)` fetches that array and
returns `data.filter(s => s.noteId === noteId)` via `select`, so the modal shows
exactly the current note's links (decision: per-note modal). `total`/pagination is
not involved — the contract is a bare array.

### AD-4: Preset expiry → ISO at submit; "Never" → `null`

`expiryPresets.ts` maps `'never' | '1d' | '7d' | '30d'` to either `null` or
`new Date(Date.now() + days*86_400_000).toISOString()`. The value is computed at
**submit** time (not render) so it is always strictly in the future when
`CreateShareSchema`'s `.refine(future)` runs server-side. No datetime picker.

### AD-5: Modal reuses the self-rolled overlay pattern; revoke uses `ConfirmDialog`

`ShareModal` is a controlled overlay built exactly like `ConfirmDialog`
(`role="dialog"`, `aria-modal`, Escape + backdrop dismiss) — no new dialog
dependency. Revoke is a destructive action, so `ShareLinkRow` reuses the existing
`ConfirmDialog` for confirmation, mirroring `DeleteNoteButton`.

### AD-6: Public viewer renders read-only TipTap

`PublicNoteView` mounts `useEditor({ extensions: [StarterKit], content, editable:
false })` + `EditorContent` — the same extension set the editor uses, so content
renders identically but with no toolbar, autosave, tags, or version UI (FRS-7.3,
FRS-7.8). The page never requests tags/versions/owner; it calls only the public
endpoint.

### AD-7: Share action gated to active notes

`ShareButton` is rendered only in `NoteCard`'s `active` branch and in the editor
header (which only mounts for a loaded, non-deleted note). A `422 NOTE_DELETED` on
create (note trashed after the modal opened) is still handled in-modal as a
readable message (FRS-7.6 create-side).

### AD-8: Query keys + invalidation

`SHARES_QUERY_KEY = ['shares']` (single cached array). `useCreateShare` and
`useRevokeShare` invalidate `['shares']` on success, so the per-note `select`
recomputes. `usePublicNote` keys on `['public-note', token]`, `retry: false` so
404/410 surface immediately, no token attached.

---

## TypeScript Shapes

Imported from `@note-app/shared/schemas/shares` (no redefinition of business
shapes):

```ts
import {
  type CreateShareInput,      // { expiresAt?: string | null }
  type ShareEnvelope,         // { share: ShareResponse }  — POST result
  PublicNoteViewSchema,       // { title, content }        — public GET result
} from '@note-app/shared/schemas/shares'
```

Frontend-local (string-date read view + UI enums), in `api/shares.ts` /
`expiryPresets.ts`:

```ts
export interface ShareLinkItem { /* see AD-2 */ }

export type ExpiryPreset = 'never' | '1d' | '7d' | '30d'
export function presetToExpiresAt(p: ExpiryPreset): string | null
```

Hook signatures:

```ts
export function useNoteShares(noteId: string):
  UseQueryResult<ShareLinkItem[], ApiError>            // filtered by noteId
export function useCreateShare(noteId: string):
  UseMutationResult<ShareEnvelope, ApiError, CreateShareInput>
export function useRevokeShare():
  UseMutationResult<void, ApiError, string>            // arg = shareId
export function usePublicNote(token: string):
  UseQueryResult<{ title: string; content: unknown }, ApiError>
```

---

## Component Tree

```
NoteEditor header ─┐
NoteCard (active) ─┴─ ShareButton  (opens modal)
                      └── ShareModal { noteId, open, onClose }
                          ├── CreateShareForm { noteId }     ── useCreateShare
                          │     └── Select (expiry presets) + Generate Button
                          ├── [loading]  list skeleton       ── useNoteShares
                          ├── [error]    retry message
                          ├── [empty]    "No active links…"
                          └── ShareLinkRow × N { share }      ── useRevokeShare
                                ├── URL + Copy Button         ── shareUrl + clipboard
                                ├── expiry + viewCount
                                └── Revoke Button + ConfirmDialog

PublicSharePage (route /s/:token)            ── usePublicNote(token)
  ├── [loading] spinner
  ├── [404]     "This share link doesn't exist"
  ├── [410]     "This share link is no longer available"
  └── PublicNoteView { title, content }      ── read-only TipTap
```

---

## Reused Components / Utilities

| Reused from | Used in |
|---|---|
| `apiFetch`, `ApiError` (`@/api/client`) | all hooks; `auth:false` path for public |
| `ConfirmDialog` (`@/components/ui/confirm-dialog`) | revoke confirmation; modal overlay pattern reference |
| `Button`, `Card`, `Select`, `Input` (`@/components/ui/*`) | modal + rows + form |
| `useEditor`, `EditorContent`, `StarterKit` (TipTap) | `PublicNoteView` (`editable:false`) |
| `toast` (`sonner`) | copy success/failure feedback |
| `DeleteNoteButton` pattern | shape of `ShareLinkRow` revoke (mutation + confirm) |

---

## DB Changes

None. Backend, migration, and the public endpoint were delivered in AB-1008 and are
unchanged. This plan is additive on the frontend only — fully backward compatible.

---

## Quality Gates

Run in order after implementation:

```bash
pnpm -w lint                    # zero ESLint errors
pnpm --filter frontend test     # Vitest: expiry presets, shareUrl, hook filter,
                                # modal generate/empty/422, row copy+revoke,
                                # public page 404/410/loaded
pnpm -w build                   # zero TypeScript errors (note: tsc --noEmit runs in CI;
                                # build alone skips tsc — run tsc --noEmit if unsure)
pnpm --filter frontend dev      # manual smoke: open modal, generate (Never + 7d),
                                # copy URL, revoke; open /s/:token anonymously
```

E2E (`pnpm --filter frontend e2e`) is required for this user-facing feature
(CLAUDE.md Quality Gate 5): generate a link → open `/s/:token` in a fresh context →
see content → revoke → reload `/s/:token` → see "no longer available".

---

## What This Plan Does NOT Do

- No `packages/shared` changes — share + public schemas already exist
- No backend or migration changes
- No Zustand store — modal open/close is local component state; link data is server
  state via TanStack Query
- No global "all shares" management page (active-links list is per-note)
- No datetime picker (preset durations only)
- No view-count polling/realtime — count reflects what `GET /api/shares` returned
