# Functional Requirements Specification (FRS)

**Product:** Note Taking Application
**Project:** Claude Code · Spec-Driven Development assignment
**Status:** v1.0 — reviewed; all design decisions confirmed
**Document role:** Source of *business* truth (the **WHAT**). All technical decisions — schema, endpoints, status codes — live in `SDS.md`.

---

## 1. Introduction

### 1.1 Purpose
This document defines **what** the Note Taking Application must do: its business rules, user stories, acceptance criteria, and error behaviour. It is the single source of business truth. `AGENTS.md`, every OpenSpec proposal (`/spec`), and every compliance review (`/review`) are checked back against this document.

### 1.2 Product summary
Authenticated users can create, organize, search, and share rich-text notes. Each note keeps a full version history. The product is a single-user-per-account tool: notes are private by default and become readable by others only through an explicit, revocable public link.

### 1.3 Scope of this release
The release covers six functional domains: Authentication, Notes CRUD, Tags, Search, Sharing, and Version History. Section 10 lists what is explicitly excluded.

### 1.4 Definitions
- **User** — an authenticated account holder.
- **Note** — a titled rich-text document owned by exactly one user.
- **Tag** — a user-scoped label (with a colour) that can be attached to many notes.
- **Version** — an immutable snapshot of a note's title and content captured at a point in time.
- **Share link** — a public, read-only, token-addressed view of a single note.
- **Soft delete** — marking a note as deleted (recoverable) without removing its data.
- **OTP** — a one-time numeric code used to authorize a password reset.

### 1.5 Requirement language
"SHALL" / "MUST" denote mandatory behaviour. Each requirement has a stable ID (e.g. `FRS-3.1.2`) used for traceability in specs, tests, and PRs. Every acceptance criterion is intended to map to exactly one named test.

### 1.6 Ticket reference and build order

The `AB-xxxx` identifiers cited throughout this document are the assignment's build tickets, reproduced here so the SDS is self-contained. Tickets are built strictly in order; backend tickets (AB-1002–1009) deliver the contracts in sections 4–6, frontend tickets (AB-1010–1015) consume them, and AB-1016 verifies the whole journey end-to-end. AB-1001's tooling is adapted to this SDS's stack (Prisma; `CLAUDE.md`/agents/skills/MCP scaffolding unchanged).

| Ticket | Scope | SDS coverage |
| --- | --- | --- |
| AB-1001 | Project setup — monorepo, Prisma, `CLAUDE.md`, agents, skills, MCPs | section 1,2,3 |
| AB-1002 | Auth — register, login, logout, JWT + refresh token | 4.1–4.4 |
| AB-1003 | Auth — forgot password + OTP reset | 4.5–4.6 |
| AB-1004 | Notes — full CRUD + soft delete | 5.1–5.6 |
| AB-1005 | Notes — pagination, sorting, tag filtering | 5.7 |
| AB-1006 | Tags — CRUD + note count per tag | 6.1, 5.8 |
| AB-1007 | Search — full-text with highlight + pagination | 6.2 |
| AB-1008 | Sharing — generate link, revoke, public access, atomic view count | 6.3–6.4 |
| AB-1009 | Version history — snapshot, list, view, restore, auto-purge | 6.5–6.6 |
| AB-1010 | Frontend — Auth pages | consumes 4.1–4.6 |
| AB-1011 | Frontend — Notes list page | consumes 5.7 |
| AB-1012 | Frontend — Note editor (TipTap + autosave) | consumes 5.1–5.3 |
| AB-1013 | Frontend — Search UI with highlights | consumes 6.2 |
| AB-1014 | Frontend — Share modal + active links | consumes 6.3 |
| AB-1015 | Frontend — Version history drawer + restore | consumes 6.5 |
| AB-1016 | E2E — Playwright full user journey | section 8 |

---

## 2. Actors and roles

| Actor | Description | Authenticated |
| --- | --- | --- |
| Guest | An unauthenticated visitor. May register, log in, begin a password reset, and view a valid share link. | No |
| User | An authenticated account holder. Full access to **their own** notes, tags, shares, and versions only. | Yes |
| Public viewer | A guest who opens a valid, non-expired, non-revoked share link. Read-only access to that one note. | No |

