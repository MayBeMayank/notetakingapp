# Technical Plan: AB-1002 — Auth: Register, Login, Logout, JWT + Refresh Token

_Branch: `feat/AB-1002-auth-register-login-logout`_

---

## 1. File Inventory

### Create (new files)

```
packages/shared/src/schemas/auth.ts           # Zod schemas + inferred types
packages/shared/src/schemas/index.ts          # re-export auth (modify)

backend/src/lib/prisma.ts                     # Prisma client singleton
backend/src/lib/errors.ts                     # typed AppError hierarchy
backend/src/lib/jwt.ts                        # sign / verify access token
backend/src/lib/hash.ts                       # argon2 (passwords) + SHA-256 (tokens)
backend/src/lib/token.ts                      # crypto.randomBytes → base64url

backend/src/types/express.d.ts               # extends Request with userId

backend/src/middleware/validate.middleware.ts  # generic Zod body validator → 400
backend/src/middleware/auth.middleware.ts      # JWT guard → attaches req.userId
backend/src/middleware/error.middleware.ts     # central Express 5 error handler

backend/src/repositories/auth.repository.ts   # User + RefreshToken DB ops
backend/src/services/auth.service.ts          # business logic (FRS rules)
backend/src/controllers/auth.controller.ts    # req/res mapping, calls service
backend/src/routes/auth.routes.ts             # mounts /api/auth/* with validate middleware

backend/tests/unit/auth.service.test.ts       # Vitest unit tests
backend/tests/integration/auth.routes.test.ts # Supertest integration tests
```

### Modify (existing files)

```
backend/src/app.ts                            # mount authRouter + errorMiddleware
packages/shared/src/schemas/index.ts          # export * from './auth.js'
```

---

## 2. TypeScript Shapes (final contracts)

### `packages/shared/src/schemas/auth.ts`

```ts
// ── Request schemas ──────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email: z.string().email('Must be a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
})

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
})

// ── Response schemas ─────────────────────────────────────────────────────────

export const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  createdAt: z.date(),
})

export const RegisterResponseSchema = z.object({
  user: UserResponseSchema,
})

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: UserResponseSchema,
})

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
})

// ── Inferred types ───────────────────────────────────────────────────────────

export type RegisterInput     = z.infer<typeof RegisterSchema>
export type LoginInput        = z.infer<typeof LoginSchema>
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>
export type LogoutInput       = z.infer<typeof LogoutSchema>
export type UserResponse      = z.infer<typeof UserResponseSchema>
export type RegisterResponse  = z.infer<typeof RegisterResponseSchema>
export type LoginResponse     = z.infer<typeof LoginResponseSchema>
export type RefreshResponse   = z.infer<typeof RefreshResponseSchema>
```

### `backend/src/lib/errors.ts`

```ts
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Array<{ field: string; message: string }>
  ) { super(message) }
}

export class ValidationError extends AppError {
  constructor(fields: Array<{ field: string; message: string }>) {
    super(400, 'VALIDATION_ERROR', 'Validation failed', fields)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message)
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(422, code, message)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message)
  }
}
```

### `backend/src/types/express.d.ts`

```ts
declare global {
  namespace Express {
    interface Request {
      userId: string
    }
  }
}
export {}
```

### Repository interface (`auth.repository.ts`)

```ts
// Exposed methods
findUserByEmail(email: string): Promise<User | null>
createUser(data: { email: string; passwordHash: string }): Promise<User>
createRefreshToken(data: {
  userId: string
  tokenHash: string
  expiresAt: Date
}): Promise<RefreshToken>
findRefreshToken(tokenHash: string): Promise<RefreshToken | null>
revokeRefreshToken(id: string): Promise<void>
```

### Service interface (`auth.service.ts`)

```ts
register(input: RegisterInput): Promise<RegisterResponse>
login(input: LoginInput): Promise<LoginResponse>
refresh(input: RefreshTokenInput): Promise<RefreshResponse>
logout(input: LogoutInput): Promise<void>
```

---

## 3. Architecture Decisions

### A — Refresh token hashing: SHA-256, not argon2

The SDS mentions "argon2 hash" for refresh tokens, but argon2 is non-deterministic (uses a random salt per call). The schema has `@@index([tokenHash])`, which only provides value if the hash is deterministic — i.e., the same token input always produces the same hash so it can be queried with `WHERE tokenHash = ?`.

