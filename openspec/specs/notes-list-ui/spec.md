# notes-list-ui Specification

## Purpose
The notes list UI is the authenticated home screen. It renders the signed-in user's notes with pagination, sorting, tag filtering, and a Trash view for soft-deleted notes. View state (sort, order, filter, page, status) is encoded in the URL so the list is bookmarkable, shareable, and survives reload and browser navigation.

## Requirements

### Requirement: Paginated active notes list
The authenticated home screen SHALL render the signed-in user's own active
(non-deleted) notes with pagination controls driven by the `{ data, page, limit,
total }` envelope, covering FRS-4.5.1 and FRS-4.4.2.

#### Scenario: Active notes render
- **WHEN** an authenticated user opens the notes list and the user has active notes
- **THEN** each note renders as a card showing its title (a fallback label such as "Untitled" when the title is empty) and its last-updated time, and only the current user's notes appear

#### Scenario: Pagination controls reflect total and current page
- **WHEN** the list response reports `total` greater than `limit`
- **THEN** paging controls render showing the current page and allow moving to the next/previous page, and the displayed page never exceeds the number of pages implied by `total`/`limit`

#### Scenario: Changing page fetches the matching slice
- **WHEN** the user advances to page 2
- **THEN** the client requests `GET /api/notes` with `page=2` and renders that slice, leaving the active sort and filter unchanged

#### Scenario: Soft-deleted notes excluded by default
- **WHEN** the active list is shown (`status=active`)
- **THEN** notes with a `deletedAt` set never appear in it

#### Scenario: Empty active list
- **WHEN** the user has zero active notes (and no filter is applied)
- **THEN** an empty state is shown that invites the user to create their first note, rather than an error or a blank page

#### Scenario: Loading state
- **WHEN** the notes request is in flight and no cached data is available
- **THEN** a loading indicator (e.g. skeleton cards) is shown in place of the list

#### Scenario: Error state with retry
- **WHEN** the notes request fails (non-2xx other than an auth refresh that succeeds)
- **THEN** an error message is shown with a retry affordance, and retrying re-issues the request

---

### Requirement: Sorting
The list SHALL let the user sort by last-updated, created date, or title, in
ascending or descending order, defaulting to last-updated descending (FRS-4.5.2).

#### Scenario: Default sort on first load
- **WHEN** the user opens the list with no sort specified in the URL
- **THEN** the request uses `sort=updatedAt&order=desc` and the control reflects "last updated, newest first"

#### Scenario: Changing sort field and order
- **WHEN** the user selects a different sort field (`createdAt` or `title`) or toggles the order
- **THEN** the client re-fetches with the chosen `sort`/`order` and the list re-renders in that order

#### Scenario: Sort is retained across pages
- **WHEN** the user has chosen a non-default sort and moves to another page
- **THEN** the chosen sort is preserved in the new page request

---

### Requirement: Tag filtering with OR semantics
The list SHALL let the user filter by one or more of their own tags; multiple
selected tags match notes carrying ANY of them (OR), and a note carrying more than
one selected tag appears once (FRS-4.5.3). Selectable tags and per-card tag chips
are sourced read-only from `GET /api/tags`.

#### Scenario: Tag options come from the user's tags
- **WHEN** the filter control opens
- **THEN** it lists the user's own tags (name + color) obtained from `GET /api/tags`, and no other user's tags

#### Scenario: Single-tag filter
- **WHEN** the user selects one tag
- **THEN** the request includes `tags=<tagId>` and the list shows only notes carrying that tag

#### Scenario: Multi-tag filter is OR, de-duplicated
- **WHEN** the user selects two or more tags
- **THEN** the request includes the comma-joined tag IDs and the list shows every note carrying ANY of the selected tags, with a note carrying several of them shown exactly once

#### Scenario: Clearing the filter
- **WHEN** the user removes all selected tags
- **THEN** the request omits `tags` and the unfiltered list is restored

#### Scenario: Per-card tag chips
- **WHEN** a note carries tags
- **THEN** its card renders a chip per tag using the tag's name and color

#### Scenario: Empty filtered result is distinct from empty account
- **WHEN** a tag filter is applied and matches no notes
- **THEN** a "no notes match this filter" state is shown (distinct from the first-note empty state) with a way to clear the filter

---

### Requirement: Composed list query
Pagination, sorting, and tag filtering SHALL compose into a single `GET /api/notes`
request (FRS-4.5.4).

#### Scenario: All parameters in one request
- **WHEN** the user has a sort, a tag filter, and a page selected
- **THEN** a single request carries `page`, `limit`, `sort`, `order`, and `tags` together, and the rendered list reflects all of them at once

#### Scenario: Changing sort or filter resets to page 1
- **WHEN** the user changes the sort or the tag selection while not on page 1
- **THEN** the page resets to 1 for the new query so results are not silently skipped

---

### Requirement: List view-state in the URL
The list's sort, order, tag filter, page, and status SHALL be reflected in the URL
search params so the view is bookmarkable, shareable, and survives reload and
browser navigation.

