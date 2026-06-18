# AB-1001 — Sequenced Implementation Tasks

> **Legend:** `[PARALLEL]` — task can run concurrently with other `[PARALLEL]` tasks in the same phase.
> Checkpoints must all pass before starting the next phase.

---

## Phase 1 — Foundation

*Establishes the workspace skeleton and `packages/shared` first — everything else depends on both.*

- [ ] 1.1  Look up and record exact patch versions (no `^`/`~`) for every
           dependency in SDS §2 from the live npm registry before writing any
           `package.json`: Express 5, React 19, Vite, TanStack Query v5, Zustand,
           TipTap v2, shadcn/ui deps (clsx, tailwind-merge), Prisma 6,
           @prisma/client, argon2, jsonwebtoken, @types/jsonwebtoken, Zod,
           Vitest, Supertest, @types/supertest, @playwright/test, tsx,
           TypeScript 5, ESLint 9, typescript-eslint 8 (plugin + parser),
           Husky 9, @commitlint/cli + config-conventional. Record in a scratch
           file so all subsequent tasks can reference them.

- [ ] 1.2  Create `pnpm-workspace.yaml` at repo root declaring packages
           `backend`, `frontend`, and `packages/shared`.

- [ ] 1.3  Create root `package.json` (private, no dist) with scripts
           `build: "pnpm -r build"`, `test: "pnpm -r test"`, `lint: "eslint ."`;
           devDependencies: ESLint 9, typescript-eslint plugin + parser,
           TypeScript, Husky, @commitlint/cli, @commitlint/config-conventional
           — all at exact pinned versions from 1.1.

- [ ] 1.4  Create `tsconfig.base.json` at root with `strict: true`,
           `noImplicitAny: true`, `esModuleInterop: true`,
           `forceConsistentCasingInFileNames: true`, `skipLibCheck: true`,
           `declaration: true`, `declarationMap: true`, `sourceMap: true`.
           No `target`, `module`, or `outDir` here — those are per-package.

- [ ] 1.5  Create `eslint.config.js` (ESLint 9 flat config) using
           `typescript-eslint`'s `tseslint.config()` with
           `tseslint.configs.recommended` and an `ignores` entry for
           `**/dist/**` and `**/node_modules/**`.

- [ ] 1.6  Create `commitlint.config.cjs` enforcing:
           types `feat|fix|refactor|test|chore|docs`;
           scopes `auth|notes|tags|search|share|versions|shared|db|infra`;
           `scope-empty: [2, 'never']` (scope always required).

- [ ] 1.7  Run `pnpm exec husky init` (or manually create `.husky/pre-commit`)
           so Husky is installed; set `prepare` script in root `package.json`
           to `husky`.

- [ ] 1.8  Create `.husky/pre-commit` containing `pnpm -w lint`.

- [ ] 1.9  Create `.husky/commit-msg` containing
           `npx --no -- commitlint --edit "$1"`.

- [ ] 1.10 Create `.gitignore` covering `node_modules/`, `dist/`, `.env`,
           `.env.test`, `*.tsbuildinfo`, `.DS_Store`.

- [ ] 1.11 Create `packages/shared/package.json`:
           name `@note-app/shared`, `"type": "module"`,
           `main: "./dist/index.js"`, `types: "./dist/index.d.ts"`,
           full `exports` map (`.`, `./schemas`, `./schemas/*`, `./types`),
           scripts `build: "tsc"` and `lint: "eslint src"`,
           production dependency: `zod` at exact pinned version from 1.1 only.

- [ ] 1.12 Create `packages/shared/tsconfig.json` extending
           `../../tsconfig.base.json`; `target: "ES2022"`,
           `module: "NodeNext"`, `moduleResolution: "NodeNext"`,
           `outDir: "dist"`, `rootDir: "src"`.

- [ ] 1.13 Create `packages/shared/src/schemas/index.ts` — empty barrel
           (`export {}`).

- [ ] 1.14 Create `packages/shared/src/types/index.ts` — empty barrel
           (`export {}`).

