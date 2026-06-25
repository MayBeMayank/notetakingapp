# Technical Plan: AB-1011 — Frontend Notes List Page

> Layer: **frontend only**. No backend, Prisma, or `packages/shared` changes.
> Consumes already-shipped contracts: `GET /api/notes`, `GET /api/tags`,
> `DELETE /api/notes/:id`, `POST /api/notes/:id/restore` (SDS §6.3 / §6.4 / §5.2).
> Capabilities: **`notes-list-ui`** (new) + **`frontend-app-shell`** (routing modified).

---

## 1. Architecture decisions (with reasoning)

### AD-1 — URL search params are the single source of list view-state
`status`, `sort`, `order`, `tags`, `page`, `limit` live in the URL query string,
read/written via react-router v7 `useSearchParams` (already on `react-router-dom@7.18`).

- **Why:** the clarified requirement is bookmarkable / shareable / reload-proof state with working back-forward. The URL maps 1:1 onto the backend query contract, so there is nothing to translate. A Zustand store would duplicate this and lose reload/share. Per the frontend rule, server state stays in TanStack Query; the only *client* state here (an open delete-confirm) is ephemeral local component state — it does not warrant a store.
- **Rejected:** Zustand list store (ephemeral, not shareable, redundant with the URL).

### AD-2 — No new runtime dependencies; small in-house UI primitives
Add `badge`, `select` (wrapping native `<select>`), and `confirm-dialog` under
`components/ui/`, styled with `cn` + cva like the existing primitives. The tag filter
is built from toggle chips (no popover).

- **Why:** AB-1010 set the precedent of a deliberately minimal, version-pinned dep set (it even dropped unused `lucide-react`/`autoprefixer`). Adding `@radix-ui/react-select` + `@radix-ui/react-dialog` would trigger the Rule 9/20 pin-and-verify-via-Context7 overhead for a list screen that needs none of it. A native `<select>` is fully accessible and trivially testable (`userEvent.selectOptions`); a controlled `role="alertdialog"` div covers delete confirmation.
- **Rejected:** Radix Select/Dialog/DropdownMenu for this ticket (revisit if richer UX is needed later).

### AD-3 — Response bodies typed as local read-only interfaces (string dates)
Request/query/enum types are imported from `@note-app/shared`; **response** shapes are
declared as local read-only interfaces whose date fields are `string`.

- **Why:** this is the exact, documented precedent in `src/api/auth.ts` — the shared response schemas use `z.date()`, which would throw on the JSON date *strings* returned over the wire. The shared-package rule governs **request/response Zod schemas**; reusing the inferred *request/enum* types (`ListNotesQuery`, `NoteSortField`, `NoteSortOrder`, `NoteListStatus`) honors it, while response wire-types stay local exactly as the auth hooks already do. No shared schema is redefined.
- **Rejected:** adding `z.iso.datetime()` "wire" schemas to `packages/shared` (out of scope; contradicts "no shared changes").

### AD-4 — TanStack Query for all server state; mutations invalidate `['notes']`
List + tags are `useQuery`; delete + restore are `useMutation` that
`invalidateQueries({ queryKey: ['notes'] })` so both Active and Trash refetch.

- **Why:** frontend rule — server state in TanStack Query only, never Zustand. The list query key embeds the full view object so each distinct view is cached and refetched independently.

### AD-5 — Dynamic tag colors via inline `style`
Tag chips set `style={{ ... }}` from the tag's hex `color` rather than Tailwind classes.

- **Why:** Tailwind v4 (CSS-first) cannot generate utility classes for arbitrary runtime hex values; colors are data, not design tokens.

### AD-6 — One placeholder page for the editor routes
A single `NoteEditorPlaceholderPage` serves both `/notes/new` and `/notes/:id` until
AB-1012 replaces it.

- **Why:** keeps "New note" and card-open navigation working now without pre-empting AB-1012's editor scope.

### AD-7 — Tests: Vitest + RTL now; Playwright full journey in AB-1016
Cover every spec scenario with Vitest + React Testing Library + `fetch` stub (the
AB-1010 pattern). Defer the end-to-end Playwright journey to AB-1016.

- **Why:** matches AB-1010's done criteria verbatim ("Playwright full journey deferred to AB-1016"); no Playwright config or `e2e/` dir exists yet.

---

## 2. DB & shared-package changes

- **DB / Prisma migrations:** **None.**
- **`packages/shared` schemas:** **None added or modified.** Reuse existing
  `schemas/notes.ts` (`ListNotesQuerySchema`, `NoteSortField`, `NoteSortOrder`,
  `NoteListStatus`, `NoteListResponseSchema`, `NoteResponse`) and `schemas/tags.ts`.
- **Backward compatibility:** N/A — purely additive frontend; no contract changes.

---

## 3. Files to create / modify

### Create — API hooks (`frontend/src/api/`)
| File | Responsibility |
| --- | --- |
| `notes.ts` | `useNotesList(view)`, `useDeleteNote()`, `useRestoreNote()` + `serializeNotesQuery(view)` |
| `tags.ts` | read-only `useTags()` |

