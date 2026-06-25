# Tasks — AB-1013: Frontend Search UI with Highlights

> Track: mark `- [x]` as each task completes. Run the checkpoint after every phase.

---

## Phase 1 — Foundation

No DB migrations or shared schema changes needed; schemas exist in
`packages/shared/src/schemas/search.ts`.

- [x] **1.1** Create `frontend/src/features/search/searchQuery.ts`
  - `SearchViewState` interface `{ q: string; page: number }`
  - `DEFAULT_SEARCH_VIEW = { q: '', page: 1 }`
  - `parseSearchView(sp: URLSearchParams): SearchViewState`
    — reads `q` and `page`; falls back to defaults for invalid/missing values
  - `serializeSearchView(view: SearchViewState): URLSearchParams`
    — omits `q` when empty, omits `page` when 1 (clean URLs)

- [x] **1.2** Create `frontend/src/features/search/useSearchQueryParams.ts`
  - Wraps `useSearchParams` (same pattern as `useNotesQueryParams`)
  - Returns `[view, setView]`
  - Changing `q` resets `page` to 1 (unless patch also sets `page`)

- [x] **1.3** Create `frontend/src/api/search.ts`
  - `useSearch(q: string, page: number, limit = 20)` — TanStack Query hook
  - Query key: `['search', q, page]`
  - `queryFn`: `apiFetch<SearchListResponse>('/search?q=...&page=...&limit=...')`
  - `enabled: q.trim().length > 0` — skips request for empty/whitespace query
  - `staleTime: 30_000`
  - Import `SearchListResponse` from `@note-app/shared/schemas/search`; do not redefine types

### Phase 1 Checkpoint
```bash
pnpm -w build                   # 0 TypeScript errors
pnpm -w lint                    # 0 warnings
pnpm --filter frontend test     # all green (no new tests yet — existing suite must stay green)
```

---

## Phase 2 — Core UI Components [some tasks PARALLEL]

- [x] **2.1** [PARALLEL] Create `frontend/src/features/search/SearchStates.tsx`
  - `SearchLoadingState()` — 3-item animate-pulse skeleton (matches search card height)
  - `SearchErrorState({ onRetry: () => void })` — error message + "Try again" `<Button variant="outline">`
  - `SearchIdleState()` — "Type to search your notes" instructional empty state (shown when `q` is empty)
  - `SearchNoResultsState({ q: string })` — `No notes found for "{q}"` (shown when `total === 0` with a non-empty query)

- [x] **2.2** [PARALLEL] Create `frontend/src/features/search/SearchResultCard.tsx`
  - Props: `{ item: SearchResultItem }` — import type from `@note-app/shared/schemas/search`
  - Render as `<Card>` wrapping `<Link to={/notes/${item.noteId}}>` with hover style
  - `<h3 className="font-medium truncate">` for title; fallback "Untitled" when empty
  - When `item.snippet` is non-empty: render snippet with safe `renderSnippet()` parser
    (splits on `<mark>`/`</mark>` tokens, renders React `<mark>` elements — no dangerouslySetInnerHTML)
    inside `<p className="text-sm text-muted-foreground line-clamp-3">`
  - When `item.snippet` is empty or whitespace: hide snippet element entirely

- [x] **2.3** Add `<mark>` global style to `frontend/src/index.css`
  - One rule:
    ```css
    mark {
      background-color: hsl(var(--primary) / 0.15);
      border-radius: 2px;
      padding: 0 2px;
      color: inherit;
    }
    ```
  - Uses existing shadcn `--primary` CSS variable

- [x] **2.4** Create `frontend/src/features/search/SearchResultsList.tsx`
  - Depends on 2.1, 2.2, 2.3
  - Local state: `inputValue: string` (controlled, updates on every keystroke)
  - Debounce: `useRef<ReturnType<typeof setTimeout>>` timer, cleared on cleanup
  - Initialize `inputValue` from `view.q` on mount (handles direct-URL load)
  - On debounce fire: call `setView({ q: val })` to sync URL
  - Call `useSearch(view.q, view.page)` for server state
  - Input: `<Input>` with `maxLength={200}`, `placeholder="Search notes…"`, `value={inputValue}`,
    `onChange` updates `inputValue`
  - Render logic:
    - `view.q.trim() === ''` → `<SearchIdleState />`
    - `query.isPending` → `<SearchLoadingState />`
    - `query.isError` → `<SearchErrorState onRetry={query.refetch} />`
    - `data.total === 0` → `<SearchNoResultsState q={view.q} />`
    - else → result card grid + `<NotesPagination>`
  - `<NotesPagination page={data.page} total={data.total} limit={data.limit} onPageChange={(p) => setView({ page: p })} />`

