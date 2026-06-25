# Spec — note-editor (AB-1012)

## Purpose
A TipTap-based rich-text note editor with create-on-navigate flow, 2-second debounced autosave, inline tag picker, and differentiated save-error handling. Consumes FRS §4.1–4.3 and FRS-5.7.

---

## ADDED Requirements

### Requirement: Create a blank note on navigate to /notes/new
When an authenticated user navigates to `/notes/new`, the page SHALL immediately fire `POST /api/notes {}` (blank note), then redirect to `/notes/:newId` on success — the real note id is in the URL before the user types anything. The POST SHALL be fired exactly once per mount; rapid re-mounts (e.g. Strict Mode double-invoke) SHALL NOT create duplicate notes.

#### Scenario: Successful blank-note creation redirects to editor
- **WHEN** an authenticated user navigates to `/notes/new`
- **THEN** `POST /api/notes {}` is called once, the 201 response yields `{ note: { id, … } }`, and the router replaces `/notes/new` with `/notes/:id` so the editor renders with the new note's id in the URL (FRS-4.1.1, FRS-4.1.2)

#### Scenario: Loading state shown while POST is in flight
- **WHEN** `POST /api/notes` is in flight after navigating to `/notes/new`
- **THEN** a loading indicator is displayed and the TipTap editor is not yet rendered, preventing user input before a valid note id exists

#### Scenario: POST failure shows an error and returns to list
- **WHEN** `POST /api/notes` returns a non-2xx response (network failure or 5xx)
- **THEN** the page navigates to the notes list and displays a transient toast indicating the note could not be created; no editor is rendered

#### Scenario: Navigation away before POST completes aborts gracefully
- **WHEN** the user navigates away from `/notes/new` before the POST response arrives
- **THEN** the in-flight request is cancelled or its result is ignored and no redirect occurs; no orphan note appears in a stale update

---

### Requirement: Load an existing note into the editor
When an authenticated user navigates to `/notes/:id`, the editor SHALL fetch the note via `GET /api/notes/:id` and populate the title input and TipTap editor with the stored `title` and `contentJson`. A loading state SHALL be shown until the fetch resolves.

#### Scenario: Existing note loads into title and editor
- **WHEN** an authenticated user navigates to `/notes/:id` for an active note they own
- **THEN** the title input is populated with `note.title` and TipTap is initialised with `note.contentJson`; both are editable once loaded (FRS-4.2.1)

#### Scenario: Empty title and content render without error
- **WHEN** the fetched note has `title = ""` and an empty TipTap document as `contentJson`
- **THEN** the title input shows a placeholder (e.g. "Untitled") and the TipTap editor renders a blank, focusable document — not an error state (FRS-4.1.2)

#### Scenario: Note not found redirects to list with toast
- **WHEN** `GET /api/notes/:id` returns 404 (note absent, soft-deleted, or belongs to another user)
- **THEN** the router navigates to the notes list and a transient toast conveys "Note not found" — no editor is rendered and the 404 is not surfaced as a blank page (FRS-4.2.2)

#### Scenario: Loading state shown during initial fetch
- **WHEN** `GET /api/notes/:id` is in flight
- **THEN** a loading skeleton or spinner is displayed and the editor is not interactive, preventing autosave from firing before the note is hydrated

---

### Requirement: TipTap StarterKit rich-text editor
The editor SHALL render a TipTap instance configured with the StarterKit extension bundle, providing: bold, italic, H1–H3, bullet list, ordered list, blockquote, inline code, code block, and horizontal rule. A persistent toolbar SHALL expose these formatting options. The title field SHALL be a plain-text `<input>` above the TipTap content area, not part of the TipTap document.

#### Scenario: Toolbar applies StarterKit formatting
- **WHEN** the user selects text in the TipTap editor and activates a toolbar button (e.g. Bold)
- **THEN** the selected text is wrapped with the corresponding mark, the button reflects its active state, and the change is reflected in `editor.getJSON()` immediately

#### Scenario: Title input accepts plain text
- **WHEN** the user types in the title input
- **THEN** the input value updates in real time and the change is included in the next autosave PATCH as the `title` field — no TipTap node or rich-text formatting is applied to the title

