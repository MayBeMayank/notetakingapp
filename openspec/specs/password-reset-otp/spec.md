# password-reset-otp Specification

## Purpose
TBD - created by archiving change AB-1003. Update Purpose after archive.
## Requirements
### Requirement: Forgot-password request
The system SHALL accept a forgot-password request where a guest submits their email address, generate a 6-digit OTP, store its argon2 hash in `PasswordResetOtp`, and log the plaintext code to the server console. No email SHALL be sent.

#### Scenario: Valid registered email submitted
- **WHEN** `POST /api/auth/forgot-password` is called with a well-formed email that matches a registered user
- **THEN** a new `PasswordResetOtp` row is created (`attempts = 0`, `expiresAt = now + 10 min`, `consumedAt = null`), the plaintext 6-digit OTP is written to the server console, and the response is `200 { ok: true }`

#### Scenario: Email not registered (anti-enumeration — FRS-3.4.3)
- **WHEN** `POST /api/auth/forgot-password` is called with a well-formed email that does NOT match any user
- **THEN** no OTP row is created, no console output is produced, and the response is still `200 { ok: true }` (identical to the registered-email case)

#### Scenario: Malformed email format
- **WHEN** `POST /api/auth/forgot-password` is called with a value that fails Zod email validation (e.g. `"notanemail"`)
- **THEN** the response is `400` with `fields[{ field: "email", message: "…" }]`

#### Scenario: New request while an unexpired OTP exists
- **WHEN** `POST /api/auth/forgot-password` is called for a user who already has an active (non-expired, non-consumed) `PasswordResetOtp` row
- **THEN** the existing OTP row is invalidated (e.g. `expiresAt` set to past or record soft-deleted), a new OTP row is created, and the new code is logged to the console — `200 { ok: true }` returned

---

### Requirement: Reset password with OTP
The system SHALL accept a reset-password request where a guest submits their email, the OTP they received, and a new password. If the OTP is valid, the system SHALL update the password, mark the OTP as consumed, and revoke all refresh tokens for that user.

#### Scenario: Correct, unexpired, unused OTP (FRS-3.4.4)
- **WHEN** `POST /api/auth/reset-password` is called with `{ email, otp, newPassword }` where the OTP matches the stored hash, has not expired, and has not been consumed
- **THEN** the user's `passwordHash` is updated with argon2id of `newPassword`, the `PasswordResetOtp` row is marked consumed (`consumedAt = now()`), all `RefreshToken` rows for that user are revoked, and the response is `200 { ok: true }`

#### Scenario: Incorrect OTP increments attempt counter (FRS-3.4.5)
- **WHEN** `POST /api/auth/reset-password` is called with an OTP that does NOT match the stored hash and the current `attempts` count is below 5
- **THEN** `attempts` is incremented by 1 on the `PasswordResetOtp` row and the response is `422` with error code `INVALID_OTP`

#### Scenario: OTP invalidated after 5 failed attempts (FRS-3.4.5)
- **WHEN** `POST /api/auth/reset-password` is called with a wrong OTP and `attempts` is already 4 (i.e. this is the 5th failed attempt)
- **THEN** `attempts` becomes 5, the OTP row is invalidated (treated as consumed/expired so it can no longer be used), and the response is `422` with error code `OTP_ATTEMPT_LIMIT_REACHED`

#### Scenario: Expired OTP rejected (FRS-3.4.5)
- **WHEN** `POST /api/auth/reset-password` is called with an OTP whose `expiresAt` is in the past
- **THEN** the response is `422` with error code `OTP_EXPIRED` and no password change occurs

#### Scenario: Already-used OTP rejected (FRS-3.4.5)
- **WHEN** `POST /api/auth/reset-password` is called with an OTP whose `consumedAt` is not null
- **THEN** the response is `422` with error code `INVALID_OTP` and no password change occurs

#### Scenario: No active OTP found for email (FRS-3.4.5)
- **WHEN** `POST /api/auth/reset-password` is called with an email that has no `PasswordResetOtp` row (or all rows are consumed/invalidated)
- **THEN** the response is `422` with error code `INVALID_OTP` (same shape as wrong-OTP; no account-existence leak)

#### Scenario: Refresh tokens revoked on success (FRS-3.4.6)
- **WHEN** a password reset completes successfully
- **THEN** all `RefreshToken` rows for that user have `revokedAt` set (or are deleted), making any in-flight refresh token permanently invalid

#### Scenario: No token pair in response
- **WHEN** a password reset completes successfully
- **THEN** the response body is exactly `{ ok: true }` — no `accessToken` or `refreshToken` is issued; the user must call `POST /login` to obtain a new session

---

### Requirement: OTP validation at schema layer
The system SHALL validate the `otp` field as exactly 6 numeric digits in the shared Zod schema before any DB or argon2 operation is attempted.

#### Scenario: OTP field is not 6 digits (Zod boundary — 400)
- **WHEN** `POST /api/auth/reset-password` is called with an `otp` value that is not exactly 6 numeric digit characters (e.g. `"abc"`, `"12345"`, `"1234567"`, `""`)
- **THEN** the response is `400` with `fields[{ field: "otp", message: "…" }]` — no DB lookup is performed

---

### Requirement: New-password policy on reset
The system SHALL enforce that the `newPassword` field in `POST /api/auth/reset-password` satisfies the same password policy as registration: ≥ 8 characters, ≥ 1 letter, ≥ 1 number.

#### Scenario: Weak new password (Zod boundary — 400)
- **WHEN** `POST /api/auth/reset-password` is called with a `newPassword` that fails the policy (too short, no digit, no letter)
- **THEN** the response is `400` with `fields[{ field: "newPassword", message: "…" }]` — the OTP is NOT consumed and no password change occurs

---

### Requirement: OTP is single-use and cryptographically secure (FRS-3.4.2)
The system SHALL generate OTP as a 6-digit numeric code via a cryptographically secure source and SHALL persist only its argon2id hash, never the plaintext code.

#### Scenario: OTP stored as hash only
- **WHEN** a `PasswordResetOtp` row is created
- **THEN** the `codeHash` column contains the argon2id hash of the OTP — the plaintext 6-digit code is never written to the database or included in any response

#### Scenario: Console log is the only delivery channel
- **WHEN** a valid forgot-password request is processed
- **THEN** the plaintext OTP is written to `process.stdout` / server console, and no email, webhook, or other external channel is invoked

