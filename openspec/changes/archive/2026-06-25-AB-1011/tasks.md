# Tasks: AB-1011 — Frontend Notes List Page

> Layer: **frontend**. **No DB migration, no new/changed shared schema** — pure
> consumer of SDS §6.3 / §6.4 / §5.2 (`GET /api/notes`, `GET /api/tags`,
> `DELETE /api/notes/:id`, `POST /api/notes/:id/restore`).
> `[PARALLEL]` = touches different files with no import/logical dependency on its siblings.
> Mark `- [x]` as each task lands; run the checkpoint before leaving a phase.
> Capabilities: **`notes-list-ui`** (new) + **`frontend-app-shell`** (routing modified).

---

## Phase 1 — Foundation (UI primitives + data layer)

> No shared types or DB changes. Stands up the in-house primitives (AD-2) and the
> TanStack Query data layer + URL view-state plumbing (AD-1, AD-3, AD-4).

### 1A — UI primitives (`src/components/ui/`) — independent files
- [x] 1.1 `badge.tsx` — cva-styled chip; forwards `style` so tag chips can set a dynamic hex color (AD-5). `[PARALLEL]`
- [x] 1.2 `select.tsx` — styled wrapper over native `<select>` (label-associable, accessible). `[PARALLEL]`
- [x] 1.3 `confirm-dialog.tsx` — controlled `role="alertdialog"` modal (Cancel/Confirm), Esc + backdrop dismiss. `[PARALLEL]`

### 1B — View-state core
- [x] 1.4 `src/features/notes/notesQuery.ts` — `NotesViewState` type (reusing `NoteSortField`/`NoteSortOrder`/`NoteListStatus` from `@note-app/shared/schemas/notes`); `parseNotesView(URLSearchParams)` with defaults (`status=active`, `sort=updatedAt`, `order=desc`, `page=1`, `limit=20`) + sanitization of unknown/out-of-range values; `serializeNotesView(view)` (omits defaults + `tags` when empty; dedupes IDs). `[PARALLEL]` *(only depends on shared types)*

### 1C — API hooks (`src/api/`) + query-params hook
- [x] 1.5 `src/api/tags.ts` — read-only `useTags()` (`queryKey ['tags']`, `GET /api/tags`); local `TagOption { id, name, color, noteCount }` wire-type (AD-3). `[PARALLEL]` *(only needs existing `client.ts`)*
- [x] 1.6 `src/api/notes.ts` — `useNotesList(view)` (`queryKey ['notes', view]`, builds query via private `buildNotesQuery`), `useDeleteNote()` (DELETE → 204, invalidates `['notes']`), `useRestoreNote()` (POST restore; 422 = past-window); local `NoteListItem`/`NotesListResult` wire-types with string dates (AD-3). *(depends on 1.4)*
- [x] 1.7 `src/features/notes/useNotesQueryParams.ts` — hook over `useSearchParams`; returns `[view, setView]`; `setView` resets `page → 1` on any `sort`/`order`/`tags`/`status` change (AD-1). `[PARALLEL]` with 1.6 *(both depend on 1.4, not on each other)*

> Tests landed alongside (cadence): `notesQuery.test.ts` (1.4) + `api/notes.test.tsx` (1.5/1.6).

**Checkpoint 1:** ✅ `tsc --noEmit` 0 errors · lint clean · build 0 errors · **52/52 tests pass** (11 new).

---

## Phase 2 — Core implementation (`notes-list-ui` components)

> Leaf components (2.1–2.7) are independent files driven by props/hooks → parallel.
> `NoteCard` (2.8) composes the delete/restore buttons; `NotesList` (2.9) composes everything.

### 2A — Leaf components (`src/features/notes/`)
- [x] 2.1 `NotesSortControl.tsx` — two `Select`s (field `updatedAt|createdAt|title`, order `asc|desc`); reflects current view, calls `setView` (FRS-4.5.2). `[PARALLEL]`
- [x] 2.2 `TagFilter.tsx` — multi-select toggle chips from `useTags`; OR-filter, clear-all; selecting/deselecting updates `view.tags` (FRS-4.5.3). `[PARALLEL]`
- [x] 2.3 `StatusTabs.tsx` — Active / Trash switch driving `view.status` (FRS-4.4.2). `[PARALLEL]`
- [x] 2.4 `NotesPagination.tsx` — prev/next + "page X of N" from `total`/`limit`; never exceeds the implied page count (FRS-4.5.1). `[PARALLEL]`
- [x] 2.5 `NotesStates.tsx` — Loading (skeleton) / Error+retry / Empty-account / Empty-filter / Empty-trash presentational blocks. `[PARALLEL]`
- [x] 2.6 `DeleteNoteButton.tsx` — wraps `ConfirmDialog` + `useDeleteNote`; confirm-before-delete; surfaces failure (FRS-4.4.1). `[PARALLEL]`
- [x] 2.7 `RestoreNoteButton.tsx` — `useRestoreNote`; on 422 shows "recovery window expired", note stays in Trash (FRS-4.4.3). `[PARALLEL]`

### 2B — Composed components
- [x] 2.8 `NoteCard.tsx` — title (or "Untitled") + updated-at + tag chips (looked up from `useTags` data by `tagIds`, rendered via `Badge` + hex `style`); active card → navigates `/notes/:id`; active shows `DeleteNoteButton`, trashed shows only `RestoreNoteButton` and is not openable (FRS-4.4.5). *(after 2.6, 2.7)*
- [x] 2.9 `NotesList.tsx` — orchestrator: `useNotesQueryParams` + `useNotesList` + `useTags`; renders `StatusTabs`, `NotesSortControl`, `TagFilter`, the card grid, `NotesPagination`, and the right `NotesStates` block; composes all params into one request (FRS-4.5.4). *(after 2.1–2.8)*

