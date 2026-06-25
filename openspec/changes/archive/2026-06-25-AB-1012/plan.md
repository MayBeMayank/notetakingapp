# Plan — AB-1012: Note Editor (TipTap + Autosave)

**Branch:** `feat/AB-1012-note-editor`
**Spec:** `openspec/changes/AB-1012/specs/note-editor/spec.md`
**Depends on:** All backends (AB-1004/1005/1006). All feature directories are empty stubs.

---

## Codebase snapshot (relevant findings)

| Finding | Impact on plan |
|---|---|
| `@tiptap/react@2.27.2` + `@tiptap/starter-kit@2.27.2` already installed | No new packages for editor core |
| `apiFetch<T>(path, opts)` in `src/api/client.ts` — single fetch wrapper, auto Bearer, single-flight refresh, returns `ApiError` on non-2xx | Notes + tags hooks follow exact same pattern as auth hooks |
| `NoteResponse`, `CreateNoteInput`, `UpdateNoteInput`, `TagWithCount` — fully typed in `packages/shared` | No new interfaces to hand-author; import from shared |
| All `src/features/{notes,tags,…}/` directories are empty `.gitkeep` stubs | Clean slate; no conflict with AB-1011 (on a different branch) |
| `useAuthStore` Zustand pattern — store holds `status: 'anonymous' \| 'pending' \| 'authenticated'` | `ProtectedRoute` already handles unauthenticated / rehydrating guard |
| Test pattern: `renderWithProviders`, `vi.stubGlobal('fetch', vi.fn(...))`, `makeTestQueryClient()` | Tests follow same pattern; no new test utilities needed |
| `sonner` not yet installed | Add for toasts — one `pnpm --filter frontend add sonner` step |

---

## Architecture decisions

### A1 — Create-on-navigate via `useMutation` + `useEffect` with a once-guard
`NewNotePage` fires `POST /api/notes {}` exactly once using a `called` ref to survive React StrictMode double-invocation. On `onSuccess`, replaces `/notes/new` with `/notes/:id` via React Router's `navigate(id, { replace: true })`.

### A2 — `useAutosave` is a standalone hook, not inside `NoteEditor`
Keeps the editor component pure (UI only). The hook owns the debounce timer ref, in-flight tracking, pending-save queue (at most one queued), and the save state machine. `NoteEditorPage` instantiates it and passes `saveState` down.

### A3 — Save state machine (6 states)
```
'idle' → (change) → 'pending' → (timer fires) → 'saving'
  'saving' → (200) → 'saved'
  'saving' → (network/5xx) → 'error' → (change) → 'pending'  [recoverable]
  'saving' → (404 / 422 NOTE_DELETED) → 'fatal'  [no re-arm]
```

### A4 — TipTap content flow: `editor.getJSON()` → PATCH `content` field
`contentText` is derived server-side; the frontend only sends the JSON document as the `content` field of `UpdateNoteInput`. TipTap is initialised with `note.content` (the stored `contentJson`) as the `content` prop to `useEditor`.

### A5 — Tag picker is a flat chip list, no dropdown dependency
Given users typically have ≤ 20 tags, render all tags as toggleable `Badge`-style buttons inline below the editor. No `@radix-ui/react-popover` required. Add `src/components/ui/badge.tsx` (single new shadcn primitive — no new npm package).

### A6 — TanStack Query key shape
```
['notes', id]   → single note  (set on create / update; read on load)
['notes']       → list         (invalidated after create)
['tags']        → tag list     (read-only in editor; invalidation owned by AB-1006 frontend)
```

### A7 — `useNote` retries disabled; `useUpdateNote` does NOT use TanStack's built-in retry
`retry: false` on `useNote` prevents hammering 404s. The autosave hook manages its own retry semantics (re-arm on next user change for recoverable errors; no retry for fatal).

### A8 — Toast via `sonner`
`sonner` is the canonical shadcn toast solution. A single `<Toaster />` is mounted once in `App.tsx`. Call sites use `toast.error(msg)` / `toast.success(msg)` directly — no context or store needed.

---