### Phase 2 Checkpoint
```bash
pnpm -w build                   # 0 TypeScript errors
pnpm -w lint                    # 0 warnings
pnpm --filter frontend test     # all green
```

---

## Phase 3 — Integration

- [x] **3.1** Create `frontend/src/pages/SearchPage.tsx`
  - Thin page wrapper (same layout shell as `NotesPage`)
  - Header: "Search" title + `<Link to="/">← Notes</Link>` back-link + user email + `<LogoutButton />`
  - `<main className="mx-auto max-w-6xl px-6 py-8">` containing `<SearchResultsList />`

- [x] **3.2** Add `/search` route in `frontend/src/App.tsx`
  - Import `SearchPage` from `@/pages/SearchPage`
  - Add `<Route path="/search" element={<ProtectedRoute><SearchPage /></ProtectedRoute>} />`
    before the `path="*"` catch-all

- [x] **3.3** Add Search entry point in `frontend/src/pages/NotesPage.tsx`
  - Import `Link` from `react-router-dom`
  - Add `<Button size="sm" variant="outline" asChild><Link to="/search">Search</Link></Button>`
    in the header row alongside "New note"

### Phase 3 Checkpoint
```bash
pnpm -w build                   # 0 TypeScript errors
pnpm -w lint                    # 0 warnings
pnpm --filter frontend test     # all green
```

---

## Phase 4 — Tests

One test file per component/hook; one `it()` per spec scenario from
`openspec/changes/AB-1013/specs/search-ui/spec.md`.

- [x] **4.1** `frontend/src/features/search/searchQuery.test.ts`
  - `parseSearchView` — valid `q` and `page` are read correctly
  - `parseSearchView` — missing `q` defaults to `''`
  - `parseSearchView` — non-numeric `page` defaults to 1
  - `parseSearchView` — `page=0` (below min) defaults to 1
  - `serializeSearchView` — empty `q` omitted from params
  - `serializeSearchView` — `page=1` omitted from params (clean URL)
  - `serializeSearchView` — non-default values are present in params
  - round-trip serialize → parse

- [x] **4.2** `frontend/src/features/search/SearchResultCard.test.tsx`
  - Renders note title; falls back to "Untitled" when title is empty
  - Renders snippet with `<mark>` elements present in DOM (via safe renderSnippet parser)
  - Hides snippet element when snippet is empty string or whitespace-only
  - Link `href` points to `/notes/:noteId`

- [x] **4.3** `frontend/src/features/search/SearchStates.test.tsx`
  - `SearchIdleState` renders "Search your notes" heading and instructional subtext
  - `SearchLoadingState` renders skeleton items with `role="status"`
  - `SearchErrorState` renders error message and a retry button
  - `SearchErrorState` calls `onRetry` when retry button is clicked
  - `SearchNoResultsState` renders the query string in the message

- [x] **4.4** `frontend/src/features/search/SearchResultsList.test.tsx`
  - Shows idle state on initial render with empty URL (no `q` param) — no fetch issued
  - Shows idle state when q is only whitespace — no fetch issued
  - Pre-fills input value from URL `q` param on initial render
  - Shows loading state while fetch is pending
  - Shows result cards when fetch resolves with data
  - Shows no-results state when fetch returns `total: 0`
  - Shows error state when fetch rejects; clicking Try again calls refetch
  - Input has `maxLength` of 200
  - Pagination hidden when results fit on one page
  - Pagination shown when total exceeds page limit

### Phase 4 Checkpoint
```bash
pnpm --filter frontend test     # all green, including new tests
pnpm -w lint                    # 0 warnings
pnpm -w build                   # 0 TypeScript errors
```

---

## Definition of Done

- [x] All tasks above checked off
- [x] `pnpm -w lint` → 0 errors, 0 warnings
- [x] `pnpm --filter frontend test` → all green (157 tests, 23 files)
- [x] `pnpm -w build` → 0 TypeScript errors
- [x] Every scenario in `specs/search-ui/spec.md` has exactly one named test
- [x] Snippet rendering uses safe `renderSnippet()` parser — no `dangerouslySetInnerHTML`
- [x] No new types or schemas defined outside `packages/shared`
- [x] URL back/forward works — `useSearchQueryParams` pushes history entries (no `replace:true`)
