import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/repositories/auth.repository.js')
vi.mock('../../src/lib/hash.js')
vi.mock('../../src/lib/token.js')

import * as authRepo from '../../src/repositories/auth.repository.js'
import * as hashLib from '../../src/lib/hash.js'
import * as tokenLib from '../../src/lib/token.js'
import { forgotPassword, resetPassword } from '../../src/services/auth.service.js'

const mockedRepo = vi.mocked(authRepo)
const mockedHash = vi.mocked(hashLib)
const mockedToken = vi.mocked(tokenLib)

const fakeUser = {
  id: 'user-id-1',
  email: 'alice@example.com',
  passwordHash: '$argon2id$v=19$...',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const fakeOtpRow = {
  id: 'otp-row-id',
  userId: 'user-id-1',
  codeHash: '$argon2id$otp$...',
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  attempts: 0,
  consumedAt: null,
  createdAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedHash.hashPassword.mockResolvedValue('hashed-value')
  mockedHash.verifyPassword.mockResolvedValue(true)
  mockedToken.generateOtp.mockReturnValue('123456')
  mockedRepo.invalidatePendingOtps.mockResolvedValue(undefined)
  mockedRepo.createPasswordResetOtp.mockResolvedValue(fakeOtpRow)
  mockedRepo.findLatestPendingOtp.mockResolvedValue(fakeOtpRow)
  mockedRepo.consumeOtp.mockResolvedValue(undefined)
  mockedRepo.updateUserPassword.mockResolvedValue(undefined)
  mockedRepo.revokeAllUserRefreshTokens.mockResolvedValue(undefined)
})

// ── forgotPassword ────────────────────────────────────────────────────────────

