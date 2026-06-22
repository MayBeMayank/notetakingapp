# Delta Spec — full-text-search
**Change:** AB-1007
**FRS coverage:** §6.1 (full-text across own title + content), §6.2 (native DB FTS — no external service), §6.3 (relevance-ranked + paginated), §6.4 (highlighted snippet), §6.5 (own active notes only, soft-deleted excluded), §6.6 (empty/whitespace query → empty result); cross-cutting §9.1 (ownership isolation), §9.2 (auth), §9.3 (validation), §9.6 (pagination)
**SDS coverage:** §6.5 (search contract), §7 (Postgres native FTS design — tsvector / GIN / `websearch_to_tsquery` / `ts_headline` / `ts_rank`), §5.1 (status codes), §5.2 (pagination contract)

> Search covers the title and content of the caller's **active** notes only. Tags, version history, trashed notes, and shared notes are never searched (FRS-6.5). The search **UI** is AB-1013; the `tags=`/`sort=` note-list filters are AB-1005 — `/api/search` takes only `q`, `page`, `limit`.

---

## ADDED Requirements

### Requirement: Full-text search over own active notes
The system SHALL allow an authenticated user to full-text search across the `title` and content of their **own active (non-deleted)** notes, using PostgreSQL's native full-text capability. A note SHALL match when its `search_vector` matches the parsed query; the search SHALL never return another user's note or a soft-deleted note.

#### Scenario: Match on title
- **WHEN** an authenticated user searches `q=invoice` and owns an active note whose title contains "invoice"
- **THEN** the system responds `200` and that note appears in `data` with `noteId` and `title`

#### Scenario: Match on content
- **WHEN** an authenticated user searches `q=quarterly` and owns an active note whose body (`contentText`) contains "quarterly" but whose title does not
- **THEN** the system responds `200` and that note appears in `data`

#### Scenario: Non-matching notes excluded
- **WHEN** an authenticated user searches a term that appears in none of their notes
- **THEN** the system responds `200` with `{ data: [], page, limit, total: 0 }`

#### Scenario: Only the caller's notes are searched
- **WHEN** user A searches a term that matches a note owned by user B
- **THEN** user B's note never appears in user A's results, and its existence is not leaked (FRS-6.5 / 9.1)

#### Scenario: Soft-deleted notes excluded
- **WHEN** an authenticated user soft-deletes a note that matches the query and then searches that term
- **THEN** the soft-deleted note does not appear in `data` and is not counted in `total` (FRS-6.5)

#### Scenario: Native Postgres FTS is used
- **WHEN** the search runs
- **THEN** matching is performed in the database via the `search_vector` tsvector column and `websearch_to_tsquery('english', …)` — no external search service and no application-side text scan (FRS-6.2)

---

### Requirement: Relevance ranking, deterministic order, and pagination
Results SHALL be ranked by relevance (`ts_rank`) descending, with a deterministic tie-breaker, and SHALL be paginated per the SDS §5.2 contract. The response SHALL report the full match count as `total`, independent of the page size.

#### Scenario: Results ordered by relevance
- **WHEN** a query matches several of the caller's notes with differing relevance
- **THEN** `data` is ordered by `rank` descending (most relevant first), and each item carries its `rank` value

#### Scenario: Equal-rank ties are deterministically ordered
- **WHEN** two matching notes have an equal `ts_rank`
- **THEN** they are ordered by `updatedAt` descending (most-recently-updated first), giving a stable, repeatable order across pages

#### Scenario: Pagination returns the requested page
- **WHEN** a query matches 25 notes and the user requests `page=2&limit=10`
- **THEN** the system responds `200` with the 11th–20th most-relevant notes in `data`, `page: 2`, `limit: 10`

#### Scenario: total reflects the full match count
- **WHEN** a query matches 25 notes and the user requests `page=1&limit=10`
- **THEN** `data` has 10 items but `total` is `25` (the window-function count of all matches, not the page size)

#### Scenario: Page beyond the last returns empty data with correct total
- **WHEN** a query matches 5 notes and the user requests `page=3&limit=10`
- **THEN** the system responds `200` with `data: []`, `page: 3`, `limit: 10`, `total: 5`

#### Scenario: Out-of-range page and limit are clamped, not rejected
- **WHEN** a user requests `page=0` or `limit=500` (or negative values)
- **THEN** the system clamps to the bounds (`page` min 1; `limit` min 1, max 100) and responds `200` — it does not reject with 400 (SDS §5.2)

#### Scenario: Default pagination when omitted
- **WHEN** a user searches with `q` only and no `page`/`limit`
- **THEN** `page` defaults to `1` and `limit` to `20`