#### Scenario: Editor is read-only while initial fetch is pending
- **WHEN** `GET /api/notes/:id` has not yet resolved
- **THEN** TipTap is not mounted and the toolbar is not rendered; the user cannot type until the note is loaded

---

### Requirement: Autosave on title, content, or tag change
Any change to the title input, the TipTap document, or the tag selection SHALL reset a 2-second debounce timer. When the timer fires, the editor SHALL PATCH `/api/notes/:id` with `{ title: <current>, content: <tiptap.getJSON()>, tagIds: <current> }`. Only one PATCH SHALL be in flight at a time; a new change while a PATCH is in flight queues a follow-up save after the in-flight one completes.

#### Scenario: Autosave fires 2 seconds after last change
- **WHEN** an authenticated user stops editing (title, content, or tags) for 2 seconds
- **THEN** exactly one `PATCH /api/notes/:id` is fired with the current `{ title, content, tagIds }` (FRS-4.3.1)

#### Scenario: Rapid changes coalesce into a single PATCH
- **WHEN** the user makes continuous edits (e.g. typing a paragraph) within the same 2-second window
- **THEN** only one PATCH fires after the final keystroke's 2-second timer expires — not one per keystroke

#### Scenario: Tag change triggers autosave on the same 2-second debounce
- **WHEN** the user adds or removes a tag in the tag picker and no other edit occurs within 2 seconds
- **THEN** a PATCH fires with the updated `tagIds` alongside the current `title` and `content` (FRS-5.7)

#### Scenario: Change while PATCH is in flight queues one follow-up
- **WHEN** the user edits the note while a PATCH is already in flight
- **THEN** the in-flight PATCH completes first; a single follow-up PATCH is fired with the latest state after the in-flight one resolves — at most one queued PATCH exists at any time

#### Scenario: Autosave debounce cancelled on unmount
- **WHEN** the user navigates away from the editor before the 2-second timer fires
- **THEN** the pending autosave is cancelled and no PATCH is sent after unmount; no "can't perform state update on unmounted component" warnings occur

#### Scenario: No-op change does not trigger autosave
- **WHEN** the editor loads a note and the user makes no modifications
- **THEN** no PATCH is sent (the debounce never fires because the note content is unchanged from the server copy)

---

### Requirement: Autosave status indicator
A status indicator in the editor header SHALL reflect the current save state: no-changes (initial load or post-save), saving (PATCH in flight), saved (last PATCH succeeded), or error (last PATCH failed). The indicator SHALL update in real time without blocking the editor.

#### Scenario: Initial load shows "Saved" state
- **WHEN** the note is successfully loaded via GET and no edits have been made
- **THEN** the status indicator shows a "Saved" or quiescent state

#### Scenario: Unsaved changes state shown while debounce is pending
- **WHEN** the user makes a change and the 2-second timer has not yet fired
- **THEN** the indicator transitions to an "Unsaved changes" or pending state, signalling that a save is queued

#### Scenario: Saving state shown while PATCH is in flight
- **WHEN** a PATCH request is in flight
- **THEN** the indicator shows "Saving…" (or equivalent) and does not block further editing

#### Scenario: Saved state shown after successful PATCH
- **WHEN** the PATCH responds 200
- **THEN** the indicator transitions to "Saved" (or equivalent), confirming the latest content is persisted

#### Scenario: Error state shown after a failed PATCH
- **WHEN** the PATCH returns a non-2xx response or a network error
- **THEN** the indicator transitions to an error state, signalling that the last save attempt failed

---

### Requirement: Inline tag picker
The editor SHALL display a tag picker component listing all of the authenticated user's own tags (fetched via `GET /api/tags`). Tags currently attached to the note SHALL appear selected. Clicking a tag toggles its attachment optimistically in the UI; the change is included in the next autosave PATCH as the full replacement `tagIds` array.

#### Scenario: Tag picker lists all user tags with current selections
- **WHEN** the editor loads and `GET /api/tags` resolves
- **THEN** all of the user's tags are shown; tags whose ids appear in `note.tagIds` are visually selected (FRS-5.6)

