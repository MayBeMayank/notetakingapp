import type { User, RefreshToken, PasswordResetOtp } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } })
}

export async function createUser(data: {
  email: string
  passwordHash: string
}): Promise<User> {
  return prisma.user.create({ data })
}

export async function createRefreshToken(data: {
  userId: string
  tokenHash: string
  expiresAt: Date
}): Promise<RefreshToken> {
  return prisma.refreshToken.create({ data })
}

export async function findRefreshToken(
  tokenHash: string
): Promise<RefreshToken | null> {
  return prisma.refreshToken.findFirst({ where: { tokenHash } })
}

export async function revokeRefreshToken(id: string): Promise<void> {
  await prisma.refreshToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  })
}

// T2.1 — OTP methods

export async function invalidatePendingOtps(userId: string): Promise<void> {
  const now = new Date()
  await prisma.passwordResetOtp.updateMany({
    where: {
      userId,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  })
}

export async function createPasswordResetOtp(data: {
  userId: string
  codeHash: string
  expiresAt: Date
}): Promise<PasswordResetOtp> {
  return prisma.passwordResetOtp.create({ data })
}

// Returns the latest non-consumed OTP for a user, including expired rows.
// Intentionally does NOT filter on expiresAt so the service can distinguish
// OTP_EXPIRED from INVALID_OTP (no row at all).
export async function findLatestPendingOtp(
  userId: string
): Promise<PasswordResetOtp | null> {
  return prisma.passwordResetOtp.findFirst({
    where: {
      userId,
      consumedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function incrementOtpAttempts(id: string): Promise<void> {
  await prisma.passwordResetOtp.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  })
}

export async function consumeOtp(id: string): Promise<void> {
  await prisma.passwordResetOtp.update({
    where: { id },
    data: { consumedAt: new Date() },
  })
}

// T2.2 — refresh-token bulk revoke + password update

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function updateUserPassword(
  id: string,
  passwordHash: string
): Promise<void> {
  await prisma.user.update({
    where: { id },
    data: { passwordHash },
  })
}
