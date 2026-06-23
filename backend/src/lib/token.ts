import { randomBytes, randomInt } from 'node:crypto'

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

// Unguessable 32-byte share-link token (SDS §8). Uniqueness is also enforced by
// the `ShareLink.token @unique` constraint.
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url')
}

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}
