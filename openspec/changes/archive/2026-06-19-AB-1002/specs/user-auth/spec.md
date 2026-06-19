# Spec: user-auth
_Capability introduced by AB-1002_

---

## ADDED Requirements

---

### Requirement: User registration
A guest may create an account by supplying a valid email and password. The system stores only a secure hash of the password and returns the new user identity.

#### Scenario: Successful registration
- **WHEN** a guest POSTs `{ email: "alice@example.com", password: "Pass1234" }` to `/api/auth/register`
- **THEN** the system responds 201 with `{ user: { id, email, createdAt } }`, the email is stored lower-cased, and the password is stored as an argon2id hash (never plaintext)

#### Scenario: Duplicate email rejected
- **WHEN** a guest registers with an email already in use (case-insensitive match)
- **THEN** the system responds 422 with `{ error: { code: "DUPLICATE_EMAIL", message: "Email already registered" } }`

#### Scenario: Malformed email rejected
- **WHEN** a guest submits a registration with an email that fails RFC format validation (e.g. `"notanemail"`)
- **THEN** the system responds 400 with `{ error: { code: "VALIDATION_ERROR", fields: [{ field: "email", message: "…" }] } }`

#### Scenario: Weak password rejected — too short
- **WHEN** a guest submits a password shorter than 8 characters (e.g. `"Ab1"`)
- **THEN** the system responds 400 with a field-level error on `password` describing the minimum length requirement

#### Scenario: Weak password rejected — missing letter
- **WHEN** a guest submits a password of 8+ characters containing only digits (e.g. `"12345678"`)
- **THEN** the system responds 400 with a field-level error on `password` describing the letter requirement

#### Scenario: Weak password rejected — missing number
- **WHEN** a guest submits a password of 8+ characters containing only letters (e.g. `"abcdefgh"`)
- **THEN** the system responds 400 with a field-level error on `password` describing the number requirement

#### Scenario: Missing required field
- **WHEN** a guest submits a registration body missing `email` or `password`
- **THEN** the system responds 400 with a field-level error for each missing field

#### Scenario: Password never appears in response or logs
- **WHEN** any registration attempt succeeds or fails
- **THEN** the response body and server logs MUST NOT contain the plaintext password or the argon2 hash

---

### Requirement: User login
A registered user may authenticate with their email and password to receive a short-lived access token and a rotating refresh token.

#### Scenario: Successful login
- **WHEN** a registered user POSTs `{ email, password }` to `/api/auth/login` with correct credentials
- **THEN** the system responds 200 with `{ accessToken, refreshToken, user: { id, email, createdAt } }`, where `accessToken` is a signed JWT expiring in 15 minutes and `refreshToken` is an opaque 32-byte base64url value

#### Scenario: Login is additive — existing sessions survive
- **WHEN** a user logs in while already holding a valid refresh token from another device
- **THEN** a new `RefreshToken` row is created without revoking the previous one (multi-device support)

#### Scenario: Wrong password rejected
- **WHEN** a user submits a correct email with an incorrect password
- **THEN** the system responds 401 with `{ error: { code: "UNAUTHORIZED", message: "Invalid email or password" } }` (no field-level hint about which value was wrong)

#### Scenario: Unknown email rejected
- **WHEN** a guest submits an email that is not registered
- **THEN** the system responds 401 with the same generic `"Invalid email or password"` message (no existence leak)

#### Scenario: Email lookup is case-insensitive
- **WHEN** a user logs in with `"ALICE@EXAMPLE.COM"` but registered as `"alice@example.com"`
- **THEN** the system resolves the account and responds 200 (email is lower-cased before lookup)

#### Scenario: Refresh token persisted as hash only
- **WHEN** a login succeeds and a refresh token is issued
- **THEN** only the argon2id hash of the opaque token value is stored in `RefreshToken.tokenHash`; the plaintext token is never persisted or logged

---

### Requirement: Refresh token rotation
A client holding a valid refresh token may exchange it for a new access token and a new refresh token; the old refresh token is revoked atomically.

#### Scenario: Successful token refresh
- **WHEN** a client POSTs `{ refreshToken }` to `/api/auth/refresh` with a valid, non-expired, non-revoked token
- **THEN** the system responds 200 with `{ accessToken, refreshToken }`, the old `RefreshToken` row is marked `revokedAt = now()`, and a new `RefreshToken` row is inserted

#### Scenario: Expired refresh token rejected
- **WHEN** a client presents a refresh token whose `expiresAt` is in the past
- **THEN** the system responds 401 with `{ error: { code: "UNAUTHORIZED", message: "…" } }`

#### Scenario: Revoked refresh token rejected
- **WHEN** a client presents a refresh token that has already been revoked (e.g. used once before)
- **THEN** the system responds 401; no other tokens for that user are affected (no full-session sweep)

#### Scenario: Unknown refresh token rejected
- **WHEN** a client presents a token string that matches no row in `RefreshToken`
- **THEN** the system responds 401

#### Scenario: Malformed request rejected
- **WHEN** the request body is missing `refreshToken` or it is not a string
- **THEN** the system responds 400 with a field-level validation error

---

### Requirement: Logout / token revocation
A client may explicitly revoke a refresh token so it can no longer be used to mint access tokens.

#### Scenario: Successful logout
- **WHEN** an authenticated client POSTs `{ refreshToken }` to `/api/auth/logout` with a valid token
- **THEN** the system responds 204 and sets `revokedAt = now()` on the matching `RefreshToken` row

#### Scenario: Subsequent refresh rejected after logout
- **WHEN** a client presents the same refresh token after a successful logout
- **THEN** the system responds 401 on the `/api/auth/refresh` call

#### Scenario: Logout with unrecognized token
- **WHEN** a client POSTs an unknown or already-revoked `refreshToken` to `/api/auth/logout`
- **THEN** the system responds 401 (idempotent revocation is not required; unknown token = error)

---

### Requirement: Auth middleware — protected route enforcement
Every route except the public auth endpoints requires a valid, non-expired JWT. The middleware attaches `req.userId` for downstream layers.

#### Scenario: Valid token passes through
- **WHEN** a request carries `Authorization: Bearer <valid-jwt>` on a protected route
- **THEN** the middleware attaches `req.userId` from the token's `sub` claim and forwards the request

#### Scenario: Missing Authorization header rejected
- **WHEN** a request to a protected route has no `Authorization` header
- **THEN** the middleware responds 401 with `{ error: { code: "UNAUTHORIZED", message: "…" } }` and the route handler is not called

#### Scenario: Malformed Bearer token rejected
- **WHEN** the `Authorization` header is present but the JWT is syntactically invalid (tampered, wrong structure)
- **THEN** the middleware responds 401

#### Scenario: Expired JWT rejected
- **WHEN** the JWT's `exp` claim is in the past
- **THEN** the middleware responds 401 with the same generic `UNAUTHORIZED` code (token state not leaked)

#### Scenario: Public routes bypass the middleware
- **WHEN** a request targets `POST /api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/forgot-password`, `/api/auth/reset-password`, or `GET /api/public/notes/:token`
- **THEN** no JWT is required and the middleware is not applied to those routes
