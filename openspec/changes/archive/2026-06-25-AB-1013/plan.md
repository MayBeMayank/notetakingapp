# Implementation Plan — AB-1013: Frontend Search UI with Highlights

## Overview

Frontend-only change. No new DB migrations, no new backend endpoints, no new
shared Zod schemas. This ticket wires the existing `GET /api/search` endpoint
(AB-1007) into a new `/search` page, following the patterns established by the
notes-list UI (AB-1011).

---

## Files to Create / Modify

### New files

| File | Purpose |
|---|---|
| `frontend/src/features/search/searchQuery.ts` | URL state parse/serialize (mirrors `notesQuery.ts`) |
| `frontend/src/features/search/useSearchQueryParams.ts` | `useSearchParams` hook for `/search` (mirrors `useNotesQueryParams.ts`) |
| `frontend/src/features/search/SearchResultCard.tsx` | Single result card: title + `<mark>`-highlighted snippet |
| `frontend/src/features/search/SearchStates.tsx` | Loading skeleton, error, "type to search", "no results" states |
| `frontend/src/features/search/SearchResultsList.tsx` | Orchestrator: input + debounce + results + pagination |
| `frontend/src/api/search.ts` | `useSearch(q, page, limit)` TanStack Query hook |
| `frontend/src/pages/SearchPage.tsx` | Route-level wrapper (thin, delegates to `SearchResultsList`) |

### Modified files

| File | Change |
|---|---|
| `frontend/src/App.tsx` | Add `<Route path="/search">` protected route |
| `frontend/src/pages/NotesPage.tsx` | Add Search button in header (`<Link to="/search">`) |

No changes to `packages/shared`, `backend`, or any `.env` files.

---

## Architecture Decisions

### AD-1: URL as single source of truth for `q` and `page`

Both `q` and `page` are serialized into URL search params (`/search?q=foo&page=2`).
This gives browser back/forward, bookmarking, and direct-URL loading for free —
the same pattern used by notes-list view state.

The input field is **locally controlled** (immediate keystroke response).
After the 300 ms debounce fires, the URL is updated and the query is issued.
This means the URL always reflects what was actually searched, not the in-flight
characters.

### AD-2: Debounce lives in `SearchResultsList`, not in `useSearch`

`useSearch` is a pure query hook: given `(q, page)`, return the query result.
`SearchResultsList` owns the debounce via `useEffect + setTimeout`. This keeps
the hook testable in isolation and avoids coupling the debounce to cache keys.

When `q.trim() === ''`, the hook is disabled (`enabled: false`) and returns an
empty-data state immediately — no network round-trip (FRS-6.6).

### AD-3: `dangerouslySetInnerHTML` for snippet

Snippets come exclusively from the authenticated user's own notes; the backend
injects only `<mark>…</mark>` tags. This is safe. Rendering plain text would
drop the highlight requirement (FRS-6.4). A thin CSS rule targets
`mark { background: hsl(var(--primary)/0.2); border-radius: 2px; padding: 0 2px; }`
to match shadcn/ui token colours.

### AD-4: Reuse `NotesPagination` unchanged

`NotesPagination` accepts `{ page, total, limit, onPageChange }` which maps
directly to the `SearchListResponse` shape. No modifications needed.

### AD-5: `limit` is fixed at 20 (default) — no UI control

The spec does not require a page-size selector. `limit=20` is the default from
`SearchQuerySchema` and matches the notes list behaviour.

---

## TypeScript Shapes

All response types are imported from `@note-app/shared/schemas/search`; nothing
is redefined locally.

```ts
// packages/shared/src/schemas/search.ts (already exists — import only)
import type {
  SearchResultItem,   // { noteId, title, snippet, rank }
  SearchListResponse, // { data, page, limit, total }
} from '@note-app/shared/schemas/search'
```

```ts
// frontend/src/features/search/searchQuery.ts
export interface SearchViewState {
  q: string     // raw query string, empty string when none
  page: number  // 1-based, positive integer
}

export const DEFAULT_SEARCH_VIEW: SearchViewState = { q: '', page: 1 }
```

---

## Component Tree

```
SearchPage (src/pages/SearchPage.tsx)
└── SearchResultsList (src/features/search/SearchResultsList.tsx)
    ├── Input  (shadcn/ui — query text field)
    ├── [loading]  SearchLoadingState
    ├── [error]    SearchErrorState  { onRetry }
    ├── [empty-q]  SearchIdleState   ("Type to search your notes")
    ├── [empty-r]  SearchNoResultsState  { q }
    ├── [results]
    │   ├── SearchResultCard × N  (src/features/search/SearchResultCard.tsx)
    │   │   └── Link to /notes/:noteId
    │   └── NotesPagination  (reused from notes feature)
    └── (all states exported from SearchStates.tsx)
```

---

## Implementation Tasks

Tasks are listed in dependency order; independent tasks within the same group
can run in parallel.

### Phase 1 — Data layer