There is no admin role and no cross-user access in this release.

---

## 3. Authentication

> Tickets: AB-1002 (register/login/logout/refresh), AB-1003 (forgot/reset via OTP)

### 3.1 Registration
- **FRS-3.1.1** — The system SHALL allow a guest to register with an email address and a password.
- **FRS-3.1.2** — The system SHALL reject registration when the email is already in use, and SHALL inform the guest that the email is taken (conflict).
- **FRS-3.1.3** — The system SHALL validate that the email is well-formed and the password meets the minimum policy (≥ 8 characters, at least one letter and one number). Invalid input SHALL be rejected with per-field validation messages.
- **FRS-3.1.4** — The system SHALL store passwords only as a secure salted hash. The plaintext password SHALL never be stored or logged.
- **FRS-3.1.5** — On successful registration the system SHALL create the account and return the new user identity (without the password hash).

**Error scenarios**
| Condition | Expected result |
| --- | --- |
| Duplicate email | Rejected, "email already registered" (conflict) |
| Malformed email / weak password | Rejected with field-level validation errors |
| Missing required field | Rejected with field-level validation errors |

### 3.2 Login
- **FRS-3.2.1** — The system SHALL allow a registered user to log in with email + password.
- **FRS-3.2.2** — On success the system SHALL issue a short-lived **access token (15 min)** and a longer-lived **refresh token (7 days)**; the refresh token SHALL be persisted server-side so it can be revoked.
- **FRS-3.2.3** — The system SHALL reject invalid credentials with a generic "invalid email or password" message that does not reveal which field was wrong.

### 3.3 Token refresh and logout
- **FRS-3.3.1** — The system SHALL allow a user to exchange a valid, unexpired, non-revoked refresh token for a new access token.
- **FRS-3.3.2** — The system SHALL reject refresh when the token is expired, unknown, or revoked.
- **FRS-3.3.3** — Logout SHALL revoke the user's refresh token so it can no longer be used to mint access tokens.
- **FRS-3.3.4** — Every protected resource SHALL reject requests with a missing, malformed, or expired access token (unauthorized).

### 3.4 Forgot / reset password (OTP)
- **FRS-3.4.1** — The system SHALL allow a guest to request a password reset by submitting their email.
- **FRS-3.4.2** — The system SHALL generate a **6-digit OTP valid for 10 minutes**, single-use, and "deliver" it by **logging it to the server console** (no real email is sent — see §10).
- **FRS-3.4.3** — To avoid account enumeration, the request response SHALL be identical whether or not the email exists.
- **FRS-3.4.4** — The system SHALL allow the guest to set a new password by submitting the email, the OTP, and the new password. A correct, unexpired, unused OTP SHALL reset the password and invalidate the OTP.
- **FRS-3.4.5** — The system SHALL reject an incorrect, expired, or already-used OTP. After **5 failed attempts** the OTP SHALL be invalidated and a new one required.
- **FRS-3.4.6** — A successful password reset SHALL revoke all existing refresh tokens for that user.

---

## 4. Notes CRUD

> Tickets: AB-1004 (CRUD + soft delete), AB-1005 (pagination, sorting, tag filtering)

### 4.1 Create
- **FRS-4.1.1** — A user SHALL be able to create a note with a title and rich-text content.
- **FRS-4.1.2** — The system SHALL allow an empty title and/or empty content (a blank note is valid, to support autosave-on-create).
- **FRS-4.1.3** — A newly created note SHALL be owned by the creating user and SHALL be private (not shared).
- **FRS-4.1.4** — Creating a note SHALL capture an initial version (see §8).

### 4.2 Read
- **FRS-4.2.1** — A user SHALL be able to read any of their own non-deleted notes by id.
- **FRS-4.2.2** — The system SHALL reject reads of notes the user does not own (not found / forbidden — exact code per SDS), and SHALL not leak the existence of another user's note.

### 4.3 Update
- **FRS-4.3.1** — A user SHALL be able to update the title, content, and tag associations of their own note.
- **FRS-4.3.2** — Each successful save SHALL create a new version snapshot (see §8).
- **FRS-4.3.3** — Updating a soft-deleted note SHALL be rejected until it is restored.

