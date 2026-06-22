import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'

beforeAll(async () => {
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.noteTag.deleteMany()
  await prisma.noteVersion.deleteMany()
  await prisma.shareLink.deleteMany()
  await prisma.note.deleteMany()
  await prisma.tag.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.passwordResetOtp.deleteMany()
  await prisma.user.deleteMany()
})

async function registerAndLogin(email = 'alice@example.com', password = 'Pass1234') {
  await request(app).post('/api/auth/register').send({ email, password })
  const res = await request(app).post('/api/auth/login').send({ email, password })
  return { token: res.body.accessToken as string, userId: res.body.user.id as string }
}

async function createTag(token: string, name: string, color = '#3B82F6') {
  const res = await request(app)
    .post('/api/tags')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, color })
  return res
}

// ── POST /api/tags ─────────────────────────────────────────────────────────────

describe('POST /api/tags', () => {
  it('201 { tag } with name lower-cased on create', async () => {
    const { token } = await registerAndLogin()
    const res = await createTag(token, 'Work', '#3B82F6')

    expect(res.status).toBe(201)
    expect(res.body.tag).toMatchObject({ name: 'work', color: '#3B82F6' })
    expect(res.body.tag.id).toBeDefined()
    expect(res.body.tag.createdAt).toBeDefined()
    expect(res.body.tag.updatedAt).toBeDefined()
  })

  it('422 TAG_NAME_TAKEN for exact duplicate name', async () => {
    const { token } = await registerAndLogin()
    await createTag(token, 'work')
    const res = await createTag(token, 'work')

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TAG_NAME_TAKEN')
  })

  it('422 TAG_NAME_TAKEN for case-insensitive duplicate (Work vs WORK)', async () => {
    const { token } = await registerAndLogin()
    await createTag(token, 'Work')
    const res = await createTag(token, 'WORK')

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TAG_NAME_TAKEN')
  })

  it('same name allowed for a different user (201)', async () => {
    const { token: tokenA } = await registerAndLogin('alice@example.com')
    const { token: tokenB } = await registerAndLogin('bob@example.com', 'Pass1234')

    await createTag(tokenA, 'work')
    const res = await createTag(tokenB, 'work')

    expect(res.status).toBe(201)
  })

  it('400 VALIDATION_ERROR for invalid color (shorthand #FFF)', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'design', color: '#FFF' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'color')).toBe(true)
  })

  it('400 VALIDATION_ERROR for color with no hash (e.g. "3B82F6")', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'design', color: '3B82F6' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('400 VALIDATION_ERROR for color "blue" (word color)', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'design', color: 'blue' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('400 VALIDATION_ERROR when name is missing', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ color: '#3B82F6' })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'name')).toBe(true)
  })

  it('400 VALIDATION_ERROR when color is missing', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'design' })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'color')).toBe(true)
  })

  it('400 VALIDATION_ERROR for whitespace-only name', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ', color: '#3B82F6' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app)
      .post('/api/tags')
      .send({ name: 'work', color: '#3B82F6' })

    expect(res.status).toBe(401)
  })
})

// ── GET /api/tags ─────────────────────────────────────────────────────────────

describe('GET /api/tags', () => {
  it('200 bare array with noteCount per tag', async () => {
    const { token } = await registerAndLogin()
    await createTag(token, 'work')
    const res = await request(app)
      .get('/api/tags')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0]).toHaveProperty('noteCount')
    expect(typeof res.body[0].noteCount).toBe('number')
  })

  it('noteCount counts only active (non-deleted) notes', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'work')
    const tagId = tagRes.body.tag.id

    const validContent = { type: 'doc', content: [] }
    await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Note A', content: validContent, tagIds: [tagId] })
    const note2 = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Note B', content: validContent, tagIds: [tagId] })

    // Soft-delete note2
    await request(app)
      .delete(`/api/notes/${note2.body.note.id}`)
      .set('Authorization', `Bearer ${token}`)

    const res = await request(app)
      .get('/api/tags')
      .set('Authorization', `Bearer ${token}`)

    const tag = res.body.find((t: { id: string }) => t.id === tagId)
    expect(tag.noteCount).toBe(1)
  })

  it('noteCount is 0 for a tag attached to no notes', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'unused')
    const tagId = tagRes.body.tag.id

    const res = await request(app)
      .get('/api/tags')
      .set('Authorization', `Bearer ${token}`)

    const tag = res.body.find((t: { id: string }) => t.id === tagId)
    expect(tag.noteCount).toBe(0)
  })

  it("other users' tags are not returned", async () => {
    const { token: tokenA } = await registerAndLogin('alice@example.com')
    const { token: tokenB } = await registerAndLogin('bob@example.com', 'Pass1234')

    await createTag(tokenA, 'alice-only')

    const res = await request(app)
      .get('/api/tags')
      .set('Authorization', `Bearer ${tokenB}`)

    expect(res.body).toHaveLength(0)
  })

  it('200 empty array when no tags exist', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app)
      .get('/api/tags')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app).get('/api/tags')

    expect(res.status).toBe(401)
  })
})

// ── PATCH /api/tags/:id ───────────────────────────────────────────────────────

