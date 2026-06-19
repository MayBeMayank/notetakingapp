import { randomBytes } from 'node:crypto'

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}
