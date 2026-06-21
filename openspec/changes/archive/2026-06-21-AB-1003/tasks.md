# Tasks — AB-1003: Forgot Password + OTP Reset

> Track progress by checking off `- [ ]` → `- [x]` after each task passes its checkpoint.

---

## Phase 1 — Foundation

> Goal: shared types compile cleanly; `generateOtp` utility available; no DB migration needed.

- [x] **T1.1** — Extract `passwordSchema` refinement in `packages/shared/src/schemas/auth.ts` into a shared constant so `RegisterSchema` and the upcoming `ResetPasswordSchema` reuse the exact same policy definition
- [x] **T1.2** — Add `ForgotPasswordSchema` and `ForgotPasswordResponse` schema + inferred types to `packages/shared/src/schemas/auth.ts`
- [x] **T1.3** — Add `ResetPasswordSchema` and `ResetPasswordResponse` schema + inferred types to `packages/shared/src/schemas/auth.ts` (reuse `passwordSchema` from T1.1; `otp` field: `/^\d{6}$/`)
- [x] **T1.4** — Add `generateOtp(): string` to `backend/src/lib/token.ts` using `crypto.randomInt(0, 1_000_000)` padded to 6 digits

**Phase 1 checkpoint:**
```bash
pnpm --filter @note-app/shared build   # 0 errors
pnpm -w lint                           # 0 warnings
```

---

## Phase 2 — Core Implementation

> These tasks are sequential: T2.1+T2.2 both edit `auth.repository.ts`; T2.3+T2.4 both edit `auth.service.ts` and depend on T2.1+T2.2 being present to compile.

- [x] **T2.1** — Add OTP repository methods to `backend/src/repositories/auth.repository.ts`:
  - `invalidatePendingOtps(userId: string): Promise<void>` — sets `consumedAt = now()` on all non-consumed, non-expired rows for the user
  - `createPasswordResetOtp(data: { userId, codeHash, expiresAt }): Promise<PasswordResetOtp>`
  - `findLatestActiveOtp(userId: string): Promise<PasswordResetOtp | null>` — non-consumed, non-expired, ordered by `createdAt DESC`
  - `incrementOtpAttempts(id: string): Promise<void>` — `{ increment: 1 }` on `attempts`
  - `consumeOtp(id: string): Promise<void>` — sets `consumedAt = now()`

- [x] **T2.2** — Check if `revokeAllUserRefreshTokens(userId)` and `updateUserPassword(id, passwordHash)` already exist in `auth.repository.ts`; add whichever are missing

- [x] **T2.3** — Implement `forgotPassword(input: ForgotPasswordInput): Promise<ForgotPasswordResponse>` in `backend/src/services/auth.service.ts`:
  - Lowercase email, look up user
  - If user not found: return `{ ok: true }` immediately (anti-enumeration)
  - Call `invalidatePendingOtps(user.id)`
  - `generateOtp()` → `hashPassword(rawOtp)` (argon2id) → `createPasswordResetOtp`
  - `console.log` the raw OTP (console-only delivery)
  - Return `{ ok: true }`

- [x] **T2.4** — Implement `resetPassword(input: ResetPasswordInput): Promise<ResetPasswordResponse>` in `backend/src/services/auth.service.ts`:
  - Lowercase email, look up user; if not found → `throw new ConflictError('INVALID_OTP', ...)`
  - `findLatestActiveOtp(user.id)`; if null → `throw new ConflictError('INVALID_OTP', ...)`
  - If `otpRecord.attempts >= 5` → `throw new ConflictError('OTP_ATTEMPT_LIMIT_REACHED', ...)`
  - `verifyPassword(otpRecord.codeHash, input.otp)`; if false → `incrementOtpAttempts` → `throw new ConflictError('INVALID_OTP', ...)`
  - `consumeOtp`, `updateUserPassword(hashPassword(input.newPassword))`, `revokeAllUserRefreshTokens`
  - Return `{ ok: true }`