**Task 1.1** `frontend/src/api/search.ts`
- Export `useSearch(q: string, page: number, limit?: number)`
- Uses `useQuery` with key `['search', q, page]`
- `queryFn`: `apiFetch<SearchListResponse>('/search?q=...&page=...&limit=...')`
- `enabled: q.trim().length > 0`; when disabled, `data` is `undefined`
- `staleTime: 30_000` (same as tags hook)
- Import `SearchListResponse` from `@note-app/shared/schemas/search`

**Task 1.2** `frontend/src/features/search/searchQuery.ts`
- `SearchViewState` interface: `{ q: string; page: number }`
- `DEFAULT_SEARCH_VIEW = { q: '', page: 1 }`
- `parseSearchView(sp: URLSearchParams): SearchViewState` — reads `q` and `page`
  from params; falls back to defaults for invalid values
- `serializeSearchView(view: SearchViewState): URLSearchParams` — omits `q` if
  empty and `page` if 1 (clean URLs)

**Task 1.3** `frontend/src/features/search/useSearchQueryParams.ts`
- Wraps `useSearchParams` exactly like `useNotesQueryParams`
- Returns `[view, setView]`; changing `q` resets `page` to 1

### Phase 2 — UI components

**Task 2.1** `frontend/src/features/search/SearchStates.tsx`
- `SearchLoadingState()` — 3-item skeleton list matching the search card shape
- `SearchErrorState({ onRetry })` — error message + Retry button
- `SearchIdleState()` — "Type to search your notes" placeholder
- `SearchNoResultsState({ q })` — `No notes found for "{q}"` message

**Task 2.2** `frontend/src/features/search/SearchResultCard.tsx`
- Props: `{ item: SearchResultItem }`
- Renders as `<Card>` wrapping `<Link to={/notes/${item.noteId}}>`:
  - `<h3>` — `item.title` (fallback "Untitled" when empty)
  - snippet rendered with `dangerouslySetInnerHTML={{ __html: item.snippet }}`
    inside a `<p className="text-sm text-muted-foreground">` when non-empty
- `<mark>` elements styled globally in `index.css` (one rule)

**Task 2.3** `frontend/src/features/search/SearchResultsList.tsx`
- Local state: `inputValue: string` (immediate, controlled by Input)
- Debounce: `useEffect` with 300 ms `setTimeout` sets `debouncedQ` local state;
  cleanup clears timer on each change
- `[view, setView]` from `useSearchQueryParams`; `inputValue` initialized from
  `view.q` on mount
- On debounce: call `setView({ q: debouncedQ })` (also updates URL)
- `useSearch(view.q, view.page)` for data
- Renders appropriate state component based on `query.isPending`, `query.isError`,
  `view.q.trim() === ''`, `data.total === 0`, or result cards
- `onPageChange` calls `setView({ page: p })`

**Task 2.4** `frontend/src/pages/SearchPage.tsx`
- Thin wrapper; renders header ("Search") + `<SearchResultsList />`
- Same layout structure as `NotesPage` (border-b header, max-w-6xl content area)
- Back-link or breadcrumb to `/` (notes list)

### Phase 3 — Routing and navigation

**Task 3.1** `frontend/src/App.tsx`
- Add `import SearchPage from '@/pages/SearchPage'`
- Add `<Route path="/search" element={<ProtectedRoute><SearchPage /></ProtectedRoute>} />`
  before the `path="*"` catch-all

**Task 3.2** `frontend/src/pages/NotesPage.tsx`
- Add `import { Link } from 'react-router-dom'`
- Add a Search `<Button>` (or `<Link>`) in the header row next to "New note",
  pointing to `/search`

---

## Reused Components / Utilities

| Reused from | Used in |
|---|---|
| `NotesPagination` | `SearchResultsList` — identical interface, no changes |
| `apiFetch`, `ApiError` | `useSearch` hook |
| `Button` (`@/components/ui/button`) | `SearchStates.tsx` |
| `Card` (`@/components/ui/card`) | `SearchResultCard.tsx` |
| `Input` (`@/components/ui/input`) | `SearchResultsList.tsx` |
| `ProtectedRoute` | `App.tsx` route |

---

## `<mark>` Global Style

One rule added to `frontend/src/index.css`:
```css
mark {
  background-color: hsl(var(--primary) / 0.15);
  border-radius: 2px;
  padding: 0 2px;
  color: inherit;
}
```
Uses the existing shadcn `--primary` CSS variable; stays in sync with any
future theme changes.

---

## Quality Gates

Run in this order after implementation:

```bash
pnpm -w lint                    # zero ESLint errors
pnpm --filter frontend test     # Vitest unit — searchQuery parse/serialize,
                                # SearchResultCard renders mark HTML,
                                # SearchResultsList shows idle state when q empty
pnpm -w build                   # zero TypeScript errors
pnpm --filter frontend dev      # manual smoke: type a query, see highlights,
                                # navigate result → editor, use browser back
```

E2E (`pnpm --filter frontend e2e`) is required for this user-facing feature
change (CLAUDE.md Quality Gate 5).

---

## What This Plan Does NOT Do

- No changes to `packages/shared` (schemas already exist)
- No backend changes
- No new Zod schemas (all types imported from shared)
- No Zustand stores (all state is server state via TanStack Query + URL params)
- No tag filtering on the search page (out of scope for AB-1013)
