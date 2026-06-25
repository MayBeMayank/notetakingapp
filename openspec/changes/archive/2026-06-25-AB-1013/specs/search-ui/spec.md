# Delta Spec — search-ui (AB-1013)

Consumes: `GET /api/search` (AB-1007, SDS §6.5)
FRS coverage: §6.1, §6.3, §6.4, §6.5, §6.6

---

## ADDED Requirements

### Requirement: Dedicated search route

The application SHALL expose a protected route at `/search` that renders the
search UI. The route requires an active session; unauthenticated visitors are
redirected to `/login`.

#### Scenario: authenticated user navigates to /search
- **WHEN** an authenticated user navigates to `/search`
- **THEN** the search page renders with an empty search input and no results shown

#### Scenario: unauthenticated user navigates to /search
- **WHEN** a visitor without a valid session navigates to `/search`
- **THEN** they are redirected to `/login`

---

### Requirement: Search input with debounced query

The search input SHALL accept free-text up to 200 characters (matching
`SearchQuerySchema.q`). Queries are dispatched to `GET /api/search` after a
300 ms debounce. (FRS-6.1)

#### Scenario: user types a query
- **WHEN** the user types a search query into the input field
- **THEN** after 300 ms of inactivity the app issues `GET /api/search?q=<query>&page=1` and displays results

#### Scenario: user types faster than the debounce window
- **WHEN** the user types continuously without pausing 300 ms
- **THEN** only one request is issued (for the final value after the debounce settles)

#### Scenario: user clears the input
- **WHEN** the user removes all text from the search input
- **THEN** the results area is cleared and no request is sent to the backend

#### Scenario: query exceeds 200 characters
- **WHEN** the user's input reaches the 200-character limit
- **THEN** the input stops accepting further characters (enforced by `maxLength` attribute)

---

### Requirement: URL-persisted query and page state

The current query string and page number SHALL be stored in URL search params
(`?q=<value>&page=<n>`) so that browser back/forward navigation and bookmarks
reproduce the same results.

#### Scenario: user performs a search then navigates back
- **WHEN** the user searches for "meeting notes", views page 2, then presses the browser back button
- **THEN** the URL reverts to the previous state and the corresponding results are displayed

#### Scenario: user loads a URL with pre-filled query
- **WHEN** the user opens `/search?q=quarterly&page=2` directly
- **THEN** the search input is pre-filled with "quarterly" and page 2 of results is fetched and displayed

---

### Requirement: Ranked, paginated result list

Results SHALL be displayed ranked by relevance (as returned by the backend).
Pagination controls SHALL allow navigation through pages using the same
`page`/`limit` contract as the notes list (SDS §5.2). (FRS-6.3)

#### Scenario: multiple pages of results
- **WHEN** a query returns more results than the page limit (default 20)
- **THEN** pagination controls appear and the user can navigate to subsequent pages

#### Scenario: result cards link to the note editor
- **WHEN** the user clicks on a search result card
- **THEN** they are navigated to `/notes/:noteId` (the existing note editor)

---

### Requirement: Highlighted snippet rendering

Each result card SHALL display a text snippet with matched terms wrapped in
`<mark>` elements rendered as HTML so the highlights are visible. (FRS-6.4)

#### Scenario: result with matched terms
- **WHEN** a search result contains a snippet like `"…the <mark>meeting</mark> agenda…"`
- **THEN** the word "meeting" is rendered visually highlighted (yellow/accent background)

#### Scenario: result with title only (no content match)
- **WHEN** a search result has an empty or whitespace snippet
- **THEN** the snippet area is hidden or shows a placeholder; the title is still displayed

---

### Requirement: Empty query — no request, empty state

When the query is empty or whitespace-only, the search hook SHALL return an
empty result set without issuing a network request. (FRS-6.6)

#### Scenario: search page first load (no query)
- **WHEN** the user arrives at `/search` with no `q` param
- **THEN** an instructional empty state is displayed ("Type to search your notes") and no API call is made

#### Scenario: whitespace-only query
- **WHEN** the user enters only spaces or tabs into the input
- **THEN** the input is treated as empty; no request is sent and the empty state is shown

---

### Requirement: No-results state

When a non-empty query returns zero results, a "no matches" empty state SHALL
be displayed instead of a blank page. (FRS-6.3 / FRS-6.6)

#### Scenario: query with no matching notes
- **WHEN** a query returns `total: 0`
- **THEN** a "No notes found for '<query>'" message is displayed and no result cards are rendered

---

### Requirement: Loading state

While a search request is in-flight, a loading indicator SHALL be shown to
prevent a jarring blank-then-filled transition. (FRS-6.3)

#### Scenario: request in-flight
- **WHEN** a debounced query has been sent and the response has not yet arrived
- **THEN** a skeleton or spinner is displayed in the results area

---

### Requirement: Error state with retry

If the search request fails (network error or 5xx), an error state with a
retry action SHALL be displayed. (FRS-9.5)

#### Scenario: network or server error
- **WHEN** `GET /api/search` responds with an error
- **THEN** an error message is displayed with a "Try again" button that re-issues the request

---

### Requirement: Navigation from Notes page

The Notes page header SHALL include a link or button to navigate to the search
page, giving users a discoverable entry point.

#### Scenario: user clicks search from notes list
- **WHEN** the user clicks the Search button/link in the Notes page header
- **THEN** they are navigated to `/search`
