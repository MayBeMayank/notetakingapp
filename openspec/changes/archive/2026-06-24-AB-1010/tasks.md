# Tasks: AB-1010 — Frontend Auth Pages

> Layer: **frontend**. No DB migration, no new shared schema (pure consumer of SDS §6.1).
> `[PARALLEL]` = touches different files with no import/logical dependency on its siblings.
> Mark `- [x]` as each task lands; run the checkpoint before leaving a phase.

---

## Phase 1 — Foundation (bootstrap & config)

> No shared types or DB changes. This phase stands up Tailwind, deps, providers, and shadcn primitives.

- [x] 1.1 Add pinned deps to `frontend/package.json`. **Resolved majors:** react-router-dom@7, react-hook-form@7, @hookform/resolvers@5, **tailwindcss@4** (CSS-first), @tailwindcss/postcss@4, postcss@8, class-variance-authority@0.7, @radix-ui/react-label@2, @radix-ui/react-slot@1; devDeps @testing-library/{react@16,user-event@14,jest-dom@6}. **Dropped** `autoprefixer` (v4 plugin handles it) + `lucide-react` (unused). `pnpm install` done.
- [x] 1.2 Create `frontend/postcss.config.js` (`@tailwindcss/postcss`). *(Tailwind v4 is CSS-first → no `tailwind.config.js` needed.)*
- [x] 1.3 Create `frontend/src/index.css` — `@import 'tailwindcss'` + `:root` tokens + `@theme inline` mapping (v4 form of shadcn cssVariables).
- [x] 1.4 Modify `frontend/vite.config.ts` — dev `server.proxy` for `/api` → `http://localhost:3000`.
- [x] 1.5 Modify `frontend/vitest.config.ts` (`globals`, `setupFiles`) + create `frontend/src/test/setup.ts`.
- [x] 1.6 Create `frontend/.env.example` (`VITE_API_URL=/api`).
- [x] 1.7 Create `frontend/src/lib/queryClient.ts`.
- [x] 1.8 Modify `frontend/src/main.tsx` — import css; wrap in `QueryClientProvider` + `BrowserRouter`.
- [x] 1.8b Add `@/*` path mapping to `frontend/tsconfig.json` (needed for `tsc` to resolve the Vite alias). *(unplanned — required for typecheck)*
- [x] 1.9 Create minimal shadcn primitives:
  - [x] 1.9a `src/components/ui/button.tsx`
  - [x] 1.9b `src/components/ui/input.tsx`
  - [x] 1.9c `src/components/ui/label.tsx`
  - [x] 1.9d `src/components/ui/card.tsx`
  - [x] 1.9e `src/components/ui/form.tsx` (react-hook-form context wrappers)

**Checkpoint 1:** ✅ build 0 errors · tsc --noEmit 0 errors · lint clean · test green (no tests yet).

---

## Phase 2 — Core implementation (`frontend-app-shell` + `auth-ui` units)

### 2A — App shell (sequential chain: store → client → hooks → guard)
- [x] 2.1 `src/stores/auth.store.ts` — Zustand session store: `user`/`accessToken` in memory, refresh token in `localStorage` (`REFRESH_KEY`), `status` (`anonymous|pending|authenticated`), `setSession`/`setAccessToken`/`clear`. Never log tokens.
- [x] 2.2 `src/api/client.ts` — `apiFetch<T>` + `ApiError`: base URL from `VITE_API_URL`, Bearer injection for `auth:true`, error-envelope parsing, **single-flight** 401 → `/api/auth/refresh` → store rotated pair → retry once; refresh-fail → `authStore.clear()` + redirect `/login`. Auth endpoints (login/register/refresh/forgot/reset) use `auth:false`.
- [x] 2.3 `src/api/auth.ts` — TanStack Query mutation hooks `useRegister`, `useLogin`, `useLogout`, `useForgotPassword`, `useResetPassword` (request types from `@note-app/shared/schemas/auth`; responses typed, not re-validated).
- [x] 2.4 `src/features/auth/useBootstrapSession.ts` — on mount, if refresh token present + no access token, attempt one refresh; set `status` accordingly.
- [x] 2.5 `src/features/auth/ProtectedRoute.tsx` — redirect to `/login` when anonymous, render children when authenticated, show loading while `pending`.

### 2B — Auth UI (after 2.3 hooks + 1.9 primitives exist)
- [x] 2.6 `src/features/auth/LoginForm.tsx` — `zodResolver(LoginSchema)`; success → store session + navigate `/`; 401 → generic message; pending disables submit; links to register/forgot. `[PARALLEL]`
- [x] 2.7 `src/features/auth/RegisterForm.tsx` — `zodResolver(RegisterSchema)`; 201 → navigate `/login` with notice; 422 dup-email on email field; 400 `fields[]` mapping; pending disables submit. `[PARALLEL]`
- [x] 2.8 `src/features/auth/ForgotPasswordForm.tsx` — `zodResolver(ForgotPasswordSchema)`; neutral anti-enumeration confirmation + dev console-code hint; route to `/reset-password` carrying email. `[PARALLEL]`
- [x] 2.9 `src/features/auth/ResetPasswordForm.tsx` — `zodResolver(ResetPasswordSchema)`; email prefilled from route state (editable); 200 → `/login` notice; 422 bad/expired; exhausted-attempts message + link to forgot. `[PARALLEL]`
- [x] 2.10 `src/features/auth/LogoutButton.tsx` — calls `useLogout`; clears session and redirects `/login` even if the call fails. `[PARALLEL]`

