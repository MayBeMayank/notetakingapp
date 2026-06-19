import { hashPassword, verifyPassword, hashToken } from '../lib/hash.js'
import { signAccessToken } from '../lib/jwt.js'
import { generateRefreshToken } from '../lib/token.js'
import { UnauthorizedError, ConflictError } from '../lib/errors.js'
import * as authRepo from '../repositories/auth.repository.js'
import type {
  RegisterInput,
  LoginInput,
  RefreshTokenInput,
  LogoutInput,
  RegisterResponse,
  LoginResponse,
  RefreshResponse,
} from '@note-app/shared/schemas/auth'

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function register(input: RegisterInput): Promise<RegisterResponse> {
  const email = input.email.toLowerCase()
  const existing = await authRepo.findUserByEmail(email)
  if (existing) {
    throw new ConflictError('DUPLICATE_EMAIL', 'Email already registered')
  }
  const passwordHash = await hashPassword(input.password)
  const user = await authRepo.createUser({ email, passwordHash })
  return { user: { id: user.id, email: user.email, createdAt: user.createdAt } }
}

export async function login(input: LoginInput): Promise<LoginResponse> {
  const email = input.email.toLowerCase()
  const user = await authRepo.findUserByEmail(email)
  if (!user) {
    throw new UnauthorizedError('Invalid email or password')
  }
  const valid = await verifyPassword(user.passwordHash, input.password)
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password')
  }
  const accessToken = signAccessToken(user.id)
  const rawRefreshToken = generateRefreshToken()
  const tokenHash = hashToken(rawRefreshToken)
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
  await authRepo.createRefreshToken({ userId: user.id, tokenHash, expiresAt })
  return {
    accessToken,
    refreshToken: rawRefreshToken,
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
  }
}

export async function refresh(input: RefreshTokenInput): Promise<RefreshResponse> {
  const tokenHash = hashToken(input.refreshToken)
  const tokenRow = await authRepo.findRefreshToken(tokenHash)
  if (!tokenRow) {
    throw new UnauthorizedError('Invalid refresh token')
  }
  if (tokenRow.revokedAt) {
    throw new UnauthorizedError('Refresh token has been revoked')
  }
  if (tokenRow.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token has expired')
  }
  await authRepo.revokeRefreshToken(tokenRow.id)
  const accessToken = signAccessToken(tokenRow.userId)
  const rawRefreshToken = generateRefreshToken()
  const newTokenHash = hashToken(rawRefreshToken)
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
  await authRepo.createRefreshToken({
    userId: tokenRow.userId,
    tokenHash: newTokenHash,
    expiresAt,
  })
  return { accessToken, refreshToken: rawRefreshToken }
}

export async function logout(input: LogoutInput, userId: string): Promise<void> {
  const tokenHash = hashToken(input.refreshToken)
  const tokenRow = await authRepo.findRefreshToken(tokenHash)
  if (!tokenRow || tokenRow.userId !== userId) {
    throw new UnauthorizedError('Invalid refresh token')
  }
  if (tokenRow.revokedAt) {
    throw new UnauthorizedError('Refresh token has been revoked')
  }
  await authRepo.revokeRefreshToken(tokenRow.id)
}
