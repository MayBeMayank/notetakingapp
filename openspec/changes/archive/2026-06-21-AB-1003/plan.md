# Technical Plan — AB-1003: Forgot Password + OTP Reset

## Overview

Two new public auth endpoints. No new Prisma models (PasswordResetOtp already exists). Changes touch shared schemas, the auth repository, service, controller, and routes — all following the same layering established in AB-1002.

---

## Architecture Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| OTP lookup strategy | Find by `userId` first, then argon2-verify | argon2 is slow and non-invertible; can't query by hash like SHA256. Find the latest active row for the user, then verify the submitted code against its `codeHash`. |
| OTP hashing algorithm | argon2id via existing `hashPassword` / `verifyPassword` | SDS §4 explicitly specifies argon2 for OTPs. The existing `hashToken` (SHA256) is for high-throughput refresh token lookup; OTPs are low-frequency so argon2's cost is acceptable. |
| OTP generation | `crypto.randomInt(0, 1_000_000)` padded to 6 digits | Cryptographically uniform, produces exactly 6 digits (with leading-zero padding), fits `generateOtp()` in `lib/token.ts`. |
| Invalidating old OTPs on re-request | `UPDATE ... SET consumedAt = now() WHERE userId = ... AND consumedAt IS NULL AND expiresAt > now()` | Treat replacement as a soft-consume so existing validity queries (consumedAt IS NULL) automatically exclude stale rows. |
| Error mapping | `ConflictError` (→ 422) for all OTP business failures | Matches AB-1002 pattern; ConflictError already maps to 422 in error middleware. |
| No new error class | Use `ConflictError` with distinct `code` strings | Three distinct codes: `INVALID_OTP`, `OTP_EXPIRED`, `OTP_ATTEMPT_LIMIT_REACHED`. |
| Refresh token revocation on reset | `updateMany` scoped to `userId` in the same service call | FRS-3.4.6; matches the `revokeAllUserRefreshTokens` pattern that likely already exists in auth.repository or can be added there. |

---

## Files to Create

| File | Description |
|---|---|
| `backend/tests/unit/auth.otp.service.test.ts` | Vitest unit tests for `forgotPassword` and `resetPassword` service methods |
| `backend/tests/integration/auth.otp.routes.test.ts` | Supertest integration tests for both endpoints |

---

## Files to Modify

| File | Change |
|---|---|
| `packages/shared/src/schemas/auth.ts` | Add `ForgotPasswordSchema`, `ResetPasswordSchema`, inferred types |
| `backend/src/lib/token.ts` | Add `generateOtp(): string` |
| `backend/src/repositories/auth.repository.ts` | Add 5 OTP repository methods |
| `backend/src/services/auth.service.ts` | Add `forgotPassword`, `resetPassword` methods |
| `backend/src/controllers/auth.controller.ts` | Add `forgotPassword`, `resetPassword` handlers |
| `backend/src/routes/auth.routes.ts` | Register two new public routes |

---

## DB Changes

**None.** The `PasswordResetOtp` model and its indexes already exist in `schema.prisma` (added in AB-1001). No migration required.

---

## Detailed Changes

### 1. `packages/shared/src/schemas/auth.ts` — add at bottom

```typescript
// ── Forgot password ──────────────────────────────────────────────────────────

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Must be a valid email'),
})

export const ForgotPasswordResponseSchema = z.object({
  ok: z.literal(true),
})

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>
export type ForgotPasswordResponse = z.infer<typeof ForgotPasswordResponseSchema>

// ── Reset password ───────────────────────────────────────────────────────────

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number')

export const ResetPasswordSchema = z.object({
  email: z.string().email('Must be a valid email'),
  otp: z
    .string()
    .regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
  newPassword: passwordSchema,
})

export const ResetPasswordResponseSchema = z.object({
  ok: z.literal(true),
})

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponseSchema>
```

**Note:** The `passwordSchema` refinement is extracted and reused between `RegisterSchema` and `ResetPasswordSchema` so the policy is defined once. If `RegisterSchema` currently inlines the refinements, refactor to share the extracted `passwordSchema` constant.

---

### 2. `backend/src/lib/token.ts` — add `generateOtp`

