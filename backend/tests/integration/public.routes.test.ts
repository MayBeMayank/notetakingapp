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

async function createShareToken(token: string, noteId: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/notes/${noteId}/shares`)
    .set('Authorization', `Bearer ${token}`)
    .send(body)
  return { token: res.body.share.token as string, id: res.body.share.id as string }
}

// ── GET /api/public/notes/:token — happy path ───────────────────────────────────

describe('GET /api/public/notes/:token (view)', () => {
  it('200 { title, content } with NO Authorization header', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token, { title: 'Public Note' })
    const share = await createShareToken(token, noteId)

    const res = await request(app).get(`/api/public/notes/${share.token}`)

    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Public Note')
    expect(res.body.content).toEqual(validContent)
    expect(Object.keys(res.body).sort()).toEqual(['content', 'title'])
  })

  it('an access token neither helps nor is required — identical result with a Bearer header', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token, { title: 'Public Note' })
    const share = await createShareToken(token, noteId)

    const anon = await request(app).get(`/api/public/notes/${share.token}`)
    const withAuth = await request(app)
      .get(`/api/public/notes/${share.token}`)
      .set('Authorization', `Bearer ${token}`)

    expect(withAuth.status).toBe(200)
    expect(withAuth.body).toEqual(anon.body)
  })

  it('serves the note CURRENT content, not a snapshot from link-creation time', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token, { title: 'Before' })
    const share = await createShareToken(token, noteId)

    const editedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'After' }] }] }
    await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'After', content: editedContent })

    const res = await request(app).get(`/api/public/notes/${share.token}`)

    expect(res.body.title).toBe('After')
    expect(res.body.content).toEqual(editedContent)
  })

  it('no-leak: exposes only title+content — no tags, owner, ids, or timestamps', async () => {
    const { token, userId } = await registerAndLogin()
    const tagRes = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'confidential-xyz', color: '#3B82F6' })
    const noteId = await createNote(token, { tagIds: [tagRes.body.tag.id] })
    const share = await createShareToken(token, noteId)

    const res = await request(app).get(`/api/public/notes/${share.token}`)
    const serialized = JSON.stringify(res.body)

    expect(Object.keys(res.body).sort()).toEqual(['content', 'title'])
    expect(serialized).not.toContain('confidential-xyz') // tag name
    expect(serialized).not.toContain(tagRes.body.tag.id) // tag id
    expect(serialized).not.toContain(userId) // owner identity
    expect(serialized).not.toContain(noteId) // note id
    for (const leak of ['userId', 'tagId', 'tagIds', 'deletedAt', 'contentText', 'viewCount', 'createdAt', 'updatedAt', 'token']) {
      expect(serialized).not.toContain(leak)
    }
  })
})

// ── GET /api/public/notes/:token — inaccessible links ───────────────────────────

describe('GET /api/public/notes/:token (inaccessible)', () => {
  it('404 NOT_FOUND for an unknown token', async () => {
    const res = await request(app).get('/api/public/notes/this-token-does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('410 SHARE_GONE for a revoked link', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = await createShareToken(token, noteId)
    await request(app).delete(`/api/shares/${share.id}`).set('Authorization', `Bearer ${token}`)

    const res = await request(app).get(`/api/public/notes/${share.token}`)

    expect(res.status).toBe(410)
    expect(res.body.error.code).toBe('SHARE_GONE')
  })

  it('410 for an expired link (expiresAt in the past)', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = await createShareToken(token, noteId)
    await prisma.shareLink.update({
      where: { id: share.id },
      data: { expiresAt: new Date('2000-01-01T00:00:00.000Z') },
    })

    const res = await request(app).get(`/api/public/notes/${share.token}`)

    expect(res.status).toBe(410)
    expect(res.body.error.code).toBe('SHARE_GONE')
  })

  it('410 when the underlying note is soft-deleted', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = await createShareToken(token, noteId)
    await request(app).delete(`/api/notes/${noteId}`).set('Authorization', `Bearer ${token}`)

    const res = await request(app).get(`/api/public/notes/${share.token}`)

    expect(res.status).toBe(410)
    expect(res.body.error.code).toBe('SHARE_GONE')
  })

  it('410 body uses the standard envelope — code only, no fields, no content', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = await createShareToken(token, noteId)
    await request(app).delete(`/api/shares/${share.id}`).set('Authorization', `Bearer ${token}`)

    const res = await request(app).get(`/api/public/notes/${share.token}`)

    expect(res.body).toEqual({ error: { code: 'SHARE_GONE', message: expect.any(String) } })
    expect(res.body.title).toBeUndefined()
    expect(res.body.content).toBeUndefined()
  })
})

// ── Atomic view count (FRS-7.4) ─────────────────────────────────────────────────

describe('view-count increment', () => {
  it('increments viewCount by exactly 1 on a successful view', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = await createShareToken(token, noteId)

    await request(app).get(`/api/public/notes/${share.token}`)

    const row = await prisma.shareLink.findUnique({ where: { id: share.id } })
    expect(row?.viewCount).toBe(1)
  })

  it('concurrent views do not lose updates — N parallel views → +N', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = await createShareToken(token, noteId)

    await Promise.all(
      Array.from({ length: 5 }, () => request(app).get(`/api/public/notes/${share.token}`)),
    )

    const row = await prisma.shareLink.findUnique({ where: { id: share.id } })
    expect(row?.viewCount).toBe(5)
  })

  it('does NOT increment on a 404 (unknown token)', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = await createShareToken(token, noteId)

    await request(app).get('/api/public/notes/unknown-token')

    const row = await prisma.shareLink.findUnique({ where: { id: share.id } })
    expect(row?.viewCount).toBe(0)
  })

  it('does NOT increment on a 410 (revoked link)', async () => {
    const { token } = await registerAndLogin()
    const noteId = await createNote(token)
    const share = await createShareToken(token, noteId)
    await request(app).delete(`/api/shares/${share.id}`).set('Authorization', `Bearer ${token}`)

    await request(app).get(`/api/public/notes/${share.token}`)

    const row = await prisma.shareLink.findUnique({ where: { id: share.id } })
    expect(row?.viewCount).toBe(0)
  })
})
