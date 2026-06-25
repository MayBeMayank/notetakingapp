# Tasks — AB-1014: Share Modal + Active Links

Frontend-only. No shared-schema or DB work (share + public schemas already exist
in `packages/shared/src/schemas/shares.ts`). Tasks are sequenced by import
dependency. `[PARALLEL]` marks tasks that touch **different files** with **no
import dependency** on each other — they may run concurrently.

Mark `- [x]` after each task's phase checkpoint passes (not batched at the end).

---

## Phase 1 — Foundation (data + pure utilities)

Three independent files, no interdependency.

- [ ] **1.1 [PARALLEL]** `frontend/src/features/share/expiryPresets.ts`
  - `export type ExpiryPreset = 'never' | '1d' | '7d' | '30d'`
  - `presetToExpiresAt(p)`: `'never' → null`; else `new Date(Date.now() + days*86_400_000).toISOString()`
  - `EXPIRY_OPTIONS`: ordered `{ value, label }[]` for the Select
- [ ] **1.2 [PARALLEL]** `frontend/src/features/share/shareUrl.ts`
  - `toAbsoluteShareUrl(relativeUrl: string): string` — prepend `window.location.origin`
- [ ] **1.3 [PARALLEL]** `frontend/src/api/shares.ts`
  - `ShareLinkItem` interface (string dates — AD-2 precedent)
  - `SHARES_QUERY_KEY = ['shares']`
  - `useNoteShares(noteId)`: `useQuery(['shares'])` → `select` filters by `noteId` (AD-3)
  - `useCreateShare(noteId)`: `POST /notes/:id/shares`, invalidate `['shares']`
  - `useRevokeShare()`: `DELETE /shares/:id`, invalidate `['shares']`
  - `usePublicNote(token)`: `GET /public/notes/:token` with `{ auth: false }`, `retry: false`, key `['public-note', token]`; validate against `PublicNoteViewSchema`

**Checkpoint 1:** `pnpm -w build` → 0 errors · `pnpm -w lint --max-warnings 0` · `pnpm --filter frontend test` → green

---

## Phase 2 — Core components

### 2a — Leaf components (depend only on Phase 1)

- [ ] **2.1 [PARALLEL]** `frontend/src/features/share/ShareLinkRow.tsx`
  - Props `{ share: ShareLinkItem }`; show absolute URL, expiry ("Never expires" / formatted date, mark past-expiry "Expired"), `viewCount`
  - Copy button → `navigator.clipboard.writeText` + `sonner` toast (success/failure)
  - Revoke button → `ConfirmDialog`; on confirm `useRevokeShare().mutate(share.id)`; treat `404` as success (row already gone)
- [ ] **2.2 [PARALLEL]** `frontend/src/features/share/CreateShareForm.tsx`
  - Props `{ noteId }`; expiry `<Select>` from `EXPIRY_OPTIONS` (default "Never")
  - Generate → `useCreateShare(noteId).mutate({ expiresAt: presetToExpiresAt(sel) })`
  - Disable Generate while pending; map `422 NOTE_DELETED` → "restore it before sharing", `404` → generic error
- [ ] **2.3 [PARALLEL]** `frontend/src/features/share/PublicNoteView.tsx`
  - Props `{ title, content }`; `useEditor({ extensions:[StarterKit], content, editable:false })` + `EditorContent`; render title; no toolbar/tags/version (AD-6, FRS-7.8)

### 2b — Composed components (depend on 2a)

- [ ] **2.4** `frontend/src/features/share/ShareModal.tsx` — depends on 2.1, 2.2
  - Controlled overlay (`role="dialog"`, `aria-modal`, Escape + backdrop dismiss — `ConfirmDialog` pattern)
  - `useNoteShares(noteId)`: loading skeleton / error+retry / empty state / `ShareLinkRow` list
  - Embeds `CreateShareForm`
- [ ] **2.5** `frontend/src/features/share/ShareButton.tsx` — depends on 2.4
  - Local open state; renders trigger `<Button>` + `<ShareModal noteId open onClose />`
- [ ] **2.6** `frontend/src/pages/PublicSharePage.tsx` — depends on 2.3 + 1.3
  - `useParams` token → `usePublicNote(token)`; states: loading / `404` "doesn't exist" / `410` "no longer available" / loaded → `PublicNoteView`

**Checkpoint 2:** `pnpm -w build` → 0 errors · `pnpm -w lint --max-warnings 0` · `pnpm --filter frontend test` → green

---

## Phase 3 — Integration (wire into existing screens)

Three separate files, no interdependency.