## TypeScript interfaces

All response/request shapes come from `@note-app/shared`. Only local types are defined in-package.

```ts
// frontend/src/features/notes/useAutosave.ts
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'fatal'

interface UseAutosaveOptions {
  noteId: string
  title: string
  content: object          // editor.getJSON() output
  tagIds: string[]
  onFatalError: () => void // called on 404 / 422 NOTE_DELETED; page navigates away
}

interface UseAutosaveReturn {
  saveState: SaveState
}
```

---

## Exact files to create / modify

### New files

```
frontend/src/api/notes.ts
frontend/src/api/tags.ts
frontend/src/components/ui/badge.tsx
frontend/src/features/notes/useAutosave.ts
frontend/src/features/notes/SaveStatusIndicator.tsx
frontend/src/features/notes/NoteTitle.tsx
frontend/src/features/notes/EditorToolbar.tsx
frontend/src/features/notes/TagPicker.tsx
frontend/src/features/notes/NoteEditor.tsx
frontend/src/features/notes/useAutosave.test.ts
frontend/src/features/notes/NoteEditor.test.tsx
frontend/src/pages/NewNotePage.tsx
frontend/src/pages/NoteEditorPage.tsx
```

### Modified files

```
frontend/src/App.tsx          — add two protected routes + <Toaster />
frontend/package.json         — add sonner dependency
```

---

## Phase breakdown

### Phase 1 — Dependencies + API layer

**1a. Add `sonner`**
```bash
pnpm --filter frontend add sonner
```

**1b. `frontend/src/api/notes.ts`**

Four exports following the same `useMutation` / `useQuery` pattern as `src/api/auth.ts`:

```ts
export function useCreateNote(): UseMutationResult<NoteEnvelope, ApiError, void>
// mutationFn: () => apiFetch<NoteEnvelope>('/notes', { method: 'POST', body: {} })
// onSuccess: setQueryData(['notes', note.id], data) + invalidateQueries(['notes'])

export function useNote(id: string): UseQueryResult<NoteEnvelope, ApiError>
// queryKey: ['notes', id]
// queryFn: () => apiFetch<NoteEnvelope>(`/notes/${id}`)
// retry: false  (don't hammer 404s)
// staleTime: 0  (always fresh; autosave keeps server in sync)

export function useUpdateNote(): UseMutationResult<NoteEnvelope, ApiError, UpdateNoteInput & { id: string }>
// mutationFn: ({ id, ...body }) => apiFetch<NoteEnvelope>(`/notes/${id}`, { method: 'PATCH', body })
// onSuccess: setQueryData(['notes', note.id], data)
// NO retry here — useAutosave manages retry semantics
```

**1c. `frontend/src/api/tags.ts`**

```ts
export function useTags(): UseQueryResult<TagListResponse, ApiError>
// queryKey: ['tags']
// queryFn: () => apiFetch<TagListResponse>('/tags')
// staleTime: 30_000  (tags change infrequently; 30s cache avoids re-fetches on editor re-render)
```

**Checkpoint:** `pnpm -w build` → 0 errors.

---

### Phase 2 — `NewNotePage` (create-on-navigate)

**`frontend/src/pages/NewNotePage.tsx`**

```tsx
// useCreateNote mutation
// useEffect with called.current ref to fire exactly once
// While pending: full-page spinner
// onSuccess: navigate('/notes/' + note.id, { replace: true })
// onError: toast.error('Could not create note') + navigate('/notes')
```

Key implementation detail:
```ts
const called = useRef(false)
useEffect(() => {
  if (called.current) return
  called.current = true
  createNote(undefined, {
    onSuccess: (data) => navigate(`/notes/${data.note.id}`, { replace: true }),
    onError:   ()     => { toast.error('Could not create note'); navigate('/notes') },
  })
}, [])  // eslint-disable-line react-hooks/exhaustive-deps
```

**Checkpoint:** `pnpm -w build` → 0 errors.

---

### Phase 3 — Core editor UI components

**`frontend/src/components/ui/badge.tsx`**
Standard shadcn Badge primitive — variants: `default`, `secondary`, `outline`, `destructive`.
Used by `TagPicker` for tag chips.

