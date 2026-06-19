import type { User, RefreshToken } from '@prisma/client'
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
