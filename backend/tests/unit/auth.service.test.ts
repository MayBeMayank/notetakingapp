import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictError, UnauthorizedError } from '../../src/lib/errors.js'

vi.mock('../../src/repositories/auth.repository.js')
vi.mock('../../src/lib/hash.js')
vi.mock('../../src/lib/token.js')
vi.mock('../../src/lib/jwt.js')

import * as authRepo from '../../src/repositories/auth.repository.js'
import * as hashLib from '../../src/lib/hash.js'
import * as tokenLib from '../../src/lib/token.js'
import * as jwtLib from '../../src/lib/jwt.js'
import { register, login, refresh, logout } from '../../src/services/auth.service.js'

const mockedRepo = vi.mocked(authRepo)
const mockedHash = vi.mocked(hashLib)
const mockedToken = vi.mocked(tokenLib)
const mockedJwt = vi.mocked(jwtLib)

const fakeUser = {
  id: 'user-id-1',
  email: 'alice@example.com',
  passwordHash: '$argon2id$...',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const fakeRefreshTokenRow = {
  id: 'token-row-id',
  userId: 'user-id-1',
  tokenHash: 'sha256-token-hash',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  revokedAt: null,
  createdAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedHash.hashPassword.mockResolvedValue('hashed-password')
  mockedHash.verifyPassword.mockResolvedValue(true)
  mockedHash.hashToken.mockImplementation((t: string) => `sha256:${t}`)
  mockedToken.generateRefreshToken.mockReturnValue('raw-refresh-token')
  mockedJwt.signAccessToken.mockReturnValue('signed-access-token')
})

// ── register ──────────────────────────────────────────────────────────────────

describe('register', () => {
  it('creates user and returns { user: { id, email, createdAt } }', async () => {
    // FRS-3.1.1, FRS-3.1.5
    mockedRepo.findUserByEmail.mockResolvedValue(null)
    mockedRepo.createUser.mockResolvedValue(fakeUser)

    const result = await register({ email: 'Alice@Example.COM', password: 'Pass1234' })

    expect(result).toEqual({
      user: { id: fakeUser.id, email: fakeUser.email, createdAt: fakeUser.createdAt },
    })
    // email is lowercased before write
    expect(mockedRepo.findUserByEmail).toHaveBeenCalledWith('alice@example.com')
    expect(mockedRepo.createUser).toHaveBeenCalledWith({
      email: 'alice@example.com',
      passwordHash: 'hashed-password',
    })
  })

  it('throws ConflictError(DUPLICATE_EMAIL) when email already in use', async () => {
    // FRS-3.1.2
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)

    await expect(register({ email: 'alice@example.com', password: 'Pass1234' })).rejects.toThrow(
      ConflictError
    )
    await expect(register({ email: 'alice@example.com', password: 'Pass1234' })).rejects.toMatchObject({
      code: 'DUPLICATE_EMAIL',
      statusCode: 422,
    })
  })

  it('passwordHash never appears in the return value', async () => {
    // FRS-3.1.4
    mockedRepo.findUserByEmail.mockResolvedValue(null)
    mockedRepo.createUser.mockResolvedValue(fakeUser)

    const result = await register({ email: 'alice@example.com', password: 'Pass1234' })

    expect(JSON.stringify(result)).not.toContain('passwordHash')
    expect(JSON.stringify(result)).not.toContain('argon2')
  })
})

// ── login ────────────────────────────────────────────────────────────────────

