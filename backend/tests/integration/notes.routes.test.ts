import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
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
  // Delete in dependency order — notes depend on users
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

// ── POST /api/notes ───────────────────────────────────────────────────────────

describe('POST /api/notes', () => {
  it('201 with { note: { id, title, content, createdAt, updatedAt } } when body has title+content', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'My Note', content: validContent })

    expect(res.status).toBe(201)
    expect(res.body.note).toMatchObject({
      title: 'My Note',
    })
    expect(res.body.note.id).toBeDefined()
    expect(res.body.note.createdAt).toBeDefined()
    expect(res.body.note.updatedAt).toBeDefined()
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('201 with blank body {} (title defaults to empty string, content defaults to empty doc)', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(201)
    expect(res.body.note).toBeDefined()
    expect(res.body.note.id).toBeDefined()
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('400 VALIDATION_ERROR when content is a plain string (not a TipTap doc)', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Bad Note', content: 'just a plain string' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app)
      .post('/api/notes')
      .send({ title: 'My Note', content: validContent })

    expect(res.status).toBe(401)
  })
})

// ── GET /api/notes ────────────────────────────────────────────────────────────

describe('GET /api/notes', () => {
  it('200 { data: [...], page: 1, limit: 20, total } — correct envelope shape', async () => {
    const { token } = await registerAndLogin()
    await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Note 1', content: validContent })

    const res = await request(app)
      .get('/api/notes')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      page: 1,
      limit: 20,
    })
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(typeof res.body.total).toBe('number')
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('only returns the authenticated user\'s active notes (no cross-user data leak)', async () => {
    const alice = await registerAndLogin('alice@example.com')
    const bob = await registerAndLogin('bob@example.com')

    await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ title: 'Alice Note', content: validContent })

    await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ title: 'Bob Note', content: validContent })

    const res = await request(app)
      .get('/api/notes')
      .set('Authorization', `Bearer ${alice.token}`)

    expect(res.status).toBe(200)
    const titles = res.body.data.map((n: { title: string }) => n.title)
    expect(titles).toContain('Alice Note')
    expect(titles).not.toContain('Bob Note')
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('?page=abc → 400 VALIDATION_ERROR (non-numeric page)', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .get('/api/notes?page=abc')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('?page=0&limit=999 → 200 with page: 1, limit: 100 in response (clamped, not rejected)', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .get('/api/notes?page=0&limit=999')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(100)
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('empty list → { data: [], total: 0 }', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .get('/api/notes')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.total).toBe(0)
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('notes are returned in last-updated-descending order', async () => {
    const { token } = await registerAndLogin()

    const resA = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Note A' })
    const noteAId = resA.body.note.id as string

    const resB = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Note B' })
    const noteBId = resB.body.note.id as string

    // Patch A so it gets a newer updatedAt than B
    await request(app)
      .patch(`/api/notes/${noteAId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Note A Updated' })

    const res = await request(app)
      .get('/api/notes')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0].id).toBe(noteAId)
    expect(res.body.data[1].id).toBe(noteBId)
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app).get('/api/notes')

    expect(res.status).toBe(401)
  })
})

// ── GET /api/notes/:id ────────────────────────────────────────────────────────

describe('GET /api/notes/:id', () => {
  it('200 { note: { id, title, content, createdAt, updatedAt } } for owned note', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'My Note', content: validContent })
    const noteId = createRes.body.note.id as string

    const res = await request(app)
      .get(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.note).toMatchObject({ id: noteId, title: 'My Note' })
    expect(res.body.note.createdAt).toBeDefined()
    expect(res.body.note.updatedAt).toBeDefined()
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('404 for a note owned by a different user (no existence leak)', async () => {
    const alice = await registerAndLogin('alice@example.com')
    const bob = await registerAndLogin('bob@example.com')

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ title: 'Bob Note', content: validContent })
    const bobNoteId = createRes.body.note.id as string

    const res = await request(app)
      .get(`/api/notes/${bobNoteId}`)
      .set('Authorization', `Bearer ${alice.token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('404 for a non-existent id', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .get('/api/notes/nonexistent-id-00000000')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('404 for a soft-deleted note', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Soon Deleted', content: validContent })
    const noteId = createRes.body.note.id as string

    await prisma.note.update({
      where: { id: noteId },
      data: { deletedAt: new Date() },
    })

    const res = await request(app)
      .get(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('404 response body must NOT contain a fields key', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .get('/api/notes/nonexistent-id-00000000')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.fields).toBeUndefined()
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app).get('/api/notes/some-id')

    expect(res.status).toBe(401)
  })
})

// ── PATCH /api/notes/:id ──────────────────────────────────────────────────────

describe('PATCH /api/notes/:id', () => {
  it('200 with updated note when body has { title } only', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Original Title', content: validContent })
    const noteId = createRes.body.note.id as string

    const res = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated Title' })

    expect(res.status).toBe(200)
    expect(res.body.note.title).toBe('Updated Title')
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('partial update: if body only has title, content field in response is unchanged', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Original', content: validContent })
    const noteId = createRes.body.note.id as string
    const originalContent = createRes.body.note.content

    const res = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Title' })

    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body.note.content)).toBe(JSON.stringify(originalContent))
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('422 NOTE_DELETED when patching a soft-deleted note', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'To Delete', content: validContent })
    const noteId = createRes.body.note.id as string

    await prisma.note.update({
      where: { id: noteId },
      data: { deletedAt: new Date() },
    })

    const res = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Attempt Update' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('NOTE_DELETED')
  })

  it('404 for a note owned by another user', async () => {
    const alice = await registerAndLogin('alice@example.com')
    const bob = await registerAndLogin('bob@example.com')

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ title: 'Bob Note', content: validContent })
    const bobNoteId = createRes.body.note.id as string

    const res = await request(app)
      .patch(`/api/notes/${bobNoteId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ title: 'Alice Hijacks' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('partial update: if body only has content, title field in response is unchanged', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Keep This Title', content: validContent })
    const noteId = createRes.body.note.id as string

    const newContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New content' }] }] }

    const res = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: newContent })

    expect(res.status).toBe(200)
    expect(res.body.note.title).toBe('Keep This Title')
    expect(JSON.stringify(res.body)).not.toContain('contentText')
  })

  it('404 for a non-existent note id', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .patch('/api/notes/nonexistent-id-00000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Update' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('400 VALIDATION_ERROR for empty body {} (at least one field required)', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'My Note', content: validContent })
    const noteId = createRes.body.note.id as string

    const res = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app)
      .patch('/api/notes/some-id')
      .send({ title: 'Updated' })

    expect(res.status).toBe(401)
  })
})

// ── DELETE /api/notes/:id ─────────────────────────────────────────────────────

describe('DELETE /api/notes/:id', () => {
  it('204 and the DB row is still present with deletedAt set (soft-delete)', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'To Soft Delete', content: validContent })
    const noteId = createRes.body.note.id as string

    const res = await request(app)
      .delete(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)

    const dbNote = await prisma.note.findFirst({ where: { id: noteId } })
    expect(dbNote).not.toBeNull()
    expect(dbNote?.deletedAt).not.toBeNull()
  })

  it('404 for another user\'s note', async () => {
    const alice = await registerAndLogin('alice@example.com')
    const bob = await registerAndLogin('bob@example.com')

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ title: 'Bob Note', content: validContent })
    const bobNoteId = createRes.body.note.id as string

    const res = await request(app)
      .delete(`/api/notes/${bobNoteId}`)
      .set('Authorization', `Bearer ${alice.token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('404 for a non-existent note id', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .delete('/api/notes/nonexistent-id-00000000')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('404 for an already-deleted note (delete twice; second call must 404)', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Delete Me', content: validContent })
    const noteId = createRes.body.note.id as string

    await request(app)
      .delete(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)

    const res = await request(app)
      .delete(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app).delete('/api/notes/some-id')

    expect(res.status).toBe(401)
  })
})

// ── POST /api/notes/:id/restore ───────────────────────────────────────────────

describe('POST /api/notes/:id/restore', () => {
  it('200 and note reappears in GET /api/notes list after restore', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Restore Me', content: validContent })
    const noteId = createRes.body.note.id as string

    // Soft-delete it
    await request(app)
      .delete(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)

    // Restore
    const restoreRes = await request(app)
      .post(`/api/notes/${noteId}/restore`)
      .set('Authorization', `Bearer ${token}`)

    expect(restoreRes.status).toBe(200)
    expect(JSON.stringify(restoreRes.body)).not.toContain('contentText')

    // Verify it reappears in list
    const listRes = await request(app)
      .get('/api/notes')
      .set('Authorization', `Bearer ${token}`)

    const ids = listRes.body.data.map((n: { id: string }) => n.id)
    expect(ids).toContain(noteId)
    expect(JSON.stringify(listRes.body)).not.toContain('contentText')
  })

  it('422 RESTORE_WINDOW_EXPIRED when deletedAt is 31 days ago', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Expired Note', content: validContent })
    const noteId = createRes.body.note.id as string

    // Seed with old deletedAt (31 days ago, past the 30-day window)
    await prisma.note.update({
      where: { id: noteId },
      data: { deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    })

    const res = await request(app)
      .post(`/api/notes/${noteId}/restore`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('RESTORE_WINDOW_EXPIRED')
  })

  it('422 NOTE_NOT_DELETED when note is active', async () => {
    const { token } = await registerAndLogin()
    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Active Note', content: validContent })
    const noteId = createRes.body.note.id as string

    const res = await request(app)
      .post(`/api/notes/${noteId}/restore`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('NOTE_NOT_DELETED')
  })

  it('404 for another user\'s note', async () => {
    const alice = await registerAndLogin('alice@example.com')
    const bob = await registerAndLogin('bob@example.com')

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ title: 'Bob Note', content: validContent })
    const bobNoteId = createRes.body.note.id as string

    await prisma.note.update({
      where: { id: bobNoteId },
      data: { deletedAt: new Date() },
    })

    const res = await request(app)
      .post(`/api/notes/${bobNoteId}/restore`)
      .set('Authorization', `Bearer ${alice.token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('404 for a non-existent note id', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .post('/api/notes/nonexistent-id-00000000/restore')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app).post('/api/notes/some-id/restore')

    expect(res.status).toBe(401)
  })
})