### 4.4 Soft delete and recovery
- **FRS-4.4.1** — "Delete" SHALL be a **soft delete**: the note is marked deleted (a `deletedAt` timestamp is set) and SHALL NOT be physically removed.
- **FRS-4.4.2** — Soft-deleted notes SHALL be excluded from the default note list, search results, and tag counts.
- **FRS-4.4.3** — A user SHALL be able to restore a soft-deleted note within a **30-day recovery window**, returning it to active state.
- **FRS-4.4.4** — Notes whose recovery window has elapsed become eligible for permanent purge (purge is a background concern, not a user action).
- **FRS-4.4.5** — A user SHALL NOT be able to act on (read/update/share) a soft-deleted note other than to restore it.

### 4.5 List, pagination, sorting, filtering
- **FRS-4.5.1** — A user SHALL be able to list their own active notes with pagination; the list SHALL report total count and current page so the UI can render paging controls.
- **FRS-4.5.2** — The list SHALL be sortable by **created date, last-updated date, and title**, ascending or descending. Default sort is last-updated, descending.
- **FRS-4.5.3** — The list SHALL be filterable by one or more tags. When multiple tags are supplied the result SHALL contain notes carrying **any** of the supplied tags (OR semantics). A note carrying more than one of the supplied tags SHALL appear exactly once.
- **FRS-4.5.4** — Pagination, sorting, and filtering SHALL compose in a single request.

---

## 5. Tags

> Ticket: AB-1006

- **FRS-5.1** — Tags SHALL be **user-scoped**: a user only ever sees and uses their own tags.
- **FRS-5.2** — A user SHALL be able to create a tag with a name and a colour (a hex colour value).
- **FRS-5.3** — Tag names SHALL be unique per user, compared case-insensitively. A duplicate SHALL be rejected (conflict).
- **FRS-5.4** — A user SHALL be able to rename a tag, change its colour, and delete a tag.
- **FRS-5.5** — Deleting a tag SHALL remove its association from all notes but SHALL NOT delete those notes.
- **FRS-5.6** — Listing tags SHALL include, for each tag, the **count of the user's active (non-deleted) notes** carrying that tag.
- **FRS-5.7** — A user SHALL be able to attach and detach tags on their own notes; only the owner's own tags may be attached.

---

## 6. Search

> Ticket: AB-1007

- **FRS-6.1** — A user SHALL be able to full-text search across the **title and content** of their own active notes.
- **FRS-6.2** — Search SHALL use the database's native full-text capability (no external search service — see SDS).
- **FRS-6.3** — Results SHALL be ranked by relevance and SHALL be paginated.
- **FRS-6.4** — Each result SHALL include a highlighted snippet showing the matched keyword(s) in context.
- **FRS-6.5** — Search SHALL only ever return the requesting user's own notes; soft-deleted notes SHALL be excluded.
- **FRS-6.6** — An empty or whitespace-only query SHALL return an empty result set (not an error).

---

## 7. Sharing

> Ticket: AB-1008

- **FRS-7.1** — A user SHALL be able to generate a public, read-only share link for one of their own active notes.
- **FRS-7.2** — A share link SHALL be addressed by an unguessable token and SHALL support an **optional expiry**. After expiry the link SHALL be inaccessible.
- **FRS-7.3** — A public viewer opening a valid, non-expired, non-revoked link SHALL see the note's **current** title and content, read-only, with **no edit controls and no authentication required**.
- **FRS-7.4** — The system SHALL maintain a **view count** per share link; each successful public view SHALL increment it **atomically** (no lost updates under concurrency).
- **FRS-7.5** — A user SHALL be able to **revoke** a share link; a revoked link SHALL immediately become inaccessible.
- **FRS-7.6** — If the underlying note is soft-deleted, all of its share links SHALL become inaccessible.
- **FRS-7.7** — A user SHALL be able to list their active share links with each link's expiry and view count.
- **FRS-7.8** — A public viewer SHALL NOT be able to see the note's tags, version history, owner identity, or any other note belonging to the user.

**Error scenarios**
| Condition | Expected result |
| --- | --- |
| Unknown / revoked / expired token | Inaccessible (not found / gone — code per SDS) |
| Share requested on a soft-deleted note | Rejected |

