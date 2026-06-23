# public-share-view Specification

## Purpose
TBD - created by archiving change AB-1008. Update Purpose after archive.
## Requirements
### Requirement: Public read-only view of a shared note
The system SHALL expose a public, read-only view of a single shared note at `GET /api/public/notes/:token`. When the token resolves to a share link that is **not revoked**, **not expired**, and whose underlying note is **active (not soft-deleted)**, the system SHALL respond `200` with the note's **current** `title` and `content`, where `content` is the note's current `contentJson` (TipTap JSON). The endpoint SHALL require **no authentication** and SHALL expose **no edit controls** (read-only payload only).

#### Scenario: View a valid shared note without authentication
- **WHEN** an unauthenticated request GETs `/api/public/notes/:token` for a non-revoked, non-expired link whose note is active, carrying **no** `Authorization` header
- **THEN** the system responds `200` with `{ title, content }` where `content` is the note's current `contentJson` (TipTap JSON document) — no token or auth was required (FRS-7.3, FRS-9.2 exception)

#### Scenario: Response contains only title and content
- **WHEN** a valid public view succeeds
- **THEN** the response body is exactly `{ title, content }` and contains no other keys — no `id`, `noteId`, `userId`, owner email, `tagIds`, version data, `createdAt`/`updatedAt`, or share metadata (FRS-7.8)

#### Scenario: Share serves the note's current content, not a snapshot
- **WHEN** a note is edited after its share link is created, and the link is then opened publicly
- **THEN** the `200` response reflects the note's **current** `title` and `contentJson` (the latest saved content), not the content as it stood when the link was minted (FRS-7.3, confirmed design decision: current content not a frozen snapshot)

#### Scenario: A link with no expiry stays viewable
- **WHEN** an unauthenticated request GETs `/api/public/notes/:token` for a non-revoked link whose `expiresAt` is `null` (never expires) and whose note is active
- **THEN** the system responds `200` with `{ title, content }` (FRS-7.2: optional expiry; null = no expiry)

---

### Requirement: No data leakage through a share link
The public view SHALL expose nothing about the note beyond its current `title` and `content`. It SHALL NOT leak the note's tags, version history, owner identity, internal identifiers, timestamps, share-link metadata, or any other note belonging to the user (FRS-7.8, FRS-9.4). Each leak vector below is independently prohibited.

#### Scenario: Tags are not exposed
- **WHEN** the underlying note carries one or more tags and the share link is opened publicly
- **THEN** the `200` payload contains no `tagIds`, tag names, or tag colours — tags are never visible through a share link (FRS-7.8)

#### Scenario: Version history is not exposed
- **WHEN** the underlying note has version history and the share link is opened publicly
- **THEN** the `200` payload contains no versions, `versionNumber`, or any historical title/content — only the current `title` + `content` (FRS-7.8, FRS-8.6)

#### Scenario: Owner identity is not exposed
- **WHEN** a share link is opened publicly
- **THEN** the `200` payload contains no `userId`, owner email, or any field that identifies or hints at the note's owner (FRS-7.8, FRS-9.4)

#### Scenario: Note id and timestamps are not exposed
- **WHEN** a share link is opened publicly
- **THEN** the `200` payload contains no note `id`/`noteId`, `createdAt`, `updatedAt`, `deletedAt`, or share-link metadata (token, expiry, viewCount, ids) — only `title` + `content`

#### Scenario: No other note is reachable through one token
- **WHEN** a share link for one note is opened publicly
- **THEN** the response exposes that single note only — there is no field, list, or navigation that reveals any other note belonging to the same user (FRS-7.8, FRS-9.1)

---

### Requirement: Atomic view-count increment
Each **successful** public view (`200`) SHALL increment the resolved share link's `viewCount` by exactly `1` using a single atomic Prisma `{ increment: 1 }` update (compiling to `SET view_count = view_count + 1`). The system SHALL NOT use a read-modify-write pattern, so concurrent views never lose updates. A `404` or `410` response SHALL NOT increment any view count.

#### Scenario: A successful view increments viewCount by exactly one
- **WHEN** a valid, viewable share link is opened publicly and the system responds `200`
- **THEN** that link's `viewCount` is incremented by exactly `1` via a single `prisma.shareLink.update({ where: { id }, data: { viewCount: { increment: 1 } } })` statement (FRS-7.4, SDS §8)

