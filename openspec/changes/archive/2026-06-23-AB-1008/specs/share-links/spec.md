# Delta Spec — share-links
**Change:** AB-1008
**FRS coverage:** §7.1 (generate a public read-only link for an own active note), §7.2 (unguessable token + optional expiry — create-time validation), §7.5 (revoke), §7.7 (list active links with expiry + view count), and the **create-side** of §7.6 (cannot create a share on a soft-deleted note); cross-cutting §9.1–9.5
**SDS coverage:** §6.6 (owner-side sharing contracts), §3 (ShareLink model), §5.1 (status codes), §8 (token generation)

> The **public viewer** behaviour (FRS-7.3 read-only current title+content, FRS-7.4 atomic view-count increment, FRS-7.8 no leak of tags/versions/owner/other notes) and the **view-side** of FRS-7.6 (soft-deleted note → link inaccessible) and FRS-7.2 (expiry enforced on view) are realized on `GET /api/public/notes/:token` and are specified in the sibling `public-share-view` delta of this change.

---

## ADDED Requirements

### Requirement: Generate a share link
The system SHALL allow an authenticated user to generate a public, read-only share link for one of their own **active** notes by `POST`ing to `/api/notes/:id/shares`. Each successful request SHALL mint a **new, independent** share link addressed by an unguessable token. A note MAY carry multiple active share links simultaneously. The link MAY carry an optional `expiresAt`; when omitted or `null` the link never expires. On success the system SHALL respond `201` with the share resource shaped `{ id, noteId, token, url, expiresAt, viewCount, createdAt }`, where `url` is the relative path `"/s/<token>"` and `viewCount` starts at `0`.

#### Scenario: Create a link with no expiry
- **WHEN** an authenticated user POSTs `{}` (or `{ expiresAt: null }`) to `/api/notes/:id/shares` for an own active note
- **THEN** the system responds `201` with `{ share: { id, noteId, token, url: "/s/<token>", expiresAt: null, viewCount: 0, createdAt } }`, the row's `noteId` is the target note, and the link never expires (FRS-7.1, FRS-7.2)

#### Scenario: Create a link with a valid future expiry
- **WHEN** an authenticated user POSTs `{ expiresAt: "<a future ISO datetime>" }` to `/api/notes/:id/shares` for an own active note
- **THEN** the system responds `201` and the returned share echoes the same `expiresAt` value, with `viewCount: 0` (FRS-7.2)

#### Scenario: Multiple active links on the same note each get a distinct token
- **WHEN** an authenticated user POSTs to `/api/notes/:id/shares` twice for the same own note
- **THEN** both requests respond `201`, each returns a **different** `token` (and therefore a different `url`), and both links are independently usable — minting a new link never replaces or revokes an existing one (clarification 1, FRS-7.1)

#### Scenario: Token is unguessable
- **WHEN** a share link is generated
- **THEN** the `token` is a 32-byte random value encoded base64url (SDS §8, §3) — unique across all shares and not derivable from the note id, user id, or any sequence

#### Scenario: url is a relative path
- **WHEN** a share link is generated
- **THEN** the response `url` is exactly `"/s/<token>"` — a relative path string with no absolute base URL and no host (clarification 4)

#### Scenario: Unauthenticated create rejected
- **WHEN** a request to `POST /api/notes/:id/shares` carries no valid access token
- **THEN** the auth middleware responds `401` and no share link is created (FRS-9.2)

---

### Requirement: Reject share creation on an invalid target
The system SHALL reject share creation when the target note does not exist, is not owned by the caller, or is soft-deleted, and SHALL reject a non-future or malformed `expiresAt`. A note that is absent or owned by another user SHALL return `404` (no existence leak); a soft-deleted own note SHALL return `422`; an invalid `expiresAt` SHALL return `400` with `fields[]`.

#### Scenario: Note not found returns 404
- **WHEN** an authenticated user POSTs to `/api/notes/:id/shares` for a note id that matches no note
- **THEN** the system responds `404` with `{ error: { code: "NOT_FOUND", … } }` and no share link is created (FRS-9.1)

