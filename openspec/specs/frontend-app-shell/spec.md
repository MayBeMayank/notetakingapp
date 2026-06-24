# frontend-app-shell Specification

## Purpose
TBD - created by archiving change AB-1010. Update Purpose after archive.
## Requirements
### Requirement: Application routing
The SPA SHALL expose the auth screens as public routes and SHALL gate everything else behind authentication, using `react-router-dom`.

#### Scenario: Public auth routes render without a session
- **WHEN** an unauthenticated visitor navigates to `/login`, `/register`, `/forgot-password`, or `/reset-password`
- **THEN** the corresponding screen renders without redirecting, and no access token is required

#### Scenario: Unknown route falls back
- **WHEN** a visitor navigates to a path that matches no defined route
- **THEN** the router redirects an unauthenticated visitor to `/login` and an authenticated visitor to the protected home placeholder

#### Scenario: Authenticated visitor on an auth route is redirected home
- **WHEN** a visitor who already holds a valid session opens `/login` or `/register`
- **THEN** the router redirects them to the protected home placeholder instead of showing the auth form

---

### Requirement: Auth session store
A Zustand store SHALL be the single source of client auth state. The access token SHALL live in memory only; the refresh token SHALL be persisted to `localStorage` so the session survives a page reload.

#### Scenario: Tokens stored on successful login
- **WHEN** a login succeeds and returns `{ accessToken, refreshToken, user }`
- **THEN** the store holds `accessToken` and `user` in memory and writes `refreshToken` to `localStorage`

#### Scenario: Session rehydrates after reload
- **WHEN** the app boots and a `refreshToken` is present in `localStorage` but no access token is in memory
- **THEN** the store is considered "pending refresh", and the first protected request (or an explicit bootstrap) exchanges the refresh token for a fresh access token before rendering protected content

#### Scenario: Reload with no stored refresh token is unauthenticated
- **WHEN** the app boots and `localStorage` has no `refreshToken`
- **THEN** the store reports no session and protected routes redirect to `/login`

#### Scenario: Session cleared on logout
- **WHEN** the session is cleared (logout or unrecoverable 401)
- **THEN** the in-memory access token and user are dropped and the `refreshToken` key is removed from `localStorage`

#### Scenario: Tokens are never logged
- **WHEN** the store reads, writes, or clears tokens
- **THEN** neither the access token nor the refresh token is written to the console or any log sink

---

### Requirement: Authenticated API client with token refresh
A single fetch wrapper SHALL perform all backend calls: it SHALL inject the access token, parse the standard error envelope, and transparently refresh an expired access token once before failing.

#### Scenario: Bearer token attached to protected calls
- **WHEN** the client issues a request to a protected endpoint and an access token is in memory
- **THEN** the request carries `Authorization: Bearer <accessToken>`

#### Scenario: 401 triggers a single refresh and retry
- **WHEN** a protected request returns 401 and a `refreshToken` is available
- **THEN** the client calls `POST /api/auth/refresh` once, stores the rotated `{ accessToken, refreshToken }` pair, and retries the original request exactly once with the new access token

#### Scenario: Failed refresh clears the session
- **WHEN** the `POST /api/auth/refresh` call during 401 recovery itself returns 401 (expired/revoked/unknown refresh token)
- **THEN** the client clears the session and redirects the user to `/login`, and does not retry the original request again

#### Scenario: Rotated refresh token replaces the old one
- **WHEN** a refresh succeeds and returns a new `refreshToken`
- **THEN** the new value replaces the prior one in `localStorage` (rotation), and the prior value is no longer used

#### Scenario: Error envelope parsed into a usable error
- **WHEN** any call returns a non-2xx response shaped as `{ error: { code, message, fields? } }`
- **THEN** the client surfaces `code`, `message`, and (when present) `fields[]` to the caller so forms can render field-level and form-level messages

#### Scenario: Concurrent 401s share one refresh
- **WHEN** multiple protected requests are in flight and more than one returns 401 at nearly the same time
- **THEN** only a single `/api/auth/refresh` call is made and all waiting requests retry with the resulting access token (no refresh stampede)

---

### Requirement: Protected route guard
A `ProtectedRoute` wrapper SHALL render authenticated content only for a valid session and SHALL otherwise redirect to login.

#### Scenario: Unauthenticated access redirected to login
- **WHEN** a visitor with no session navigates directly to a protected route
- **THEN** the guard redirects them to `/login`

#### Scenario: Authenticated access renders content
- **WHEN** a visitor with a valid session navigates to a protected route
- **THEN** the guard renders the protected content (the minimal authenticated home placeholder in this ticket)

#### Scenario: Pending rehydration shows a loading state
- **WHEN** a refresh token exists but the access token has not yet been obtained on boot
- **THEN** the guard shows a loading indicator until the refresh resolves, then either renders content (success) or redirects to `/login` (failure) — it does not flash the login page prematurely