- [ ] 1.15 Create `packages/shared/src/index.ts` re-exporting from
           `./schemas/index.js` and `./types/index.js` (`.js` extension
           required — NodeNext ESM).

---

### Phase 1 Checkpoint

```bash
pnpm install                                  # workspace links must resolve
pnpm --filter @note-app/shared build          # 0 errors, dist/ created
pnpm -w lint                                  # 0 errors (only shared has src/ yet)
```

All three commands must exit 0 before starting Phase 2.

---

## Phase 2 — Core Implementation

*Backend skeleton, Prisma schema, and frontend skeleton are independent — implement in parallel.*

### 2A — Backend Skeleton [PARALLEL]

- [ ] 2A.1 Create `backend/package.json`:
           name `"backend"`, `"type": "module"`, scripts
           `dev: "tsx src/server.ts"`, `build: "tsc"`,
           `test: "vitest run"`, `lint: "eslint src"`;
           `prisma` key: `{ "schema": "src/prisma/schema.prisma",
           "seed": "tsx src/prisma/seed.ts" }`;
           dependencies (exact pinned): `express`, `@prisma/client`, `argon2`,
           `jsonwebtoken`, `zod`, `@note-app/shared@workspace:*`;
           devDependencies (exact pinned): `@types/express`,
           `@types/jsonwebtoken`, `@types/supertest`, `prisma`, `supertest`,
           `tsx`, `typescript`, `vitest`.

- [ ] 2A.2 Create `backend/tsconfig.json` extending `../tsconfig.base.json`;
           `target: "ES2022"`, `module: "NodeNext"`,
           `moduleResolution: "NodeNext"`, `outDir: "dist"`, `rootDir: "src"`;
           `include: ["src/**/*"]`, `exclude: ["node_modules", "dist"]`.

- [ ] 2A.3 Create empty directory stubs with `.gitkeep`:
           `backend/src/routes/`, `backend/src/controllers/`,
           `backend/src/services/`, `backend/src/repositories/`,
           `backend/src/middleware/`, `backend/src/lib/`.

- [ ] 2A.4 Create `backend/src/app.ts`: imports `express`, creates app,
           wires `express.json()`, exports `app`.

- [ ] 2A.5 Create `backend/src/server.ts`: imports `app` from `./app.js`
           (`.js` required — NodeNext), reads `PORT` from `process.env`,
           calls `app.listen(port)` and logs the bound address.

- [ ] 2A.6 Create `backend/.env.example` with placeholder entries:
           `DATABASE_URL=`, `JWT_SECRET=`, `ACCESS_TOKEN_TTL=15m`,
           `REFRESH_TOKEN_TTL=7d`, `OTP_TTL=10m`, `PORT=3000`.

- [ ] 2A.7 Create `backend/.env.test.example` with placeholder:
           `DATABASE_URL=postgresql://user:pass@localhost:5432/note_app_test`.

### 2B — Prisma Schema [PARALLEL]

- [ ] 2B.1 Create `backend/src/prisma/schema.prisma` with:
           `generator client { provider = "prisma-client-js" }`;
           `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }`.

- [ ] 2B.2 Add `User` model: `id` (cuid PK), `email` (String, unique),
           `passwordHash` (String), `createdAt`, `updatedAt`; relations to
           RefreshToken, PasswordResetOtp, Note, Tag.

- [ ] 2B.3 Add `RefreshToken` model: `id` (cuid PK), `userId` (FK → User
           onDelete Cascade), `tokenHash` (String), `expiresAt` (DateTime),
           `revokedAt` (DateTime?), `createdAt`; `@@index([userId])`,
           `@@index([tokenHash])`.

- [ ] 2B.4 Add `PasswordResetOtp` model: `id` (cuid PK), `userId` (FK → User
           onDelete Cascade), `codeHash` (String), `expiresAt` (DateTime),
           `attempts` (Int default 0), `consumedAt` (DateTime?), `createdAt`;
           `@@index([userId])`.

- [ ] 2B.5 Add `Note` model: `id` (cuid PK), `userId` (FK → User onDelete
           Cascade), `title` (String default ""), `contentJson` (Json),
           `contentText` (String default ""), `createdAt`, `updatedAt`,
           `deletedAt` (DateTime?); relations to Tag (via NoteTag), NoteVersion,
           ShareLink; `@@index([userId, deletedAt, updatedAt])`.