**`frontend/src/features/notes/NoteTitle.tsx`**
```tsx
// Props: value: string; onChange: (v: string) => void; disabled?: boolean
// Renders: <input type="text" placeholder="Untitled" ... />
// No TipTap, no form library — direct controlled input
// Applies Tailwind: text-2xl font-bold, no border, focus:outline-none
```

**`frontend/src/features/notes/EditorToolbar.tsx`**
```tsx
// Props: editor: Editor | null
// Renders a row of icon buttons for StarterKit commands:
//   Bold | Italic | H1 | H2 | H3 | BulletList | OrderedList | Blockquote | Code | CodeBlock | HorizontalRule
// Each button: editor.chain().focus().<command>().run()
// Active state: editor.isActive('<mark>') — applied as visual highlight via cn()
// Uses Button variant="ghost" size="sm" from components/ui/button
```

**`frontend/src/features/notes/SaveStatusIndicator.tsx`**
```tsx
// Props: state: SaveState
// Renders a small text indicator in the editor header:
//   'idle'    → nothing / blank
//   'pending' → "Unsaved changes"  (muted text)
//   'saving'  → "Saving…"          (muted text + spinner icon)
//   'saved'   → "Saved"            (muted text + check icon)
//   'error'   → "Save failed"      (destructive text)
//   'fatal'   → (banner; not this component — handled in NoteEditorPage)
```

**Checkpoint:** `pnpm -w build` → 0 errors.

---

### Phase 4 — `useAutosave` hook

**`frontend/src/features/notes/useAutosave.ts`**

Full implementation contract:

```ts
const DEBOUNCE_MS = 2_000

export function useAutosave({ noteId, title, content, tagIds, onFatalError }: UseAutosaveOptions): UseAutosaveReturn {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef  = useRef(false)
  const pendingRef   = useRef(false)         // true = a change arrived while PATCH was in-flight
  const latestRef    = useRef({ title, content, tagIds })  // always holds latest values
  const fatalRef     = useRef(false)         // once fatal, never retry

  const { mutateAsync: updateNote } = useUpdateNote()

  // keep latestRef fresh on every render without triggering saves
  useEffect(() => { latestRef.current = { title, content, tagIds } })

  const executeSave = useCallback(async () => {
    if (fatalRef.current) return
    if (inFlightRef.current) { pendingRef.current = true; return }

    inFlightRef.current = true
    setSaveState('saving')
    try {
      await updateNote({ id: noteId, ...latestRef.current })
      setSaveState('saved')
      if (pendingRef.current) {
        pendingRef.current = false
        executeSave()  // drain the queued save
      }
    } catch (err) {
      const e = err as ApiError
      if (e.status === 404 || (e.status === 422 && e.code === 'NOTE_DELETED')) {
        fatalRef.current = true
        setSaveState('fatal')
        onFatalError()
      } else {
        setSaveState('error')  // recoverable; re-arms on next change
      }
    } finally {
      inFlightRef.current = false
    }
  }, [noteId, updateNote, onFatalError])

  // debounce: reset timer on any change
  useEffect(() => {
    if (fatalRef.current) return
    setSaveState('pending')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(executeSave, DEBOUNCE_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [title, content, tagIds, executeSave])

  return { saveState }
}
```

> Note: `content` is an `object` (TipTap JSON). Because objects fail React's reference-equality check on every render, `NoteEditor` must pass a **stable reference** via `useRef` or `useMemo` — only update when `editor.getJSON()` actually changes (use `editor.on('update', ...)` to capture the new JSON into state, not inline in the render).

**Checkpoint:** `pnpm -w build` → 0 errors.

---

### Phase 5 — `TagPicker`

**`frontend/src/features/notes/TagPicker.tsx`**
```tsx
// Props: selectedIds: string[]; onToggle: (id: string) => void; disabled?: boolean
// Data: useTags() — renders loading skeleton while in flight
// Renders: flat row of Badge buttons, each toggling between outline (unselected) / default (selected)
// Empty state: "No tags — create tags from the sidebar" (or similar)
// Disabled when editor is in fatal state
```