#### Scenario: Note owned by another user returns 404, never 403
- **WHEN** an authenticated user POSTs to `/api/notes/:id/shares` for a note owned by a different user
- **THEN** the system responds `404` (indistinguishable from absent) — never `403` — and the other user's note is untouched (FRS-9.1, FRS-4.2.2)

#### Scenario: Note is soft-deleted returns 422
- **WHEN** an authenticated user POSTs to `/api/notes/:id/shares` for one of their own notes whose `deletedAt` is set
- **THEN** the system responds `422` with `{ error: { code: "NOTE_DELETED", … } }` and no share link is created (create-side of FRS-7.6, FRS-4.4.5)

#### Scenario: Past-or-present expiresAt rejected with 400
- **WHEN** an authenticated user POSTs `{ expiresAt: "<a past or present datetime>" }` to `/api/notes/:id/shares`
- **THEN** the system responds `400` with `{ error: { code: "VALIDATION_ERROR", fields: [{ field: "expiresAt", message: "…" }] } }` and no share link is created — `expiresAt`, if provided, MUST be strictly in the future (clarification 2, FRS-7.2)

#### Scenario: Malformed expiresAt rejected with 400
- **WHEN** an authenticated user POSTs `{ expiresAt: "not-a-date" }` (or any non-datetime value) to `/api/notes/:id/shares`
- **THEN** the system responds `400` with a `fields[]` entry for `expiresAt` and no share link is created (FRS-9.3)

---

### Requirement: List active share links
The system SHALL allow an authenticated user to list their own active share links by `GET`ting `/api/shares`. The response SHALL be a **bare array** (no `{ data, page, limit, total }` envelope) of share resources spanning **all** of the caller's notes, each carrying its `expiresAt` and `viewCount`, **ordered by `createdAt` descending (newest first)**. "Active" SHALL exclude only **revoked** links (`revokedAt IS NULL`); expired-but-not-revoked links remain listed so the user can review and clean them up, and a link whose underlying note is **soft-deleted is also still listed** — the query filters on `revokedAt` only, never on the note's `deletedAt`.

#### Scenario: List returns the caller's shares across all their notes
- **WHEN** an authenticated user GETs `/api/shares`
- **THEN** the system responds `200` with a bare array `[ { id, noteId, token, url, expiresAt, viewCount, createdAt } ]` containing every non-revoked share the caller owns, drawn from any of their own notes (FRS-7.7)

#### Scenario: Revoked links are excluded
- **WHEN** an authenticated user has revoked one of their share links and then GETs `/api/shares`
- **THEN** the revoked link does not appear in the array (clarification 3, FRS-7.5)

#### Scenario: Expired-but-not-revoked links are included
- **WHEN** an authenticated user has a share link whose `expiresAt` is in the past but which has not been revoked, and GETs `/api/shares`
- **THEN** that link still appears, carrying its (past) `expiresAt` and current `viewCount`, so the user can see and clean it up (clarification 3, FRS-7.7)

#### Scenario: Links on soft-deleted notes are still included
- **WHEN** an authenticated user has a non-revoked share link whose underlying note has been soft-deleted (non-null `deletedAt`) and GETs `/api/shares`
- **THEN** that link still appears in the array with its `expiresAt` + `viewCount` — the list filters only on `revokedAt IS NULL`, never on the note's `deletedAt`, so the link resumes public viewing if the note is later restored (clarification 5, FRS-7.7)

#### Scenario: List is ordered newest-first
- **WHEN** an authenticated user with several share links GETs `/api/shares`
- **THEN** the array is ordered by `createdAt` **descending** — the most recently minted link appears first — giving a deterministic order in the absence of a pagination envelope (clarification 6)

