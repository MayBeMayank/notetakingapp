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

// ── tagIds on notes (T4.4) ────────────────────────────────────────────────────

async function createOwnedTag(token: string, name: string, color = '#3B82F6') {
  const res = await request(app)
    .post('/api/tags')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, color })
  return res.body.tag.id as string
}

describe('POST /api/notes — tagIds', () => {
  it('201 with owned tagIds → response note.tagIds contains those ids', async () => {
    const { token } = await registerAndLogin()
    const tagId = await createOwnedTag(token, 'work')

    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tagged', content: validContent, tagIds: [tagId] })

    expect(res.status).toBe(201)
    expect(res.body.note.tagIds).toEqual([tagId])
  })

  it('201 with no tagIds → response note.tagIds is []', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'No tags', content: validContent })

    expect(res.status).toBe(201)
    expect(res.body.note.tagIds).toEqual([])
  })

  it('422 INVALID_TAG_IDS for a foreign or non-existent tagId — note is NOT created', async () => {
    const { token } = await registerAndLogin()
    const countBefore = await prisma.note.count()

    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Should fail', content: validContent, tagIds: ['nonexistent-tag-id'] })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('INVALID_TAG_IDS')
    expect(await prisma.note.count()).toBe(countBefore)
  })

  it('duplicate tagIds in request are de-duplicated — note.tagIds lists id once', async () => {
    const { token } = await registerAndLogin()
    const tagId = await createOwnedTag(token, 'work')

    const res = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Duped', content: validContent, tagIds: [tagId, tagId] })

    expect(res.status).toBe(201)
    expect(res.body.note.tagIds).toHaveLength(1)
    expect(res.body.note.tagIds[0]).toBe(tagId)
  })
})

describe('PATCH /api/notes/:id — tagIds', () => {
  it('full-replace: { tagIds: [B] } on note tagged A,B → leaves only B', async () => {
    const { token } = await registerAndLogin()
    const tagA = await createOwnedTag(token, 'a')
    const tagB = await createOwnedTag(token, 'b')

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: validContent, tagIds: [tagA, tagB] })
    const noteId = createRes.body.note.id as string

    const res = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tagIds: [tagB] })

    expect(res.status).toBe(200)
    expect(res.body.note.tagIds).toEqual([tagB])
  })

  it('{ tagIds: [] } detaches all tags → response note.tagIds is []', async () => {
    const { token } = await registerAndLogin()
    const tagId = await createOwnedTag(token, 'work')

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: validContent, tagIds: [tagId] })
    const noteId = createRes.body.note.id as string

    const res = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tagIds: [] })

    expect(res.status).toBe(200)
    expect(res.body.note.tagIds).toEqual([])
  })

  it('omitting tagIds leaves existing associations unchanged', async () => {
    const { token } = await registerAndLogin()
    const tagId = await createOwnedTag(token, 'work')

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: validContent, tagIds: [tagId] })
    const noteId = createRes.body.note.id as string

    const res = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Title' })

    expect(res.status).toBe(200)
    expect(res.body.note.tagIds).toContain(tagId)
  })

  it('422 INVALID_TAG_IDS for foreign tagId — existing associations unchanged', async () => {
    const { token } = await registerAndLogin()
    const tagId = await createOwnedTag(token, 'work')

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: validContent, tagIds: [tagId] })
    const noteId = createRes.body.note.id as string

    const res = await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tagIds: ['foreign-tag-id'] })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('INVALID_TAG_IDS')

    // Verify existing associations unchanged
    const noteCheck = await request(app)
      .get(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(noteCheck.body.note.tagIds).toContain(tagId)
  })
})

describe('note responses always include tagIds', () => {
  it('GET /api/notes/:id includes tagIds', async () => {
    const { token } = await registerAndLogin()
    const tagId = await createOwnedTag(token, 'work')

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: validContent, tagIds: [tagId] })
    const noteId = createRes.body.note.id as string

    const res = await request(app)
      .get(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.note.tagIds).toEqual([tagId])
  })

  it('GET /api/notes list includes tagIds on each item', async () => {
    const { token } = await registerAndLogin()
    const tagId = await createOwnedTag(token, 'work')

    await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: validContent, tagIds: [tagId] })

    const res = await request(app)
      .get('/api/notes')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0].tagIds).toEqual([tagId])
  })

  it('note created without tags has tagIds: [] in all responses', async () => {
    const { token } = await registerAndLogin()

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'No tags', content: validContent })
    const noteId = createRes.body.note.id

    expect(createRes.body.note.tagIds).toEqual([])

    const getRes = await request(app)
      .get(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.body.note.tagIds).toEqual([])
  })

  it('POST /api/notes/:id/restore response includes tagIds', async () => {
    const { token } = await registerAndLogin()
    const tagId = await createOwnedTag(token, 'restore-tag')

    const createRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'To restore', content: validContent, tagIds: [tagId] })
    const noteId = createRes.body.note.id as string

    await request(app)
      .delete(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)

    const restoreRes = await request(app)
      .post(`/api/notes/${noteId}/restore`)
      .set('Authorization', `Bearer ${token}`)

    expect(restoreRes.status).toBe(200)
    expect(restoreRes.body.note.tagIds).toEqual([tagId])
  })
})

