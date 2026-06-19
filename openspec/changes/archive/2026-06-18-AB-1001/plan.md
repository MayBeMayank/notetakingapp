# AB-1001 — Technical Implementation Plan

---

## 1. Existing State (what the repo already has)

| Item | Status |
|---|---|
| `.git/` + git history | ✅ present |
| `.husky/_/` Husky internal runner | ✅ present (hooks not wired yet) |
| `CLAUDE.md`, `AGENTS.md` | ✅ present |
| `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `packages/shared/CLAUDE.md` | ✅ present |
| `docs/FRS.md`, `docs/SDS.md` | ✅ present |
| `openspec/` + change artifacts | ✅ present |
| Root `package.json`, `pnpm-workspace.yaml` | ❌ to create |
| `tsconfig.base.json`, ESLint config, commitlint config | ❌ to create |
| `.husky/pre-commit`, `.husky/commit-msg` actual hooks | ❌ to create |
| All source under `backend/src/`, `frontend/src/`, `packages/shared/src/` | ❌ to create |

---

## 2. Architecture Decisions

### 2.1 ESLint flat config (`eslint.config.js`) over legacy `.eslintrc`
ESLint 9 ships flat config as default and has deprecated `.eslintrc`. Using
`eslint.config.js` avoids a future migration and aligns with current ESLint 9
conventions.

### 2.2 ESM (`NodeNext`) for backend and shared; `bundler` for frontend
Node 22 has full native ESM. Express 5 and Prisma 6 both support ESM.
`"module": "NodeNext"` + `"moduleResolution": "NodeNext"` is the correct pair
for Node 22 ESM packages. The frontend uses `"module": "ESNext"` +
`"moduleResolution": "bundler"` because Vite handles resolution — no
`.js`-extension enforcement needed in the browser bundle.

**Implication:** All intra-package imports in `backend/` and `packages/shared/`
must use `.js` extensions even when importing `.ts` source files. This is a
TypeScript ESM requirement, not a bug.
```ts
// correct in backend/shared ESM context
import { app } from './app.js'
import { PrismaClient } from '@prisma/client'
```

### 2.3 Simple `tsconfig extends` — no TypeScript project references
Project references add build-graph complexity that only pays off at large scale.
Three packages with separate `tsc` invocations via `pnpm -r build` is simpler
and sufficient. Dependency ordering is handled by pnpm's workspace topology.

### 2.4 `tsx` as the dev and seed runner (not `ts-node`)
`tsx` requires no tsconfig changes, handles ESM natively, and is materially
faster for startup than `ts-node`. It is listed in SDS §2.

### 2.5 Prisma schema at `backend/src/prisma/` (per SDS §1 diagram)
The SDS and AGENTS.md diagrams both show `backend/src/prisma/`. This requires
the `prisma.schema` key in `backend/package.json` so the CLI can locate it:
```json
"prisma": {
  "schema": "src/prisma/schema.prisma",
  "seed": "tsx src/prisma/seed.ts"
}
```

### 2.6 `packages/shared` package exports map
Both `import from '@note-app/shared'` (barrel) and
`import from '@note-app/shared/schemas/notes'` (sub-path) appear in the
CLAUDE.md guides. The `exports` field in `packages/shared/package.json` must
declare both forms:
```json
"exports": {
  ".":          { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
  "./schemas":  { "import": "./dist/schemas/index.js", "types": "./dist/schemas/index.d.ts" },
  "./schemas/*":{ "import": "./dist/schemas/*.js",     "types": "./dist/schemas/*.d.ts" },
  "./types":    { "import": "./dist/types/index.js",   "types": "./dist/types/index.d.ts" }
}
```

### 2.7 Dependency version pinning
All `dependencies` and `devDependencies` use exact patch versions (no `^`/`~`)
per SDS §2, Rule 9. Versions are looked up from the live npm registry
immediately before writing each `package.json`. The major-version constraints
from SDS §2 are:

| Package | Major |
|---|---|
| TypeScript | 5.x |
| Express | 5.x |
| React / React-DOM | 19.x |
| Vite | 6.x |
| @vitejs/plugin-react | 4.x |
| @tanstack/react-query | 5.x |
| Zustand | 5.x |
| @tiptap/react + @tiptap/starter-kit | 2.x |
| Prisma + @prisma/client | 6.x |
| Zod | 3.x |
| argon2 | 0.x (latest) |
| jsonwebtoken + @types/jsonwebtoken | 9.x |
| Vitest | 3.x |
| Supertest + @types/supertest | 7.x |
| @playwright/test | 1.x |
| tsx | 4.x |
| ESLint | 9.x |
| @typescript-eslint (plugin + parser) | 8.x |
| Husky | 9.x |
| @commitlint/cli + config-conventional | 19.x |
| clsx + tailwind-merge (shadcn cn helper) | latest stable |

---

## 3. Complete File Inventory

### 3.1 Root

| File | Action | Notes |
|---|---|---|
| `package.json` | CREATE | workspace root, no dist |
| `pnpm-workspace.yaml` | CREATE | declares 3 packages |
| `tsconfig.base.json` | CREATE | strict options shared by all packages |
| `eslint.config.js` | CREATE | flat config, ts-eslint recommended |
| `commitlint.config.cjs` | CREATE | types + scopes from CLAUDE.md |
| `.husky/pre-commit` | CREATE | runs `pnpm -w lint` |
| `.husky/commit-msg` | CREATE | runs `npx --no -- commitlint --edit "$1"` |
| `.gitignore` | CREATE | covers node_modules, dist, .env, .env.test, *.tsbuildinfo |

### 3.2 `packages/shared`

| File | Action |
|---|---|
| `packages/shared/package.json` | CREATE |
| `packages/shared/tsconfig.json` | CREATE |
| `packages/shared/src/index.ts` | CREATE |
| `packages/shared/src/schemas/index.ts` | CREATE — empty barrel |
| `packages/shared/src/types/index.ts` | CREATE — empty barrel |

### 3.3 `backend`

| File | Action | Notes |
|---|---|---|
| `backend/package.json` | CREATE | includes prisma schema path config |
| `backend/tsconfig.json` | CREATE | NodeNext module |
| `backend/.env.example` | CREATE | all required env var keys |
| `backend/.env.test.example` | CREATE | separate test DATABASE_URL |
| `backend/src/app.ts` | CREATE | Express app, json middleware |
| `backend/src/server.ts` | CREATE | binds to PORT |
| `backend/src/routes/.gitkeep` | CREATE | |
| `backend/src/controllers/.gitkeep` | CREATE | |
| `backend/src/services/.gitkeep` | CREATE | |
| `backend/src/repositories/.gitkeep` | CREATE | |
| `backend/src/middleware/.gitkeep` | CREATE | |
| `backend/src/lib/.gitkeep` | CREATE | |
| `backend/src/prisma/schema.prisma` | CREATE | all 7 models |
| `backend/src/prisma/seed.ts` | CREATE | skeleton only |

### 3.4 `frontend`

| File | Action | Notes |
|---|---|---|
| `frontend/package.json` | CREATE | |
| `frontend/tsconfig.json` | CREATE | bundler moduleResolution |
| `frontend/vite.config.ts` | CREATE | react plugin + `@` alias |
| `frontend/index.html` | CREATE | Vite entry point |
| `frontend/components.json` | CREATE | shadcn/ui config |
| `frontend/src/main.tsx` | CREATE | mounts App into #root |
| `frontend/src/App.tsx` | CREATE | placeholder component |
| `frontend/src/lib/utils.ts` | CREATE | cn() helper (clsx + twMerge) |
| `frontend/src/pages/.gitkeep` | CREATE | |
| `frontend/src/features/auth/.gitkeep` | CREATE | |
| `frontend/src/features/notes/.gitkeep` | CREATE | |
| `frontend/src/features/tags/.gitkeep` | CREATE | |
| `frontend/src/features/search/.gitkeep` | CREATE | |
| `frontend/src/features/share/.gitkeep` | CREATE | |
| `frontend/src/features/versions/.gitkeep` | CREATE | |
| `frontend/src/components/.gitkeep` | CREATE | |
| `frontend/src/api/.gitkeep` | CREATE | |
| `frontend/src/stores/.gitkeep` | CREATE | |

---

## 4. Key File Shapes

### `pnpm-workspace.yaml`
```yaml
packages:
  - 'backend'
  - 'frontend'
  - 'packages/shared'
```

### Root `package.json`
```json
{
  "name": "note-app",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test":  "pnpm -r test",
    "lint":  "eslint ."
  },
  "devDependencies": {
    "@commitlint/cli": "<pinned>",
    "@commitlint/config-conventional": "<pinned>",
    "@typescript-eslint/eslint-plugin": "<pinned>",
    "@typescript-eslint/parser": "<pinned>",
    "eslint": "<pinned>",
    "husky": "<pinned>",
    "typescript": "<pinned>"
  }
}
```

### `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### `backend/tsconfig.json`
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `packages/shared/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `frontend/tsconfig.json`
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### `packages/shared/package.json`
```json
{
  "name": "@note-app/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":           { "import": "./dist/index.js",          "types": "./dist/index.d.ts" },
    "./schemas":   { "import": "./dist/schemas/index.js",  "types": "./dist/schemas/index.d.ts" },
    "./schemas/*": { "import": "./dist/schemas/*.js",      "types": "./dist/schemas/*.d.ts" },
    "./types":     { "import": "./dist/types/index.js",    "types": "./dist/types/index.d.ts" }
  },
  "scripts": {
    "build": "tsc",
    "lint":  "eslint src"
  },
  "dependencies": {
    "zod": "<pinned>"
  }
}
```

### `backend/package.json` (structure)
```json
{
  "name": "backend",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev":   "tsx src/server.ts",
    "build": "tsc",
    "test":  "vitest run",
    "lint":  "eslint src"
  },
  "prisma": {
    "schema": "src/prisma/schema.prisma",
    "seed":   "tsx src/prisma/seed.ts"
  },
  "dependencies": {
    "express":              "<pinned>",
    "@prisma/client":       "<pinned>",
    "argon2":               "<pinned>",
    "jsonwebtoken":         "<pinned>",
    "zod":                  "<pinned>",
    "@note-app/shared":     "workspace:*"
  },
  "devDependencies": {
    "@types/express":       "<pinned>",
    "@types/jsonwebtoken":  "<pinned>",
    "@types/supertest":     "<pinned>",
    "prisma":               "<pinned>",
    "supertest":            "<pinned>",
    "tsx":                  "<pinned>",
    "typescript":           "<pinned>",
    "vitest":               "<pinned>"
  }
}
```

### `backend/src/app.ts`
```ts
import express from 'express'

