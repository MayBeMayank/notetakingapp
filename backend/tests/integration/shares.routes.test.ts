import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'

// ── DB lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.noteVersion.deleteMany()
  await prisma.shareLink.deleteMany()
  await prisma.noteTag.deleteMany()
  await prisma.note.deleteMany()
  await prisma.tag.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.passwordResetOtp.deleteMany()
  await prisma.user.deleteMany()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function registerAndLogin(email = 'alice@example.com', password = 'Pass1234') {
  await request(app).post('/api/auth/register').send({ email, password })
  const res = await request(app).post('/api/auth/login').send({ email, password })
  return { token: res.body.accessToken as string, userId: res.body.user.id as string }
}

const validContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
}

async function createNote(token: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/notes')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Note', content: validContent, ...body })
  return res.body.note.id as string
}

async function createShare(token: string, noteId: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/notes/${noteId}/shares`)
    .set('Authorization', `Bearer ${token}`)
    .send(body)
  return res
}

// ── POST /api/notes/:id/shares ──────────────────────────────────────────────────

describe('POST /api/notes/:id/shares', () => {
  it('201 { share } with token, relative url, expiresAt null, viewCount 0 (no expiry)', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)

    const res = await createShare(token, noteId, {})

    expect(res.status).toBe(201)
    expect(res.body.share).toMatchObject({ noteId, expiresAt: null, viewCount: 0 })
    expect(res.body.share.id).toBeDefined()
    expect(res.body.share.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(res.body.share.url).toBe(`/s/${res.body.share.token}`)
  })

  it('201 with a valid future expiresAt → echoes it back', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const future = new Date('2099-01-01T00:00:00.000Z').toISOString()

    const res = await createShare(token, noteId, { expiresAt: future })

    expect(res.status).toBe(201)
    expect(new Date(res.body.share.expiresAt).toISOString()).toBe(future)
  })

  it('400 VALIDATION_ERROR with fields[expiresAt] for a past expiresAt', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const past = new Date('2000-01-01T00:00:00.000Z').toISOString()

    const res = await createShare(token, noteId, { expiresAt: past })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'expiresAt')).toBe(true)
  })

  it('400 VALIDATION_ERROR for a malformed expiresAt', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)

    const res = await createShare(token, noteId, { expiresAt: 'not-a-date' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('404 when the note does not exist', async () => {
    const { token } = await registerAndLogin()
    const res = await createShare(token, 'nonexistent-id', {})
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('404 (never 403) when the note belongs to another user', async () => {
    const alice = await registerAndLogin('alice@example.com')
    const bob = await registerAndLogin('bob@example.com')
    const bobNote = await createNote(bob.token)

    const res = await createShare(alice.token, bobNote, {})

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('422 NOTE_DELETED when sharing a soft-deleted note', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    await request(app).delete(`/api/notes/${noteId}`).set('Authorization', `Bearer ${token}`)

    const res = await createShare(token, noteId, {})

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('NOTE_DELETED')
  })

  it('mints a NEW distinct token on each call (multiple active links per note)', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)

    const a = await createShare(token, noteId, {})
    const b = await createShare(token, noteId, {})

    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(a.body.share.token).not.toBe(b.body.share.token)
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app).post('/api/notes/some-id/shares').send({})
    expect(res.status).toBe(401)
  })
})

// ── GET /api/shares ─────────────────────────────────────────────────────────────

describe('GET /api/shares', () => {
  it('200 bare array (no { data, page, limit, total } envelope)', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    await createShare(token, noteId, {})

    const res = await request(app).get('/api/shares').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ noteId, viewCount: 0 })
  })

  it('excludes revoked links', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = (await createShare(token, noteId, {})).body.share
    await request(app).delete(`/api/shares/${share.id}`).set('Authorization', `Bearer ${token}`)

    const res = await request(app).get('/api/shares').set('Authorization', `Bearer ${token}`)

    expect(res.body.find((s: { id: string }) => s.id === share.id)).toBeUndefined()
  })

  it('includes expired-but-not-revoked links', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = (await createShare(token, noteId, {})).body.share
    await prisma.shareLink.update({
      where: { id: share.id },
      data: { expiresAt: new Date('2000-01-01T00:00:00.000Z') },
    })

    const res = await request(app).get('/api/shares').set('Authorization', `Bearer ${token}`)

    expect(res.body.find((s: { id: string }) => s.id === share.id)).toBeDefined()
  })

  it('includes links whose underlying note is soft-deleted', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = (await createShare(token, noteId, {})).body.share
    await request(app).delete(`/api/notes/${noteId}`).set('Authorization', `Bearer ${token}`)

    const res = await request(app).get('/api/shares').set('Authorization', `Bearer ${token}`)

    expect(res.body.find((s: { id: string }) => s.id === share.id)).toBeDefined()
  })

  it('is ordered by createdAt descending (newest first)', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const older = (await createShare(token, noteId, {})).body.share
    const newer = (await createShare(token, noteId, {})).body.share
    // Force a deterministic gap so the ordering assertion is stable.
    await prisma.shareLink.update({
      where: { id: older.id },
      data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
    })
    await prisma.shareLink.update({
      where: { id: newer.id },
      data: { createdAt: new Date('2026-06-01T00:00:00.000Z') },
    })

    const res = await request(app).get('/api/shares').set('Authorization', `Bearer ${token}`)

    expect(res.body.map((s: { id: string }) => s.id)).toEqual([newer.id, older.id])
  })

  it("excludes other users' shares", async () => {
    const alice = await registerAndLogin('alice@example.com')
    const bob = await registerAndLogin('bob@example.com')
    const bobNote = await createNote(bob.token)
    await createShare(bob.token, bobNote, {})

    const res = await request(app).get('/api/shares').set('Authorization', `Bearer ${alice.token}`)

    expect(res.body).toEqual([])
  })

  it('200 [] when the user has no shares', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app).get('/api/shares').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app).get('/api/shares')
    expect(res.status).toBe(401)
  })
})

// ── DELETE /api/shares/:id ──────────────────────────────────────────────────────

describe('DELETE /api/shares/:id', () => {
  it('204 revoking an own link; it disappears from the list', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = (await createShare(token, noteId, {})).body.share

    const del = await request(app).delete(`/api/shares/${share.id}`).set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(204)

    const list = await request(app).get('/api/shares').set('Authorization', `Bearer ${token}`)
    expect(list.body.find((s: { id: string }) => s.id === share.id)).toBeUndefined()

    const row = await prisma.shareLink.findUnique({ where: { id: share.id } })
    expect(row?.revokedAt).not.toBeNull()
  })

  it('404 with NOT_FOUND envelope (no fields) for an unknown id', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app).delete('/api/shares/nope').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(res.body.error.fields).toBeUndefined()
  })

  it('404 (never 403) when the link belongs to another user', async () => {
    const alice = await registerAndLogin('alice@example.com')
    const bob = await registerAndLogin('bob@example.com')
    const bobNote = await createNote(bob.token)
    const bobShare = (await createShare(bob.token, bobNote, {})).body.share

    const res = await request(app).delete(`/api/shares/${bobShare.id}`).set('Authorization', `Bearer ${alice.token}`)

    expect(res.status).toBe(404)
  })

  it('idempotent: revoking an already-revoked own link still returns 204', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = (await createShare(token, noteId, {})).body.share

    const first = await request(app).delete(`/api/shares/${share.id}`).set('Authorization', `Bearer ${token}`)
    const second = await request(app).delete(`/api/shares/${share.id}`).set('Authorization', `Bearer ${token}`)

    expect(first.status).toBe(204)
    expect(second.status).toBe(204)
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app).delete('/api/shares/some-id')
    expect(res.status).toBe(401)
  })
})