#### Scenario: Concurrent views do not lose updates
- **WHEN** N concurrent public requests open the same viewable link and all return `200`
- **THEN** the final `viewCount` increases by exactly N — the atomic `{ increment: 1 }` statement is race-free (no read-modify-write) (FRS-7.4)

#### Scenario: An inaccessible link does not increment
- **WHEN** a public request resolves to an unknown token (`404`) or to a revoked/expired/soft-deleted-note link (`410`)
- **THEN** no `viewCount` is incremented — only a successful `200` view counts (FRS-7.4)

---

### Requirement: Inaccessible links return the correct status
The system SHALL resolve the `:token` and return a precise status for each failure condition, using the standard error envelope. An **unknown** token SHALL return `404` — on this public route `404` means *no share link bears this token* (token-existence only; there is no caller/ownership dimension, unlike the owner-side ownership `404`). A **revoked** link (`revokedAt` set), an **expired** link (`expiresAt <= now`), or a link whose **underlying note is soft-deleted** SHALL each return `410` with code `SHARE_GONE`. No failure path SHALL leak whether a token exists, who owns it, or any note content.

#### Scenario: Unknown token returns 404
- **WHEN** an unauthenticated request GETs `/api/public/notes/:token` for a token that matches no share link
- **THEN** the system responds `404` with `{ error: { code: "NOT_FOUND", message: "…" } }` and no `viewCount` is incremented (SDS §5.1, §8)

#### Scenario: Revoked link returns 410
- **WHEN** the token resolves to a share link whose `revokedAt` is set
- **THEN** the system responds `410` with the standard error envelope `{ error: { code, message } }`, exposes no note content, and increments nothing (FRS-7.5, SDS §5.1)

#### Scenario: Expired link returns 410
- **WHEN** the token resolves to a non-revoked link whose `expiresAt` is at or before the request time
- **THEN** the system responds `410` with the standard error envelope (code `SHARE_GONE`), exposes no note content, and increments nothing — a link is treated as expired when `expiresAt <= now`, so the exact instant of expiry counts as expired (FRS-7.2, SDS §5.1)

#### Scenario: Link on a soft-deleted note returns 410
- **WHEN** the token resolves to a non-revoked, non-expired link whose underlying note has a non-null `deletedAt`
- **THEN** the system responds `410` with the standard error envelope — soft-deleting a note makes all of its share links inaccessible — and increments nothing (FRS-7.6, SDS §5.1/§8)

#### Scenario: 410 body uses the standard error envelope
- **WHEN** any `410` is returned (revoked, expired, or note soft-deleted)
- **THEN** the response body is `{ "error": { "code": "SHARE_GONE", "message": "…" } }` — no `fields` array, no note content, and no detail that distinguishes which of the three conditions occurred (FRS-9.5)

---

### Requirement: Public endpoint requires no authentication
`GET /api/public/notes/:token` SHALL be reachable by an unauthenticated guest and SHALL be excluded from the auth middleware (FRS-9.2 exception, SDS §5/§6.2). The presence or absence of an `Authorization` header SHALL neither be required for, nor alter, the outcome — only the token state (unknown / valid / revoked / expired) and the underlying note's deletion state determine the response.

#### Scenario: Reachable with no Authorization header
- **WHEN** a guest GETs `/api/public/notes/:token` for a viewable link **without** any `Authorization` header
- **THEN** the system responds `200` with `{ title, content }` — no token is required (FRS-7.3, FRS-9.2)

#### Scenario: An access token neither helps nor is required
- **WHEN** the same request is made **with** a valid `Authorization: Bearer <jwt>` header
- **THEN** the outcome is identical to the unauthenticated request — the token is neither consulted nor required, and ownership of the token bearer is irrelevant to the result (SDS §6.2)

#### Scenario: Token state alone governs accessibility
- **WHEN** any public request resolves the `:token`
- **THEN** the response is determined solely by token existence and link state (revoked / expired) and the note's `deletedAt` — never by caller identity (FRS-9.1, FRS-9.2)