**Phase 2 checkpoint:**
```bash
pnpm --filter backend build   # 0 TypeScript errors
pnpm -w lint                  # 0 warnings
```

---

## Phase 3 — Integration

- [x] **T3.1** — Add `forgotPassword` and `resetPassword` async handlers to `backend/src/controllers/auth.controller.ts`; both respond `200 json(result)`
- [x] **T3.2** — Register two new public routes in `backend/src/routes/auth.routes.ts` (no `authMiddleware`):
  - `POST /forgot-password` → `validateBody(ForgotPasswordSchema)`, `authController.forgotPassword`
  - `POST /reset-password` → `validateBody(ResetPasswordSchema)`, `authController.resetPassword`

**Phase 3 checkpoint:**
```bash
pnpm -w build    # full workspace, 0 errors
pnpm -w lint     # 0 warnings
```

---

## Phase 4 — Tests

> One test per spec scenario. Map to `openspec/changes/AB-1003/specs/password-reset-otp/spec.md`.

### Unit tests — `backend/tests/unit/auth.otp.service.test.ts`

- [x] **T4.1** — `forgotPassword › returns { ok: true } for a registered email` (OTP row created, console logged)
- [x] **T4.2** — `forgotPassword › returns { ok: true } for an unregistered email` (no DB write, same response — FRS-3.4.3)
- [x] **T4.3** — `forgotPassword › invalidates existing pending OTP before issuing a new one` (replacement behaviour)
- [x] **T4.4** — `resetPassword › succeeds with a correct, unexpired, unused OTP` (password updated, OTP consumed, refresh tokens revoked — FRS-3.4.4 + 3.4.6)
- [x] **T4.5** — `resetPassword › throws INVALID_OTP and increments attempts for a wrong OTP` (attempts < 5 — FRS-3.4.5)
- [x] **T4.6** — `resetPassword › throws OTP_ATTEMPT_LIMIT_REACHED when attempts already at 5` (cap enforced — FRS-3.4.5)
- [x] **T4.7** — `resetPassword › throws INVALID_OTP for an unregistered email` (no account enumeration)
- [x] **T4.8** — `resetPassword › throws INVALID_OTP when no active OTP row exists` (consumed or expired)

### Integration tests — `backend/tests/integration/auth.otp.routes.test.ts`

- [x] **T4.9** — `POST /forgot-password › 200 { ok: true } for a registered email`
- [x] **T4.10** — `POST /forgot-password › 200 { ok: true } for an unknown email` (identical response — FRS-3.4.3)
- [x] **T4.11** — `POST /forgot-password › 400 with fields[email] for a malformed email`
- [x] **T4.12** — `POST /reset-password › 200 { ok: true } on correct OTP; subsequent login with new password succeeds`
- [x] **T4.13** — `POST /reset-password › 422 INVALID_OTP on a wrong OTP`
- [x] **T4.14** — `POST /reset-password › 422 OTP_ATTEMPT_LIMIT_REACHED after 5 failed attempts`
- [x] **T4.15** — `POST /reset-password › 422 INVALID_OTP for an expired OTP`
- [x] **T4.16** — `POST /reset-password › 422 INVALID_OTP for an already-consumed OTP`
- [x] **T4.17** — `POST /reset-password › 400 with fields[otp] when otp is not 6 numeric digits`
- [x] **T4.18** — `POST /reset-password › 400 with fields[newPassword] for a weak new password`
- [x] **T4.19** — `POST /reset-password › refresh tokens are revoked; old token rejected after successful reset` (FRS-3.4.6)

**Phase 4 checkpoint:**
```bash
pnpm --filter backend test   # all 19 tests green
pnpm -w build                # 0 errors
pnpm -w lint                 # 0 warnings
```

---

## Final Pre-Commit Gate

```bash
pnpm -w lint                  # zero errors
pnpm --filter backend test    # all green
pnpm -w build                 # zero TypeScript errors
npx commitlint --from HEAD~1  # passes
```