#### Scenario: Clicking an unselected tag adds it optimistically
- **WHEN** the user clicks an unselected tag in the picker
- **THEN** the tag is shown as selected immediately (optimistic), and the 2-second autosave debounce is reset (FRS-5.7)

#### Scenario: Clicking a selected tag removes it optimistically
- **WHEN** the user clicks a selected tag in the picker
- **THEN** the tag is shown as deselected immediately (optimistic), and the 2-second autosave debounce is reset (FRS-5.7)

#### Scenario: Tag picker unavailable while tags are loading
- **WHEN** `GET /api/tags` is in flight
- **THEN** the tag picker shows a loading state and is not interactive until the tag list resolves

#### Scenario: User with no tags sees an empty picker
- **WHEN** `GET /api/tags` returns an empty array
- **THEN** the tag picker renders an empty state (e.g. "No tags yet") — not an error

---

### Requirement: Recoverable autosave error handling
A network failure or 5xx response from `PATCH /api/notes/:id` SHALL be treated as a transient error. The editor SHALL show a non-blocking toast notification and SHALL resume autosave retries on the user's next change — the editor remains fully editable.

#### Scenario: Network error shows a toast and keeps editor editable
- **WHEN** a PATCH request fails due to a network error or timeout
- **THEN** a transient toast notification appears (e.g. "Could not save — will retry"), the editor remains editable, and autosave re-arms on the next change

#### Scenario: 5xx response treated as recoverable
- **WHEN** a PATCH returns a 500 or other 5xx response
- **THEN** the same transient-toast + retry behaviour as a network error applies; the user's current edits are not discarded

#### Scenario: Successful retry clears the error state
- **WHEN** after a recoverable error the user makes a further change and the subsequent PATCH succeeds
- **THEN** the error toast is dismissed (or replaced) and the status indicator returns to "Saved"

---

### Requirement: Fatal autosave error handling
A 404 or 422 `NOTE_DELETED` response from `PATCH /api/notes/:id` SHALL be treated as fatal. The editor SHALL render a persistent error banner, disable further autosave attempts, and offer navigation back to the notes list. The user's in-memory edits MAY be shown for reference but cannot be persisted.

#### Scenario: 404 during autosave shows persistent banner and disables saves
- **WHEN** a PATCH returns 404 (note has been deleted or never existed)
- **THEN** a persistent error banner is displayed (e.g. "This note no longer exists"), the autosave debounce is stopped, and further PATCHes are blocked until the user leaves the page

#### Scenario: 422 NOTE_DELETED during autosave shows persistent banner
- **WHEN** a PATCH returns 422 with `error.code = "NOTE_DELETED"`
- **THEN** the same persistent-banner + save-disabled behaviour as a 404 applies (FRS-4.3.3)

#### Scenario: Persistent banner offers navigation to notes list
- **WHEN** a fatal error banner is shown
- **THEN** the banner includes a control (button or link) that navigates the user back to `/notes` (the notes list)

---

### Requirement: Protected route access
Both `/notes/new` and `/notes/:id` SHALL be protected routes requiring a valid session. An unauthenticated visitor SHALL be redirected to `/login` by the existing `ProtectedRoute` guard. No editor content SHALL be rendered before authentication is confirmed.

#### Scenario: Unauthenticated access to /notes/new redirected to login
- **WHEN** a visitor with no valid session navigates to `/notes/new`
- **THEN** `ProtectedRoute` redirects to `/login` without firing `POST /api/notes` (FRS-9.2)

#### Scenario: Unauthenticated access to /notes/:id redirected to login
- **WHEN** a visitor with no valid session navigates to `/notes/:id`
- **THEN** `ProtectedRoute` redirects to `/login` without firing `GET /api/notes/:id`

#### Scenario: Session rehydration shows loading before editor
- **WHEN** a visitor with a stored refresh token (but no in-memory access token) navigates to `/notes/:id` on boot
- **THEN** `ProtectedRoute` shows a loading indicator while the token refresh resolves, then either renders the editor (success) or redirects to `/login` (failure) — it does not flash the login page prematurely (per `frontend-app-shell` spec)