#### Scenario: State written to the URL
- **WHEN** the user changes sort, order, tags, page, or switches to Trash
- **THEN** the URL search params update to encode that state (e.g. `?sort=title&order=asc&tags=a,b&page=2&status=trashed`)

#### Scenario: Reload reproduces the view
- **WHEN** the user reloads the page (or opens a shared URL) carrying list params
- **THEN** the list renders with exactly that sort, filter, page, and status, issuing the matching request

#### Scenario: Back/forward navigates view-state
- **WHEN** the user changes the view and then presses the browser back button
- **THEN** the previous list view-state is restored from the URL

#### Scenario: Out-of-range or malformed params are tolerated
- **WHEN** the URL carries an out-of-range `page`/`limit` (clamped server-side per the pagination contract) or an unknown param value
- **THEN** the page renders a sensible list without crashing, falling back to defaults for any unusable value

---

### Requirement: Trash view
A Trash view SHALL list the user's soft-deleted notes (`status=trashed`), kept
separate from the active list, and SHALL only allow restoring them — not opening or
editing (FRS-4.4.2, FRS-4.4.5).

#### Scenario: Trash view lists soft-deleted notes
- **WHEN** the user switches to the Trash view
- **THEN** the client requests `GET /api/notes` with `status=trashed` and renders the user's soft-deleted notes

#### Scenario: Active and Trash are mutually exclusive
- **WHEN** a note is active
- **THEN** it appears only in the active list and never in Trash, and a trashed note appears only in Trash

#### Scenario: Trashed cards expose only Restore
- **WHEN** a trashed note card is rendered
- **THEN** it offers a Restore action and does NOT offer open/edit or a delete action (a soft-deleted note may only be restored)

#### Scenario: Empty trash
- **WHEN** the user opens Trash and has no soft-deleted notes
- **THEN** an empty-trash state is shown rather than an error

---

### Requirement: Soft-delete from the list
Deleting a note from the active list SHALL perform a soft delete via
`DELETE /api/notes/:id`, after which the note leaves the active list and is found in
Trash (FRS-4.4.1).

#### Scenario: Delete moves a note to Trash
- **WHEN** the user confirms deletion of an active note
- **THEN** the client calls `DELETE /api/notes/:id`, expects `204`, invalidates the active list so the note is removed from it, and the note subsequently appears in the Trash view

#### Scenario: Delete is confirmed first
- **WHEN** the user triggers delete on a note card
- **THEN** a confirmation step is required before the request is sent, so a single misclick does not delete a note

#### Scenario: Delete failure surfaces an error
- **WHEN** the delete request fails (e.g. `404` for an already-removed note)
- **THEN** an error is surfaced and the list state is reconciled (the note is not left in a falsely-deleted UI state)

---

### Requirement: Restore from Trash
Restoring a trashed note SHALL call `POST /api/notes/:id/restore`; on success the
note returns to the active list, and a restore past the 30-day window SHALL be
surfaced clearly without losing the note (FRS-4.4.3).

#### Scenario: Restore returns a note to active
- **WHEN** the user restores a trashed note within the recovery window
- **THEN** the client calls `POST /api/notes/:id/restore`, expects `200`, invalidates both lists, and the note reappears in the active list and leaves Trash

#### Scenario: Restore past the 30-day window
- **WHEN** restoring a note whose recovery window has elapsed and the API returns `422`
- **THEN** a clear "recovery window has expired" message is shown and the note remains in Trash (the UI does not pretend the restore succeeded)

---

### Requirement: Navigation entry points to the editor
The list SHALL provide entry points into the (AB-1012) editor: a "New note" action
and clickable active note cards, routing to placeholder routes until the editor
lands.

#### Scenario: New note entry point
- **WHEN** the user activates the "New note" button
- **THEN** the app navigates to `/notes/new`

#### Scenario: Opening an active note
- **WHEN** the user clicks an active note card
- **THEN** the app navigates to `/notes/:id` for that note

#### Scenario: Trashed cards are not openable
- **WHEN** the user clicks the body of a trashed note card
- **THEN** no navigation to the editor occurs (only Restore is available)

---

### Requirement: Server state via TanStack Query and shared schemas
Notes and tags SHALL be fetched and mutated exclusively through TanStack Query hooks
in `src/api/`, typed from the `packages/shared` Zod schemas, with no API responses
held in Zustand and no hand-authored duplicates of shared shapes.

#### Scenario: Data flows through query hooks
- **WHEN** the page needs notes or tags, or mutates a note (delete/restore)
- **THEN** it uses TanStack Query hooks (`useNotesList`, `useTags`, `useDeleteNote`, `useRestoreNote`) rather than ad-hoc `fetch` + `useState`, and mutations invalidate the relevant queries

#### Scenario: Types are imported from shared
- **WHEN** typing the list query params and response
- **THEN** the code imports `ListNotesQuery` / `NoteListResponse` (and tag types) from `@note-app/shared` instead of redefining them

#### Scenario: Auth handled by the existing client
- **WHEN** a list/mutation request meets an expired access token (`401`)
- **THEN** the existing `apiFetch` client performs the single refresh-and-retry and, on unrecoverable failure, redirects to `/login` — the list page adds no bespoke auth handling
