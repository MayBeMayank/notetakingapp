import { hashPassword, verifyPassword, hashToken } from '../lib/hash.js'
import { signAccessToken } from '../lib/jwt.js'
import { generateRefreshToken, generateOtp } from '../lib/token.js'
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
  ForgotPasswordInput,
  ForgotPasswordResponse,
  ResetPasswordInput,
  ResetPasswordResponse,
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

const OTP_TTL_MS = 10 * 60 * 1000 // 10 minutes
const OTP_MAX_ATTEMPTS = 5

export async function forgotPassword(
  input: ForgotPasswordInput
): Promise<ForgotPasswordResponse> {
  const email = input.email.toLowerCase()
  const user = await authRepo.findUserByEmail(email)
  if (!user) {
    return { ok: true }
  }
  await authRepo.invalidatePendingOtps(user.id)
  const rawOtp = generateOtp()
  const codeHash = await hashPassword(rawOtp)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)
  await authRepo.createPasswordResetOtp({ userId: user.id, codeHash, expiresAt })
  console.log(`[OTP] Password reset code for user ${user.id}: ${rawOtp}`)
  return { ok: true }
}

export async function resetPassword(
  input: ResetPasswordInput
): Promise<ResetPasswordResponse> {
  const email = input.email.toLowerCase()
  const user = await authRepo.findUserByEmail(email)
  if (!user) {
    throw new ConflictError('INVALID_OTP', 'Invalid or expired OTP')
  }
  const otpRecord = await authRepo.findLatestPendingOtp(user.id)
  if (!otpRecord) {
    throw new ConflictError('INVALID_OTP', 'Invalid or expired OTP')
  }
  if (otpRecord.expiresAt <= new Date()) {
    throw new ConflictError('OTP_EXPIRED', 'OTP has expired. Please request a new one.')
  }
  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    throw new ConflictError(
      'OTP_ATTEMPT_LIMIT_REACHED',
      'Too many failed attempts. Please request a new OTP.'
    )
  }
  const valid = await verifyPassword(otpRecord.codeHash, input.otp)
  if (!valid) {
    await authRepo.incrementOtpAttempts(otpRecord.id)
    if (otpRecord.attempts + 1 >= OTP_MAX_ATTEMPTS) {
      await authRepo.consumeOtp(otpRecord.id)
      throw new ConflictError(
        'OTP_ATTEMPT_LIMIT_REACHED',
        'Too many failed attempts. Please request a new OTP.'
      )
    }
    throw new ConflictError('INVALID_OTP', 'Invalid or expired OTP')
  }
  const passwordHash = await hashPassword(input.newPassword)
  await authRepo.consumeOtp(otpRecord.id)
  await authRepo.updateUserPassword(user.id, passwordHash)
  await authRepo.revokeAllUserRefreshTokens(user.id)
  return { ok: true }
}
