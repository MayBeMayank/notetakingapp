# Tasks: AB-1002 — Auth: Register, Login, Logout, JWT + Refresh Token

_Branch: `feat/AB-1002-auth-register-login-logout`_
_Spec: `openspec/changes/AB-1002/specs/user-auth/spec.md`_
_Plan: `openspec/changes/AB-1002/plan.md`_

---

## Phase 1 — Foundation (shared contracts + server utilities)

> Goal: everything that downstream layers import from. No business logic yet.
> Build must pass green at the end of this phase.

- [x] **T01** — Create `packages/shared/src/schemas/auth.ts`
  - `RegisterSchema` (email + password policy: ≥8 chars, ≥1 letter, ≥1 number)
  - `LoginSchema`, `RefreshTokenSchema`, `LogoutSchema`
  - `UserResponseSchema` (`id`, `email`, `createdAt` — no `passwordHash`)
  - `RegisterResponseSchema`, `LoginResponseSchema`, `RefreshResponseSchema`
  - Export inferred types: `RegisterInput`, `LoginInput`, `RefreshTokenInput`, `LogoutInput`, `UserResponse`, `RegisterResponse`, `LoginResponse`, `RefreshResponse`

- [x] **T02** — Update `packages/shared/src/schemas/index.ts`
  - Add `export * from './auth.js'`

- [x] **T03** — Create `backend/src/lib/prisma.ts`
  - Export a single `PrismaClient` singleton (prevents connection pool exhaustion in tests)

- [x] **T04** — Create `backend/src/lib/errors.ts`
  - `AppError` base class (`statusCode`, `code`, `message`, optional `fields[]`)
  - Subclasses: `ValidationError` (400), `UnauthorizedError` (401), `NotFoundError` (404), `ConflictError` (422)

- [x] **T05** — Create `backend/src/lib/jwt.ts`
  - `signAccessToken(userId: string): string` — JWT HS256, 15 min TTL, `sub` = userId
  - `verifyAccessToken(token: string): { sub: string }` — throws on invalid/expired

- [x] **T06** — Create `backend/src/lib/hash.ts`
  - `hashPassword(plain: string): Promise<string>` — argon2id
  - `verifyPassword(hash: string, plain: string): Promise<boolean>` — argon2id
  - `hashToken(token: string): string` — SHA-256 hex (deterministic; for refresh token index lookup)

- [x] **T07** — Create `backend/src/lib/token.ts`
  - `generateRefreshToken(): string` — `crypto.randomBytes(32).toString('base64url')`

- [x] **T08** — Create `backend/src/types/express.d.ts`
  - Declaration merge: `Express.Request` gains `userId: string`

### ✅ Phase 1 checkpoint
```bash
pnpm -w build        # 0 errors, 0 warnings
pnpm -w lint         # 0 errors
```

---

## Phase 2 — Core Implementation [PARALLEL where marked]

> Goal: all business logic and HTTP wiring in place; server starts without error.

- [x] **T09** `[PARALLEL]` — Create `backend/src/repositories/auth.repository.ts`
  - `findUserByEmail(email: string): Promise<User | null>`
  - `createUser(data: { email: string; passwordHash: string }): Promise<User>`
  - `createRefreshToken(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<RefreshToken>`
  - `findRefreshToken(tokenHash: string): Promise<RefreshToken | null>`
  - `revokeRefreshToken(id: string): Promise<void>` — sets `revokedAt = new Date()`
  - _Imports only: `lib/prisma.ts`, Prisma types. No business logic._

- [x] **T10** `[PARALLEL]` — Create `backend/src/middleware/validate.middleware.ts`
  - `validateBody<T>(schema: z.ZodSchema<T>): RequestHandler`
  - On failure: `res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '…', fields: […] } })`
  - On success: assign `req.body = result.data` and call `next()`

- [x] **T11** `[PARALLEL]` — Create `backend/src/middleware/error.middleware.ts`
  - Central Express 5 error handler (`(err, req, res, next)` signature)
  - `AppError` → map `statusCode`, `code`, `message`, `fields`
  - Unknown errors → 500, `{ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }` (no internals)