### Create — feature module (`frontend/src/features/notes/`)
| File | Responsibility |
| --- | --- |
| `notesQuery.ts` | parse `URLSearchParams` → `NotesViewState` (with defaults + sanitization) and serialize back |
| `useNotesQueryParams.ts` | hook over `useSearchParams`: returns `[view, setView]`; `setView` resets `page` to 1 on sort/order/tags/status change |
| `NotesList.tsx` | feature orchestrator: reads view, runs `useNotesList`/`useTags`, renders controls + cards + states |
| `NoteCard.tsx` | one note: title (or "Untitled"), updated-at, tag chips; click → `/notes/:id` (active only); delete trigger (active) / restore (trashed) |
| `NotesSortControl.tsx` | `Select` for field (`updatedAt`/`createdAt`/`title`) + order (`asc`/`desc`) |
| `TagFilter.tsx` | multi-select toggle chips from `useTags`; OR-filter; clear-all |
| `StatusTabs.tsx` | Active / Trash switch |
| `NotesPagination.tsx` | prev/next + "page X of N" from `total`/`limit` |
| `DeleteNoteButton.tsx` | wraps `ConfirmDialog` + `useDeleteNote` |
| `RestoreNoteButton.tsx` | `useRestoreNote`; surfaces 422 past-window message |
| `NotesStates.tsx` | shared Loading / Error+retry / Empty (account) / Empty (filter) / Empty (trash) blocks |

### Create — UI primitives (`frontend/src/components/ui/`)
| File | Responsibility |
| --- | --- |
| `badge.tsx` | cva-styled chip; accepts `style` for dynamic tag color |
| `select.tsx` | styled native `<select>` wrapper (label-associable) |
| `confirm-dialog.tsx` | controlled `role="alertdialog"` modal (Cancel / Confirm), Esc + backdrop close |

### Create — pages (`frontend/src/pages/`)
| File | Responsibility |
| --- | --- |
| `NotesPage.tsx` | thin route screen: header (app title, user email, `LogoutButton`, "New note") + `<NotesList />` |
| `NoteEditorPlaceholderPage.tsx` | placeholder for `/notes/new` and `/notes/:id` (replaced by AB-1012) |

### Modify
| File | Change |
| --- | --- |
| `frontend/src/App.tsx` | `/` → `NotesPage` (was `HomePage`); add protected `/notes/new` + `/notes/:id` → `NoteEditorPlaceholderPage`; fallback unchanged |
| `frontend/src/App.routing.test.tsx` | add: `/` renders notes list; `/notes/new` & `/notes/:id` are protected (anon → `/login`) |
| `frontend/src/pages/HomePage.tsx` | **delete** (dead after `/` swap) — *flagged for `[y/n]` confirm before `rm`* |

### Create — tests (one per scenario; `vitest run`)
`api/notes.test.ts`, `features/notes/notesQuery.test.ts`,
`features/notes/NotesList.test.tsx`, `features/notes/NoteCard.test.tsx`,
`features/notes/TagFilter.test.tsx`, `features/notes/NotesPagination.test.tsx`,
`features/notes/DeleteNoteButton.test.tsx`, `features/notes/RestoreNoteButton.test.tsx`
(+ the `App.routing.test.tsx` additions).

---

## 4. Key TypeScript interfaces (final shapes)

```ts
// frontend/src/features/notes/notesQuery.ts
import type {
  NoteSortField, NoteSortOrder, NoteListStatus,
} from '@note-app/shared/schemas/notes' // reuse shared request/enum types (AD-3)

export interface NotesViewState {
  status: NoteListStatus            // 'active' | 'trashed'   (default 'active')
  sort: NoteSortField               // 'updatedAt'|'createdAt'|'title' (default 'updatedAt')
  order: NoteSortOrder              // 'asc' | 'desc'         (default 'desc')
  tags: string[]                    // tag IDs for OR filter  (default [])
  page: number                      // default 1
  limit: number                     // default 20
}

export function parseNotesView(sp: URLSearchParams): NotesViewState  // clamps/sanitizes → defaults
export function serializeNotesView(view: NotesViewState): URLSearchParams
```

```ts
// frontend/src/api/notes.ts — response wire-types are LOCAL with string dates (AD-3)
export interface NoteListItem {
  id: string
  title: string
  tagIds: string[]
  createdAt: string                 // ISO string over the wire
  updatedAt: string
}
export interface NotesListResult {
  data: NoteListItem[]
  page: number
  limit: number
  total: number
}

export function useNotesList(view: NotesViewState):
  UseQueryResult<NotesListResult, ApiError>           // queryKey ['notes', view]
export function useDeleteNote():
  UseMutationResult<void, ApiError, string>           // DELETE /notes/:id → 204; invalidates ['notes']
export function useRestoreNote():
  UseMutationResult<{ note: NoteListItem }, ApiError, string> // POST /notes/:id/restore; 422 = past window
```

```ts
// frontend/src/api/tags.ts
export interface TagOption { id: string; name: string; color: string; noteCount: number }
export function useTags(): UseQueryResult<TagOption[], ApiError>   // queryKey ['tags']; GET /api/tags
```

