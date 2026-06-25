# public-share-view-ui Specification

## Purpose
TBD - created by archiving change ab-1014. Update Purpose after archive.
## Requirements
### Requirement: Public viewer route

The application SHALL expose an **unauthenticated** route at `/s/:token` that renders
the shared note. The route SHALL be mounted **outside** the auth guard and SHALL NOT
require or redirect for a session. (FRS-7.3)

#### Scenario: anonymous visitor opens a valid link
- **WHEN** a visitor with no session opens `/s/<token>` for a valid, non-expired, non-revoked link
- **THEN** the page renders the note's current title and content without redirecting to `/login`

#### Scenario: authenticated owner opens the same link
- **WHEN** a logged-in user opens `/s/<token>`
- **THEN** they see the identical read-only public view — the page does not attach their access token and grants no extra controls

---

### Requirement: Read-only rendering of current content

The page SHALL fetch `GET /api/public/notes/:token` **without** an access token and
render the returned `title` and `content` (TipTap JSON) as read-only. (FRS-7.3)

#### Scenario: content renders read-only
- **WHEN** the public note loads successfully
- **THEN** the title and rich-text content are displayed with **no** edit affordances — no toolbar, no autosave, no editable surface (a read-only TipTap render or equivalent)

#### Scenario: current content is served, not a snapshot
- **WHEN** the owner has edited the note since the link was created and a viewer reloads `/s/<token>`
- **THEN** the page shows the note's **current** title and content (the backend serves live content; the viewer never caches a stale snapshot beyond normal query staleness) (FRS-7.3)

#### Scenario: request carries no credentials
- **WHEN** the page issues the public fetch
- **THEN** it calls the API client with `auth: false` so no `Authorization` header is sent

---

### Requirement: No private data exposed

The public viewer SHALL render only the note's title and content. It SHALL NOT
request, derive, or display the note's tags, version history, owner identity, share
metadata, or any other note. (FRS-7.8)

#### Scenario: only title and content are shown
- **WHEN** the public note renders
- **THEN** the DOM contains the title and content only — no tags, no version controls, no owner name/email, no view count, no links to the owner's other notes

#### Scenario: no navigation into the authenticated app
- **WHEN** a viewer is on `/s/<token>`
- **THEN** the page exposes no controls that would reveal or navigate into the owner's private workspace (notes list, editor, search)

---

### Requirement: Unknown link state

When the token is unknown, the page SHALL show a clear "link not found" state rather
than an authenticated error or a crash. (FRS-7.3, view-side)

#### Scenario: unknown token
- **WHEN** `GET /api/public/notes/:token` responds `404`
- **THEN** the page shows a "This share link doesn't exist" message and no note content

---

### Requirement: Gone link state

The page SHALL show a "link no longer available" state when the link is revoked,
expired, or its note has been soft-deleted (backend responds `410`). (FRS-7.5,
FRS-7.6, view-side)

#### Scenario: revoked or expired link
- **WHEN** `GET /api/public/notes/:token` responds `410`
- **THEN** the page SHALL show a "This share link is no longer available" message and no note content

#### Scenario: note behind the link was soft-deleted
- **WHEN** the underlying note is soft-deleted and the public fetch responds `410`
- **THEN** the page SHALL show the same "no longer available" state — the viewer is never told the note exists or was deleted (FRS-7.6, FRS-7.8)

---

### Requirement: Loading state

While the public note is being fetched, a loading state SHALL be shown. (FRS-9.5)

#### Scenario: fetch in flight
- **WHEN** the public note request has been issued and not yet resolved
- **THEN** a loading indicator is shown in place of the note