- [x] **T12** — Create `backend/src/services/auth.service.ts`
  _(depends on T09 — repository must exist first)_
  - `register`: lowercase email → check dup → hash password → create user → return `{ user }`
    - Dup email → throw `ConflictError('DUPLICATE_EMAIL', 'Email already registered')`
  - `login`: lowercase email → find user → compare password → 401 generic on any failure → generate tokens → hash token (SHA-256) → store RefreshToken row → return `{ accessToken, refreshToken, user }`
  - `refresh`: hash presented token → find row → 401 if not found / `revokedAt` set / `expiresAt` past → revoke old row → generate new token + access token → store new row → return `{ accessToken, refreshToken }`
  - `logout`: hash presented token → find row → 401 if not found → set `revokedAt` → return void

- [x] **T13** — Create `backend/src/middleware/auth.middleware.ts`
  _(depends on T05 jwt.ts, T04 errors.ts)_
  - Extract `Authorization: Bearer <token>` header
  - `verifyAccessToken(token)` — catches any error → `UnauthorizedError`
  - Attach `req.userId = payload.sub`
  - Call `next()`; missing header or any JWT error → `next(new UnauthorizedError())`

- [x] **T14** — Create `backend/src/controllers/auth.controller.ts`
  _(depends on T12 service, T04 errors)_
  - `register`: call `authService.register(req.body)` → `res.status(201).json(result)`
  - `login`: call `authService.login(req.body)` → `res.status(200).json(result)`
  - `refresh`: call `authService.refresh(req.body)` → `res.status(200).json(result)`
  - `logout`: call `authService.logout(req.body)` → `res.status(204).send()`
  - _No try/catch — Express 5 async error propagation handles it; errors bubble to T11_

- [x] **T15** — Create `backend/src/routes/auth.routes.ts`
  _(depends on T14 controller, T10 validate)_
  - `POST /register` → `validateBody(RegisterSchema)`, `authController.register`
  - `POST /login` → `validateBody(LoginSchema)`, `authController.login`
  - `POST /refresh` → `validateBody(RefreshTokenSchema)`, `authController.refresh`
  - `POST /logout` → `validateBody(LogoutSchema)`, `authController.logout`
  - Export `authRouter`

- [x] **T16** — Modify `backend/src/app.ts`
  - Mount `authRouter` at `/api/auth` (public — before the auth guard)
  - Apply `authMiddleware` globally after the auth router mount
  - Register `errorMiddleware` as the last middleware (Express 5 error handler)

### ✅ Phase 2 checkpoint
```bash
pnpm -w build        # 0 errors, 0 warnings
pnpm -w lint         # 0 errors
pnpm --filter backend dev   # server starts and responds to POST /api/auth/register
```

---

## Phase 3 — Integration (wire-up smoke test)

> Goal: confirm the full request path works end-to-end before writing formal tests.

- [x] **T17** — Apply initial DB migration (dev + test)
  - `pnpm --filter backend prisma migrate dev --name init` → creates `backend/prisma/migrations/` and applies to dev DB [ASK y/n first]
  - Apply to test DB: `DATABASE_URL=<test-url> pnpm --filter backend prisma migrate deploy`
  - Confirm `pnpm --filter backend prisma generate` succeeds (migrate dev triggers this automatically)
  - _No schema changes — this just writes the AB-1001 schema to the live DB for the first time_

- [x] **T18** — Manual smoke test (curl or REST client)
  - `POST /api/auth/register` with valid body → expect 201 + `{ user: { id, email, createdAt } }`
  - `POST /api/auth/register` duplicate email → expect 422
  - `POST /api/auth/login` → expect 200 + `{ accessToken, refreshToken, user }`
  - `POST /api/auth/refresh` → expect 200 + new tokens
  - `POST /api/auth/logout` → expect 204
  - `GET /api/nonexistent` with no token → expect 401

### ✅ Phase 3 checkpoint
```bash
pnpm -w build        # still 0 errors
pnpm -w lint         # still 0 errors
```

---

## Phase 4 — Tests (one test per spec scenario)

> Every scenario in `specs/user-auth/spec.md` maps to exactly one named test.

### T19 — Create `backend/tests/unit/auth.service.test.ts`

Unit tests mock the repository; no DB required.

