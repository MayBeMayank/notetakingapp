# Backend — Claude Code Guide

## Commands
```bash
pnpm --filter backend dev          # start dev server
pnpm --filter backend test         # Vitest unit + Supertest integration
pnpm --filter backend build        # tsc compile
pnpm -w lint                       # ESLint (run before every commit)
pnpm --filter backend prisma generate          # regenerate Prisma client (safe)
pnpm --filter backend prisma migrate dev       # [ASK FIRST] mutates DB schema
pnpm --filter backend prisma db seed           # [ASK FIRST] writes seed data
```

## Layering — one direction only
```
routes → controllers → services → repositories → Prisma
```
- **Routes:** register handlers, nothing else.
- **Controllers:** parse `req`, call service, send `res`. No Prisma imports.
- **Services:** all business logic. No `req`/`res`. Throw typed errors.
- **Repositories:** Prisma queries only. No business rules.

## Error handling
- Services throw typed errors; the central Express 5 error middleware maps them to HTTP codes.
- Status code catalog is binding — see `AGENTS.md §8` and `docs/SDS.md §5.1`.
- 404 for missing **or** not-owned resources (no existence leak).
- 422 for business-rule conflicts (dup email, bad OTP, deleted-note update, etc.).

## Auth
- Every protected route uses the auth middleware; it attaches `req.userId`.
- Public routes (no token): register, login, refresh, forgot-password, reset-password, `GET /api/public/notes/:token`.
- Scope every DB query to `req.userId` — never expose another user's data.

## Validation
- Import Zod schemas from `@note-app/shared/schemas/*` — never redefine them here.
- Validate at the controller/middleware boundary; emit `400 + fields[]` on failure.

## FTS
- Use `prisma.$queryRaw` (parameterized) for the `tsvector` search query.
- `contentText` is derived from TipTap `contentJson` on every save; always update both.

## Anti-patterns
- ❌ Prisma in controllers or routes
- ❌ `req`/`res` in services
- ❌ Redefining Zod schemas — edit `packages/shared` first
- ❌ Plaintext passwords, OTPs, or raw refresh tokens in DB or logs
- ❌ `viewCount` read-modify-write — use `{ increment: 1 }`
- ❌ `--no-verify` on commits