**Decision:** use `crypto.createHash('sha256').update(token).digest('hex')` for refresh tokens. This is:
- Deterministic → indexable, single query `WHERE tokenHash = sha256(presented token)`
- Secure for random inputs — a cryptographically random 32-byte opaque token has maximum entropy; argon2's purpose (slow brute-force resistance) is irrelevant here
- argon2 remains exclusively for passwords (user-chosen, potentially weak)

This is consistent with `@@index([tokenHash])` in the Prisma schema.

### B — Prisma client: singleton in `lib/prisma.ts`

A single `PrismaClient` instance is exported from `lib/prisma.ts` and imported by all repositories. This avoids connection-pool exhaustion in test environments and during hot-reload.

### C — Validation: generic `validateBody` middleware factory

A single reusable `validateBody(schema)` middleware factory is used across all routes. It runs `schema.safeParse(req.body)`, short-circuits with `400 + fields[]` on failure, and assigns `req.body = result.data` (replacing the raw body with the Zod-parsed value, which provides type narrowing downstream).

### D — Error handling: typed `AppError` + central handler

Services throw typed subclasses of `AppError` (e.g. `UnauthorizedError`, `ConflictError`). The central Express 5 error middleware in `error.middleware.ts` catches them and maps to the correct HTTP code + error envelope. Unknown errors → 500 with generic body (no stack trace or internals).

### E — Auth middleware placement

The auth middleware is applied **globally** to the Express app (`app.use(authMiddleware)`) but placed **after** the public router mounts (`/api/auth`, `/api/public`). This means public routes are declared before the guard is applied, not by skipping it per-route.

Alternatively, it can be applied per-router. **Decision: mount auth router before the auth middleware, then apply middleware; all subsequent routers (notes, tags, etc.) inherit it automatically.** This is cleaner than per-route opt-in and matches the SDS's intent of a single public vs. protected split.

### F — Email normalization

Email is lowercased both on creation (`email.toLowerCase()` in the service before writing) and on login lookup (`findUserByEmail(email.toLowerCase())`). Zod's `.email()` validates format but does not transform; the service owns the normalization.

---

## 4. DB Changes

**No schema changes.** `User` and `RefreshToken` models were scaffolded in AB-1001. No new columns or tables are added in AB-1002.

**However, the initial migration has not been applied yet.** The `backend/prisma/migrations/` directory is empty — the schema exists only in `schema.prisma`, not in the database. Before the server can start or tests can run, the migration must be created and applied.

### Required DB setup steps (run once, in order)

```bash
# 1. Create and apply the initial migration to the dev DB
#    ⚠️ Ask [y/n] before running — mutates the DB schema (CLAUDE.md rule)
pnpm --filter backend prisma migrate dev --name init

# 2. Apply the same migration to the test DB
#    Set DATABASE_URL to the test DB value first, or use dotenv-cli
DATABASE_URL=$(grep DATABASE_URL backend/.env.test | cut -d= -f2) \
  pnpm --filter backend prisma migrate deploy

# 3. Regenerate the Prisma client (migrate dev does this automatically,
#    but run standalone if only step 2 was needed)
pnpm --filter backend prisma generate
```

> **Note:** `backend/.env` and `backend/.env.test` both have `DATABASE_URL` populated. The dev DB is `notetakingapp`, the test DB is `note_app_test`. The test suite reads `.env.test` automatically via the Vitest config.

---

## 5. Reuse of Existing Code

- `backend/package.json` already includes `argon2`, `jsonwebtoken`, `zod`, `@note-app/shared` — no new dependencies needed.
- `@types/jsonwebtoken` is already a devDependency.
- `packages/shared/src/schemas/index.ts` already exists (empty); we add the `auth.ts` export there.

---

## 6. Test Plan

### Unit tests — `backend/tests/unit/auth.service.test.ts`

All service tests mock the repository layer (no DB). Tests name directly maps to the FRS criterion they cover.

