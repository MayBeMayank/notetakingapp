# shared-package Specification

## Purpose
TBD - created by archiving change AB-1001. Update Purpose after archive.
## Requirements
### Requirement: Package identity and workspace resolution
`packages/shared` SHALL be published under the name `@note-app/shared` in its
`package.json`. Both `backend` and `frontend` SHALL declare it as a workspace
dependency using the pnpm workspace protocol (`workspace:*`), enabling direct
import resolution without a registry publish step.

#### Scenario: backend resolves the shared package
- **WHEN** `import {} from '@note-app/shared'` is added to a backend TypeScript
  file and `pnpm install` has been run
- **THEN** TypeScript resolves the import to `packages/shared/src/index.ts`
  without error

#### Scenario: frontend resolves the shared package
- **WHEN** `import {} from '@note-app/shared'` is added to a frontend TypeScript
  file and `pnpm install` has been run
- **THEN** TypeScript resolves the import to `packages/shared/src/index.ts`
  without error

#### Scenario: direct circular dependency is prevented
- **WHEN** `packages/shared/package.json` is inspected
- **THEN** it does NOT depend on `backend` or `frontend` — the dependency
  direction is one-way only

---

### Requirement: Schema directory structure
A `schemas/` directory SHALL exist under `packages/shared/src/`. It SHALL
contain an `index.ts` barrel file that is initially empty. Feature tickets
add named schema files here (e.g. `notes.ts`, `auth.ts`) and re-export them
through this barrel.

#### Scenario: schemas barrel file exists and is importable
- **WHEN** `import {} from '@note-app/shared/schemas'` is used (or the barrel
  is imported via the package root)
- **THEN** TypeScript resolves the import to `packages/shared/src/schemas/
  index.ts` without error

#### Scenario: empty barrel does not cause build errors
- **WHEN** `pnpm --filter @note-app/shared build` is run with an empty
  `schemas/index.ts`
- **THEN** compilation exits 0 with zero errors

---

### Requirement: Types directory structure
A `types/` directory SHALL exist under `packages/shared/src/`. It SHALL
contain an `index.ts` barrel file that is initially empty. All TypeScript
types exposed by the package SHALL be derived exclusively via
`z.infer<typeof SomeSchema>` — no hand-authored type definitions are permitted.

#### Scenario: types barrel file exists and is importable
- **WHEN** `import {} from '@note-app/shared/types'` is used (or the barrel
  is imported via the package root)
- **THEN** TypeScript resolves the import to `packages/shared/src/types/
  index.ts` without error

#### Scenario: empty barrel does not cause build errors
- **WHEN** `pnpm --filter @note-app/shared build` is run with an empty
  `types/index.ts`
- **THEN** compilation exits 0 with zero errors

---

### Requirement: Root package barrel
`packages/shared/src/index.ts` SHALL re-export everything from `schemas/` and
`types/` so consumers can import from `@note-app/shared` directly without
knowing the internal sub-path.

#### Scenario: root barrel re-exports schemas and types
- **WHEN** a new schema is added to `schemas/index.ts` and re-exported from
  `src/index.ts`
- **THEN** importing it via `import { NewSchema } from '@note-app/shared'`
  resolves correctly in both backend and frontend

---

### Requirement: Zod as the sole dependency
`packages/shared/package.json` SHALL list Zod as its only production
dependency. No framework-specific packages (Express, React, Prisma, etc.) are
permitted as dependencies of the shared package.

#### Scenario: shared package has no framework dependencies
- **WHEN** `packages/shared/package.json` dependencies section is inspected
- **THEN** only `zod` appears; no `express`, `react`, `@prisma/client`, or
  other framework packages are present

