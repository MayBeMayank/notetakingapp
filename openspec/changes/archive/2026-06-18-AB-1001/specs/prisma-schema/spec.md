# Capability: prisma-schema

Defines the complete Prisma data model for the application — all 7 models,
their fields, indexes, and cascade relationships — exactly as specified in
SDS §3. Produces an initial migration that can be applied to a clean
PostgreSQL 16 database.

References: SDS §3 (data model), SDS §4 (auth design — hashing strategy),
SDS §10 (soft delete design).

---

## ADDED Requirements

### Requirement: Prisma client configuration
The backend SHALL include a `schema.prisma` with `provider = "postgresql"` and
`DATABASE_URL` sourced from the environment. The Prisma client generator SHALL
be configured to emit to the default `@prisma/client` location.

#### Scenario: prisma generate succeeds
- **WHEN** `prisma generate` is run against the schema
- **THEN** Prisma exits 0 and the generated client is available for import

#### Scenario: missing DATABASE_URL is caught at runtime
- **WHEN** the backend starts without `DATABASE_URL` set
- **THEN** the process throws a configuration error before accepting connections
  (Prisma's default behavior — no custom handling required in this ticket)

---

### Requirement: User model
The schema SHALL define a `User` model with fields `id` (cuid, PK),
`email` (String, unique), `passwordHash` (String), `createdAt`, and `updatedAt`.

#### Scenario: user table is created by migration
- **WHEN** `prisma migrate dev --name init` is run against a clean database
- **THEN** the `User` table exists with a unique index on `email`

#### Scenario: email uniqueness is enforced at the DB level
- **WHEN** two `User` rows with identical `email` values are inserted
- **THEN** the database rejects the second insert with a unique constraint
  violation

---

### Requirement: RefreshToken model
The schema SHALL define a `RefreshToken` model with fields `id` (cuid, PK),
`userId` (FK → User, cascade delete), `tokenHash` (String), `expiresAt`
(DateTime), `revokedAt` (DateTime, optional), and `createdAt`. Indexes SHALL
exist on `userId` and `tokenHash`.

#### Scenario: refresh token table created
- **WHEN** the initial migration is applied
- **THEN** the `RefreshToken` table exists with indexes on `userId` and
  `tokenHash`

#### Scenario: cascade delete propagates from user
- **WHEN** a `User` row is deleted
- **THEN** all associated `RefreshToken` rows are automatically deleted

---

### Requirement: PasswordResetOtp model
The schema SHALL define a `PasswordResetOtp` model with fields `id` (cuid, PK),
`userId` (FK → User, cascade delete), `codeHash` (String), `expiresAt`
(DateTime), `attempts` (Int, default 0), `consumedAt` (DateTime, optional),
and `createdAt`. An index SHALL exist on `userId`.

#### Scenario: otp table created
- **WHEN** the initial migration is applied
- **THEN** the `PasswordResetOtp` table exists with `attempts` defaulting to 0

#### Scenario: cascade delete propagates from user
- **WHEN** a `User` row is deleted
- **THEN** all associated `PasswordResetOtp` rows are automatically deleted

---

### Requirement: Note model
The schema SHALL define a `Note` model with fields `id` (cuid, PK), `userId`
(FK → User, cascade delete), `title` (String, default `""`), `contentJson`
(Json), `contentText` (String, default `""`), `createdAt`, `updatedAt`, and
`deletedAt` (DateTime, optional for soft delete). A composite index on
`[userId, deletedAt, updatedAt]` SHALL be present.

#### Scenario: note table created with soft-delete column
- **WHEN** the initial migration is applied
- **THEN** the `Note` table exists with a nullable `deletedAt` column and the
  composite index `[userId, deletedAt, updatedAt]`

#### Scenario: cascade delete propagates from user
- **WHEN** a `User` row is deleted
- **THEN** all associated `Note` rows are automatically deleted

---

### Requirement: Tag model
The schema SHALL define a `Tag` model with fields `id` (cuid, PK), `userId`
(FK → User, cascade delete), `name` (String), `color` (String for hex value),
`createdAt`, and `updatedAt`. A unique constraint on `[userId, name]` SHALL
enforce per-user case-insensitive uniqueness (names normalized to lowercase
before write — not enforced at DB level beyond the unique constraint).

#### Scenario: tag table created with unique constraint
- **WHEN** the initial migration is applied
- **THEN** the `Tag` table exists with a unique constraint on `[userId, name]`

#### Scenario: duplicate tag name per user is rejected by DB
- **WHEN** two `Tag` rows with the same `userId` and `name` are inserted
- **THEN** the database rejects the second insert with a unique constraint
  violation

---

### Requirement: NoteTag join model
The schema SHALL define a `NoteTag` model with a composite PK `[noteId, tagId]`,
both being FKs with cascade delete to `Note` and `Tag` respectively. An index
SHALL exist on `tagId`.

#### Scenario: note-tag association table created
- **WHEN** the initial migration is applied
- **THEN** the `NoteTag` table exists with composite PK and index on `tagId`

#### Scenario: cascade delete from note removes associations
- **WHEN** a `Note` row is deleted
- **THEN** all associated `NoteTag` rows are automatically deleted

#### Scenario: cascade delete from tag removes associations
- **WHEN** a `Tag` row is deleted
- **THEN** all associated `NoteTag` rows are automatically deleted

---

### Requirement: NoteVersion model
The schema SHALL define a `NoteVersion` model with fields `id` (cuid, PK),
`noteId` (FK → Note, cascade delete), `versionNumber` (Int), `title` (String),
`contentJson` (Json), `contentText` (String), and `createdAt`. A unique
constraint on `[noteId, versionNumber]` and an index on `[noteId, createdAt]`
SHALL be present.

#### Scenario: note-version table created
- **WHEN** the initial migration is applied
- **THEN** the `NoteVersion` table exists with unique constraint on
  `[noteId, versionNumber]` and index on `[noteId, createdAt]`

#### Scenario: cascade delete from note removes versions
- **WHEN** a `Note` row is deleted
- **THEN** all associated `NoteVersion` rows are automatically deleted

---

### Requirement: ShareLink model
The schema SHALL define a `ShareLink` model with fields `id` (cuid, PK),
`noteId` (FK → Note, cascade delete), `token` (String, unique), `expiresAt`
(DateTime, optional), `revokedAt` (DateTime, optional), `viewCount` (Int,
default 0), and `createdAt`. An index SHALL exist on `noteId`.

#### Scenario: share-link table created
- **WHEN** the initial migration is applied
- **THEN** the `ShareLink` table exists with a unique index on `token`,
  `viewCount` defaulting to 0, and an index on `noteId`

#### Scenario: cascade delete from note removes share links
- **WHEN** a `Note` row is deleted
- **THEN** all associated `ShareLink` rows are automatically deleted

---

### Requirement: Seed skeleton
A `prisma/seed.ts` file SHALL exist. It SHALL import `PrismaClient`, define an
async `main()` function, and call it with standard error handling. No data is
inserted by the skeleton.

#### Scenario: seed runs without error on empty DB
- **WHEN** `prisma db seed` is run against a freshly migrated database
- **THEN** the seed script exits 0 having inserted no rows
