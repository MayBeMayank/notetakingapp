# Proposal — AB-1013: Frontend Search UI with Highlights

## Why

The full-text search backend (AB-1007) is fully implemented and exposes
`GET /api/search`. Users currently have no way to reach it from the SPA.
AB-1013 delivers the UI surface: a dedicated `/search` page where users type a
query and see ranked, paginated results with their matched keywords highlighted
— closing the loop between the FTS capability and the user experience.

## What Changes

**In scope**

- FRS-6.1 — UI for full-text search across title and content of own active notes
- FRS-6.3 — ranked, paginated result list
- FRS-6.4 — each result card shows a snippet with `<mark>`-wrapped highlights
- FRS-6.5 — only the authenticated user's own active notes are returned (enforced by backend; UI must be auth-gated)
- FRS-6.6 — empty/whitespace query shows an empty result set, never an error

**Out of scope**

- Backend search implementation (completed in AB-1007)
- Shared Zod schemas (already in `packages/shared/src/schemas/search.ts`)
- Tag/version/share UI (separate tickets AB-1014–AB-1015)
- Real-time collab, file attachments, admin roles (excluded by FRS §10)

## Capabilities

### New Capabilities

- `search-ui`: Dedicated `/search` page — input, debounced query, ranked results
  with highlighted snippets, pagination, and URL-persisted state.

### Modified Capabilities

_(none — no existing spec requirements change)_

## Impact

**API Delta**

Consumes the existing endpoint (no new endpoints):

```
GET /api/search?q=<string>&page=<int>&limit=<int>
→ 200 { data: [{ noteId, title, snippet, rank }], page, limit, total }
```

`snippet` contains `<mark>…</mark>` around matched terms. Empty/whitespace `q`
returns `{ data: [], page: 1, limit: 20, total: 0 }` (FRS-6.6).

**DB Changes**

None — backend and migration are complete.

**Affected layers**

| Layer | Change |
|---|---|
| `packages/shared` | No change — `SearchListResponseSchema`, `SearchResultItemSchema`, `SearchQuerySchema` already exported |
| `frontend/src/api/search.ts` | New file — `useSearch(q, page)` TanStack Query hook |
| `frontend/src/features/search/` | New components: `SearchResultCard`, `SearchResultsList`, `SearchEmptyState`, `SearchErrorState` |
| `frontend/src/pages/SearchPage.tsx` | New route-level page |
| `frontend/src/App.tsx` | Add protected route `/search` + link from notes header |

**Key assumptions**

- Query and page number are stored in URL search params (`?q=foo&page=2`) so
  browser history, back/forward, and bookmarks all work correctly.
- Debounce window is 300 ms; the hook does **not** fire for an empty/whitespace
  query (returns empty immediately, matching FRS-6.6 without a network round-trip).
- Snippets are rendered with `dangerouslySetInnerHTML` — safe because content
  comes exclusively from the authenticated user's own notes and the backend only
  injects `<mark>` tags (no third-party or anonymous input).
- Clicking a result navigates to `/notes/:noteId` (the existing note editor).
