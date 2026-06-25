# Proposal — AB-1014: Frontend Share Modal + Active Links

## Why

The sharing backend (AB-1008) is fully implemented: an owner can mint, list, and
revoke public share links (`/api/notes/:id/shares`, `/api/shares`,
`/api/shares/:id`), and an unauthenticated viewer can read a shared note through
`GET /api/public/notes/:token`. None of this is reachable from the SPA today.

AB-1014 delivers the user-facing surface: a **Share modal** launched from the note
editor and from each note card, where an owner generates a read-only link (with an
optional expiry), copies its URL, sees that note's active links with their view
counts, and revokes any of them. It also delivers the **public viewer page**
(`/s/:token`) so a generated link actually resolves to a clean, read-only rendering
of the note — closing the loop between the sharing capability and real usage.

## What Changes

**In scope** (the frontend slice of FRS §7):

- FRS-7.1 — UI to generate a public, read-only share link for one of the user's own active notes
- FRS-7.2 — optional expiry chosen via preset durations (Never / 1 day / 7 days / 30 days), sent as a strictly-future ISO datetime
- FRS-7.3 — public viewer page at `/s/:token` showing the note's **current** title + content, read-only, no edit controls, no authentication required
- FRS-7.4 — display each link's view count (incremented atomically server-side on each public view)
- FRS-7.5 — UI to revoke a link, immediately removing it from the active list
- FRS-7.6 — public viewer surfaces "gone" when the link is revoked/expired or its note is soft-deleted (410); creating a share on a soft-deleted note surfaces its 422
- FRS-7.7 — list the current note's active share links, each with expiry and view count
- FRS-7.8 — the public viewer renders only title + content; it never requests or displays tags, versions, owner identity, or any other note

**Out of scope**

- Backend sharing implementation, the public endpoint, atomic view-count increment, and the `410`/`404`/`422` semantics — all completed in AB-1008
- Shared Zod schemas — already in `packages/shared/src/schemas/shares.ts` (`CreateShareSchema`, `ShareResponseSchema`, `ShareListResponseSchema`, `PublicNoteViewSchema`)
- Version-history UI (AB-1015) and the full E2E journey (AB-1016)
- A "share all notes" management screen — the active-links list is scoped to a single note (see Impact, key assumptions)
- Real-time collab, file attachments, OAuth, folders, email (excluded by FRS §10)

## Capabilities

### New Capabilities

- `share-ui`: A per-note Share modal — generate link with preset expiry, copy URL, list that note's active links with view counts, and revoke — reachable from the note editor header and from each note card.
- `public-share-view-ui`: The unauthenticated public viewer route `/s/:token` that renders a shared note's current title + read-only content and handles unknown/gone links.

### Modified Capabilities

_(none — no existing spec requirements change; `share-links` and `public-share-view` remain the backend contracts this UI consumes)_

## Impact

**API Delta**

Consumes existing endpoints only (no new or modified endpoints):

```
POST   /api/notes/:id/shares   { expiresAt?: string|null }  → 201 { share: { id, noteId, token, url, expiresAt, viewCount, createdAt } }
                                                               404 (note absent/not owned), 422 (note soft-deleted), 400 (bad expiresAt)
GET    /api/shares                                           → 200 [ { id, noteId, token, url, expiresAt, viewCount, createdAt } ]  (bare array, newest-first)
DELETE /api/shares/:id                                       → 204   404 (unknown/not owned)
GET    /api/public/notes/:token  (no auth)                  → 200 { title, content }   404 (unknown), 410 (revoked/expired/note deleted)
```

`url` is the relative path `"/s/<token>"`; the copy action prepends `window.location.origin` to produce an absolute, shareable URL. Active links for the current note are obtained by client-filtering the bare `GET /api/shares` array on `noteId`.

**DB Changes**

None — backend, migration, and public endpoint are complete.

**Affected layers**

| Layer | Change |
|---|---|
| `packages/shared` | No change — share schemas already exported |
| `frontend/src/api/shares.ts` | New — `useNoteShares(noteId)`, `useCreateShare(noteId)`, `useRevokeShare()` (TanStack Query) and `usePublicNote(token)` (auth-less) |
| `frontend/src/features/share/` | New — `ShareModal`, `ShareLinkRow`, `CreateShareForm` (preset-expiry control + copy), `ShareButton`, expiry-preset helper |
| `frontend/src/features/share/PublicNoteView.tsx` | New — read-only TipTap renderer for the public page |
| `frontend/src/pages/PublicSharePage.tsx` | New — route-level `/s/:token` screen (loading / gone / loaded) |
| `frontend/src/features/notes/NoteEditor.tsx` (header) | Add a Share button entry point |
| `frontend/src/features/notes/NoteCard.tsx` | Add a Share action entry point |
| `frontend/src/App.tsx` | Add **public** (unguarded) route `/s/:token` |

**Key assumptions**

- The Share modal is **per-note**: it filters `GET /api/shares` to the current note's `noteId` client-side, so the owner manages exactly the links for the note they opened it from.
- Expiry is entered as **preset durations** (Never / 1 day / 7 days / 30 days). The chosen duration is converted to a strictly-future ISO datetime at submit time; "Never" sends `expiresAt: null`. This satisfies `CreateShareSchema` without a datetime picker.
- Over-the-wire date fields (`expiresAt`, `createdAt`) are treated as **strings** in the frontend types (matching the established `src/api/notes.ts` / `src/api/auth.ts` precedent), not the shared schema's `z.date()`.
- `/s/:token` is mounted **outside** the auth guard and does **not** attach an access token (`apiFetch(..., { auth: false })`); a logged-in owner and an anonymous guest see the identical read-only view.
- The public page renders `content` (TipTap JSON) with a read-only TipTap instance (`editable: false`); no toolbar, autosave, tags, version, or owner UI is mounted.
- Modal and confirmation UI follow the existing self-rolled overlay pattern (`components/ui/confirm-dialog.tsx`) — no new dialog dependency. Revoke is confirmed before firing.
- Copy-to-clipboard uses the `navigator.clipboard` API with a `sonner` toast on success/failure.