> 2.6–2.10 touch different files and share no imports between them → parallel once 2.3 + 1.9 are in.

**Checkpoint 2:** build → 0 errors · lint clean · test green.

---

## Phase 3 — Integration (pages + routing)

- [x] 3.1 Thin route pages (each delegates to its feature; different files → `[PARALLEL]`):
  - [x] 3.1a `src/pages/LoginPage.tsx` `[PARALLEL]`
  - [x] 3.1b `src/pages/RegisterPage.tsx` `[PARALLEL]`
  - [x] 3.1c `src/pages/ForgotPasswordPage.tsx` `[PARALLEL]`
  - [x] 3.1d `src/pages/ResetPasswordPage.tsx` `[PARALLEL]`
  - [x] 3.1e `src/pages/HomePage.tsx` — minimal authenticated placeholder with `LogoutButton` (AB-1011 replaces). `[PARALLEL]`
- [x] 3.2 `src/App.tsx` — `<Routes>`: public `/login` `/register` `/forgot-password` `/reset-password`; protected `/` via `ProtectedRoute`; unknown-route fallback (anon→`/login`, auth→`/`); authed-on-auth-route redirect to `/`. Wire `useBootstrapSession`.
- [~] 3.3 Manual smoke via `pnpm --filter frontend dev` against the running backend: register → login → home → logout; forgot → reset (OTP read from backend console).

**Checkpoint 3:** build → 0 errors · lint clean · test green.

---

## Phase 4 — Tests (one test per spec scenario)

> Each file `[PARALLEL]` (distinct files); depends on the Phase 2/3 code it covers.

- [x] 4.1 `src/stores/auth.store.test.ts` — `frontend-app-shell › Auth session store`:
  - tokens stored on login · rehydrate after reload · reload w/o token = anonymous · cleared on logout · tokens never logged
- [x] 4.2 `src/api/client.test.ts` — `frontend-app-shell › Authenticated API client`:
  - Bearer attached · 401 → single refresh + retry · failed refresh clears session + redirect · rotated refresh token replaces old · error envelope parsed (code/message/fields) · concurrent 401s share one refresh
- [x] 4.3 `src/features/auth/ProtectedRoute.test.tsx` — `frontend-app-shell › Protected route guard`:
  - unauthenticated → redirect `/login` · authenticated → renders content · pending → loading (no login flash)
- [x] 4.4 `src/App.routing.test.tsx` — `frontend-app-shell › Application routing`:
  - public auth routes render anon · unknown route fallback (anon vs auth) · authed visitor on `/login` redirected to `/`
- [x] 4.5 `src/features/auth/RegisterForm.test.tsx` — `auth-ui › Registration screen`:
  - success → routes to `/login` (no token stored) · client validation blocks (email/password policy) · 422 duplicate email · 400 server `fields[]` mapped · submit disabled while pending · password never logged
- [x] 4.6 `src/features/auth/LoginForm.test.tsx` — `auth-ui › Login screen`:
  - success establishes session + navigates `/` · 401 generic message (no field hint) · client validation blocks · submit disabled while pending · links to register/forgot present
- [x] 4.7 `src/features/auth/LogoutButton.test.tsx` — `auth-ui › Logout control`:
  - success clears + redirects `/login` · session cleared even if logout call fails · protected route inaccessible after logout
- [x] 4.8 `src/features/auth/ForgotPasswordForm.test.tsx` — `auth-ui › Forgot-password screen`:
  - identical confirmation regardless of email existence · hand-off to `/reset-password` with email prefilled · client email validation · dev-mode code hint shown
- [x] 4.9 `src/features/auth/ResetPasswordForm.test.tsx` — `auth-ui › Reset-password screen`:
  - success → `/login` notice · client validation (OTP 6-digit + password policy) · 422 bad/expired OTP · exhausted-attempts message + link to forgot · submit disabled while pending

**Checkpoint 4 (full gate):** ✅ build 0 errors · tsc --noEmit 0 errors · lint clean · **41/41 tests pass** · coverage **91.83% stmts / 84.7% branch** (≥80%). `commitlint` runs at commit time.

---

## Done criteria
- All 9 spec scenarios per capability covered by a named test (4.1–4.9).
- Build/lint/test gates green; coverage ≥ 80% on new code.
- No backend, DB, or shared-schema changes introduced.
- Playwright full journey deferred to **AB-1016**.