```typescript
export function generateOtp(): string {
  // crypto.randomInt is cryptographically secure and uniformly distributed
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}
```

---

### 3. `backend/src/repositories/auth.repository.ts` — add OTP methods

```typescript
// ── OTP ─────────────────────────────────────────────────────────────────────

export async function invalidatePendingOtps(userId: string): Promise<void> {
  await prisma.passwordResetOtp.updateMany({
    where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  })
}

export async function createPasswordResetOtp(data: {
  userId: string
  codeHash: string
  expiresAt: Date
}): Promise<PasswordResetOtp> {
  return prisma.passwordResetOtp.create({ data })
}

export async function findLatestActiveOtp(
  userId: string,
): Promise<PasswordResetOtp | null> {
  return prisma.passwordResetOtp.findFirst({
    where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function incrementOtpAttempts(id: string): Promise<void> {
  await prisma.passwordResetOtp.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  })
}

export async function consumeOtp(id: string): Promise<void> {
  await prisma.passwordResetOtp.update({
    where: { id },
    data: { consumedAt: new Date() },
  })
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
```

**Note:** Check if `revokeAllUserRefreshTokens` already exists in the repository (it may have been added for logout or password-change flows in AB-1002). If so, reuse it; do not duplicate.

---

### 4. `backend/src/services/auth.service.ts` — add two methods

```typescript
const OTP_TTL_MS = 10 * 60 * 1000  // 10 minutes

export async function forgotPassword(
  input: ForgotPasswordInput,
): Promise<ForgotPasswordResponse> {
  const email = input.email.toLowerCase()
  const user = await authRepo.findUserByEmail(email)

  if (!user) {
    // Anti-enumeration: behave identically when email is unknown (FRS-3.4.3)
    return { ok: true }
  }

  // Invalidate any existing pending OTPs for this user (spec: replace, not coexist)
  await authRepo.invalidatePendingOtps(user.id)

  const rawOtp = generateOtp()
  const codeHash = await hashPassword(rawOtp)  // argon2id per SDS §4
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await authRepo.createPasswordResetOtp({ userId: user.id, codeHash, expiresAt })

  // Delivery: console only — no email (FRS §10)
  console.log(`[OTP] Reset code for ${email}: ${rawOtp}`)

  return { ok: true }
}

const OTP_MAX_ATTEMPTS = 5

export async function resetPassword(
  input: ResetPasswordInput,
): Promise<ResetPasswordResponse> {
  const email = input.email.toLowerCase()
  const user = await authRepo.findUserByEmail(email)

  if (!user) {
    throw new ConflictError('INVALID_OTP', 'Invalid or expired OTP')
  }

  const otpRecord = await authRepo.findLatestActiveOtp(user.id)

  if (!otpRecord) {
    throw new ConflictError('INVALID_OTP', 'Invalid or expired OTP')
  }

  // Check attempt cap before verifying (count this attempt)
  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    throw new ConflictError('OTP_ATTEMPT_LIMIT_REACHED', 'Too many incorrect attempts; request a new code')
  }

  const isValid = await verifyPassword(otpRecord.codeHash, input.otp)

  if (!isValid) {
    await authRepo.incrementOtpAttempts(otpRecord.id)
    // If this increment brings attempts to the cap, the next call will be blocked above
    throw new ConflictError('INVALID_OTP', 'Invalid or expired OTP')
  }

  // OTP is valid — consume it, update password, revoke all refresh tokens
  await authRepo.consumeOtp(otpRecord.id)

  const newPasswordHash = await hashPassword(input.newPassword)
  await authRepo.updateUserPassword(user.id, newPasswordHash)

  await authRepo.revokeAllUserRefreshTokens(user.id)

  return { ok: true }
}
```

**Note:** `updateUserPassword` — check if this already exists in auth.repository. If not, add:
```typescript
export async function updateUserPassword(id: string, passwordHash: string): Promise<void> {
  await prisma.user.update({ where: { id }, data: { passwordHash } })
}
```

---

### 5. `backend/src/controllers/auth.controller.ts` — add two handlers

```typescript
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const result = await authService.forgotPassword(req.body)
  res.status(200).json(result)
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const result = await authService.resetPassword(req.body)
  res.status(200).json(result)
}
```

---

