import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'

// ── DB helpers ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Verify DB connection
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  // Delete in dependency order — User cascade-deletes RefreshToken
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

function makeExpiredJwt(userId = 'test-user-id') {
  const secret = process.env['JWT_SECRET'] as string
  return jwt.sign(
    { sub: userId, exp: Math.floor(Date.now() / 1000) - 3600 },
    secret
  )
}

// ── Registration ──────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  it('201 with { user: { id, email, createdAt } }', async () => {
    // FRS-3.1.1, FRS-3.1.5
    const res = await registerUser()

    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({
      email: 'alice@example.com',
    })
    expect(res.body.user.id).toBeDefined()
    expect(res.body.user.createdAt).toBeDefined()
  })

  it('201 response never contains passwordHash', async () => {
    // FRS-3.1.4
    const res = await registerUser()

    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
    expect(JSON.stringify(res.body)).not.toContain('argon2')
  })

  it('422 DUPLICATE_EMAIL on second identical email', async () => {
    // FRS-3.1.2
    await registerUser()
    const res = await registerUser()

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL')
  })

  it('422 DUPLICATE_EMAIL on case-insensitive match', async () => {
    // FRS-3.1.2 — email uniqueness is case-insensitive (stored lower-cased)
    await registerUser('alice@example.com')
    const res = await registerUser('ALICE@EXAMPLE.COM')

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL')
  })

  it('400 field error on malformed email', async () => {
    // FRS-3.1.3
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'notanemail', password: 'Pass1234' })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'email')).toBe(true)
  })

  it('400 field error on password shorter than 8 chars', async () => {
    // FRS-3.1.3
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'alice@example.com', password: 'Ab1' })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'password')).toBe(true)
  })

  it('400 field error on password with no letter', async () => {
    // FRS-3.1.3
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'alice@example.com', password: '12345678' })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'password')).toBe(true)
  })

  it('400 field error on password with no number', async () => {
    // FRS-3.1.3
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'alice@example.com', password: 'abcdefgh' })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'password')).toBe(true)
  })

  it('400 field errors when email and password both missing', async () => {
    // FRS-3.1.3
    const res = await request(app).post('/api/auth/register').send({})

    expect(res.status).toBe(400)
    expect(res.body.error.fields.length).toBeGreaterThanOrEqual(2)
  })
})

// ── Login ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await registerUser()
  })

  it('200 with { accessToken, refreshToken, user }', async () => {
    // FRS-3.2.1, FRS-3.2.2
    const res = await loginUser()

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: { email: 'alice@example.com' },
    })
  })

  it('email lookup is case-insensitive', async () => {
    // spec scenario (plan §F)
    const res = await loginUser('ALICE@EXAMPLE.COM', 'Pass1234')

    expect(res.status).toBe(200)
  })

  it('401 UNAUTHORIZED on wrong password (no field hint)', async () => {
    // FRS-3.2.3
    const res = await loginUser('alice@example.com', 'WrongPassword1')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
    expect(res.body.error).not.toHaveProperty('fields')
  })

  it('401 UNAUTHORIZED on unknown email (same body, no leak)', async () => {
    // FRS-3.2.3
    const res = await loginUser('nobody@example.com', 'Pass1234')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('second login creates a new token without revoking the first', async () => {
    // spec scenario (multi-session)
    const first = await loginUser()
    const second = await loginUser()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    // Both refresh tokens should be independently valid
    expect(first.body.refreshToken).not.toBe(second.body.refreshToken)

    const refreshFirst = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
    expect(refreshFirst.status).toBe(200)
  })
})

