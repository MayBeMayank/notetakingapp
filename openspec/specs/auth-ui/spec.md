# auth-ui Specification

## Purpose
TBD - created by archiving change AB-1010. Update Purpose after archive.
## Requirements
### Requirement: Registration screen
A guest SHALL be able to create an account from `/register`. The form SHALL validate client-side before submit, map backend errors to the correct fields, and route to login on success (registration does not establish a session).

#### Scenario: Successful registration routes to login
- **WHEN** a guest submits a valid email and a policy-compliant password and the backend responds 201 `{ user }`
- **THEN** the app navigates to `/login` and shows a success notice prompting the user to sign in; no token is stored (the register response carries none)

#### Scenario: Client-side validation blocks submit
- **WHEN** the guest enters a malformed email or a password failing the policy (< 8 chars, or missing a letter, or missing a number)
- **THEN** the form shows inline per-field messages from `RegisterSchema` and does not call the backend

#### Scenario: Duplicate email surfaced
- **WHEN** the backend responds 422 with `{ error: { code: "DUPLICATE_EMAIL" } }`
- **THEN** the form shows a message that the email is already registered, anchored to the email field, and the user remains on `/register`

#### Scenario: Server field errors mapped
- **WHEN** the backend responds 400 with `{ error: { fields: [{ field, message }] } }`
- **THEN** each `field`/`message` pair is rendered against its corresponding input

#### Scenario: Submit is disabled while pending
- **WHEN** a registration request is in flight
- **THEN** the submit control is disabled and a pending state is shown, preventing duplicate submissions

#### Scenario: Password is never logged
- **WHEN** the registration form handles input or errors
- **THEN** the plaintext password is never written to the console or any log

---

### Requirement: Login screen
A registered user SHALL be able to sign in from `/login`. On success the session SHALL be established and the user SHALL land on the protected home; bad credentials SHALL produce a single generic message.

#### Scenario: Successful login establishes a session
- **WHEN** the user submits correct credentials and the backend responds 200 `{ accessToken, refreshToken, user }`
- **THEN** the tokens are stored per the session policy (access in memory, refresh in localStorage) and the app navigates to the protected home placeholder

#### Scenario: Invalid credentials show a generic message
- **WHEN** the backend responds 401 (wrong password or unknown email)
- **THEN** the form shows a single generic "Invalid email or password" message that does not indicate which field was wrong, and the user stays on `/login`

#### Scenario: Client-side validation blocks submit
- **WHEN** the email is malformed or the password is empty
- **THEN** inline validation from `LoginSchema` blocks the request

#### Scenario: Submit is disabled while pending
- **WHEN** a login request is in flight
- **THEN** the submit control is disabled and a pending state is shown

#### Scenario: Links to register and forgot-password
- **WHEN** the login screen is displayed
- **THEN** it offers navigation to `/register` and `/forgot-password`

---

### Requirement: Logout control
An authenticated user SHALL be able to sign out, which SHALL revoke the refresh token server-side and clear the client session.

#### Scenario: Successful logout
- **WHEN** the user activates the logout control and the backend responds 204 to `POST /api/auth/logout` with the stored refresh token
- **THEN** the client session is cleared (access token dropped, refresh token removed from localStorage) and the user is redirected to `/login`

#### Scenario: Session cleared even if logout call fails
- **WHEN** the logout request returns a non-2xx response (e.g. the token was already revoked)
- **THEN** the client still clears the local session and redirects to `/login`, so the browser is never left in a stale authenticated state

#### Scenario: Protected routes inaccessible after logout
- **WHEN** the user navigates to a protected route after logging out
- **THEN** the guard redirects to `/login`

---

### Requirement: Forgot-password screen
A guest SHALL be able to request a reset code from `/forgot-password`. The response SHALL be identical whether or not the email exists (anti-enumeration), and the flow SHALL hand off to the reset screen.

#### Scenario: Identical confirmation regardless of email existence
- **WHEN** the guest submits any well-formed email and the backend responds 200 `{ ok: true }`
- **THEN** the screen shows a neutral confirmation that does not reveal whether an account exists, worded so the user knows to proceed with the code that was "sent"

#### Scenario: Hand-off to reset screen with email prefilled
- **WHEN** the forgot-password request succeeds
- **THEN** the app routes to `/reset-password` carrying the entered email so it is prefilled (and still editable) on the reset form

#### Scenario: Client-side email validation
- **WHEN** the guest submits a malformed email
- **THEN** inline validation from `ForgotPasswordSchema` blocks the request

#### Scenario: Dev-mode code hint
- **WHEN** the confirmation is shown
- **THEN** the UI conveys that the code was delivered out-of-band (in dev, logged to the server console — no email is sent), without leaking account existence

---

### Requirement: Reset-password screen
A guest SHALL be able to set a new password from `/reset-password` by supplying their email, the 6-digit OTP, and a new password. Bad, expired, or exhausted OTPs SHALL be surfaced clearly.

#### Scenario: Successful reset routes to login
- **WHEN** the guest submits a valid email, a correct unexpired 6-digit OTP, and a policy-compliant new password, and the backend responds 200 `{ ok: true }`
- **THEN** the app navigates to `/login` with a success notice; the user can sign in with the new password

#### Scenario: Client-side validation of OTP and password
- **WHEN** the OTP is not exactly 6 digits, or the new password fails the policy
- **THEN** inline validation from `ResetPasswordSchema` blocks the request

#### Scenario: Bad or expired OTP surfaced
- **WHEN** the backend responds 422 (incorrect or expired OTP)
- **THEN** the form shows an error inviting the user to re-check the code or request a new one, and the user stays on `/reset-password`

#### Scenario: Exhausted attempts surfaced
- **WHEN** the backend responds 422 after the OTP has been invalidated by exceeding the 5-attempt cap
- **THEN** the form shows a message advising the user to request a new code via forgot-password, with a link back to `/forgot-password`

#### Scenario: Submit is disabled while pending
- **WHEN** a reset request is in flight
- **THEN** the submit control is disabled and a pending state is shown

