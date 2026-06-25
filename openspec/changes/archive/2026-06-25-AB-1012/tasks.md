# Tasks — AB-1012: Note Editor (TipTap + Autosave)

**Branch:** `feat/AB-1012-note-editor`
**Spec:** `openspec/changes/AB-1012/specs/note-editor/spec.md`
**Plan:** `openspec/changes/AB-1012/plan.md`

---

## Phase 1 — Foundation (Dependencies + API Layer)

> Sequential — each step builds on the prior.

- [ ] **1.1** Install `sonner` — `pnpm --filter frontend add sonner`
- [ ] **1.2** Create `frontend/src/api/notes.ts` — `useCreateNote`, `useNote`, `useUpdateNote` (follows `apiFetch` / `useMutation` / `useQuery` pattern from `api/auth.ts`; `retry: false` on `useNote`)
- [ ] **1.3** Create `frontend/src/api/tags.ts` — `useTags` (`staleTime: 30_000`)

**Checkpoint 1:** `pnpm -w build` → 0 errors

---

## Phase 2 — Core Implementation

### 2A — Independent files (no cross-dependencies within group) [PARALLEL]

> All depend only on Phase 1 being complete and touch separate files.

- [ ] **2.1** [PARALLEL] Create `frontend/src/pages/NewNotePage.tsx` — `POST /api/notes` + `called.current` once-guard + redirect to `/notes/:id` + error toast + navigate to `/notes`
- [ ] **2.2** [PARALLEL] Create `frontend/src/components/ui/badge.tsx` — shadcn Badge primitive, variants: `default | secondary | outline | destructive`
- [ ] **2.3** [PARALLEL] Create `frontend/src/features/notes/NoteTitle.tsx` — controlled `<input>` with `placeholder="Untitled"`, no rich text
- [ ] **2.4** [PARALLEL] Create `frontend/src/features/notes/EditorToolbar.tsx` — toolbar for StarterKit commands (Bold, Italic, H1–H3, BulletList, OrderedList, Blockquote, Code, CodeBlock, HorizontalRule); active state via `editor.isActive()`
- [ ] **2.5** [PARALLEL] Create `frontend/src/features/notes/SaveStatusIndicator.tsx` — maps `SaveState` → label (`idle` blank, `pending` "Unsaved changes", `saving` "Saving…", `saved` "Saved", `error` "Save failed")
- [ ] **2.6** [PARALLEL] Create `frontend/src/features/notes/useAutosave.ts` — 6-state machine (`idle → pending → saving → saved | error | fatal`), 2 s debounce, in-flight queue (max 1 pending), fatal-error guard; `UseAutosaveOptions` uses `contentRef: React.RefObject<object>` + `contentVersion: number` to avoid object ref-equality issue

### 2B — Depends on 2.2 (badge) + Phase 1 (api/tags)

- [ ] **2.7** Create `frontend/src/features/notes/TagPicker.tsx` — flat chip list via Badge, `useTags()`, loading skeleton while in-flight, empty state "No tags yet", optimistic toggle via `onToggle` prop

**Checkpoint 2:** `pnpm -w build` → 0 errors

---

## Phase 3 — Integration

> Sequential — each file depends on the previous.

- [ ] **3.1** Create `frontend/src/features/notes/NoteEditor.tsx` — composes `NoteTitle`, `EditorToolbar`, `EditorContent`, `TagPicker`, `SaveStatusIndicator`; owns `title`, `tagIds`, `contentRef`, `contentVersion` state; wires `useAutosave`; passes `disabled` to children when `saveState === 'fatal'`
- [ ] **3.2** Create `frontend/src/pages/NoteEditorPage.tsx` — reads `:id` from `useParams`; calls `useNote(id)`; loading skeleton while fetching; 404 → `toast.error('Note not found')` + `navigate('/notes', { replace: true })`; renders `NoteEditor`; shows persistent fatal banner when `saveState === 'fatal'` (overlay with "This note has been deleted." + "Back to notes" button)
- [ ] **3.3** Modify `frontend/src/App.tsx` — add `<Toaster position="bottom-right" richColors />` once; add two protected routes in order: `/notes/new` (before `/notes/:id`) wrapping `NewNotePage` and `NoteEditorPage`