### 6. `backend/src/routes/auth.routes.ts` — register routes

```typescript
authRouter.post(
  '/forgot-password',
  validateBody(ForgotPasswordSchema),
  authController.forgotPassword,
)
authRouter.post(
  '/reset-password',
  validateBody(ResetPasswordSchema),
  authController.resetPassword,
)
```

Both routes are public (no `authMiddleware`).

---

## OTP Attempt-Cap Logic (detail)

The cap is applied at the **start** of `resetPassword` using the persisted `attempts` count:

```
request arrives with attempts = 4
  → 4 < 5, proceed to argon2 verify
  → wrong OTP → incrementOtpAttempts → attempts becomes 5
  → throw INVALID_OTP

next request arrives with attempts = 5
  → 5 >= 5 → throw OTP_ATTEMPT_LIMIT_REACHED immediately (no verify)
```

This means the 5th wrong attempt returns `INVALID_OTP` (the attempt was still processed), and the 6th+ return `OTP_ATTEMPT_LIMIT_REACHED`. This matches the spec scenario: "after 5 failed attempts the OTP SHALL be invalidated."

---

## Tests

### Unit tests — `backend/tests/unit/auth.otp.service.test.ts`

| Test name | Scenario |
|---|---|
| `forgotPassword - returns ok:true for registered email` | Happy path, OTP created |
| `forgotPassword - returns ok:true for unknown email (anti-enumeration)` | No user, same response |
| `forgotPassword - invalidates existing OTP before creating new one` | Replace behaviour |
| `resetPassword - succeeds with valid OTP` | Happy path, password changed, tokens revoked |
| `resetPassword - throws INVALID_OTP for wrong code` | Increments attempts |
| `resetPassword - throws OTP_ATTEMPT_LIMIT_REACHED when attempts >= 5` | Cap enforced |
| `resetPassword - throws INVALID_OTP for unknown email` | No account-enumeration |
| `resetPassword - throws INVALID_OTP when no active OTP exists` | consumedAt or expired |

### Integration tests — `backend/tests/integration/auth.otp.routes.test.ts`

| Test name | Assert |
|---|---|
| `POST /forgot-password 200 for registered email` | `{ ok: true }`, status 200 |
| `POST /forgot-password 200 for unknown email` | `{ ok: true }`, status 200 |
| `POST /forgot-password 400 on invalid email format` | status 400 + fields |
| `POST /reset-password 200 on correct OTP` | status 200, password changed (verify by login) |
| `POST /reset-password 422 on wrong OTP` | status 422, code INVALID_OTP |
| `POST /reset-password 422 after 5 failed attempts` | status 422, code OTP_ATTEMPT_LIMIT_REACHED |
| `POST /reset-password 422 on expired OTP` | status 422, code INVALID_OTP |
| `POST /reset-password 422 on consumed OTP` | status 422, code INVALID_OTP |
| `POST /reset-password 400 with non-6-digit OTP` | status 400 + fields[otp] |
| `POST /reset-password 400 with weak newPassword` | status 400 + fields[newPassword] |
| `POST /reset-password - refresh tokens revoked on success` | old token rejected after reset |

---

## Build / Test Checkpoints

Run these in order after each layer is complete:

```bash
# 1. After shared schema changes:
pnpm --filter @note-app/shared build

# 2. After backend changes:
pnpm --filter backend build        # 0 TypeScript errors

# 3. Before commit:
pnpm -w lint                       # 0 errors
pnpm --filter backend test         # all green (unit + integration)
pnpm -w build                      # full workspace build clean
```

---

## Traceability

| FRS | Implemented by |
|---|---|
| FRS-3.4.1 | `forgotPassword` service + `POST /forgot-password` route |
| FRS-3.4.2 | `generateOtp()` in lib/token, argon2 hash in repo, `console.log` delivery |
| FRS-3.4.3 | Early return `{ ok: true }` when user not found |
| FRS-3.4.4 | `resetPassword` service: verify OTP, update password, consume row |
| FRS-3.4.5 | `incrementOtpAttempts`, attempt-cap check, `OTP_ATTEMPT_LIMIT_REACHED` |
| FRS-3.4.6 | `revokeAllUserRefreshTokens` called on successful reset |