describe('forgotPassword', () => {
  it('T4.1 — returns { ok: true } for a registered email (OTP row created, console logged)', async () => {
    // FRS-3.4.1, FRS-3.4.2
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await forgotPassword({ email: 'alice@example.com' })

    expect(result).toEqual({ ok: true })
    expect(mockedRepo.createPasswordResetOtp).toHaveBeenCalledWith(
      expect.objectContaining({ userId: fakeUser.id, codeHash: 'hashed-value' })
    )
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('123456'))

    consoleSpy.mockRestore()
  })

  it('T4.2 — returns { ok: true } for an unregistered email (no DB write — FRS-3.4.3)', async () => {
    // Anti-enumeration: response must be identical regardless of email existence
    mockedRepo.findUserByEmail.mockResolvedValue(null)
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await forgotPassword({ email: 'nobody@example.com' })

    expect(result).toEqual({ ok: true })
    expect(mockedRepo.createPasswordResetOtp).not.toHaveBeenCalled()
    expect(mockedRepo.invalidatePendingOtps).not.toHaveBeenCalled()
    expect(consoleSpy).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('T4.3 — invalidates existing pending OTP before issuing a new one', async () => {
    // Replacement behaviour: old OTP must be invalidated before new one is stored
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await forgotPassword({ email: 'alice@example.com' })

    expect(mockedRepo.invalidatePendingOtps).toHaveBeenCalledWith(fakeUser.id)
    expect(mockedRepo.createPasswordResetOtp).toHaveBeenCalled()
    // invalidate must be called before create
    const invalidateOrder = mockedRepo.invalidatePendingOtps.mock.invocationCallOrder[0]
    const createOrder = mockedRepo.createPasswordResetOtp.mock.invocationCallOrder[0]
    expect(invalidateOrder).toBeLessThan(createOrder!)
  })
})

// ── resetPassword ─────────────────────────────────────────────────────────────

describe('resetPassword', () => {
  it('T4.4 — succeeds with a correct, unexpired, unused OTP (FRS-3.4.4 + FRS-3.4.6)', async () => {
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    mockedRepo.findLatestPendingOtp.mockResolvedValue({ ...fakeOtpRow, attempts: 0 })
    mockedHash.verifyPassword.mockResolvedValue(true)

    const result = await resetPassword({
      email: 'alice@example.com',
      otp: '123456',
      newPassword: 'NewPass99',
    })

    expect(result).toEqual({ ok: true })
    expect(mockedRepo.consumeOtp).toHaveBeenCalledWith(fakeOtpRow.id)
    expect(mockedRepo.updateUserPassword).toHaveBeenCalledWith(fakeUser.id, 'hashed-value')
    expect(mockedRepo.revokeAllUserRefreshTokens).toHaveBeenCalledWith(fakeUser.id)
  })

  it('T4.5 — throws INVALID_OTP and increments attempts for a wrong OTP (attempts < 5 — FRS-3.4.5)', async () => {
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    mockedRepo.findLatestPendingOtp.mockResolvedValue({ ...fakeOtpRow, attempts: 2 })
    mockedHash.verifyPassword.mockResolvedValue(false)
    mockedRepo.incrementOtpAttempts.mockResolvedValue(undefined)

    await expect(
      resetPassword({ email: 'alice@example.com', otp: '000000', newPassword: 'NewPass99' })
    ).rejects.toMatchObject({ code: 'INVALID_OTP', statusCode: 422 })

    expect(mockedRepo.incrementOtpAttempts).toHaveBeenCalledWith(fakeOtpRow.id)
    expect(mockedRepo.consumeOtp).not.toHaveBeenCalled()
    expect(mockedRepo.updateUserPassword).not.toHaveBeenCalled()
  })

  it('T4.5b — throws OTP_ATTEMPT_LIMIT_REACHED on the 5th wrong attempt (attempts already 4)', async () => {
    // FRS-3.4.5 — cap triggers on the 5th attempt, not the 6th; OTP is also consumed (invalidated)
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    mockedRepo.findLatestPendingOtp.mockResolvedValue({ ...fakeOtpRow, attempts: 4 })
    mockedHash.verifyPassword.mockResolvedValue(false)
    mockedRepo.incrementOtpAttempts.mockResolvedValue(undefined)

    await expect(
      resetPassword({ email: 'alice@example.com', otp: '000000', newPassword: 'NewPass99' })
    ).rejects.toMatchObject({ code: 'OTP_ATTEMPT_LIMIT_REACHED', statusCode: 422 })

    expect(mockedRepo.incrementOtpAttempts).toHaveBeenCalledWith(fakeOtpRow.id)
    expect(mockedRepo.consumeOtp).toHaveBeenCalledWith(fakeOtpRow.id)
    expect(mockedRepo.updateUserPassword).not.toHaveBeenCalled()
  })

  it('T4.6 — throws OTP_ATTEMPT_LIMIT_REACHED when attempts already at 5 (FRS-3.4.5)', async () => {
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    mockedRepo.findLatestPendingOtp.mockResolvedValue({ ...fakeOtpRow, attempts: 5 })

    await expect(
      resetPassword({ email: 'alice@example.com', otp: '000000', newPassword: 'NewPass99' })
    ).rejects.toMatchObject({ code: 'OTP_ATTEMPT_LIMIT_REACHED', statusCode: 422 })

    expect(mockedRepo.incrementOtpAttempts).not.toHaveBeenCalled()
    expect(mockedRepo.updateUserPassword).not.toHaveBeenCalled()
  })

  it('T4.7 — throws INVALID_OTP for an unregistered email (no account enumeration)', async () => {
    mockedRepo.findUserByEmail.mockResolvedValue(null)

    await expect(
      resetPassword({ email: 'nobody@example.com', otp: '123456', newPassword: 'NewPass99' })
    ).rejects.toMatchObject({ code: 'INVALID_OTP', statusCode: 422 })

    expect(mockedRepo.findLatestPendingOtp).not.toHaveBeenCalled()
  })

  it('T4.8 — throws INVALID_OTP when no unconsumed OTP row exists', async () => {
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    mockedRepo.findLatestPendingOtp.mockResolvedValue(null)

    await expect(
      resetPassword({ email: 'alice@example.com', otp: '123456', newPassword: 'NewPass99' })
    ).rejects.toMatchObject({ code: 'INVALID_OTP', statusCode: 422 })

    expect(mockedRepo.consumeOtp).not.toHaveBeenCalled()
    expect(mockedRepo.updateUserPassword).not.toHaveBeenCalled()
  })

  it('T4.8b — throws OTP_EXPIRED for an expired but unconsumed OTP', async () => {
    // FRS-3.4.5 — expired OTP has a distinct error code from wrong/missing OTP
    mockedRepo.findUserByEmail.mockResolvedValue(fakeUser)
    mockedRepo.findLatestPendingOtp.mockResolvedValue({
      ...fakeOtpRow,
      expiresAt: new Date(Date.now() - 1000),
    })

    await expect(
      resetPassword({ email: 'alice@example.com', otp: '123456', newPassword: 'NewPass99' })
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED', statusCode: 422 })

    expect(mockedRepo.incrementOtpAttempts).not.toHaveBeenCalled()
    expect(mockedRepo.consumeOtp).not.toHaveBeenCalled()
    expect(mockedRepo.updateUserPassword).not.toHaveBeenCalled()
  })
})