**Checkpoint 3:** `pnpm -w build` → 0 errors

---

## Phase 4 — Tests

> Test files are independent of each other [PARALLEL]; both depend on Phase 3 being complete.

- [ ] **4.1** [PARALLEL] Create `frontend/src/features/notes/useAutosave.test.ts` — 9 scenarios:
  - `fires PATCH 2 s after last change`
  - `rapid changes send one PATCH`
  - `queues one pending save while in-flight`
  - `cancels debounce on unmount`
  - `transitions to saved on 200`
  - `transitions to error on network failure, re-arms on next change`
  - `calls onFatalError on 404`
  - `calls onFatalError on 422 NOTE_DELETED`
  - `does not fire on initial mount`

- [ ] **4.2** [PARALLEL] Create `frontend/src/features/notes/NoteEditor.test.tsx` — 7 scenarios:
  - `renders title from note prop`
  - `title input is editable`
  - `tag picker renders user tags`
  - `clicking tag toggles selection`
  - `status indicator reflects save state`
  - `shows fatal banner on fatal error`
  - `fatal banner navigates to list`

**Checkpoint 4 (full quality gate):**
```bash
pnpm -w lint                        # zero errors, zero warnings
pnpm --filter frontend test         # all green
pnpm -w build                       # zero TypeScript errors
pnpm --filter frontend e2e          # required — user-facing feature
```

---

## Spec → task traceability

| Spec scenario | Task |
|---|---|
| Successful blank-note creation redirects to editor | 2.1 |
| Loading state shown while POST is in flight | 2.1 |
| POST failure shows toast and returns to list | 2.1 |
| Navigation away before POST completes aborts gracefully | 2.1 |
| Existing note loads into title and editor | 3.2 |
| Empty title and content render without error | 3.1, 2.3 |
| Note not found redirects to list with toast | 3.2 |
| Loading state shown during initial fetch | 3.2 |
| Toolbar applies StarterKit formatting | 2.4 |
| Title input accepts plain text | 2.3 |
| Editor is read-only while initial fetch is pending | 3.2 |
| Autosave fires 2 s after last change | 2.6 |
| Rapid changes coalesce into a single PATCH | 2.6 |
| Tag change triggers autosave on the same 2 s debounce | 2.6, 2.7 |
| Change while PATCH is in-flight queues one follow-up | 2.6 |
| Autosave debounce cancelled on unmount | 2.6 |
| No-op change does not trigger autosave | 2.6 |
| Initial load shows Saved state | 2.5 |
| Unsaved changes state shown while debounce is pending | 2.5 |
| Saving state shown while PATCH is in-flight | 2.5 |
| Saved state shown after successful PATCH | 2.5 |
| Error state shown after a failed PATCH | 2.5 |
| Tag picker lists all user tags with current selections | 2.7 |
| Clicking unselected tag adds it optimistically | 2.7 |
| Clicking selected tag removes it optimistically | 2.7 |
| Tag picker unavailable while tags are loading | 2.7 |
| User with no tags sees an empty picker | 2.7 |
| Network error shows toast and keeps editor editable | 2.6 |
| 5xx response treated as recoverable | 2.6 |
| Successful retry clears the error state | 2.6 |
| 404 during autosave shows persistent banner | 2.6, 3.2 |
| 422 NOTE_DELETED during autosave shows persistent banner | 2.6, 3.2 |
| Persistent banner offers navigation to notes list | 3.2 |
| Unauthenticated access to /notes/new redirected to login | 3.3 |
| Unauthenticated access to /notes/:id redirected to login | 3.3 |
| Session rehydration shows loading before editor | 3.3 (ProtectedRoute existing) |
