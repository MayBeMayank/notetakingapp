# Technical Plan: AB-1010 — Frontend Auth Pages

> Consumes SDS §6.1 auth contracts. No backend/DB/schema changes. Layer in focus: **frontend**.
> Capabilities: `frontend-app-shell` (routing, providers, session store, API client, route guard) and `auth-ui` (the four screens + logout).

---

## 1. Confirmed decisions (driving this plan)

| # | Decision | Source |
|---|---|---|
| 1 | Refresh token → `localStorage`; access token (JWT) → memory only | proposal |
| 2 | Protected 401 → one `/api/auth/refresh` + single retry; on failure clear session → `/login` | proposal |
| 3 | Add `react-router-dom`; public auth routes + `ProtectedRoute` guard | proposal |
| 4 | Scope = auth forms **+** app shell (providers, store, guard, placeholder home) | proposal |
| 5 | Bootstrap **Tailwind + minimal shadcn primitives** (Button, Input, Label, Card, Form) | this plan |
| 6 | Forms use **react-hook-form + @hookform/resolvers (zodResolver)** with the shared Zod schemas | this plan |

**Critical gotcha (must honor):** `UserResponseSchema.createdAt` is `z.date()`. JSON responses carry `createdAt` as a **string**, so response bodies MUST NOT be re-validated at runtime with the shared request/response schemas — they would throw on the date field. The client trusts the typed backend contract for responses and uses the shared schemas **only** for form-input validation (request shapes). The UI only consumes `user.id` / `user.email`.

---

## 2. Dependencies to add (`frontend/package.json`)

Pin exact versions verified against live docs (Rule 9/20) at install time — do not invent patch numbers here.

**dependencies**
- `react-router-dom` — routing (v6/v7 stable).
- `react-hook-form` — form state.
- `@hookform/resolvers` — `zodResolver` bridge to the shared Zod schemas.
- `tailwindcss`, `postcss`, `autoprefixer` — styling foundation.
- `class-variance-authority` — shadcn primitive variants (Button uses `cva`). `clsx` + `tailwind-merge` already present (`cn` in `src/lib/utils.ts`).
- `@radix-ui/react-label`, `@radix-ui/react-slot` — peer deps of the Label/Button primitives.
- `lucide-react` — icons used by shadcn (optional; only if a primitive needs it).

**devDependencies**
- `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` — component tests (vitest already configured with jsdom).
- `tailwindcss` peer tooling as needed.

> `@note-app/shared`, `@tanstack/react-query`, `zustand`, `react`, `react-dom` are already present.

---

## 3. Files to create / modify

### Bootstrap & config
| Path | Action | Purpose |
|---|---|---|
| `frontend/tailwind.config.js` | create | content globs `./index.html`, `./src/**/*.{ts,tsx}`; shadcn slate base + CSS-var theme |
| `frontend/postcss.config.js` | create | tailwind + autoprefixer |
| `frontend/src/index.css` | create | `@tailwind base/components/utilities` + shadcn CSS variables (matches `components.json` cssVariables) |
| `frontend/vite.config.ts` | modify | add dev `server.proxy` for `/api` → backend (`http://localhost:3000`) |
| `frontend/src/main.tsx` | modify | import `./index.css`; wrap in `QueryClientProvider` + `BrowserRouter` |
| `frontend/src/App.tsx` | modify | replace placeholder with `<Routes>` table |
| `frontend/vitest.config.ts` | modify | add `setupFiles: ['./src/test/setup.ts']` |
| `frontend/src/test/setup.ts` | create | `import '@testing-library/jest-dom'` |
| `frontend/.env.example` | create | `VITE_API_URL=http://localhost:3000/api` |