- [ ] 2B.6 Add `Tag` model: `id` (cuid PK), `userId` (FK → User onDelete
           Cascade), `name` (String), `color` (String), `createdAt`,
           `updatedAt`; relation to Note (via NoteTag); `@@unique([userId, name])`.

- [ ] 2B.7 Add `NoteTag` model: composite PK `@@id([noteId, tagId])`,
           `noteId` (FK → Note onDelete Cascade),
           `tagId` (FK → Tag onDelete Cascade); `@@index([tagId])`.

- [ ] 2B.8 Add `NoteVersion` model: `id` (cuid PK), `noteId` (FK → Note
           onDelete Cascade), `versionNumber` (Int), `title` (String),
           `contentJson` (Json), `contentText` (String), `createdAt`;
           `@@unique([noteId, versionNumber])`, `@@index([noteId, createdAt])`.

- [ ] 2B.9 Add `ShareLink` model: `id` (cuid PK), `noteId` (FK → Note
           onDelete Cascade), `token` (String unique), `expiresAt` (DateTime?),
           `revokedAt` (DateTime?), `viewCount` (Int default 0), `createdAt`;
           `@@index([noteId])`.

- [ ] 2B.10 Create `backend/src/prisma/seed.ts`: imports `PrismaClient`,
            defines async `main(): Promise<void>` (empty body), calls `main()`
            with `.catch(console.error).finally(() => prisma.$disconnect())`.
            Inserts no data.

### 2C — Frontend Skeleton [PARALLEL]

- [ ] 2C.1 Create `frontend/package.json`:
           name `"frontend"`, `"type": "module"`, scripts
           `dev: "vite"`, `build: "vite build"` (**not** `tsc` — `noEmit`
           would produce no output), `test: "vitest run"`,
           `lint: "eslint src"`, `e2e: "playwright test"`;
           dependencies (exact pinned): `react`, `react-dom`,
           `@tanstack/react-query`, `zustand`, `@tiptap/react`,
           `@tiptap/starter-kit`, `clsx`, `tailwind-merge`,
           `@note-app/shared@workspace:*`;
           devDependencies (exact pinned): `vite`, `@vitejs/plugin-react`,
           `typescript`, `vitest`, `@playwright/test`, `@types/react`,
           `@types/react-dom`.

- [ ] 2C.2 Create `frontend/tsconfig.json` extending `../tsconfig.base.json`;
           `target: "ES2020"`, `module: "ESNext"`,
           `moduleResolution: "bundler"`, `lib: ["ES2020","DOM","DOM.Iterable"]`,
           `jsx: "react-jsx"`, `noEmit: true`,
           `allowImportingTsExtensions: true`.

- [ ] 2C.3 Create `frontend/vite.config.ts` with `@vitejs/plugin-react` plugin
           and resolve alias `"@"` → `"./src"`.

- [ ] 2C.4 Create `frontend/index.html` — standard Vite entry with
           `<div id="root"></div>` and `<script type="module" src="/src/main.tsx">`.

- [ ] 2C.5 Create `frontend/src/main.tsx` — mounts `<App />` into `#root`
           using `ReactDOM.createRoot`.

- [ ] 2C.6 Create `frontend/src/App.tsx` — minimal placeholder:
           `export default function App() { return <div>Note App</div> }`.

- [ ] 2C.7 Create `frontend/src/lib/utils.ts` — `cn()` helper using
           `clsx` + `tailwind-merge`.

- [ ] 2C.8 Create `frontend/components.json` — shadcn/ui config stub
           (style, rsc, tsx, tailwind, aliases).

- [ ] 2C.9 Create empty directory stubs with `.gitkeep`:
           `frontend/src/pages/`,
           `frontend/src/features/auth/`,
           `frontend/src/features/notes/`,
           `frontend/src/features/tags/`,
           `frontend/src/features/search/`,
           `frontend/src/features/share/`,
           `frontend/src/features/versions/`,
           `frontend/src/components/`,
           `frontend/src/api/`,
           `frontend/src/stores/`.