describe('PATCH /api/tags/:id', () => {
  it('200 { tag } after renaming — stored lower-cased', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'work')
    const id = tagRes.body.tag.id

    const res = await request(app)
      .patch(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Personal' })

    expect(res.status).toBe(200)
    expect(res.body.tag.name).toBe('personal')
  })

  it('200 { tag } after recoloring', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'work')
    const id = tagRes.body.tag.id

    const res = await request(app)
      .patch(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ color: '#10B981' })

    expect(res.status).toBe(200)
    expect(res.body.tag.color).toBe('#10B981')
  })

  it('200 { tag } when renaming and recoloring together', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'work')
    const id = tagRes.body.tag.id

    const res = await request(app)
      .patch(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Personal', color: '#10B981' })

    expect(res.status).toBe(200)
    expect(res.body.tag.name).toBe('personal')
    expect(res.body.tag.color).toBe('#10B981')
  })

  it('422 TAG_NAME_TAKEN on name collision with another tag', async () => {
    const { token } = await registerAndLogin()
    await createTag(token, 'work')
    const tagRes = await createTag(token, 'personal')
    const id = tagRes.body.tag.id

    const res = await request(app)
      .patch(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'work' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TAG_NAME_TAKEN')
  })

  it('200 when renaming a tag to its own current name (case variant)', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'work')
    const id = tagRes.body.tag.id

    const res = await request(app)
      .patch(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'WORK' })

    expect(res.status).toBe(200)
  })

  it('400 VALIDATION_ERROR for empty body (no name or color)', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'work')
    const id = tagRes.body.tag.id

    const res = await request(app)
      .patch(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('404 when patching a tag owned by another user (no existence leak)', async () => {
    const { token: tokenA } = await registerAndLogin('alice@example.com')
    const { token: tokenB } = await registerAndLogin('bob@example.com', 'Pass1234')

    const tagRes = await createTag(tokenA, 'work')
    const id = tagRes.body.tag.id

    const res = await request(app)
      .patch(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'stolen' })

    expect(res.status).toBe(404)
    expect(res.body.error).not.toHaveProperty('fields')
  })

  it('404 when patching a non-existent tag', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app)
      .patch('/api/tags/nonexistent-id')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'new' })

    expect(res.status).toBe(404)
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app)
      .patch('/api/tags/any-id')
      .send({ name: 'new' })

    expect(res.status).toBe(401)
  })
})

// ── DELETE /api/tags/:id ──────────────────────────────────────────────────────

describe('DELETE /api/tags/:id', () => {
  it('204 — tag is gone afterwards', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'work')
    const id = tagRes.body.tag.id

    const del = await request(app)
      .delete(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(del.status).toBe(204)

    const listRes = await request(app)
      .get('/api/tags')
      .set('Authorization', `Bearer ${token}`)
    expect(listRes.body).toHaveLength(0)
  })

  it('NoteTag associations removed but notes are kept', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'work')
    const tagId = tagRes.body.tag.id

    const validContent = { type: 'doc', content: [] }
    const noteRes = await request(app)
      .post('/api/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tagged Note', content: validContent, tagIds: [tagId] })
    const noteId = noteRes.body.note.id

    await request(app)
      .delete(`/api/tags/${tagId}`)
      .set('Authorization', `Bearer ${token}`)

    // Note still exists
    const noteCheck = await request(app)
      .get(`/api/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(noteCheck.status).toBe(200)

    // NoteTag row gone (tagIds is now empty)
    expect(noteCheck.body.note.tagIds).toEqual([])

    // NoteTag rows are gone at DB level
    const ntCount = await prisma.noteTag.count({ where: { tagId } })
    expect(ntCount).toBe(0)
  })

  it('404 when deleting another user\'s tag (no existence leak)', async () => {
    const { token: tokenA } = await registerAndLogin('alice@example.com')
    const { token: tokenB } = await registerAndLogin('bob@example.com', 'Pass1234')

    const tagRes = await createTag(tokenA, 'work')
    const id = tagRes.body.tag.id

    const res = await request(app)
      .delete(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)

    expect(res.status).toBe(404)
    // Alice's tag should still exist
    const aliceTag = await prisma.tag.findUnique({ where: { id } })
    expect(aliceTag).not.toBeNull()
  })

  it('404 when deleting a non-existent tag', async () => {
    const { token } = await registerAndLogin()
    const res = await request(app)
      .delete('/api/tags/nonexistent-id')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('401 when no Authorization header', async () => {
    const res = await request(app).delete('/api/tags/any-id')

    expect(res.status).toBe(401)
  })
})

// ── PATCH validation edge cases ───────────────────────────────────────────────

describe('PATCH /api/tags/:id — validation edge cases', () => {
  it('400 VALIDATION_ERROR for invalid color (shorthand #FFF)', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'work')
    const id = tagRes.body.tag.id

    const res = await request(app)
      .patch(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ color: '#FFF' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.fields.some((f: { field: string }) => f.field === 'color')).toBe(true)
  })

  it('400 VALIDATION_ERROR for whitespace-only name on update', async () => {
    const { token } = await registerAndLogin()
    const tagRes = await createTag(token, 'work')
    const id = tagRes.body.tag.id

    const res = await request(app)
      .patch(`/api/tags/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
