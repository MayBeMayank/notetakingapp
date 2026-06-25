# share-ui Specification

## Purpose
TBD - created by archiving change ab-1014. Update Purpose after archive.
## Requirements
### Requirement: Share entry points

The application SHALL expose a "Share" action both in the note editor header and on
each note card in the notes list. Activating it opens the Share modal for that note.

#### Scenario: open share from the editor header
- **WHEN** an authenticated user viewing a note in the editor clicks the "Share" button in the header
- **THEN** the Share modal opens scoped to that note's id

#### Scenario: open share from a note card
- **WHEN** an authenticated user clicks the Share action on a note card in the list
- **THEN** the Share modal opens scoped to that card's note id, without navigating away from the list

#### Scenario: share action is not offered for a trashed note
- **WHEN** a note card is rendered in the trashed (soft-deleted) status view
- **THEN** the Share action is hidden or disabled, because a share cannot be created on a soft-deleted note (FRS-7.6, FRS-4.4.5)

---

### Requirement: Share modal lifecycle

The Share modal SHALL be a controlled overlay following the existing
`confirm-dialog` pattern (`role="dialog"`, `aria-modal`, dismissable via Escape or
backdrop click). It SHALL contain the create-link control and the active-links list
for the current note.

#### Scenario: modal opens with current state
- **WHEN** the Share modal opens for a note
- **THEN** it fetches `GET /api/shares`, filters the result to the current note, and shows that note's active links plus a control to generate a new one

#### Scenario: dismiss the modal
- **WHEN** the user presses Escape, clicks the backdrop, or clicks the close control
- **THEN** the modal closes and no pending create/revoke request is left dangling

---

### Requirement: Generate a share link with preset expiry

The modal SHALL let the user generate a new public link for the current active note
by `POST`ing to `/api/notes/:id/shares`. Expiry is chosen from preset durations —
**Never, 1 day, 7 days, 30 days**. A non-"Never" choice is converted to a
strictly-future ISO 8601 datetime at submit; "Never" sends `expiresAt: null`.
(FRS-7.1, FRS-7.2)

#### Scenario: generate a never-expiring link
- **WHEN** the user keeps the expiry on "Never" and clicks Generate
- **THEN** the app POSTs `{ expiresAt: null }`, and on `201` the new link appears at the top of the active-links list with `viewCount: 0` and "Never expires"

#### Scenario: generate a link with a preset expiry
- **WHEN** the user picks "7 days" and clicks Generate
- **THEN** the app POSTs `{ expiresAt: "<now + 7 days, ISO 8601 future datetime>" }`, and on `201` the new link appears showing its expiry

#### Scenario: multiple links on one note coexist
- **WHEN** the user generates a second link for the same note
- **THEN** both links appear in the list, each with a distinct token/url — generating a new link never replaces an existing one (FRS-7.1)

#### Scenario: optimistic disable while generating
- **WHEN** a generate request is in flight
- **THEN** the Generate control is disabled to prevent duplicate submissions, and a pending indicator is shown

---

### Requirement: Generate rejected on a soft-deleted note

The modal SHALL surface a user-readable message when the backend rejects share creation
because the target note is soft-deleted (`422`), rather than showing a generic failure.
(FRS-7.6, create-side)

#### Scenario: note soft-deleted between open and generate
- **WHEN** the user clicks Generate and the backend responds `422` with code `NOTE_DELETED`
- **THEN** the modal SHALL show an inline error such as "This note is in the trash — restore it before sharing" and no link is added to the list

#### Scenario: note not found or not owned
- **WHEN** the generate request responds `404`
- **THEN** the modal SHALL show an error message and no link is added (no existence leak is implied by the UI)

---

### Requirement: Copy a link URL

Each active link SHALL offer a Copy action that places the **absolute** share URL on
the clipboard. The stored `url` is the relative `"/s/<token>"`; the UI prepends
`window.location.origin`.

#### Scenario: copy succeeds
- **WHEN** the user clicks Copy on a link
- **THEN** `window.location.origin + "/s/<token>"` is written to the clipboard and a success toast confirms it

#### Scenario: clipboard unavailable
- **WHEN** the clipboard write fails or is unavailable
- **THEN** an error toast is shown and the URL remains visible/selectable for manual copy

---

### Requirement: List the current note's active links

The modal SHALL display the active links for the current note, each showing its
expiry (or "Never expires") and its current view count, newest first. (FRS-7.7,
FRS-7.4 display)

#### Scenario: links scoped to this note only
- **WHEN** the user has share links across several notes and opens the modal for one note
- **THEN** only that note's links are listed — links belonging to other notes are filtered out client-side on `noteId`

#### Scenario: each link shows expiry and view count
- **WHEN** the active-links list renders
- **THEN** each row shows its expiry (formatted date, or "Never expires") and its `viewCount`

#### Scenario: no active links yet
- **WHEN** the current note has no active share links
- **THEN** an empty state ("No active links — generate one to share this note") is shown instead of an empty list

#### Scenario: expired-but-not-revoked link is still listed
- **WHEN** a link's `expiresAt` is in the past but it has not been revoked
- **THEN** it still appears (matching `GET /api/shares`), visibly marked as expired so the user can clean it up (FRS-7.7)

---

### Requirement: Revoke a share link

Each link SHALL offer a Revoke action that `DELETE`s `/api/shares/:id`. Revocation
SHALL be confirmed first; on success the link is removed from the list immediately.
(FRS-7.5)

#### Scenario: revoke with confirmation
- **WHEN** the user clicks Revoke and confirms in the confirmation prompt
- **THEN** the app DELETEs `/api/shares/:id`, and on `204` the link is removed from the active-links list

#### Scenario: cancel revocation
- **WHEN** the user clicks Revoke but cancels the confirmation
- **THEN** no request is sent and the link remains

#### Scenario: revoke of an already-gone link
- **WHEN** a revoke request responds `404` (link already revoked or unknown)
- **THEN** the link is still removed from the list and no blocking error is shown (the desired end-state is reached)

---

### Requirement: Loading and error states

The modal SHALL show a loading state while fetching the link list and a recoverable
error state if the list request fails. (FRS-9.5)

#### Scenario: link list loading
- **WHEN** the `GET /api/shares` request is in flight on open
- **THEN** a loading indicator is shown in place of the list

#### Scenario: link list fetch fails
- **WHEN** `GET /api/shares` responds with an error
- **THEN** an error message with a "Try again" action is shown; retrying re-issues the request

---

### Requirement: Authentication and ownership boundary

All owner share operations driven by this UI SHALL go through the authenticated API
client, and the share surface SHALL only ever be reachable from an authenticated
session. (FRS-9.1, FRS-9.2)

#### Scenario: share operations carry the access token
- **WHEN** the UI issues any create / list / revoke share request
- **THEN** it uses the authenticated `apiFetch` (access token attached, 401 → refresh+retry), never an anonymous request

#### Scenario: session lost mid-flow
- **WHEN** a share request ultimately resolves to `401` after a failed refresh
- **THEN** the standard unauthorized handler redirects to `/login` (no share-specific bypass)

