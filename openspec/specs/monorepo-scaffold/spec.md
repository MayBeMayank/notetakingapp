# monorepo-scaffold Specification

## Purpose
TBD - created by archiving change AB-1001. Update Purpose after archive.
## Requirements
### Requirement: Dependency versions SHALL be pinned
All workspace `package.json` files SHALL pin every dependency to an exact patch
version (no `^` or `~` ranges). Versions SHALL be verified against live package
documentation before being recorded (SDS §2, Rule 9).

#### Scenario: no range specifiers in package.json
- **WHEN** any `package.json` in the workspace is inspected
- **THEN** every entry in `dependencies` and `devDependencies` is an exact
  version string (e.g. `"4.19.2"`) with no leading `^` or `~`

#### Scenario: pinned versions match major version constraints from SDS §2
- **WHEN** installed versions are compared against the SDS §2 tech stack table
- **THEN** Node.js is 22 LTS, React is 19.x, Express is 5.x, TanStack Query
  is 5.x, TipTap is 2.x, Prisma targets PostgreSQL 16, Vitest and Playwright
  are used for testing

---

### Requirement: Workspace structure
The repository SHALL be a pnpm workspace containing exactly three packages:
`backend`, `frontend`, and `packages/shared`. Root-level scripts SHALL delegate
build, test, and lint to all workspace packages.

#### Scenario: workspace packages are recognized
- **WHEN** `pnpm install` is run from the repository root
- **THEN** all three packages (`backend`, `frontend`, `packages/shared`) resolve
  their dependencies without error, and `node_modules` under each package is
  populated via the workspace protocol

#### Scenario: root script delegates to all packages
- **WHEN** `pnpm -w build` is run from the repository root
- **THEN** the build script in each of the three packages executes in dependency
  order (`packages/shared` before `backend` and `frontend`)

---

### Requirement: TypeScript strict mode
Every package SHALL compile with `strict: true` and `noImplicitAny: true`.
A root `tsconfig.base.json` SHALL be the single source of compiler options;
each package `tsconfig.json` SHALL extend it.

#### Scenario: strict mode is enforced on backend
- **WHEN** `pnpm --filter backend build` is run
- **THEN** TypeScript compilation uses `strict: true` and exits 0 with no
  implicit-any errors

#### Scenario: strict mode is enforced on frontend
- **WHEN** `pnpm --filter frontend build` is run
- **THEN** TypeScript compilation uses `strict: true` and exits 0 with no
  implicit-any errors

#### Scenario: strict mode is enforced on shared
- **WHEN** `pnpm --filter @note-app/shared build` is run
- **THEN** TypeScript compilation uses `strict: true` and exits 0

---

### Requirement: ESLint quality gate
ESLint SHALL be configured at the repository root using
`@typescript-eslint/recommended` rules. Running `pnpm -w lint` SHALL check all
`.ts` and `.tsx` files across all packages.

#### Scenario: lint passes on a clean scaffold
- **WHEN** `pnpm -w lint` is run against the freshly scaffolded project
- **THEN** ESLint exits 0 with zero errors and zero warnings

#### Scenario: implicit-any usage is caught
- **WHEN** a `.ts` file contains a parameter with no type annotation and lint
  is run
- **THEN** ESLint reports an error and exits non-zero

---

### Requirement: Husky pre-commit hook
Husky SHALL install a `pre-commit` hook that runs `pnpm -w lint`. A commit
that introduces lint errors SHALL be blocked.

#### Scenario: clean commit proceeds
- **WHEN** `git commit` is run and all staged files pass ESLint
- **THEN** the commit completes successfully without the hook aborting

#### Scenario: dirty commit is blocked
- **WHEN** `git commit` is run and at least one staged file has an ESLint error
- **THEN** the pre-commit hook exits non-zero and the commit is aborted

---

### Requirement: commitlint conventional-commits gate
Commitlint SHALL enforce the conventional commits format defined in CLAUDE.md
(types: `feat|fix|refactor|test|chore|docs`; scopes: `auth|notes|tags|search|
share|versions|shared|db|infra`). A commit message that does not conform SHALL
be rejected.

#### Scenario: conforming message is accepted
- **WHEN** a commit is created with message `feat(auth): add register endpoint`
- **THEN** commitlint exits 0 and the commit is created

#### Scenario: non-conforming message is rejected
- **WHEN** a commit is attempted with message `added some stuff`
- **THEN** commitlint exits non-zero and the commit is aborted

#### Scenario: unknown scope is rejected
- **WHEN** a commit message uses a scope not in the allowed list (e.g.
  `feat(payments): ...`)
- **THEN** commitlint exits non-zero

---

### Requirement: Backend Express 5 skeleton
The backend package SHALL contain a runnable Express 5 application with JSON
body parsing middleware wired. No feature routes are implemented. Directory
stubs for all architectural layers SHALL exist.

#### Scenario: backend starts without crashing
- **WHEN** `pnpm --filter backend dev` is run with valid environment variables
- **THEN** the server starts, binds to `PORT`, and does not throw on startup

#### Scenario: layer directories exist
- **WHEN** the repository is cloned and `ls backend/src/` is inspected
- **THEN** the directories `routes/`, `controllers/`, `services/`,
  `repositories/`, `middleware/`, and `lib/` are all present

#### Scenario: environment template is present
- **WHEN** `backend/.env.example` is read
- **THEN** it contains placeholder entries for `DATABASE_URL`, `JWT_SECRET`,
  `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `OTP_TTL`, and `PORT`

#### Scenario: test environment template is present
- **WHEN** `backend/.env.test.example` is read
- **THEN** it contains a placeholder entry for a separate test `DATABASE_URL`

---

### Requirement: Frontend Vite/React 19 skeleton
The frontend package SHALL be a standard Vite + React 19 + TypeScript scaffold.
Empty feature directory stubs SHALL be created for all six domains. No feature
components are implemented.

#### Scenario: frontend builds without errors
- **WHEN** `pnpm --filter frontend build` is run
- **THEN** Vite compiles successfully with zero TypeScript errors and zero
  build warnings

#### Scenario: feature directory stubs exist
- **WHEN** `ls frontend/src/features/` is inspected
- **THEN** the directories `auth/`, `notes/`, `tags/`, `search/`, `share/`,
  and `versions/` are all present

#### Scenario: component and state directories exist
- **WHEN** `ls frontend/src/` is inspected
- **THEN** the directories `pages/`, `components/`, `api/`, and `stores/`
  are all present