- [x] `register › creates user and returns { user: { id, email, createdAt } }` — FRS-3.1.1, FRS-3.1.5
- [x] `register › throws ConflictError(DUPLICATE_EMAIL) when email already in use` — FRS-3.1.2
- [x] `register › passwordHash never appears in the return value` — FRS-3.1.4
- [x] `login › returns accessToken + refreshToken + user on valid credentials` — FRS-3.2.1, FRS-3.2.2
- [x] `login › refreshToken is stored as SHA-256 hash, not plaintext` — FRS-3.2.2 (plan §A)
- [x] `login › throws UnauthorizedError on wrong password (generic message)` — FRS-3.2.3
- [x] `login › throws UnauthorizedError on unknown email (same message, no existence leak)` — FRS-3.2.3
- [x] `refresh › revokes old token and creates a new one (rotation)` — FRS-3.3.1
- [x] `refresh › throws UnauthorizedError when token is expired` — FRS-3.3.2
- [x] `refresh › throws UnauthorizedError when token is revoked` — FRS-3.3.2
- [x] `refresh › throws UnauthorizedError when token hash matches no row` — FRS-3.3.2
- [x] `logout › calls revokeRefreshToken with the matching row id` — FRS-3.3.3
- [x] `logout › throws UnauthorizedError when token is not found` — spec scenario

### T20 — Create `backend/tests/integration/auth.routes.test.ts`

Supertest against the Express app with a real test DB. `beforeEach` truncates `User` + `RefreshToken` tables.

**Registration**
- [x] `POST /api/auth/register › 201 with { user: { id, email, createdAt } }` — FRS-3.1.1, FRS-3.1.5
- [x] `POST /api/auth/register › 201 response never contains passwordHash` — FRS-3.1.4
- [x] `POST /api/auth/register › 422 DUPLICATE_EMAIL on second identical email` — FRS-3.1.2
- [x] `POST /api/auth/register › 400 field error on malformed email` — FRS-3.1.3
- [x] `POST /api/auth/register › 400 field error on password shorter than 8 chars` — FRS-3.1.3
- [x] `POST /api/auth/register › 400 field error on password with no letter` — FRS-3.1.3
- [x] `POST /api/auth/register › 400 field error on password with no number` — FRS-3.1.3
- [x] `POST /api/auth/register › 400 field errors when email and password both missing` — FRS-3.1.3

**Login**
- [x] `POST /api/auth/login › 200 with { accessToken, refreshToken, user }` — FRS-3.2.1, FRS-3.2.2
- [x] `POST /api/auth/login › email lookup is case-insensitive` — spec scenario (plan §F)
- [x] `POST /api/auth/login › 401 UNAUTHORIZED on wrong password (no field hint)` — FRS-3.2.3
- [x] `POST /api/auth/login › 401 UNAUTHORIZED on unknown email (same body, no leak)` — FRS-3.2.3
- [x] `POST /api/auth/login › second login creates a new token without revoking the first` — spec scenario (multi-session)

**Refresh**
- [x] `POST /api/auth/refresh › 200 with new accessToken and refreshToken` — FRS-3.3.1
- [x] `POST /api/auth/refresh › 401 when presenting the old token after rotation` — FRS-3.3.2
- [x] `POST /api/auth/refresh › 401 on unknown token` — FRS-3.3.2
- [x] `POST /api/auth/refresh › 400 field error when refreshToken field missing` — spec scenario

**Logout**
- [x] `POST /api/auth/logout › 204 and token no longer accepted for refresh` — FRS-3.3.3
- [x] `POST /api/auth/logout › 401 on unknown token` — spec scenario

**Auth middleware**
- [x] `GET /api/protected-stub › 401 UNAUTHORIZED with no Authorization header` — FRS-3.3.4
- [x] `GET /api/protected-stub › 401 UNAUTHORIZED with malformed JWT` — FRS-3.3.4
- [x] `GET /api/protected-stub › 401 UNAUTHORIZED with expired JWT` — FRS-3.3.4
- [x] `GET /api/protected-stub › request passes through with valid JWT (req.userId attached)` — FRS-3.3.4

### ✅ Phase 4 checkpoint (final gate)
```bash
pnpm --filter backend test   # ALL green — unit + integration
pnpm -w build                # 0 errors, 0 warnings
pnpm -w lint                 # 0 errors
npx commitlint --from HEAD~1 # commit message valid
```

---

## Commit

```
feat(auth): implement register, login, logout, JWT + refresh token rotation

Delivers AB-1002: full session lifecycle including argon2id password
hashing, SHA-256 refresh token indexing, JWT access tokens (15 min),
rotating refresh tokens (7 days), auth middleware, and central error
handler. Unit + integration tests cover all FRS-3.1–3.3 scenarios.
```