---

### Phase 2 Checkpoint

```bash
pnpm install                                      # pick up new packages
pnpm --filter backend exec prisma generate        # 0 errors — no DB needed
pnpm --filter backend build                       # 0 TypeScript errors
pnpm --filter frontend build                      # 0 TypeScript errors (vite build)
pnpm -w lint                                      # 0 errors across all packages
```

All commands must exit 0 before starting Phase 3.

---

## Phase 3 — Integration

*Wire the DB, run the migration, verify inter-package resolution, confirm hooks.*

- [ ] 3.1  Copy `backend/.env.example` → `backend/.env`; populate
           `DATABASE_URL` with your local PostgreSQL 16 connection string and
           set `JWT_SECRET` to any non-empty value.

- [ ] 3.2  Run the initial Prisma migration:
           `pnpm --filter backend exec prisma migrate dev --name init`
           Confirm all 7 tables are created without error.

- [ ] 3.3  Run the seed skeleton:
           `pnpm --filter backend exec prisma db seed`
           Confirm it exits 0 and no rows are inserted.

- [ ] 3.4  Verify `@note-app/shared` barrel import resolves in backend:
           temporarily add `import {} from '@note-app/shared'` to
           `backend/src/app.ts`, run `pnpm --filter backend build`,
           confirm 0 errors, then remove the temporary import.

- [ ] 3.5  Verify `@note-app/shared` barrel import resolves in frontend:
           temporarily add `import {} from '@note-app/shared'` to
           `frontend/src/App.tsx`, run `pnpm --filter frontend build`,
           confirm 0 errors, then remove the temporary import.

- [ ] 3.6  Verify Husky hooks fire: run
           `git commit --allow-empty -m "chore(infra): verify hooks"` and
           confirm the pre-commit lint step runs (check terminal output).

- [ ] 3.7  Start the backend dev server (`pnpm --filter backend dev`) and
           confirm it binds to PORT 3000 without throwing.

---

### Phase 3 Checkpoint

```bash
pnpm -w build      # 0 errors, 0 warnings
pnpm -w lint       # 0 errors
```

---

## Phase 4 — Test Verification

*One verification step per spec scenario. These are CLI-level acceptance checks,
not Vitest tests (no feature logic exists yet to unit-test).*

### monorepo-scaffold spec

- [ ] T-01  **No range specifiers** — inspect every `package.json` in the
            workspace; confirm zero entries with a leading `^` or `~`.

- [ ] T-02  **Versions match SDS §2 major constraints** — spot-check installed
            versions: Node 22, React 19.x, Express 5.x, Vite 6.x,
            TanStack Query 5.x, Prisma 6.x, Vitest 3.x, Playwright 1.x.

- [ ] T-03  **Workspace packages recognized** — `pnpm install` exits 0 with all
            three packages resolving their dependencies.

- [ ] T-04  **Root script delegates to all packages** — `pnpm -w build` exits 0
            and build output for all three packages appears in order (shared first).

- [ ] T-05  **TypeScript strict — backend** — `pnpm --filter backend build`
            exits 0 with no implicit-any errors.

- [ ] T-06  **TypeScript strict — frontend** — `pnpm --filter frontend build`
            exits 0 with no implicit-any errors.

- [ ] T-07  **TypeScript strict — shared** — `pnpm --filter @note-app/shared build`
            exits 0.

- [ ] T-08  **Lint passes on clean scaffold** — `pnpm -w lint` exits 0 with
            zero errors and zero warnings.

- [ ] T-09  **Implicit-any caught by lint** — temporarily create a `.ts` file
            with an untyped parameter (e.g. `function f(x) {}`), run
            `pnpm -w lint`, confirm non-zero exit with an error, then delete
            the file.

- [ ] T-10  **Conforming commit message accepted** —
            `echo "feat(auth): add register endpoint" | npx commitlint`
            exits 0.

- [ ] T-11  **Non-conforming message rejected** —
            `echo "added some stuff" | npx commitlint` exits non-zero.