| Test name | FRS | Asserts |
|---|---|---|
| `register: creates user and returns id+email+createdAt` | FRS-3.1.1, 3.1.5 | service returns correct shape; repo createUser called with hashed password |
| `register: throws ConflictError on duplicate email` | FRS-3.1.2 | mock findUserByEmail returns existing user → ConflictError(422, DUPLICATE_EMAIL) |
| `register: passwordHash never appears in return value` | FRS-3.1.4 | return value has no passwordHash field |
| `login: returns accessToken + refreshToken + user on valid credentials` | FRS-3.2.1, 3.2.2 | tokens issued, refreshToken row created |
| `login: throws UnauthorizedError on wrong password` | FRS-3.2.3 | argon2 verify returns false → UnauthorizedError |
| `login: throws UnauthorizedError on unknown email` | FRS-3.2.3 | findUserByEmail returns null → same UnauthorizedError (no existence leak) |
| `refresh: rotates token — revokes old, creates new` | FRS-3.3.1 | revokeRefreshToken called on old id; createRefreshToken called |
| `refresh: throws UnauthorizedError on expired token` | FRS-3.3.2 | mock row has `expiresAt` in past |
| `refresh: throws UnauthorizedError on revoked token` | FRS-3.3.2 | mock row has `revokedAt` set |
| `refresh: throws UnauthorizedError on unknown token` | FRS-3.3.2 | findRefreshToken returns null |
| `logout: sets revokedAt on matching token` | FRS-3.3.3 | revokeRefreshToken called with correct id |
| `logout: throws UnauthorizedError on unknown token` | spec scenario | findRefreshToken returns null |

### Integration tests — `backend/tests/integration/auth.routes.test.ts`

Supertest against the full Express app with a real test DB (`.env.test`). DB is reset with `prisma migrate reset --force` or truncation in `beforeEach`.

| Test | Expected status | Asserts |
|---|---|---|
| POST /api/auth/register with valid body | 201 | response has `user.id`, `user.email`, `user.createdAt`; no `passwordHash` |
| POST /api/auth/register with duplicate email | 422 | `error.code === "DUPLICATE_EMAIL"` |
| POST /api/auth/register with weak password (short) | 400 | `error.fields[0].field === "password"` |
| POST /api/auth/register with weak password (no number) | 400 | `error.fields[0].field === "password"` |
| POST /api/auth/register missing email | 400 | `error.fields` contains email |
| POST /api/auth/login with valid credentials | 200 | response has `accessToken`, `refreshToken`, `user` |
| POST /api/auth/login with wrong password | 401 | `error.code === "UNAUTHORIZED"` |
| POST /api/auth/login with unknown email | 401 | same `error.code` (no field hint) |
| POST /api/auth/refresh with valid token | 200 | new `accessToken` + `refreshToken` returned |
| POST /api/auth/refresh with used token | 401 | revoked token rejected |
| POST /api/auth/refresh with missing body field | 400 | `error.fields` contains refreshToken |
| POST /api/auth/logout with valid token | 204 | empty body |
| POST /api/auth/logout with unknown token | 401 | `error.code === "UNAUTHORIZED"` |
| GET protected route (e.g. /api/notes) without token | 401 | middleware rejects, route handler not called |
| GET protected route with valid JWT | passes through | 200 or 404 depending on route |
| GET protected route with expired JWT | 401 | `error.code === "UNAUTHORIZED"` |

---

## 7. Implementation Order

Execute strictly in this order to keep the project buildable at each step:

1. `packages/shared/src/schemas/auth.ts` + re-export from `schemas/index.ts`
2. `backend/src/lib/prisma.ts`
3. `backend/src/lib/errors.ts`
4. `backend/src/lib/jwt.ts`, `hash.ts`, `token.ts`
5. `backend/src/types/express.d.ts`
6. `backend/src/repositories/auth.repository.ts`
7. `backend/src/services/auth.service.ts`
8. `backend/src/middleware/validate.middleware.ts`
9. `backend/src/middleware/error.middleware.ts`
10. `backend/src/middleware/auth.middleware.ts`
11. `backend/src/controllers/auth.controller.ts`
12. `backend/src/routes/auth.routes.ts`
13. `backend/src/app.ts` (mount routes + error handler)
14. Write unit tests (`auth.service.test.ts`)
15. Write integration tests (`auth.routes.test.ts`)

---

## 8. Quality Gate Checkpoints

After step 1 (shared schemas):
```bash
pnpm -w build          # shared package compiles; backend picks up types
```

After step 13 (app wired up):
```bash
pnpm -w build          # must: 0 TypeScript errors across all packages
pnpm -w lint           # must: 0 ESLint errors
```

After step 15 (all tests written):
```bash
pnpm --filter backend test   # must: all tests green (unit + integration)
pnpm -w build                # final type-check
pnpm -w lint                 # final lint
```

Before commit:
```bash
npx commitlint --from HEAD~1   # commit message format
# Husky pre-commit runs automatically
```