- [ ] **3.1 [PARALLEL]** `frontend/src/App.tsx`
  - Import `PublicSharePage`; add **unguarded** `<Route path="/s/:token" element={<PublicSharePage />} />` before the `*` catch-all (no `ProtectedRoute`, no `PublicOnlyRoute`)
- [ ] **3.2 [PARALLEL]** `frontend/src/features/notes/NoteEditor.tsx`
  - Add `<ShareButton noteId={note.id} />` to the header row (beside `SaveStatusIndicator`)
- [ ] **3.3 [PARALLEL]** `frontend/src/features/notes/NoteCard.tsx`
  - Add `<ShareButton noteId={note.id} />` to the **active** branch `CardFooter` only (hidden on trashed — AD-7)

**Checkpoint 3:** `pnpm -w build` → 0 errors · `pnpm -w lint --max-warnings 0` · `pnpm --filter frontend test` → green · `pnpm --filter frontend dev` manual smoke (open modal, generate Never + 7d, copy, revoke; open `/s/:token` anonymously)

---

## Phase 4 — Tests (one named test per spec scenario)

All co-located test files are independent → `[PARALLEL]`.

- [ ] **4.1 [PARALLEL]** `frontend/src/features/share/expiryPresets.test.ts`
  - `never → null` · `'7d' → future ISO ~ now+7d`
- [ ] **4.2 [PARALLEL]** `frontend/src/features/share/shareUrl.test.ts`
  - `/s/abc → origin + /s/abc` (Copy a link URL → copy succeeds)
- [ ] **4.3 [PARALLEL]** `frontend/src/api/shares.test.tsx`
  - `useNoteShares` filters bare array by `noteId` (List → scoped to this note)
  - create invalidates `['shares']` · revoke invalidates `['shares']`
  - `usePublicNote` sends **no** Authorization header (Read-only → request carries no credentials; Auth boundary)
  - `usePublicNote` surfaces `404` and `410` to caller
- [ ] **4.4 [PARALLEL]** `frontend/src/features/share/ShareModal.test.tsx`
  - modal opens with current state · dismiss (Escape/backdrop)
  - generate never-expiring (POST `{expiresAt:null}`) · generate 7d (future ISO) · multiple links coexist · Generate disabled while pending
  - `422` → "restore it before sharing" · `404` → error, no row added
  - list loading state · list error + retry
  - shows expiry + viewCount · empty state · expired-but-not-revoked marked
- [ ] **4.5 [PARALLEL]** `frontend/src/features/share/ShareLinkRow.test.tsx`
  - copy succeeds (toast) · clipboard unavailable (error toast, URL stays)
  - revoke with confirmation · cancel revocation (no request) · revoke already-gone (`404` → row removed)
- [ ] **4.6 [PARALLEL]** `frontend/src/features/share/ShareButton.test.tsx`
  - clicking opens `ShareModal` for the given `noteId` (entry point — editor + card)
- [ ] **4.7 [PARALLEL]** `frontend/src/features/notes/NoteCard.test.tsx` (extend)
  - Share action present on active card · **absent** on trashed card (Share entry points → not offered for trashed)
- [ ] **4.8 [PARALLEL]** `frontend/src/features/share/PublicNoteView.test.tsx`
  - renders title + content read-only, **no** toolbar/edit affordance · no tags/version/owner in DOM (No private data exposed)
- [ ] **4.9 [PARALLEL]** `frontend/src/pages/PublicSharePage.test.tsx`
  - loading state · `404` "doesn't exist" · `410` revoked/expired "no longer available" · `410` note-deleted (same state, no leak) · loaded renders `PublicNoteView` (anonymous; owner identical) · no navigation into authenticated app

**Checkpoint 4:** `pnpm -w build` → 0 errors · `pnpm -w lint --max-warnings 0` · `pnpm --filter frontend test` → all green · coverage ≥ 80% on new files

---

## Phase 5 — E2E (required: user-facing feature, CLAUDE.md Gate 5)

- [ ] **5.1** Playwright journey: log in → open a note → Share → generate link →
  copy URL → open `/s/:token` in a fresh (anonymous) context → see title + content →
  back as owner → revoke → reload `/s/:token` → see "no longer available"

**Final gate:** `pnpm -w lint --max-warnings 0` · `pnpm -w build` · `pnpm --filter frontend test` · `pnpm --filter frontend e2e` — all green before commit (no `--no-verify`)

---

## Out of scope (not tasked)

- `packages/shared`, backend, DB/migrations — unchanged
- Zustand store (modal state is local; link data is server state)
- Global "all shares" page · datetime picker · view-count polling