describe('login', () => {
  it('returns accessToken + refreshToken + user on valid credentials', async () => {
    // FRS-3.2.1, FRS-3.2.2
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    mockedRepo.createRefreshToken.mockResolvedValue({ ...fakeRefreshTokenRow })

    const result = await login({ email: 'alice@example.com', password: 'Pass1234' })

    expect(result).toMatchObject({
      accessToken: 'signed-access-token',
      refreshToken: 'raw-refresh-token',
      user: { id: fakeUser.id, email: fakeUser.email },
    })
    expect(mockedJwt.signAccessToken).toHaveBeenCalledWith(fakeUser.id)
  })

  it('refreshToken is stored as SHA-256 hash, not plaintext', async () => {
    // FRS-3.2.2 (plan §A — deterministic hash for indexable lookup)
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    mockedRepo.createRefreshToken.mockResolvedValue({ ...fakeRefreshTokenRow })

    await login({ email: 'alice@example.com', password: 'Pass1234' })

    expect(mockedRepo.createRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: 'sha256:raw-refresh-token' })
    )
  })

  it('throws UnauthorizedError on wrong password (generic message)', async () => {
    // FRS-3.2.3
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    mockedHash.verifyPassword.mockResolvedValue(false)

    await expect(login({ email: 'alice@example.com', password: 'wrong' })).rejects.toThrow(
      UnauthorizedError
    )
    await expect(login({ email: 'alice@example.com', password: 'wrong' })).rejects.toMatchObject({
      message: 'Invalid email or password',
    })
  })

  it('throws UnauthorizedError on unknown email (same message, no existence leak)', async () => {
    // FRS-3.2.3
    mockedRepo.findUserByEmail.mockResolvedValue(null)

    await expect(login({ email: 'nobody@example.com', password: 'Pass1234' })).rejects.toMatchObject({
      message: 'Invalid email or password',
      statusCode: 401,
    })
  })
})

// ── refresh ───────────────────────────────────────────────────────────────────

describe('refresh', () => {
  it('revokes old token and creates a new one (rotation)', async () => {
    // FRS-3.3.1
    mockedRepo.findRefreshToken.mockResolvedValue({ ...fakeRefreshTokenRow })
    mockedRepo.revokeRefreshToken.mockResolvedValue(undefined)
    mockedRepo.createRefreshToken.mockResolvedValue({ ...fakeRefreshTokenRow })

    const result = await refresh({ refreshToken: 'old-token' })

    expect(mockedRepo.revokeRefreshToken).toHaveBeenCalledWith(fakeRefreshTokenRow.id)
    expect(mockedRepo.createRefreshToken).toHaveBeenCalled()
    expect(result).toMatchObject({ accessToken: 'signed-access-token', refreshToken: 'raw-refresh-token' })
  })

  it('throws UnauthorizedError when token is expired', async () => {
    // FRS-3.3.2
    mockedRepo.findRefreshToken.mockResolvedValue({
      ...fakeRefreshTokenRow,
      expiresAt: new Date(Date.now() - 1000), // in the past
    })

    await expect(refresh({ refreshToken: 'expired-token' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    })
  })

  it('throws UnauthorizedError when token is revoked', async () => {
    // FRS-3.3.2
    mockedRepo.findRefreshToken.mockResolvedValue({
      ...fakeRefreshTokenRow,
      revokedAt: new Date(),
    })

    await expect(refresh({ refreshToken: 'revoked-token' })).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('throws UnauthorizedError when token hash matches no row', async () => {
    // FRS-3.3.2
    mockedRepo.findRefreshToken.mockResolvedValue(null)

    await expect(refresh({ refreshToken: 'unknown-token' })).rejects.toMatchObject({
      statusCode: 401,
    })
  })
})

// ── logout ────────────────────────────────────────────────────────────────────

describe('logout', () => {
  it('calls revokeRefreshToken with the matching row id', async () => {
    // FRS-3.3.3
    mockedRepo.findRefreshToken.mockResolvedValue({ ...fakeRefreshTokenRow })
    mockedRepo.revokeRefreshToken.mockResolvedValue(undefined)

    await logout({ refreshToken: 'valid-token' }, fakeUser.id)

    expect(mockedRepo.revokeRefreshToken).toHaveBeenCalledWith(fakeRefreshTokenRow.id)
  })

  it('throws UnauthorizedError when token is not found', async () => {
    // spec scenario
    mockedRepo.findRefreshToken.mockResolvedValue(null)

    await expect(logout({ refreshToken: 'unknown-token' }, fakeUser.id)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('throws UnauthorizedError when token belongs to a different user', async () => {
    // spec scenario — ownership check
    mockedRepo.findRefreshToken.mockResolvedValue({
      ...fakeRefreshTokenRow,
      userId: 'other-user-id',
    })

    await expect(logout({ refreshToken: 'other-users-token' }, fakeUser.id)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('throws UnauthorizedError when token is already revoked', async () => {
    // spec scenario — revokedAt check
    mockedRepo.findRefreshToken.mockResolvedValue({
      ...fakeRefreshTokenRow,
      revokedAt: new Date(),
    })

    await expect(logout({ refreshToken: 'revoked-token' }, fakeUser.id)).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    })
  })
})
