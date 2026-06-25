# Proposal — AB-1012: Note Editor (TipTap + Autosave)

**Ticket:** AB-1012
**Branch:** feat/AB-1012-note-editor
**Depends on:** AB-1004 (notes CRUD backend), AB-1005 (list/sort/filter), AB-1006 (tags backend), AB-1010 (auth pages + app shell), AB-1011 (notes list page)

---

## Why

AB-1010 delivered the auth flow and AB-1011 delivered the notes list page — users can now see their notes but cannot create or edit them. AB-1012 closes the core writing loop: it gives users a full rich-text editor backed by create-on-navigate and continuous autosave, completing the primary value proposition of the application.

---

## What Changes

**In scope — consumes FRS §4.1–4.3 and FRS-5.7:**
- Route `/notes/new` — immediately fires `POST /api/notes {}`, redirects to `/notes/:id` before the user types (create-on-navigate, FRS-4.1.2)
- Route `/notes/:id` — loads the note via `GET /api/notes/:id` and populates a TipTap editor
- TipTap StarterKit editor (bold, italic, H1–H3, bullet list, ordered list, blockquote, inline code, code block, horizontal rule) with a plain-text title input above it
- 2-second debounced autosave: any change to title, content, or tags resets the timer; fires `PATCH /api/notes/:id` with `{ title, content, tagIds }`
- Inline tag picker — loads the user's own tags via `GET /api/tags`, reflects current note associations, sends updated `tagIds` in every autosave
- Autosave status indicator (idle / saving / saved / error states visible in the editor header)
- Differentiated error handling:
  - Recoverable (network error, 5xx) → transient toast, autosave retries on next change
  - Fatal (404, 422 `NOTE_DELETED`) → persistent error banner, editor goes read-only, user navigated back to list

**Explicitly out of scope:**
- Soft-delete / restore actions triggered from the editor (notes list or a future dedicated control)
- Version history drawer (AB-1015)
- Share modal (AB-1014)
- Search UI (AB-1013)
- Backend API changes — all consumed endpoints already exist (AB-1004/AB-1005/AB-1006)

---

## Capabilities

### New Capabilities
- `note-editor`: TipTap-based rich-text note editor with create-on-navigate flow, 2-second debounced autosave, inline tag picker, and differentiated save-error handling

### Modified Capabilities
- `frontend-app-shell`: two new protected routes added — `/notes/new` (new-note redirect shim) and `/notes/:id` (editor page)

---

## Impact

**API Delta — no new backend endpoints. Consumes existing:**

| Method | Path | When used |
|---|---|---|
| `POST` | `/api/notes` | On mount of `/notes/new`; body `{}` (blank note) |
| `GET` | `/api/notes/:id` | On mount of `/notes/:id`; populates editor |
| `PATCH` | `/api/notes/:id` | Every autosave; body `{ title, content, tagIds }` |
| `GET` | `/api/tags` | On mount of editor; populates tag picker |

**DB Changes:** None.

**Affected layers:**
- `frontend/src/pages/` — `NewNotePage.tsx` (POST + redirect shim), `NoteEditorPage.tsx` (editor screen)
- `frontend/src/features/notes/` — `NoteEditor`, `NoteTitle`, `EditorToolbar`, `TagPicker`, `SaveStatusIndicator`, `useAutosave` hook
- `frontend/src/api/` — `useCreateNote`, `useNote`, `useUpdateNote` TanStack Query hooks; `useTags` may already exist from AB-1011
- `frontend/src/App.tsx` — two new protected route entries

**Key assumptions:**
- The frontend sends `contentJson` (TipTap JSON document object) as the `content` field; `contentText` is derived server-side
- TipTap's StarterKit `getJSON()` output is the authoritative `content` value; no manual serialisation is needed
- Tag data is already queryable via `GET /api/tags` (delivered by AB-1006 backend)
- AB-1011 may have already scaffolded `useTags` and/or basic notes list hooks; AB-1012 adds or extends with create / read / update hooks