const app = express()
app.use(express.json())

export { app }
```

### `backend/src/server.ts`
```ts
import { app } from './app.js'

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
```

### `backend/src/prisma/seed.ts`
```ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  // seed data added by feature tickets
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

### `packages/shared/src/index.ts`
```ts
export * from './schemas/index.js'
export * from './types/index.js'
```

### `packages/shared/src/schemas/index.ts`
```ts
// domain schema files (auth.ts, notes.ts, …) are added by AB-1002+
export {}
```

### `packages/shared/src/types/index.ts`
```ts
// types are derived via z.infer<> in domain schema files — none yet
export {}
```

### `frontend/src/App.tsx`
```tsx
export default function App() {
  return <div>Note App</div>
}
```

### `frontend/src/main.tsx`
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

### `frontend/src/lib/utils.ts`
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```
> Requires `clsx` and `tailwind-merge` in `frontend/package.json` dependencies.

### `eslint.config.js`
```js
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  ...tseslint.configs.recommended,
)
```

### `commitlint.config.cjs`
```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum':  [2, 'always', ['feat','fix','refactor','test','chore','docs']],
    'scope-enum': [2, 'always', ['auth','notes','tags','search','share',
                                 'versions','shared','db','infra']],
    'scope-empty': [2, 'never'],
  },
}
```

### `.husky/pre-commit`
```sh
pnpm -w lint
```

### `.husky/commit-msg`
```sh
npx --no -- commitlint --edit "$1"
```

---

## 5. Prisma Schema (full — SDS §3)

`backend/src/prisma/schema.prisma` reproduces SDS §3 verbatim, including all
7 models, all `@default`, `@unique`, `@@unique`, `@@index`, `@relation`,
`onDelete: Cascade` attributes.

No raw SQL additions in this ticket. The `tsvector` generated column and GIN
index are deferred to AB-1007.

---

## 6. DB Changes

| Change | Type | Backward compatible |
|---|---|---|
| Initial migration — creates all 7 tables | DDL (CREATE TABLE) | N/A — fresh DB |
| All indexes from SDS §3 | DDL (CREATE INDEX) | N/A — fresh DB |

Command: `pnpm --filter backend prisma migrate dev --name init`
Requires: `DATABASE_URL` set in `backend/.env`.

---

## 7. Build + Quality Gate Checkpoints

Run in this order after all files are created:

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Build shared first (backend and frontend depend on it)
pnpm --filter @note-app/shared build

# 3. Generate Prisma client (requires schema to be present)
pnpm --filter backend exec prisma generate

# 4. Build backend
pnpm --filter backend build

# 5. Build frontend
pnpm --filter frontend build

# 6. Full workspace lint — must be 0 errors
pnpm -w lint

# 7. Run initial migration (requires DATABASE_URL in backend/.env)
pnpm --filter backend exec prisma migrate dev --name init

# 8. Run seed skeleton (exits 0, inserts nothing)
pnpm --filter backend exec prisma db seed

# 9. Verify commitlint — should pass
echo "chore(infra): scaffold monorepo" | npx commitlint

# 10. Verify commitlint rejects bad message
echo "added stuff" | npx commitlint
```

---

## 8. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `.js` extension errors in ESM imports | Enforce in code review; TSConfig `moduleResolution: NodeNext` will surface them at build time |
| Husky hooks silently not running | After creating hook files, verify with `git commit --allow-empty -m "test(infra): verify hooks"` and confirm lint runs |
| `@note-app/shared` sub-path imports unresolved | The `exports` map in `packages/shared/package.json` must include `"./schemas/*"` wildcard; verify with a test import after build |
| Prisma generate fails if `DATABASE_URL` absent | `prisma generate` does not need a live DB — it reads the schema only. Only `migrate dev` needs the DB. |
| Frontend `noEmit: true` causes `tsc` to exit 0 without output | Frontend build should be `vite build` (not `tsc`); the `build` script in `frontend/package.json` must be `vite build`, not `tsc` |