---

## 8. Version history

> Ticket: AB-1009

- **FRS-8.1** — The system SHALL capture a **version snapshot on every save** of a note (create and each update), recording the title, content, and timestamp.
- **FRS-8.2** — A user SHALL be able to list all versions of their own note in reverse chronological order.
- **FRS-8.3** — A user SHALL be able to view the full content of any single version.
- **FRS-8.4** — A user SHALL be able to **restore** a version. Restore SHALL be **non-destructive**: it sets the note's current title/content to the chosen version and records the result as a **new** version (history is never rewritten or lost).
- **FRS-8.5** — The system SHALL retain at most the **most recent 50 versions per note**; older versions are auto-purged. The current content is always preserved regardless of purge.
- **FRS-8.6** — Version history SHALL be private to the owner and SHALL never be exposed through a share link.

---

## 9. Cross-cutting requirements

- **FRS-9.1 (Ownership isolation)** — Every notes/tags/search/share/version operation SHALL be scoped to the authenticated user. No user SHALL ever read or affect another user's data.
- **FRS-9.2 (Auth required)** — All endpoints except registration, login, refresh, the password-reset pair, and public share viewing SHALL require a valid access token.
- **FRS-9.3 (Validation)** — All input SHALL be validated; invalid input SHALL be rejected with field-level messages rather than causing a server error.
- **FRS-9.4 (No secret leakage)** — Passwords, password hashes, OTPs, and tokens SHALL never appear in responses or logs.
- **FRS-9.5 (Consistent errors)** — Error responses SHALL use a consistent shape; the specific HTTP status code for each condition is defined in the SDS and is binding.
- **FRS-9.6 (Pagination contract)** — Any list endpoint SHALL behave consistently (page/limit bounds, total count) per the contract in the SDS.

---

## 10. Out of scope (explicitly excluded)

The following SHALL NOT be built; any attempt is a violation of the assignment:

- Real-time collaborative editing
- File or image attachments
- A mobile app
- OAuth / social login
- Note folders or nesting
- **Actual email sending** — OTPs and any notifications are **logged to the server console only**

---

## 11. Traceability — FRS domain → ticket

| FRS section | Domain | Ticket(s) |
| --- | --- | --- |
| §3.1–3.3 | Auth: register, login, logout, refresh | AB-1002 |
| §3.4 | Auth: forgot/reset via OTP | AB-1003 |
| §4.1–4.4 | Notes CRUD + soft delete | AB-1004 |
| §4.5 | Notes list: pagination, sorting, tag filter | AB-1005 |
| §5 | Tags + per-tag note count | AB-1006 |
| §6 | Full-text search + highlight | AB-1007 |
| §7 | Sharing: generate/revoke/public view/view count | AB-1008 |
| §8 | Version history: snapshot/list/view/restore/purge | AB-1009 |
| §3–§8 (UI) | Frontend pages + E2E | AB-1010 … AB-1016 |

---

## 12. Confirmed design decisions

The following decisions are **confirmed and binding**. The SDS hardens them into contracts (schema, validation rules, status codes); any change must be made here first, then propagated.

1. **Password policy** (FRS-3.1.3): ≥ 8 chars, ≥ 1 letter + 1 number. — ✅ Confirmed
2. **OTP** (FRS-3.4.2 / 3.4.5): 6 digits, 10-minute validity, single-use, 5-attempt cap. — ✅ Confirmed
3. **Soft-delete recovery window** (FRS-4.4.3): 30 days; aligns with assignment Rule 15. — ✅ Confirmed
4. **Tag filter semantics** (FRS-4.5.3): multi-tag = **OR** (a note carrying any selected tag matches). — ✅ Confirmed (revised 2026-06-22, AND → OR; see `docs/decisions/ADR-002-tag-filter-or-semantics.md`)
5. **Share link target** (FRS-7.3): serves the note's **current** content, not a frozen snapshot. — ✅ Confirmed
6. **Version retention** (FRS-8.5): keep the most recent **50** versions per note; auto-purge older. — ✅ Confirmed
7. **Default note sort** (FRS-4.5.2): **last-updated, descending**. — ✅ Confirmed