---

### Requirement: Highlighted snippet with matched terms in context
Each result SHALL include a `snippet` showing the matched keyword(s) in context, with matched terms wrapped in `<mark>…</mark>` (FRS-6.4). When the match is in the title and the content produces no highlight, the snippet SHALL fall back to a leading slice of the content so every result still carries context.

#### Scenario: Content match yields a highlighted snippet
- **WHEN** a query matches a term in a note's content
- **THEN** that result's `snippet` contains the surrounding text with the matched term wrapped in `<mark>…</mark>` (via `ts_headline`)

#### Scenario: Title-only match falls back to a content snippet
- **WHEN** a query matches only in a note's title (the content has no matched term, so `ts_headline` over the content yields no `<mark>`)
- **THEN** the result still appears, and its `snippet` is a non-empty leading slice of the note's content text (the match is shown via the `title` field)

#### Scenario: Snippet is bounded
- **WHEN** a matching note has a very long body
- **THEN** the `snippet` is a bounded fragment (not the entire content), showing the matched context only

---

### Requirement: Empty or whitespace query returns an empty result
An empty, whitespace-only, or missing `q` SHALL return an empty result set with `200`, not an error, and SHALL not query the database (FRS-6.6).

#### Scenario: Empty query string
- **WHEN** an authenticated user requests `GET /api/search?q=`
- **THEN** the system responds `200` with `{ data: [], page, limit, total: 0 }` — not a 400

#### Scenario: Whitespace-only query
- **WHEN** an authenticated user requests `GET /api/search?q=%20%20%20` (spaces only)
- **THEN** the system responds `200` with `{ data: [], total: 0 }`

#### Scenario: Missing query parameter
- **WHEN** an authenticated user requests `GET /api/search` with no `q` parameter
- **THEN** the system responds `200` with `{ data: [], total: 0 }` (treated as an empty query, FRS-6.6)

#### Scenario: Empty query does not hit the database
- **WHEN** the query is empty or whitespace-only
- **THEN** the service short-circuits and returns the empty result without executing the FTS query

---

### Requirement: Query validation and safe parsing
The `q` parameter SHALL be length-bounded by the shared Zod schema, and within bounds SHALL be parsed safely by `websearch_to_tsquery` so that special characters never cause a server error or injection.

#### Scenario: Query longer than the bound is rejected
- **WHEN** an authenticated user submits a `q` longer than 200 characters
- **THEN** the system responds `400` with `{ error: { code: "VALIDATION_ERROR", fields: [{ field: "q", message: "…" }] } }`

#### Scenario: Non-numeric page or limit is rejected
- **WHEN** an authenticated user submits `page=abc` or `limit=xyz`
- **THEN** the system responds `400` with `fields[]` (non-numeric pagination values are rejected before clamping, consistent with the notes list)

#### Scenario: Special characters are parsed safely
- **WHEN** a query within the length bound contains punctuation or `websearch_to_tsquery` operators (e.g. `"quoted phrase" or foo -bar`, `&|!:*`)
- **THEN** the request is parameterized and parsed by `websearch_to_tsquery` — it responds `200` (with whatever matches) and never a `500` or a SQL error

---

### Requirement: Search result shape exposes only safe fields
A search result item SHALL expose exactly `{ noteId, title, snippet, rank }`. The note's `contentJson`, `contentText`, `tagIds`, owner identity, and timestamps SHALL NOT be exposed through a search result.

#### Scenario: Result item carries only the four contract fields
- **WHEN** a search returns matches
- **THEN** each item in `data` has exactly `noteId`, `title`, `snippet`, and `rank`, and no other note fields (SDS §6.5)

#### Scenario: Full content is not returned by search
- **WHEN** a note matches
- **THEN** its full `contentJson`/`contentText` is not included in the result — only the bounded `snippet` is (the client reads the full note via `GET /api/notes/:id`)

---

### Requirement: Search authentication and ownership isolation
`GET /api/search` SHALL require a valid access token and SHALL scope every query to the authenticated user.

#### Scenario: Missing or invalid token rejected
- **WHEN** a request to `GET /api/search` carries a missing, malformed, or expired access token
- **THEN** the auth middleware responds `401` with `{ error: { code: "UNAUTHORIZED", … } }` and the search is not executed (FRS-9.2)

#### Scenario: Every search is scoped to the caller
- **WHEN** any search runs
- **THEN** the underlying FTS query includes `"userId" = req.userId AND "deletedAt" IS NULL`, so results and `total` only ever reflect the caller's own active notes (FRS-9.1 / 6.5)
