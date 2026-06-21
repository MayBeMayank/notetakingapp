# AB-1003 — Auth: Forgot Password + OTP Reset

## Why

AB-1002 delivered account creation and session management but left no recovery path when a user forgets their password. Without password reset, a locked-out user has no way back into their account. AB-1003 closes this gap by adding a two-step OTP-based reset flow, completing the core authentication surface before work begins on notes (AB-1004).

## What Changes

**FRS coverage:** §3.4 (FRS-3.4.1 through FRS-3.4.6)

**In scope:**
- `POST /api/auth/forgot-password` — accepts an email and issues a 6-digit OTP (logged to console; no email sent).
- `POST /api/auth/reset-password` — accepts email + OTP + new password, resets the password, and revokes all active refresh tokens.
- OTP lifecycle: creation, argon2 hashing, 10-minute TTL, 5-attempt cap, single-use invalidation, and replacement of an existing unexpired OTP on re-request.
- Anti-enumeration: `forgot-password` returns `{ ok: true }` regardless of whether the email is registered.
- New shared Zod schemas: `ForgotPasswordSchema`, `ResetPasswordSchema`.

**Out of scope:**
- Actual email delivery (OTP is console-logged only — FRS §10).
- Rate limiting on `forgot-password` (reserved for v2).
- Any change to registration or login behaviour.

## Capabilities

### New Capabilities
- `password-reset-otp`: Two-step password reset via a 6-digit console-logged OTP — covering request, validation, attempt capping, OTP replacement, and post-reset refresh-token revocation.

### Modified Capabilities
_(none)_

## Impact

### API Delta (from SDS §6.1)

| Method | Path | Request body | Success | Errors |
|--------|------|-------------|---------|--------|
| POST | `/api/auth/forgot-password` | `{ email }` | 200 `{ ok: true }` (always) | 400 (bad email format) |
| POST | `/api/auth/reset-password` | `{ email, otp, newPassword }` | 200 `{ ok: true }` | 400 (validation), 422 (bad/expired/used OTP or attempt cap reached) |

**Clarified decisions (confirmed during spec):**
- A new `forgot-password` request while an unexpired OTP exists **invalidates the old OTP** and issues a fresh one.
- The `otp` field is validated at the Zod layer as exactly 6 numeric digits → 400 if malformed.
- `newPassword` must satisfy the same policy as registration (≥ 8 chars, ≥ 1 letter + 1 number) → 400 if it fails.
- `POST /reset-password` returns `{ ok: true }` only — no tokens issued; user must log in after reset.

### DB Changes

The `PasswordResetOtp` model already exists in the Prisma schema (added in AB-1001). No new migration is required — the table is present and indexed. No new columns needed.

### Affected layers

| Layer | Change |
|-------|--------|
| `packages/shared` | Add `ForgotPasswordSchema`, `ResetPasswordSchema` Zod schemas and inferred types |
| `backend/src/routes` | Register two new auth routes (no-auth) |
| `backend/src/controllers` | `forgotPasswordController`, `resetPasswordController` |
| `backend/src/services` | `AuthService` — add `forgotPassword`, `resetPassword` methods |
| `backend/src/repositories` | `OtpRepository` — create, find-latest-active, invalidate, mark-consumed |
| `backend/src/lib` | OTP generation utility (6-digit crypto-random) |
| `backend/tests` | Unit tests for OTP attempt cap, expiry, replacement; integration tests for both endpoints |
