import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'

// ── DB helpers ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.passwordResetOtp.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.user.deleteMany()
})

// ── helpers ───────────────────────────────────────────────────────────────────

async function registerUser(email = 'alice@example.com', password = 'Pass1234') {
  return request(app).post('/api/auth/register').send({ email, password })
}

async function loginUser(email = 'alice@example.com', password = 'Pass1234') {
  return request(app).post('/api/auth/login').send({ email, password })
}

async function forgotPassword(email = 'alice@example.com') {
  return request(app).post('/api/auth/forgot-password').send({ email })
}

async function getLatestOtpFromConsole(consoleSpy: ReturnType<typeof vi.spyOn>): Promise<string | null> {
  const calls = consoleSpy.mock.calls
  for (const args of calls) {
    const msg = String(args[0])
    const match = msg.match(/\d{6}/)
    if (match) return match[0]
  }
  return null
}

// ── POST /api/auth/forgot-password ────────────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {
  it('T4.9 — 200 { ok: true } for a registered email', async () => {
    // FRS-3.4.1
    await registerUser()

    const res = await forgotPassword()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('T4.10 — 200 { ok: true } for an unknown email (identical response — FRS-3.4.3)', async () => {
    // Anti-enumeration: unknown email must return same shape + status as known email
    const res = await forgotPassword('nobody@example.com')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('T4.11 — 400 with fields[email] for a malformed email', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'notanemail' })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'email')).toBe(true)
  })
})

// ── POST /api/auth/reset-password ─────────────────────────────────────────────

describe('POST /api/auth/reset-password', () => {
  it('T4.12 — 200 { ok: true } on correct OTP; subsequent login with new password succeeds', async () => {
    // FRS-3.4.4
    await registerUser()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await forgotPassword()
    const otp = await getLatestOtpFromConsole(consoleSpy)
    consoleSpy.mockRestore()
    expect(otp).not.toBeNull()

    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'alice@example.com', otp, newPassword: 'NewPass99' })

    expect(resetRes.status).toBe(200)
    expect(resetRes.body).toEqual({ ok: true })

    // Must be able to login with the new password
    const loginRes = await loginUser('alice@example.com', 'NewPass99')
    expect(loginRes.status).toBe(200)
    expect(loginRes.body.accessToken).toBeDefined()
  })

  it('T4.13 — 422 INVALID_OTP on a wrong OTP', async () => {
    // FRS-3.4.5
    await registerUser()
    await forgotPassword()

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'alice@example.com', otp: '000000', newPassword: 'NewPass99' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('INVALID_OTP')
  })

  it('T4.14 — 422 OTP_ATTEMPT_LIMIT_REACHED on the 5th failed attempt (FRS-3.4.5)', async () => {
    // Cap triggers on attempt 5, not 6 — first 4 wrong attempts return INVALID_OTP
    await registerUser()
    await forgotPassword()

    // Attempts 1–4: INVALID_OTP
    for (let i = 0; i < 4; i++) {
      const r = await request(app)
        .post('/api/auth/reset-password')
        .send({ email: 'alice@example.com', otp: '000000', newPassword: 'NewPass99' })
      expect(r.status).toBe(422)
      expect(r.body.error.code).toBe('INVALID_OTP')
    }

    // Attempt 5: OTP_ATTEMPT_LIMIT_REACHED
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'alice@example.com', otp: '000000', newPassword: 'NewPass99' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('OTP_ATTEMPT_LIMIT_REACHED')
  })

  it('T4.15 — 422 OTP_EXPIRED for an expired OTP', async () => {
    // FRS-3.4.5 — expired OTP has a distinct error code from wrong/missing OTP
    await registerUser()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await forgotPassword()
    const otp = await getLatestOtpFromConsole(consoleSpy)
    consoleSpy.mockRestore()

    // Manually expire the OTP row
    const user = await prisma.user.findUnique({ where: { email: 'alice@example.com' } })
    await prisma.passwordResetOtp.updateMany({
      where: { userId: user!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'alice@example.com', otp, newPassword: 'NewPass99' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('OTP_EXPIRED')
  })

  it('T4.16 — 422 INVALID_OTP for an already-consumed OTP', async () => {
    // FRS-3.4.5 — single-use
    await registerUser()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await forgotPassword()
    const otp = await getLatestOtpFromConsole(consoleSpy)
    consoleSpy.mockRestore()

    // First reset — consumes the OTP
    await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'alice@example.com', otp, newPassword: 'NewPass99' })

    // Second reset with same OTP — must be rejected
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'alice@example.com', otp, newPassword: 'AnotherPass1' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('INVALID_OTP')
  })

  it('T4.17 — 400 with fields[otp] when otp is not 6 numeric digits', async () => {
    // Zod boundary — no DB lookup performed
    const cases = ['abc', '12345', '1234567', '']
    for (const otp of cases) {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ email: 'alice@example.com', otp, newPassword: 'NewPass99' })

      expect(res.status).toBe(400)
      expect(res.body.error.fields.some((f: { field: string }) => f.field === 'otp')).toBe(true)
    }
  })

  it('T4.18 — 400 with fields[newPassword] for a weak new password', async () => {
    // Zod boundary — OTP not consumed, no password change
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'alice@example.com', otp: '123456', newPassword: 'weak' })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'newPassword')).toBe(true)
  })

  it('T4.19 — refresh tokens are revoked; old token rejected after successful reset (FRS-3.4.6)', async () => {
    await registerUser()
    const { body: { refreshToken } } = await loginUser()

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await forgotPassword()
    const otp = await getLatestOtpFromConsole(consoleSpy)
    consoleSpy.mockRestore()

    await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'alice@example.com', otp, newPassword: 'NewPass99' })

    // Old refresh token must now be rejected
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken })

    expect(refreshRes.status).toBe(401)
  })

  it('T4.20 — second forgot-password invalidates first OTP; first OTP is rejected', async () => {
    // Spec: "new request while an unexpired OTP exists" — old OTP must be invalidated
    await registerUser()

    const spy1 = vi.spyOn(console, 'log').mockImplementation(() => {})
    await forgotPassword()
    const otp1 = await getLatestOtpFromConsole(spy1)
    spy1.mockRestore()

    // Second forgot-password — invalidates otp1, issues otp2
    const spy2 = vi.spyOn(console, 'log').mockImplementation(() => {})
    await forgotPassword()
    const otp2 = await getLatestOtpFromConsole(spy2)
    spy2.mockRestore()

    expect(otp1).not.toBeNull()
    expect(otp2).not.toBeNull()

    // otp1 is now invalidated (consumedAt set); otp2 is the active OTP
    // Submitting otp1 will hit otp2's hash verification → INVALID_OTP
    const staleRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'alice@example.com', otp: otp1, newPassword: 'NewPass99' })

    expect(staleRes.status).toBe(422)
    expect(staleRes.body.error.code).toBe('INVALID_OTP')

    // otp2 must still work
    const freshRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'alice@example.com', otp: otp2, newPassword: 'NewPass99' })

    expect(freshRes.status).toBe(200)
    expect(freshRes.body).toEqual({ ok: true })
  })
})