// ── GET /api/notes — AB-1005 sort/filter/status ────────────────────────────────

describe('GET /api/notes — AB-1005 sort/filter/status', () => {
  const emptyDoc = { type: 'doc', content: [] }

  // Seed a note directly so createdAt is deterministic. updatedAt is an
  // @updatedAt field (auto-managed), so it is set afterward via raw SQL.
  async function seedNote(opts: {
    userId: string
    title: string
    createdAt?: Date
    updatedAt?: Date
    deletedAt?: Date | null
  }) {
    const note = await prisma.note.create({
      data: {
        userId: opts.userId,
        title: opts.title,
        contentJson: emptyDoc,
        contentText: '',
        createdAt: opts.createdAt ?? new Date('2024-01-01T00:00:00Z'),
      },
    })
    if (opts.updatedAt) {
      await prisma.$executeRaw`UPDATE "Note" SET "updatedAt" = ${opts.updatedAt} WHERE id = ${note.id}`
    }
    if (opts.deletedAt) {
      await prisma.note.update({ where: { id: note.id }, data: { deletedAt: opts.deletedAt } })
    }
    return note
  }

  async function seedTag(userId: string, name: string) {
    return prisma.tag.create({ data: { userId, name, color: '#3B82F6' } })
  }

  async function attachTag(noteId: string, tagId: string) {
    await prisma.noteTag.create({ data: { noteId, tagId } })
  }

  // ── SORT ──────────────────────────────────────────────────────────────────

  it('?sort=createdAt&order=asc orders by created date ascending; order=desc reverses', async () => {
    const { token, userId } = await registerAndLogin()
    const older = await seedNote({ userId, title: 'Older', createdAt: new Date('2024-01-01T00:00:00Z') })
    const newer = await seedNote({ userId, title: 'Newer', createdAt: new Date('2024-06-01T00:00:00Z') })

    const asc = await request(app)
      .get('/api/notes?sort=createdAt&order=asc')
      .set('Authorization', `Bearer ${token}`)
    expect(asc.status).toBe(200)
    expect(asc.body.data.map((n: { id: string }) => n.id)).toEqual([older.id, newer.id])

    const desc = await request(app)
      .get('/api/notes?sort=createdAt&order=desc')
      .set('Authorization', `Bearer ${token}`)
    expect(desc.status).toBe(200)
    expect(desc.body.data.map((n: { id: string }) => n.id)).toEqual([newer.id, older.id])
  })

  it('?sort=updatedAt&order=asc returns the inverse of the default order', async () => {
    const { token, userId } = await registerAndLogin()
    const first = await seedNote({ userId, title: 'First', updatedAt: new Date('2024-01-01T00:00:00Z') })
    const second = await seedNote({ userId, title: 'Second', updatedAt: new Date('2024-02-01T00:00:00Z') })
    const third = await seedNote({ userId, title: 'Third', updatedAt: new Date('2024-03-01T00:00:00Z') })

    const def = await request(app)
      .get('/api/notes')
      .set('Authorization', `Bearer ${token}`)
    expect(def.status).toBe(200)
    expect(def.body.data.map((n: { id: string }) => n.id)).toEqual([third.id, second.id, first.id])

    const asc = await request(app)
      .get('/api/notes?sort=updatedAt&order=asc')
      .set('Authorization', `Bearer ${token}`)
    expect(asc.status).toBe(200)
    expect(asc.body.data.map((n: { id: string }) => n.id)).toEqual([first.id, second.id, third.id])
  })

  it('?sort=title&order=asc is case-insensitive (apple before Zebra)', async () => {
    const { token, userId } = await registerAndLogin()
    await seedNote({ userId, title: 'Zebra' })
    await seedNote({ userId, title: 'apple' })

    const res = await request(app)
      .get('/api/notes?sort=title&order=asc')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0].title).toBe('apple')
  })

  it('breaks ties on id so pagination is stable when sort values are equal', async () => {
    const { token, userId } = await registerAndLogin()
    const sameUpdatedAt = new Date('2024-05-01T00:00:00Z')
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const note = await seedNote({ userId, title: `Tie ${i}`, updatedAt: sameUpdatedAt })
      ids.push(note.id)
    }

    const page1 = await request(app)
      .get('/api/notes?limit=2&page=1')
      .set('Authorization', `Bearer ${token}`)
    expect(page1.status).toBe(200)
    const page1Ids = page1.body.data.map((n: { id: string }) => n.id)

    const page2 = await request(app)
      .get('/api/notes?limit=2&page=2')
      .set('Authorization', `Bearer ${token}`)
    expect(page2.status).toBe(200)
    const page2Ids = page2.body.data.map((n: { id: string }) => n.id)

    // No id appears on both pages, and the union is 4 distinct seeded ids.
    const overlap = page1Ids.filter((id: string) => page2Ids.includes(id))
    expect(overlap).toEqual([])
    const union = [...page1Ids, ...page2Ids]
    expect(new Set(union).size).toBe(union.length)
    expect(union).toHaveLength(4)
    for (const id of union) expect(ids).toContain(id)
  })

  it('?sort=foo returns 400, and ?order=sideways returns 400', async () => {
    const { token } = await registerAndLogin()

    const badSort = await request(app)
      .get('/api/notes?sort=foo')
      .set('Authorization', `Bearer ${token}`)
    expect(badSort.status).toBe(400)
    expect(badSort.body.error.code).toBe('VALIDATION_ERROR')

    const badOrder = await request(app)
      .get('/api/notes?order=sideways')
      .set('Authorization', `Bearer ${token}`)
    expect(badOrder.status).toBe(400)
    expect(badOrder.body.error.code).toBe('VALIDATION_ERROR')
  })

  // ── TAG FILTER ──────────────────────────────────────────────────────────────

  it('?tags=<tagA> returns only notes carrying tagA', async () => {
    const { token, userId } = await registerAndLogin()
    const tagA = await seedTag(userId, 'work')
    const tagged = await seedNote({ userId, title: 'Tagged' })
    const untagged = await seedNote({ userId, title: 'Untagged' })
    await attachTag(tagged.id, tagA.id)

    const res = await request(app)
      .get(`/api/notes?tags=${tagA.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((n: { id: string }) => n.id)
    expect(ids).toContain(tagged.id)
    expect(ids).not.toContain(untagged.id)
    expect(res.body.total).toBe(1)
  })

  it('?tags=<tagA>,<tagB> returns the union (OR)', async () => {
    const { token, userId } = await registerAndLogin()
    const tagA = await seedTag(userId, 'work')
    const tagB = await seedTag(userId, 'home')
    const onlyA = await seedNote({ userId, title: 'Only A' })
    const onlyB = await seedNote({ userId, title: 'Only B' })
    const neither = await seedNote({ userId, title: 'Neither' })
    await attachTag(onlyA.id, tagA.id)
    await attachTag(onlyB.id, tagB.id)

    const res = await request(app)
      .get(`/api/notes?tags=${tagA.id},${tagB.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((n: { id: string }) => n.id)
    expect(ids).toContain(onlyA.id)
    expect(ids).toContain(onlyB.id)
    expect(ids).not.toContain(neither.id)
    expect(res.body.total).toBe(2)
  })

  it('a note carrying both tagA and tagB appears once and counts once in total', async () => {
    const { token, userId } = await registerAndLogin()
    const tagA = await seedTag(userId, 'work')
    const tagB = await seedTag(userId, 'home')
    const both = await seedNote({ userId, title: 'Both' })
    await attachTag(both.id, tagA.id)
    await attachTag(both.id, tagB.id)

    const res = await request(app)
      .get(`/api/notes?tags=${tagA.id},${tagB.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const occurrences = res.body.data.filter((n: { id: string }) => n.id === both.id)
    expect(occurrences).toHaveLength(1)
    expect(res.body.total).toBe(1)
  })

  it('?tags=<tagA> with status omitted excludes a soft-deleted tagged note', async () => {
    const { token, userId } = await registerAndLogin()
    const tagA = await seedTag(userId, 'work')
    const deleted = await seedNote({ userId, title: 'Deleted Tagged', deletedAt: new Date() })
    await attachTag(deleted.id, tagA.id)

    const res = await request(app)
      .get(`/api/notes?tags=${tagA.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((n: { id: string }) => n.id)
    expect(ids).not.toContain(deleted.id)
    expect(res.body.total).toBe(0)
  })

  // ── STATUS ────────────────────────────────────────────────────────────────

  it('?status=trashed returns only soft-deleted notes', async () => {
    const { token, userId } = await registerAndLogin()
    const active = await seedNote({ userId, title: 'Active' })
    const trashed = await seedNote({ userId, title: 'Trashed', deletedAt: new Date() })

    const res = await request(app)
      .get('/api/notes?status=trashed')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((n: { id: string }) => n.id)
    expect(ids).toContain(trashed.id)
    expect(ids).not.toContain(active.id)
    expect(res.body.total).toBe(1)
  })

  it('?status=trashed includes notes deleted more than 30 days ago', async () => {
    const { token, userId } = await registerAndLogin()
    const oldDeletedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    const old = await seedNote({ userId, title: 'Long Gone', deletedAt: oldDeletedAt })

    const res = await request(app)
      .get('/api/notes?status=trashed')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((n: { id: string }) => n.id)
    expect(ids).toContain(old.id)
  })

  it('?status=trashed shows only the caller\'s own soft-deleted notes', async () => {
    const alice = await registerAndLogin('alice@example.com')
    const bob = await registerAndLogin('bob@example.com')
    const aliceTrashed = await seedNote({ userId: alice.userId, title: 'Alice Trash', deletedAt: new Date() })
    const bobTrashed = await seedNote({ userId: bob.userId, title: 'Bob Trash', deletedAt: new Date() })

    const res = await request(app)
      .get('/api/notes?status=trashed')
      .set('Authorization', `Bearer ${alice.token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((n: { id: string }) => n.id)
    expect(ids).toContain(aliceTrashed.id)
    expect(ids).not.toContain(bobTrashed.id)
  })

  it('?status=archived returns 400 VALIDATION_ERROR', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .get('/api/notes?status=archived')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  // ── COMPOSE ───────────────────────────────────────────────────────────────

  it('combines status, tags, sort, order, page, and limit in one request', async () => {
    const { token, userId } = await registerAndLogin()
    const tagA = await seedTag(userId, 'work')

    // Four active, tagged notes with distinct createdAt; one active untagged
    // note and one trashed tagged note that must both be excluded.
    const n1 = await seedNote({ userId, title: 'C1', createdAt: new Date('2024-01-01T00:00:00Z') })
    const n2 = await seedNote({ userId, title: 'C2', createdAt: new Date('2024-02-01T00:00:00Z') })
    const n3 = await seedNote({ userId, title: 'C3', createdAt: new Date('2024-03-01T00:00:00Z') })
    const n4 = await seedNote({ userId, title: 'C4', createdAt: new Date('2024-04-01T00:00:00Z') })
    const untagged = await seedNote({ userId, title: 'Untagged', createdAt: new Date('2024-05-01T00:00:00Z') })
    const trashed = await seedNote({ userId, title: 'Trashed', createdAt: new Date('2024-06-01T00:00:00Z'), deletedAt: new Date() })
    for (const n of [n1, n2, n3, n4, trashed]) await attachTag(n.id, tagA.id)

    // active + tagA + sort=createdAt asc → [n1,n2,n3,n4]; limit=2 page=2 → [n3,n4]
    const res = await request(app)
      .get(`/api/notes?status=active&tags=${tagA.id}&sort=createdAt&order=asc&page=2&limit=2`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.page).toBe(2)
    expect(res.body.limit).toBe(2)
    expect(res.body.total).toBe(4)
    expect(res.body.data.map((n: { id: string }) => n.id)).toEqual([n3.id, n4.id])
    const ids = res.body.data.map((n: { id: string }) => n.id)
    expect(ids).not.toContain(untagged.id)
    expect(ids).not.toContain(trashed.id)
  })

  it('total reflects the filtered set across pages, and data length is at most limit', async () => {
    const { token, userId } = await registerAndLogin()
    const tagA = await seedTag(userId, 'work')

    // 5 tagged (in-set) notes + 3 untagged (out-of-set) notes.
    for (let i = 0; i < 5; i++) {
      const note = await seedNote({ userId, title: `In ${i}` })
      await attachTag(note.id, tagA.id)
    }
    for (let i = 0; i < 3; i++) {
      await seedNote({ userId, title: `Out ${i}` })
    }

    const res = await request(app)
      .get(`/api/notes?tags=${tagA.id}&limit=2&page=1`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(5)
    expect(res.body.data.length).toBeLessThanOrEqual(2)
  })
})
