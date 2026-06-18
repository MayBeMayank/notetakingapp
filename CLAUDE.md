@AGENTS.md

---

## Claude Code — Operational Rules

### Permission Model

**Proceed without asking:**
- Read any file, run `grep`/`glob`, read git log/diff/status
- Edit source files, write new files inside the workspace
- Run `pnpm lint`, `pnpm test`, `pnpm build` (read-only or reversible)
- Run `prisma generate` (no DB side-effects)

**Ask [y/n] before proceeding:**
- `git commit` — confirm message before committing
- `git push` / `git push --force` — always confirm; never force-push `main`
- `prisma migrate dev` or `prisma db push` — mutates the DB schema
- `prisma db seed` — writes data to the DB
- Deleting files (`rm`, `Remove-Item`) or branches (`git branch -D`)
- Any command that writes outside the workspace directory

**Never do without explicit user instruction:**
- `git push --force` to `main` or `master`
- Drop or truncate database tables
- Modify `.env` files that contain real secrets

---

### Context Management

- If the conversation output token count approaches **60 k**, proactively summarize completed work into a short bullet list before continuing.
- When switching between backend and frontend subtasks, state which layer is in focus so context stays unambiguous.
- Spawn an `Explore` subagent for codebase searches that would take more than 3 Grep/Glob calls; keep the main context clean.

---

### Thinking Depth

| Situation | Depth |
|---|---|
| Locating a file or symbol | Minimal — grep/glob, report immediately |
| Single-layer bug fix (≤ 3 files) | Standard — read, edit, verify |
| Cross-layer change (routes → service → repo → shared) | Deep — trace full call chain before editing |
| New feature or FRS-touching change | Plan first — use `Plan` agent or `/openspec-propose` |
| Auth, security, or data-integrity logic | Maximum — re-read FRS §auth + §error codes before writing |

---

### Commit Message Format

```
<type>(<scope>): <imperative summary under 72 chars>

[optional body — wrap at 72, explain why not what]
[optional footer — Breaking: ..., Closes #N]
```

**Types:** `feat` | `fix` | `refactor` | `test` | `chore` | `docs`  
**Scopes:** `auth` | `notes` | `tags` | `search` | `share` | `versions` | `shared` | `db` | `infra`

Examples:
```
feat(notes): add soft-delete with 30-day restore window
fix(auth): clamp OTP attempts to 5 before invalidation
chore(db): add GIN index on notes.search_vector
```

---

### Branch Naming

```
<type>/<scope>-<short-slug>
```

Examples: `feat/notes-soft-delete`, `fix/auth-otp-cap`, `chore/db-fts-index`

- Branches off `main` only.
- Delete branch after merge.

---

### Quality Gates (run in this order)

1. `pnpm -w lint` — must pass with zero errors before commit
2. `pnpm --filter backend test` — backend unit + integration
3. `pnpm --filter frontend test` — frontend unit
4. `pnpm -w build` — confirm no type errors
5. `pnpm --filter frontend e2e` — only required for user-facing feature changes

### After every phase checkpoint:
1.pnpm build        → 0 errors, 0 warnings
2.pnpm lint --max-warnings 0
3.pnpm test         → all green

### Before every commit:
1.npx commitlint --from HEAD~1  → must pass
2.Husky pre-commit              → must pass silently

### Never commit if:
-Any test is failing
-lint has errors
-Build has TypeScript errors

If any gate fails, fix before proceeding. Do not skip with `--no-verify`.

---

### Workspace-Specific Notes

- All Zod schemas live in `packages/shared` — edit there first, then propagate to backend/frontend.
- The backend test suite requires a running PostgreSQL instance; check `.env.test` is populated before running integration tests.
- TipTap content changes must update both `contentJson` and `contentText` fields together.
