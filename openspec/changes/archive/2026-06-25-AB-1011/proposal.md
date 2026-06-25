# AB-1011 — Frontend: Notes list page

## Why

The backend list contract (`GET /api/notes`, shipped in AB-1004/AB-1005) and the
frontend app shell + auth pages (AB-1010) are both in place, but the authenticated
home route is still the placeholder in `HomePage.tsx` (literally annotated *"AB-1011
replaces this with the notes list"*). Users can sign in but have no way to see,
organize, or manage their notes.

AB-1011 delivers the first real authenticated screen: a paginated, sortable,
tag-filterable list of the user's notes, plus the soft-delete (Trash) lifecycle.
It is the navigational hub the editor (AB-1012), search UI (AB-1013), share modal
(AB-1014), and version history (AB-1015) all hang off of, so it must land first.

## What Changes

This ticket builds the **frontend consumption** of the notes list contract. No
backend or shared-schema changes are required — the Zod schemas
(`ListNotesQuerySchema`, `NoteListResponseSchema`, `TagListResponseSchema`) and the
endpoints already exist.

**FRS references covered (consumed):**

- **FRS-4.5.1** — paginated list reporting `total` + current `page` for paging controls.
- **FRS-4.5.2** — sort by created date / last-updated / title, asc or desc; default last-updated **descending**.
- **FRS-4.5.3** — filter by one or more tags with **OR semantics**; a note carrying several selected tags appears once.
- **FRS-4.5.4** — pagination, sorting, and filtering compose in a single request.
- **FRS-4.4.1** — "delete" is a soft delete (the list triggers `DELETE /api/notes/:id`).
- **FRS-4.4.2** — soft-deleted notes are excluded from the default (active) list.
- **FRS-4.4.3** — restore a soft-deleted note within the 30-day window (the list triggers `POST /api/notes/:id/restore`; surfaces the 422 past-window case).
- **FRS-4.4.5** — a soft-deleted note may only be restored, not opened/edited (Trash cards expose Restore only).
- **FRS-5.6 (read-only)** — the tag filter consumes `GET /api/tags` to populate selectable tags and per-card chips.
- Cross-cutting: **FRS-9.1** ownership isolation (only the caller's notes are ever shown), **FRS-9.5** consistent error rendering, **FRS-9.6** pagination contract.

**In scope**

- Notes list page replacing the `HomePage` placeholder at the protected `/` route.
- Pagination controls (page / total) and page-size handling per the SDS contract.
- Sort control (field + order) with the default last-updated-desc.
- Tag filter (multi-select, OR semantics) sourced from a read-only `useTags()` query; per-card tag chips.
- Trash view (`status=trashed`): soft-delete from the active list, restore from Trash, 30-day-window (422) handling.
- List view-state (sort / order / tags / page / status) reflected in the **URL search params** so the view is bookmarkable, shareable, and survives reload / back-button.
- Navigation entry points: a "New note" button → `/notes/new` and clickable active cards → `/notes/:id` (placeholder editor routes filled in by AB-1012).
- TanStack Query data hooks in `src/api/`; loading / empty / error states.

**Out of scope (other tickets)**

- The note editor itself, TipTap, autosave, and actual note create/edit (AB-1012).
- Full-text search UI and highlighted snippets (AB-1013).
- Share link generation / modal (AB-1014) and version history drawer (AB-1015).
- Tag **management** UI (create / rename / recolor / delete) — only read-only tag consumption is in scope; there is no dedicated frontend tags ticket.
- Any backend, Prisma, or `packages/shared` changes.

## Capabilities

### New Capabilities
- `notes-list-ui`: The authenticated notes list screen — paginated, sortable, tag-filterable display of the user's notes, with the soft-delete Trash lifecycle, URL-driven view-state, and navigation entry points to the editor.

### Modified Capabilities
- `frontend-app-shell`: The `Application routing` requirement is extended so the protected home route `/` renders the notes list (replacing the placeholder) and two new protected routes (`/notes/new`, `/notes/:id`) are registered as editor entry points.

## Impact

**API Delta from SDS** — *No new or changed endpoints.* The frontend consumes
existing, already-shipped contracts:

| Method | Path | Used for | Request / Query | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/notes` | list + sort + filter + paginate + trash view | `?page&limit&sort=updatedAt\|createdAt\|title&order=asc\|desc&tags=a,b&status=active\|trashed` | `{ data: NoteResponse[], page, limit, total }` |
| GET | `/api/tags` | populate tag filter + card chips | — | `TagWithCount[]` (`id, name, color, noteCount`) |
| DELETE | `/api/notes/:id` | soft-delete from active list | — | `204` |
| POST | `/api/notes/:id/restore` | restore from Trash | — | `200 { note }`, `422` if past 30-day window |

Status codes consumed as binding (SDS §5.1): `200` list/restore, `204` soft-delete,
`400` bad query (clamped per §5.2 so rare), `401` handled by the existing client
refresh, `404` not-owned/absent, `422` restore-past-window.

**DB Changes** — None.

**Affected layers (frontend only)**

- `frontend/src/api/notes.ts` *(new)* — `useNotesList`, `useDeleteNote`, `useRestoreNote` TanStack Query hooks.
- `frontend/src/api/tags.ts` *(new)* — read-only `useTags` query hook.
- `frontend/src/features/notes/` *(new)* — list, note card, sort control, tag filter, pagination, trash view, empty/error states.
- `frontend/src/pages/NotesPage.tsx` *(new)* — route-level screen (thin; delegates to the feature).
- `frontend/src/pages/` — minimal placeholder editor screens for `/notes/new` and `/notes/:id` (replaced by AB-1012).
- `frontend/src/App.tsx` — mount the notes list at `/`; register `/notes/new` and `/notes/:id` protected routes; retire the `HomePage` placeholder.
- New shadcn/ui primitives as needed (e.g. select, badge, pagination) under `frontend/src/components/ui/`.

**Key assumptions**

- Backend AB-1004 / AB-1005 / AB-1006 are merged and behave per the SDS contracts (verified: routes + shared schemas present).
- Response bodies are consumed read-only and typed from the shared schemas; like the auth hooks, date fields arrive as JSON strings over the wire and are **not** re-validated against the `z.date()` request schemas.
- `packages/shared` already exposes every shape this page needs; no schema edits are expected. Should a genuinely missing response shape surface during implementation, it is added to `packages/shared` first (never redefined in the frontend), and an ADR is written if it extends a binding contract.
- This is a user-facing feature, so a Playwright E2E path (list → sort → filter → delete → restore) is part of the Definition of Done.