**Checkpoint 2:** build 0 errors · `tsc --noEmit` 0 errors · lint clean · test green.

---

## Phase 3 — Integration (pages + routing)

- [x] 3.1 `src/pages/NotesPage.tsx` — thin screen: header (app title, `user.email` from `useAuthStore`, `LogoutButton`, "New note" → `/notes/new`) + `<NotesList />`. *(after 2.9)*
- [x] 3.2 `src/pages/NoteEditorPlaceholderPage.tsx` — placeholder served at `/notes/new` and `/notes/:id` until AB-1012 (AD-6). `[PARALLEL]` with 3.1
- [x] 3.3 `src/App.tsx` — route `/` → `NotesPage` (replaces `HomePage`); add **protected** `/notes/new` + `/notes/:id` → `NoteEditorPlaceholderPage` (via `ProtectedRoute`); keep auth-route + unknown-route fallbacks (now → list at `/`). *(after 3.1, 3.2)*
- [x] 3.4 Delete `src/pages/HomePage.tsx` (dead after 3.3; only importer was `App.tsx`). **Ask `[y/n]` before `rm`.** *(after 3.3)*
- [ ] 3.5 Manual smoke via `pnpm --filter frontend dev` against the running backend: list renders → sort → tag filter → paginate → delete (Trash) → restore; URL reflects state, reload reproduces it.

**Checkpoint 3:** build 0 errors · `tsc --noEmit` 0 errors · lint clean · test green.

---

## Phase 4 — Tests (one named test per spec scenario)

> Each file `[PARALLEL]` (distinct files); depends on the Phase 1–3 code it covers.
> Pattern: Vitest + RTL + `fetch` stub via `jsonResponse` / `makeTestQueryClient` (AD-7).

- [x] 4.1 `src/features/notes/notesQuery.test.ts` — `notes-list-ui › view-state`: defaults applied · sort/order/tags/page/status parsed · unknown/out-of-range values clamped to defaults · `serializeNotesView` omits empty `tags`, dedupes, round-trips. `[PARALLEL]`
- [x] 4.2 `src/api/notes.test.ts` — `notes-list-ui › data layer`: `useNotesList` issues one request with all params (`page/limit/sort/order/tags`) · delete → 204 + invalidates `['notes']` · restore 200 vs 422 · types sourced from shared; auth handled by existing `apiFetch`. `[PARALLEL]`
- [x] 4.3 `src/features/notes/NotesList.test.tsx` — `notes-list-ui › list`: active notes render (own only) · soft-deleted excluded · loading state · error + retry · empty-account state · default sort `updatedAt`/`desc` on first load · change sort re-fetches · changing sort/filter resets to page 1 · URL written on change · reload/URL reproduces view · back/forward restores view. `[PARALLEL]`
- [x] 4.4 `src/features/notes/NoteCard.test.tsx` — `notes-list-ui › card`: title fallback "Untitled" · tag chips render name+color · active card navigates `/notes/:id` · trashed card not openable & shows only Restore. `[PARALLEL]`
- [x] 4.5 `src/features/notes/TagFilter.test.tsx` — `notes-list-ui › tag filter`: options come from `useTags` · single-tag filters · multi-tag OR (comma-joined, de-duplicated note shown once) · clear restores unfiltered · empty-filter state distinct from empty-account. `[PARALLEL]`
- [x] 4.6 `src/features/notes/NotesPagination.test.tsx` — `notes-list-ui › pagination`: controls reflect `total`/`page` · next/prev change page · displayed page never exceeds implied count · sort retained across pages. `[PARALLEL]`
- [x] 4.7 `src/features/notes/DeleteNoteButton.test.tsx` — `notes-list-ui › soft-delete`: confirm required before request · 204 removes from active + invalidates · failure (404) surfaced, no false-deleted UI. `[PARALLEL]`
- [x] 4.8 `src/features/notes/RestoreNoteButton.test.tsx` — `notes-list-ui › restore`: 200 returns note to active + invalidates · 422 shows "window expired", note stays in Trash. `[PARALLEL]`
- [x] 4.9 `src/App.routing.test.tsx` *(modify)* — `frontend-app-shell › Application routing`: `/` renders the notes list · `/notes/new` & `/notes/:id` protected (anon → `/login`, auth → placeholder) · unknown-route fallback (auth → `/`) · authed-on-`/login` → `/`. `[PARALLEL]`

**Checkpoint 4 (full gate):** build 0 errors · `tsc --noEmit` 0 errors · lint clean (`--max-warnings 0`) · all tests pass · coverage ≥ 80% on new code · `commitlint` passes at commit.

---

## Done criteria
- Every scenario in `specs/notes-list-ui/spec.md` and the modified `frontend-app-shell` routing requirement is covered by a named test (4.1–4.9).
- Build / `tsc --noEmit` / lint / test gates green; coverage ≥ 80% on new code.
- **No backend, DB, or shared-schema changes introduced.**
- List view-state lives in the URL (bookmarkable, shareable, reload/back-forward proof).
- No new runtime dependencies added.
- Playwright full journey deferred to **AB-1016**.

---

## Checkpoint commands
```bash
pnpm -w lint                                  # ESLint — zero errors / --max-warnings 0
pnpm --filter frontend exec tsc --noEmit      # typecheck (vite build skips tsc)
pnpm --filter frontend test                   # Vitest + RTL — all green, coverage ≥ 80%
pnpm --filter frontend build                  # vite build — 0 errors
```
