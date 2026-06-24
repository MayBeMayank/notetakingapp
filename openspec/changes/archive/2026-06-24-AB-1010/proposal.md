# Proposal: AB-1010 — Frontend Auth Pages

## Why

The backend auth surface is complete (AB-1002 register/login/refresh/logout, AB-1003 forgot/reset via OTP), but there is no user interface to exercise it — the frontend is a bare scaffold whose `App.tsx` renders only a placeholder. AB-1010 is the first frontend ticket: it must stand up the SPA's foundational shell (routing, the TanStack Query provider, the client auth session, and the authenticated API client) and the user-facing auth screens that consume the contracts in SDS §6.1. Every later frontend ticket (AB-1011 notes list, AB-1012 editor, …) depends on an authenticated session and a working API client, so this shell is a hard prerequisite.

## What Changes

**In scope — consumes FRS §3.1–§3.4 / SDS §6.1:**
- Registration screen (FRS-3.1.1–3.1.5) — client-side validation via the shared `RegisterSchema`, duplicate-email and field-error handling.
- Login screen (FRS-3.2.1–3.2.3) — token capture, generic credential-error messaging (no field leak).
- Logout control (FRS-3.3.3) — revokes the refresh token server-side and clears the client session.
- Forgot-password screen (FRS-3.4.1–3.4.3) — identical anti-enumeration response, hands off to the reset screen.
- Reset-password screen (FRS-3.4.4–3.4.5) — 6-digit OTP + new-password entry, bad/expired/exhausted-OTP handling.
- **Frontend app shell:** `react-router-dom` routing, a `QueryClientProvider`, a Zustand auth-session store, an authenticated API client with 401 auto-refresh + retry, a `ProtectedRoute` guard, and a minimal authenticated placeholder page so the flow is end-to-end testable.

**Token handling (confirmed decisions):**
- Refresh token (7-day) persisted in `localStorage`; access token (15-min JWT) held in memory only.
- On any protected `401`, the API client calls `POST /api/auth/refresh` once, stores the rotated token pair, and retries the original request once; on refresh failure it clears the session and redirects to `/login`.

**Explicitly out of scope:**
- Notes list / editor / tags / search / share / versions UI (AB-1011–AB-1015).
- The real authenticated home page (AB-1011 replaces the placeholder).
- The public share view `/s/:token` (AB-1014).
- Any backend change — all contracts already exist; this ticket only consumes them.
- New shared schemas — `packages/shared/src/schemas/auth.ts` already covers every shape used here.

## Capabilities

### New Capabilities
- `frontend-app-shell`: SPA foundation — `react-router-dom` routing, the TanStack Query provider, the Zustand auth-session store (token storage + rehydration), the authenticated API client (Bearer injection, 401 auto-refresh + single retry, rotation), and the `ProtectedRoute` guard with a placeholder authenticated page.
- `auth-ui`: The four auth screens (register, login, forgot-password, reset-password) plus the logout control, each validating with the shared Zod schemas and mapping backend status codes to user-facing messages.

### Modified Capabilities
_(none — this is the first frontend capability; no existing `openspec/specs/<name>/` requirements change.)_

## Impact

### API Delta (from SDS §6.1)

No new or modified endpoints — AB-1010 is a pure consumer. The screens and API client call the existing contracts:

| Method | Path | Request | Success | Errors consumed by UI |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{ email, password }` | 201 `{ user }` | 400 (field errors), 422 (duplicate email) |
| POST | `/api/auth/login` | `{ email, password }` | 200 `{ accessToken, refreshToken, user }` | 400, 401 (generic "invalid email or password") |
| POST | `/api/auth/refresh` | `{ refreshToken }` | 200 `{ accessToken, refreshToken }` | 401 (→ clear session, redirect to login) |
| POST | `/api/auth/logout` | `{ refreshToken }` | 204 | 401 |
| POST | `/api/auth/forgot-password` | `{ email }` | 200 `{ ok: true }` (always) | 400 |
| POST | `/api/auth/reset-password` | `{ email, otp, newPassword }` | 200 `{ ok: true }` | 400, 422 (bad/expired/exhausted OTP) |

### DB Changes

None. No schema or migration in this ticket.

### Affected layers

- `frontend/package.json` — add pinned `react-router-dom` (and, if used for forms, a pinned form helper); verified against live docs before pinning (Rule 9/20). *(modified)*
- `frontend/src/main.tsx` — wrap the app in `QueryClientProvider` + `BrowserRouter`. *(modified)*
- `frontend/src/App.tsx` — route table (public auth routes + protected stub). *(modified)*
- `frontend/src/stores/auth.store.ts` — Zustand session store (access token in memory, refresh token in localStorage, rehydrate/clear). *(new)*
- `frontend/src/api/client.ts` — fetch wrapper: base URL, Bearer injection, error-envelope parsing, 401 auto-refresh + single retry. *(new)*
- `frontend/src/api/auth.ts` — TanStack Query hooks: `useRegister`, `useLogin`, `useLogout`, `useForgotPassword`, `useResetPassword`. *(new)*
- `frontend/src/features/auth/` — `RegisterForm`, `LoginForm`, `ForgotPasswordForm`, `ResetPasswordForm`, `LogoutButton`, `ProtectedRoute`. *(new)*
- `frontend/src/pages/` — `LoginPage`, `RegisterPage`, `ForgotPasswordPage`, `ResetPasswordPage`, and a minimal `HomePage` placeholder. *(new)*
- `frontend/tests/` — Vitest component/store tests; a Playwright auth-journey spec is deferred to AB-1016 but smoke coverage of forms is in scope here.

### Key assumptions

- **Registration does not auto-login.** SDS `/register` returns only `{ user }` (no tokens), so a successful register routes the user to `/login` with a success notice — it does not establish a session.
- **OTP delivery is console-only (FRS §10).** The forgot-password screen shows the same anti-enumeration message regardless of whether the email exists, and the reset screen instructs the user that the code was "sent" (in dev, logged to the server console). The UI never reveals account existence.
- **`forgot-password` hands the entered email to the reset screen** (e.g. via route state) so the user need not retype it; the email field on the reset screen remains editable.
- **5-attempt OTP cap (FRS-3.4.5)** surfaces as a reset-screen error advising the user to request a new code; the frontend does not track the count itself — it reacts to the backend `422`.
- **Single active session per browser.** The store holds one token pair; logging in replaces it. Multi-device concurrency is a backend concern (AB-1002) and not modeled in the UI.
- **All 401s from protected calls are treated uniformly** by the client: attempt one refresh, else redirect to `/login`. The login endpoint's own 401 is handled by the login form, not the global interceptor.