#### Scenario: Other users' shares are excluded
- **WHEN** an authenticated user GETs `/api/shares`
- **THEN** share links owned by other users (i.e. on other users' notes) never appear (FRS-9.1)

#### Scenario: Empty list
- **WHEN** an authenticated user with no active share links GETs `/api/shares`
- **THEN** the system responds `200` with `[]` (not an error)

#### Scenario: Unauthenticated list rejected
- **WHEN** a request to `GET /api/shares` carries no valid access token
- **THEN** the auth middleware responds `401` (FRS-9.2)

---

### Requirement: Revoke a share link
The system SHALL allow an authenticated user to revoke one of their own share links by `DELETE`ing `/api/shares/:id`. Revocation SHALL respond `204`, SHALL make the link immediately inaccessible to public viewers, and SHALL remove it from subsequent `GET /api/shares` results. Revoking a link that is unknown or not owned by the caller SHALL return `404`. Revoking an already-revoked own link SHALL be idempotent.

#### Scenario: Revoke an own share link
- **WHEN** an authenticated user DELETEs `/api/shares/:id` for one of their own share links
- **THEN** the system responds `204`, the link's `revokedAt` is set, and the link no longer appears in `GET /api/shares` (FRS-7.5)

#### Scenario: Revoked link is immediately unusable publicly
- **WHEN** a share link is revoked and a public viewer then opens it via `GET /api/public/notes/:token`
- **THEN** the link is immediately inaccessible to public viewers — the public endpoint no longer serves the note (the `410 SHARE_GONE` response is owned and specified by the sibling `public-share-view` delta) (FRS-7.5)

#### Scenario: Revoking an unknown share returns 404
- **WHEN** an authenticated user DELETEs `/api/shares/:id` for an id that matches no share link
- **THEN** the system responds `404` with `{ error: { code: "NOT_FOUND", … } }`

#### Scenario: Revoking a not-owned share returns 404, never 403
- **WHEN** an authenticated user DELETEs `/api/shares/:id` for a share link on another user's note
- **THEN** the system responds `404` (indistinguishable from absent) — never `403` — and the other user's link is untouched (FRS-9.1)

#### Scenario: Revoke is idempotent
- **WHEN** an authenticated user DELETEs `/api/shares/:id` for one of their own links that is already revoked
- **THEN** the system responds `204` and the link remains revoked — repeated revocation is a no-op, not an error

#### Scenario: Unauthenticated revoke rejected
- **WHEN** a request to `DELETE /api/shares/:id` carries no valid access token
- **THEN** the auth middleware responds `401` and no link is revoked (FRS-9.2)

---

### Requirement: Share ownership isolation and authentication
Every `/api/notes/:id/shares` and `/api/shares` operation SHALL require a valid access token and SHALL be scoped to the authenticated user. No user SHALL be able to read, create, or revoke a share link belonging to another user, and the existence of another user's share or note SHALL never be leaked.

#### Scenario: Missing or invalid token rejected on every share route
- **WHEN** any request to `POST /api/notes/:id/shares`, `GET /api/shares`, or `DELETE /api/shares/:id` carries a missing, malformed, or expired access token
- **THEN** the auth middleware responds `401` with `{ error: { code: "UNAUTHORIZED", … } }` and the handler is not reached (FRS-9.2)

#### Scenario: Every query is scoped to the caller
- **WHEN** any share operation runs
- **THEN** the underlying repository query is constrained to the caller's `userId` (via note ownership for create, and share-owner check for list/revoke), so a note or share belonging to another user is treated as absent (404) (FRS-9.1)

#### Scenario: 404 response uses the standard error envelope
- **WHEN** a share route returns a 404 (absent or not-owned note or share)
- **THEN** the response body is `{ "error": { "code": "NOT_FOUND", "message": "…" } }` — no `fields` array, no internal detail, and no hint that the resource exists under a different user (FRS-9.5)

#### Scenario: No secret or internal leakage in responses
- **WHEN** any share route returns a share resource or an error
- **THEN** the body exposes only `{ id, noteId, token, url, expiresAt, viewCount, createdAt }` for a share — never the owner's identity beyond `noteId`, the note's content, or any DB internals (FRS-9.4)