```ts
// frontend/src/components/ui/confirm-dialog.tsx
interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string             // default 'Delete'
  onConfirm(): void
  onCancel(): void
}
```

Request URL built by `serializeNotesView`, e.g.
`/api/notes?status=active&sort=updatedAt&order=desc&tags=t1,t2&page=2&limit=20`
(`tags` omitted when empty). Matches `ListNotesQuerySchema` exactly.

---

## 5. Reuse of existing code (no duplication)

| Reused | From | Use |
| --- | --- | --- |
| `apiFetch`, `ApiError` | `src/api/client.ts` | all requests; 401 refresh/retry + error envelope are already handled |
| `useAuthStore` | `src/stores/auth.store.ts` | user email in the page header |
| `LogoutButton` | `src/features/auth/LogoutButton.tsx` | header control (moved off the deleted `HomePage`) |
| `ProtectedRoute` | `src/features/auth/ProtectedRoute.tsx` | guard `/`, `/notes/new`, `/notes/:id` |
| `Button`, `Card*` | `src/components/ui/*` | cards, controls; new primitives follow the same `cn`+cva pattern |
| `cn` | `src/lib/utils.ts` | class composition |
| `ListNotesQuery`, `NoteSortField/Order`, `NoteListStatus` | `@note-app/shared/schemas/notes` | typed view-state + query (AD-3) |
| `renderWithProviders`, `makeTestQueryClient`, `jsonResponse` | `src/test/utils.tsx` | test harness + `fetch` stub |

---

## 6. Scenario → test traceability (sets up `/tasks`)

| Spec requirement | Covering test(s) |
| --- | --- |
| Paginated active list (render / loading / error+retry / empty-account / soft-deleted excluded) | `NotesList.test.tsx` |
| Pagination controls + page change | `NotesPagination.test.tsx`, `NotesList.test.tsx` |
| Sorting (default updated-desc, change field/order, retained across pages) | `NotesList.test.tsx` |
| Tag filter OR semantics, de-dup, clear, chips, empty-filter state | `TagFilter.test.tsx`, `NoteCard.test.tsx`, `NotesList.test.tsx` |
| Composed query (single request; reset to page 1 on sort/filter change) | `notesQuery.test.ts`, `NotesList.test.tsx` |
| URL view-state (write / reload-reproduce / back-forward / tolerate bad params) | `notesQuery.test.ts`, `NotesList.test.tsx` |
| Trash view (lists trashed, mutual exclusion, restore-only cards, empty trash) | `NotesList.test.tsx`, `NoteCard.test.tsx` |
| Soft-delete from list (confirm, 204, leaves active, failure surfaced) | `DeleteNoteButton.test.tsx` |
| Restore from Trash (200 returns to active; 422 past-window message) | `RestoreNoteButton.test.tsx` |
| Navigation entry points (`/notes/new`, `/notes/:id`; trashed not openable) | `NoteCard.test.tsx`, `App.routing.test.tsx` |
| Server state via Query + shared types; auth via existing client | `api/notes.test.ts` |
| Routing modified (home = list; editor routes protected) | `App.routing.test.tsx` |

---

## 7. Implementation phases (high-level; `/tasks` expands)

1. **Primitives** — `badge`, `select`, `confirm-dialog` (+ tests as used).
2. **Data layer** — `api/notes.ts`, `api/tags.ts`, `notesQuery.ts`, `useNotesQueryParams.ts`.
3. **Feature UI** — `NotesList` orchestrator + `NoteCard`, `NotesSortControl`, `TagFilter`, `StatusTabs`, `NotesPagination`, `Delete`/`Restore` buttons, `NotesStates`.
4. **Pages + routing** — `NotesPage`, `NoteEditorPlaceholderPage`, `App.tsx` wiring, delete `HomePage`.
5. **Tests** — one named test per spec scenario; meet ≥ 80% coverage.

---

## 8. Quality gates / checkpoint commands

Run after each phase, and the full set before commit (memory: `build` does **not**
run `tsc` — typecheck separately):

```bash
pnpm -w lint                                  # ESLint — zero errors
pnpm --filter frontend exec tsc --noEmit      # typecheck (vite build skips tsc)
pnpm --filter frontend test                   # Vitest + RTL — all green, coverage ≥ 80%
pnpm --filter frontend build                  # vite build — 0 errors
```

Before commit: `npx commitlint --from HEAD~1` + Husky pre-commit must pass; never
`--no-verify`. Commit scope: `notes`. **E2E full journey: deferred to AB-1016.**

---

## 9. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| List response includes `content` (TipTap JSON) → heavy payloads | Out of AB-1011 scope (backend contract); card types only the fields it renders |
| `tags` param ordering / dedupe expectations | `serializeNotesView` joins sorted unique IDs; assert the exact query string in tests |
| Stale list after delete/restore | Mutations `invalidateQueries(['notes'])` (both Active + Trash share the prefix) |
| Bad/old URL params after a shared link | `parseNotesView` clamps unknown/out-of-range values to defaults (server also clamps page/limit per §5.2) |
| Deleting `HomePage.tsx` | Flagged for `[y/n]` confirm; verify no other importers first |
```