### `frontend-app-shell` capability
| Path | Action | Purpose |
|---|---|---|
| `frontend/src/lib/queryClient.ts` | create | single `QueryClient` instance |
| `frontend/src/stores/auth.store.ts` | create | Zustand session store (decision #1) |
| `frontend/src/api/client.ts` | create | fetch wrapper: base URL, Bearer inject, error-envelope parse, 401 single-flight refresh + retry (decision #2) |
| `frontend/src/api/auth.ts` | create | TanStack Query hooks: `useRegister`, `useLogin`, `useLogout`, `useForgotPassword`, `useResetPassword` |
| `frontend/src/features/auth/ProtectedRoute.tsx` | create | guard with loading state during boot rehydration |
| `frontend/src/features/auth/useBootstrapSession.ts` | create | on mount, if refresh token present + no access token, attempt one refresh |
| `frontend/src/components/ui/{button,input,label,card,form}.tsx` | create | minimal shadcn primitives |

### `auth-ui` capability
| Path | Action | Purpose |
|---|---|---|
| `frontend/src/features/auth/RegisterForm.tsx` | create | FRS-3.1 |
| `frontend/src/features/auth/LoginForm.tsx` | create | FRS-3.2 |
| `frontend/src/features/auth/ForgotPasswordForm.tsx` | create | FRS-3.4.1–3 |
| `frontend/src/features/auth/ResetPasswordForm.tsx` | create | FRS-3.4.4–5 |
| `frontend/src/features/auth/LogoutButton.tsx` | create | FRS-3.3.3 |
| `frontend/src/pages/{Login,Register,ForgotPassword,ResetPassword,Home}Page.tsx` | create | thin route screens delegating to features |

### Tests
| Path | Action | Purpose |
|---|---|---|
| `frontend/src/api/client.test.ts` | create | 401→refresh→retry; refresh-fail→clear; single-flight; envelope parse |
| `frontend/src/stores/auth.store.test.ts` | create | store/localStorage split, rehydrate, clear, no token logging |
| `frontend/src/features/auth/*.test.tsx` | create | per-form: client validation, success route, error-code mapping |

---

## 4. Key TypeScript shapes (final)

```ts
// src/stores/auth.store.ts
interface AuthState {
  user: { id: string; email: string } | null
  accessToken: string | null            // memory only
  status: 'anonymous' | 'pending' | 'authenticated'
  setSession(p: { accessToken: string; refreshToken: string; user: { id: string; email: string } }): void
  setAccessToken(accessToken: string, refreshToken: string): void  // refresh rotation
  clear(): void                          // drops memory + removes localStorage refresh key
}
const REFRESH_KEY = 'note-app.refreshToken'   // the ONLY persisted item
```

```ts
// src/api/client.ts
class ApiError extends Error {
  status: number
  code: string
  fields?: { field: string; message: string }[]
}
interface RequestOptions { method?: string; body?: unknown; auth?: boolean } // auth defaults true
async function apiFetch<T>(path: string, opts?: RequestOptions): Promise<T>

// single-flight: module-scoped `let refreshPromise: Promise<string> | null`
// 401 + auth + refresh-token-present  → await shared refresh → retry once
// refresh 401                         → authStore.clear() + redirect '/login' → throw
const API_URL = import.meta.env.VITE_API_URL ?? '/api'
```

```ts
// src/api/auth.ts — request types come from @note-app/shared/schemas/auth
import type { RegisterInput, LoginInput, ForgotPasswordInput, ResetPasswordInput } from '@note-app/shared/schemas/auth'
function useRegister():        UseMutationResult<{ user: { id: string; email: string } }, ApiError, RegisterInput>
function useLogin():           UseMutationResult<{ accessToken: string; refreshToken: string; user: {...} }, ApiError, LoginInput>
function useLogout():          UseMutationResult<void, ApiError, void>          // reads refresh token from store
function useForgotPassword():  UseMutationResult<{ ok: true }, ApiError, ForgotPasswordInput>
function useResetPassword():   UseMutationResult<{ ok: true }, ApiError, ResetPasswordInput>
```

Forms wire validation via `useForm({ resolver: zodResolver(RegisterSchema) })` etc. — the shared schema is the single source of field rules (no redefinition).

---

## 5. Architecture decisions & reasoning

- **Session store split (memory + localStorage):** access JWT in memory limits XSS exposure of the short-lived credential; refresh token in `localStorage` survives reload. Store stays client-only (CLAUDE.md: never put server state in Zustand) — it holds tokens + minimal identity, not cached note data (that stays in TanStack Query).
- **Single-flight refresh:** a module-scoped promise prevents a refresh stampede when several queries 401 at once (covered by a spec scenario). All callers await the same in-flight refresh.
- **Login 401 vs. global 401:** the global interceptor only refreshes for `auth: true` requests that are **not** the login/refresh calls themselves; the login form handles its own 401 to render the generic credential message. `apiFetch` for `/auth/login`, `/auth/register`, `/auth/refresh`, forgot/reset uses `auth: false` so it bypasses the interceptor.
- **Register does not auto-login:** SDS `/register` returns no tokens → navigate to `/login` with a success notice.
- **Responses not re-validated:** request schemas use `z.date()` for `createdAt`; runtime-parsing string responses would throw. UI trusts the contract and reads only `id`/`email`.
- **Routing redirect target:** `ProtectedRoute` and the post-login redirect point at `/` (Home placeholder); AB-1011 swaps the placeholder for the real notes list without touching the guard.

---

## 6. DB changes

**None.** No Prisma schema, migration, or seed change. Backward compatible by construction.

---

## 7. Reuse of existing shared code

- `@note-app/shared/schemas/auth` — `RegisterSchema`, `LoginSchema`, `ForgotPasswordSchema`, `ResetPasswordSchema` (form validation) and the inferred request types. **No new shared schema needed.**
- `src/lib/utils.ts` `cn()` — already present; used by shadcn primitives.
- Existing vite `@` → `./src` alias and jsdom vitest config — extended, not replaced.

---

## 8. Build / test / lint checkpoints

Run after the bootstrap step, then again after each capability:

```bash
pnpm --filter frontend build         # tsc + vite build — 0 type errors
pnpm -w lint --max-warnings 0        # ESLint clean
pnpm --filter frontend test          # Vitest — all green, ≥80% on new code
```

Before commit:
```bash
npx commitlint --from HEAD~1         # message format
# Husky pre-commit must pass without --no-verify
```

Playwright full auth journey is owned by **AB-1016**; AB-1010 ships Vitest component/store/client coverage only.

---

## 9. Suggested implementation order (for /tasks)

1. **Bootstrap:** deps + Tailwind/postcss/index.css + shadcn primitives + providers in `main.tsx` → checkpoint (build/lint).
2. **App shell:** auth store → api client (+ tests) → `ProtectedRoute` + bootstrap hook → route table in `App.tsx` with Home placeholder → checkpoint.
3. **auth-ui:** auth query hooks → Login + Register (+ tests) → Forgot + Reset (+ tests) → LogoutButton → checkpoint.
4. Full gate (build + lint + test), then `/review` against the two specs.

---

## 10. Open risks

- **Pinned versions:** `react-router-dom` v7 vs v6 API differs slightly (`RouterProvider` vs `BrowserRouter`+`Routes`); confirm the installed major and use its idiom. Plan assumes the `BrowserRouter`+`<Routes>` style (works in v6 and v7).
- **Dev proxy vs. CORS:** the Vite `/api` proxy avoids CORS in dev; production base URL comes from `VITE_API_URL`. Backend CORS config is out of scope for this ticket.
- **Tailwind v4 vs v3:** v4 changes the PostCSS/config setup. Confirm the installed major and use the matching `index.css`/config form.