Tag toggle is purely local state in `NoteEditor`. The `tagIds` state change feeds into `useAutosave`'s debounce via the `tagIds` dependency.

**Checkpoint:** `pnpm -w build` → 0 errors.

---

### Phase 6 — `NoteEditor` composition component

**`frontend/src/features/notes/NoteEditor.tsx`**

Top-level editor composition. Owns all local state; orchestrates child components.

```tsx
interface NoteEditorProps {
  note: NoteResponse
}

export function NoteEditor({ note }: NoteEditorProps) {
  const navigate = useNavigate()

  // local state initialised from server data
  const [title, setTitle]     = useState(note.title)
  const [tagIds, setTagIds]   = useState<string[]>(note.tagIds)
  const contentRef            = useRef<object>(note.content)  // stable ref, updated on TipTap 'update' event

  // TipTap
  const editor = useEditor({
    extensions: [StarterKit],
    content: note.content,
    onUpdate: ({ editor }) => { contentRef.current = editor.getJSON() },
  })

  // autosave
  const { saveState } = useAutosave({
    noteId: note.id,
    title,
    content: contentRef.current,
    tagIds,
    onFatalError: () => {
      // fatal banner shown via saveState === 'fatal'; user navigates manually
      // NoteEditorPage watches saveState and shows the persistent banner
    },
  })

  // ...render NoteTitle, EditorToolbar, EditorContent, TagPicker, SaveStatusIndicator
}
```

> `contentRef.current` is mutable but `useAutosave` reads `latestRef.current` inside the effect — so TipTap changes ARE captured without triggering extra re-renders. The debounce IS triggered because `useAutosave`'s `useEffect` depends on the `content` param … but wait: if `content` is `contentRef.current` passed as a prop, it won't re-trigger the effect on change because it's the same object ref.

**Correction — content triggering pattern:**
Use a separate `contentVersion` counter (number) to signal a TipTap change to the debounce, while `latestRef` holds the actual JSON:

```ts
const [contentVersion, setContentVersion] = useState(0)  // increments on every TipTap 'update'
const contentRef = useRef<object>(note.content)

// in useEditor.onUpdate:
contentRef.current = editor.getJSON()
setContentVersion(v => v + 1)

// pass to useAutosave:
useAutosave({ ..., content: contentRef, contentVersion, ... })
// useAutosave's debounce effect depends on contentVersion, reads contentRef.current on save
```

Adjust `UseAutosaveOptions`:
```ts
interface UseAutosaveOptions {
  noteId: string
  title: string
  contentRef: React.RefObject<object>
  contentVersion: number
  tagIds: string[]
  onFatalError: () => void
}
```
The debounce `useEffect` depends on `[title, contentVersion, tagIds, executeSave]`. `executeSave` reads `latestRef.current` (which mirrors title + contentRef.current + tagIds).

**Checkpoint:** `pnpm -w build` → 0 errors.

---

### Phase 7 — `NoteEditorPage`

**`frontend/src/pages/NoteEditorPage.tsx`**

```tsx
// Reads :id from useParams()
// useNote(id) query
// While loading: skeleton
// If error.status === 404: toast.error('Note not found') + navigate('/notes', { replace: true })
// If data: render NoteEditor + useTags via TagPicker inside NoteEditor
// Watches saveState for 'fatal': shows persistent error banner overlay
//   Banner: "This note has been deleted." + "Back to notes" button → navigate('/notes')
//   Editor rendered but non-interactive (disabled prop passed down)
```

**Checkpoint:** `pnpm -w build` → 0 errors.

---

### Phase 8 — Routing

**`frontend/src/App.tsx` changes:**

```tsx
// 1. Import Toaster from 'sonner' and mount once inside the router root:
//    <Toaster position="bottom-right" richColors />

// 2. Add two protected routes (before the catch-all):
<Route path="/notes/new" element={<ProtectedRoute><NewNotePage /></ProtectedRoute>} />
<Route path="/notes/:id"  element={<ProtectedRoute><NoteEditorPage /></ProtectedRoute>} />
```

