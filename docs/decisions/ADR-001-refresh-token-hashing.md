# ADR-001: SHA-256 for Refresh Token Hashing (not argon2id)

**Status:** Accepted  
**Date:** 2026-06-19  
**Ticket:** AB-1002  

---

## Context

SDS §2 and §4 state that argon2id is used for all hashing, including refresh tokens. During
implementation it was discovered that argon2id is **non-deterministic**: each `argon2.hash(input)`
call produces a different digest because a cryptographically random salt is embedded in the output.

The `RefreshToken` table has:

```prisma
tokenHash String
@@index([tokenHash])
```

A database index on `tokenHash` only has value if the hash is deterministic — i.e., the same
input always produces the same output, enabling `WHERE tokenHash = hash(presented_token)`. With
argon2id that lookup is impossible: the stored hash was computed with salt S1, but re-hashing the
presented token at lookup time produces a different hash with salt S2.

The only way to use argon2id for refresh tokens would be to:
1. Store `userId` alongside the token (already done),
2. Load all non-revoked tokens for that user,
3. Call `argon2.verify(storedHash, presentedToken)` row-by-row until a match is found.

This makes every `/refresh` and `/logout` call O(active sessions) in both DB reads and CPU time,
and defeats the purpose of the index entirely.

## Decision

Use **SHA-256** (`crypto.createHash('sha256').update(token).digest('hex')`) to hash refresh tokens.

```ts
// backend/src/lib/hash.ts
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
```

SHA-256 is:
- **Deterministic** — same input always produces the same output; the index remains useful.
- **Secure for random high-entropy inputs** — a refresh token is `crypto.randomBytes(32)`
  (256 bits of CSPRNG entropy). SHA-256 is not vulnerable to brute-force or rainbow-table attacks
  against such inputs; argon2id's intentional slowness is designed for low-entropy user-chosen
  passwords, which is not the threat model here.
- **Fast** — appropriate for a hot code path called on every authenticated request.

argon2id remains the correct choice for **passwords** and **OTPs** (low-entropy, user-chosen
values where brute-force resistance matters).

## Consequences

- `RefreshToken.tokenHash` stores a SHA-256 hex string (64 chars).
- The `@@index([tokenHash])` is efficient — single-row lookup per request.
- The SDS §2 and §4 statements "argon2id (passwords + OTP + refresh tokens)" are **incorrect**
  for refresh tokens. They are not updated in the SDS to avoid conflicting with the formal spec
  approval; this ADR is the authoritative record of the deviation.
- Any future code touching `RefreshToken.tokenHash` must use `hashToken()` from `lib/hash.ts`,
  not argon2.