// ── Refresh ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/refresh', () => {
  it('200 with new accessToken and refreshToken', async () => {
    // FRS-3.3.1
    await registerUser()
    const { body: { refreshToken } } = await loginUser()

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    })
    expect(res.body.refreshToken).not.toBe(refreshToken)
  })

  it('401 when presenting the old token after rotation', async () => {
    // FRS-3.3.2
    await registerUser()
    const { body: { refreshToken } } = await loginUser()
    await request(app).post('/api/auth/refresh').send({ refreshToken })

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken })

    expect(res.status).toBe(401)
  })

  it('401 on unknown token', async () => {
    // FRS-3.3.2
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'totally-unknown-token' })

    expect(res.status).toBe(401)
  })

  it('400 field error when refreshToken field missing', async () => {
    // spec scenario
    const res = await request(app).post('/api/auth/refresh').send({})

    expect(res.status).toBe(400)
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'refreshToken')).toBe(true)
  })
})

// ── Logout ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('204 and token no longer accepted for refresh', async () => {
    // FRS-3.3.3
    await registerUser()
    const { body: { accessToken, refreshToken } } = await loginUser()

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
    expect(logoutRes.status).toBe(204)

    const refreshRes = await request(app).post('/api/auth/refresh').send({ refreshToken })
    expect(refreshRes.status).toBe(401)
  })

  it('401 without Authorization header (no JWT)', async () => {
    // spec scenario — logout now requires a valid JWT for ownership verification
    await registerUser()
    const { body: { refreshToken } } = await loginUser()

    const res = await request(app).post('/api/auth/logout').send({ refreshToken })
    expect(res.status).toBe(401)
  })

  it('401 on unknown refresh token (valid JWT)', async () => {
    // spec scenario — valid JWT but refresh token not in DB
    await registerUser()
    const { body: { accessToken } } = await loginUser()

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken: 'unknown-token' })

    expect(res.status).toBe(401)
  })

  it('401 on already-revoked refresh token', async () => {
    // spec scenario — revokedAt check
    await registerUser()
    const { body: { accessToken, refreshToken } } = await loginUser()

    // First logout — succeeds
    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })

    // Second logout with the same (now-revoked) token
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
    expect(res.status).toBe(401)
  })

  it('401 when refresh token belongs to a different user', async () => {
    // spec scenario — ownership: alice cannot revoke bob's refresh token
    await registerUser('alice@example.com')
    await registerUser('bob@example.com')
    const { body: { accessToken: aliceAccessToken } } = await loginUser('alice@example.com')
    const { body: { refreshToken: bobRefreshToken } } = await loginUser('bob@example.com')

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${aliceAccessToken}`)
      .send({ refreshToken: bobRefreshToken })

    expect(res.status).toBe(401)
  })
})

// ── Auth middleware ───────────────────────────────────────────────────────────

describe('Auth middleware', () => {
  it('401 UNAUTHORIZED with no Authorization header on a protected route', async () => {
    // FRS-3.3.4
    const res = await request(app).get('/api/anything-protected')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('401 UNAUTHORIZED with malformed JWT', async () => {
    // FRS-3.3.4
    const res = await request(app)
      .get('/api/anything-protected')
      .set('Authorization', 'Bearer this.is.not.a.valid.jwt')

    expect(res.status).toBe(401)
  })

  it('401 UNAUTHORIZED with expired JWT', async () => {
    // FRS-3.3.4
    const expiredToken = makeExpiredJwt()
    const res = await request(app)
      .get('/api/anything-protected')
      .set('Authorization', `Bearer ${expiredToken}`)

    expect(res.status).toBe(401)
  })

  it('request passes through with valid JWT (req.userId attached)', async () => {
    // FRS-3.3.4
    await registerUser()
    const { body: { accessToken } } = await loginUser()

    const res = await request(app)
      .get('/api/anything-protected')
      .set('Authorization', `Bearer ${accessToken}`)

    // Auth middleware passes — Express returns 404 (no route matched), not 401
    expect(res.status).not.toBe(401)
  })

  it('public routes bypass the middleware — register requires no token', async () => {
    // spec scenario
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'Pass1234' })

    expect(res.status).toBe(201)
  })
})