React Router v7 matches routes top-to-bottom. `/notes/new` must be declared **before** `/notes/:id` so the literal "new" is not captured as an id param.

**Checkpoint:** `pnpm -w build` → 0 errors.

---

### Phase 9 — Tests

**`frontend/src/features/notes/useAutosave.test.ts`**

Uses `renderHook` from `@testing-library/react` wrapped with `renderWithProviders`.
Stubs `fetch` via `vi.stubGlobal('fetch', vi.fn(...))`.

Scenarios to cover:
| Scenario | Test name |
|---|---|
| Change triggers PATCH after 2 s debounce | `fires PATCH 2 s after last change` |
| Rapid changes coalesce | `rapid changes send one PATCH` |
| Change while in-flight queues one follow-up | `queues one pending save` |
| Unmount cancels pending timer | `cancels debounce on unmount` |
| 200 response → saveState 'saved' | `transitions to saved on 200` |
| Network error → saveState 'error', re-arms | `transitions to error on network failure, re-arms on next change` |
| 404 → saveState 'fatal', onFatalError called | `calls onFatalError on 404` |
| 422 NOTE_DELETED → saveState 'fatal' | `calls onFatalError on 422 NOTE_DELETED` |
| No PATCH when no change after load | `does not fire on initial mount` |

**`frontend/src/features/notes/NoteEditor.test.tsx`**

Uses `renderWithProviders`. Stubs `fetch`.

Scenarios to cover:
| Scenario | Test name |
|---|---|
| Title input reflects note.title | `renders title from note prop` |
| Typing in title updates display | `title input is editable` |
| TagPicker shows all tags, selected ones highlighted | `tag picker renders user tags` |
| Clicking unselected tag selects it | `clicking tag toggles selection` |
| SaveStatusIndicator shows correct label per state | `status indicator reflects save state` |
| Fatal banner shown when saveState === 'fatal' | `shows fatal banner on fatal error` |
| Fatal banner Back button navigates to /notes | `fatal banner navigates to list` |

**Checkpoint (full quality gate):**
```bash
pnpm -w lint
pnpm --filter frontend test
pnpm -w build
```

---

## DB changes

None — all backend APIs are pre-existing.

---

## Reuse of existing shared code

| Reused | From |
|---|---|
| `NoteResponse`, `UpdateNoteInput`, `CreateNoteInput` | `@note-app/shared/schemas/notes` |
| `TagWithCount`, `TagListResponse` | `@note-app/shared/schemas/tags` |
| `apiFetch`, `ApiError` | `frontend/src/api/client.ts` |
| `ProtectedRoute`, `useAuthStore` | `frontend/src/features/auth/` |
| `Button`, `Card` | `frontend/src/components/ui/` |
| `renderWithProviders`, `makeTestQueryClient`, `jsonResponse` | `frontend/src/test/utils.tsx` |

---

## Quality gates (run in order after all phases)

```bash
pnpm -w lint                       # zero errors
pnpm --filter frontend test        # all green (includes new useAutosave + NoteEditor tests)
pnpm -w build                      # zero TypeScript errors
pnpm --filter frontend e2e         # required — user-facing feature
```

---

## Phase summary

| Phase | Deliverable | Key files |
|---|---|---|
| 1 | API layer | `api/notes.ts`, `api/tags.ts`, add `sonner` |
| 2 | Create-on-navigate | `pages/NewNotePage.tsx` |
| 3 | UI primitives | `badge.tsx`, `NoteTitle`, `EditorToolbar`, `SaveStatusIndicator` |
| 4 | Autosave hook | `features/notes/useAutosave.ts` |
| 5 | Tag picker | `features/notes/TagPicker.tsx` |
| 6 | Editor composition | `features/notes/NoteEditor.tsx` |
| 7 | Editor page | `pages/NoteEditorPage.tsx` |
| 8 | Routing | `App.tsx` |
| 9 | Tests | `useAutosave.test.ts`, `NoteEditor.test.tsx` |