- [ ] T-12  **Unknown scope rejected** —
            `echo "feat(payments): add checkout" | npx commitlint` exits
            non-zero.

- [ ] T-13  **Backend starts without crashing** — `pnpm --filter backend dev`
            binds to PORT 3000 and logs the address; no unhandled exception
            on startup.

- [ ] T-14  **Backend layer directories exist** — confirm
            `backend/src/routes/`, `controllers/`, `services/`,
            `repositories/`, `middleware/`, `lib/` all present.

- [ ] T-15  **`.env.example` keys present** — read `backend/.env.example`;
            confirm keys `DATABASE_URL`, `JWT_SECRET`, `ACCESS_TOKEN_TTL`,
            `REFRESH_TOKEN_TTL`, `OTP_TTL`, `PORT` all present.

- [ ] T-16  **`.env.test.example` present** — read `backend/.env.test.example`;
            confirm `DATABASE_URL` placeholder entry exists.

- [ ] T-17  **Frontend builds without errors** — `pnpm --filter frontend build`
            exits 0 with zero TypeScript errors and zero build warnings.

- [ ] T-18  **Feature directory stubs exist** — confirm
            `frontend/src/features/auth/`, `notes/`, `tags/`, `search/`,
            `share/`, `versions/` all present.

- [ ] T-19  **Component/state directories exist** — confirm
            `frontend/src/pages/`, `components/`, `api/`, `stores/` present.

### prisma-schema spec

- [ ] T-20  **`prisma generate` succeeds** —
            `pnpm --filter backend exec prisma generate` exits 0 and the
            Prisma client is importable.

- [ ] T-21  **All 7 tables created by migration** — after `prisma migrate dev
            --name init`, confirm tables `User`, `RefreshToken`,
            `PasswordResetOtp`, `Note`, `Tag`, `NoteTag`, `NoteVersion`,
            `ShareLink` exist in the database (via psql or Prisma Studio).

- [ ] T-22  **Cascade indexes present** — confirm `@@index([userId])` on
            `RefreshToken` and `PasswordResetOtp`; composite index
            `[userId, deletedAt, updatedAt]` on `Note`;
            `@@index([tagId])` on `NoteTag`;
            `@@unique([noteId, versionNumber])` + `@@index([noteId, createdAt])`
            on `NoteVersion`; `@@index([noteId])` on `ShareLink`.

- [ ] T-23  **Seed exits 0 without inserting rows** —
            `pnpm --filter backend exec prisma db seed` exits 0; confirm
            all tables remain empty (e.g. `SELECT COUNT(*) FROM "User"`).

### shared-package spec

- [ ] T-24  **Backend resolves `@note-app/shared`** — verified by T-04
            (backend build); the temporary import test from 3.4 also confirms.

- [ ] T-25  **Frontend resolves `@note-app/shared`** — verified by T-04
            (frontend build); the temporary import test from 3.5 also confirms.

- [ ] T-26  **No circular dependency** — inspect `packages/shared/package.json`;
            confirm `dependencies` does not reference `backend` or `frontend`.

- [ ] T-27  **schemas barrel importable** — shared build (T-07) resolves
            `dist/schemas/index.js`; confirm file exists after build.

- [ ] T-28  **types barrel importable** — shared build (T-07) resolves
            `dist/types/index.js`; confirm file exists after build.

- [ ] T-29  **Empty barrels cause no build errors** — confirmed by T-07
            (shared build exits 0 with empty barrel content).

- [ ] T-30  **Zod is the only production dependency** — inspect
            `packages/shared/package.json`; confirm `dependencies` contains
            only `"zod"` — no `express`, `react`, `@prisma/client`, etc.

---

### Phase 4 Checkpoint (Final)

```bash
pnpm -w build                                             # 0 errors, 0 warnings
pnpm -w lint --max-warnings 0                             # 0 errors, 0 warnings
echo "chore(infra): scaffold monorepo" | npx commitlint   # exits 0
echo "wip" | npx commitlint                               # exits non-zero
```

All checks green → AB-1001 complete. Proceed to `/spec AB-1002` (Auth).
