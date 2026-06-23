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

const content = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function createNote(token: string, body: Record<string, unknown>) {
  const res = await request(app).post('/api/notes').set(auth(token)).send(body)
  return res.body.note as { id: string; title: string; tagIds: string[] }
}

async function createTag(token: string, name: string, color = '#3B82F6') {
  const res = await request(app).post('/api/tags').set(auth(token)).send({ name, color })
  return res.body.tag as { id: string }
}

const listVersions = (token: string, noteId: string) =>
  request(app).get(`/api/notes/${noteId}/versions`).set(auth(token))

const viewVersion = (token: string, noteId: string, versionId: string) =>
  request(app).get(`/api/notes/${noteId}/versions/${versionId}`).set(auth(token))

const restore = (token: string, noteId: string, versionId: string) =>
  request(app).post(`/api/notes/${noteId}/versions/${versionId}/restore`).set(auth(token))

const patchNote = (token: string, noteId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/notes/${noteId}`).set(auth(token)).send(body)

// ── GET /api/notes/:id/versions ─────────────────────────────────────────────────

describe('GET /api/notes/:id/versions', () => {
  it('200 reverse-chronological list after edits (FRS-8.2)', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { title: 'V1', content: content('one') })
    await patchNote(token, note.id, { content: content('two') })
    await patchNote(token, note.id, { content: content('three') })

    const res = await listVersions(token, note.id)
    expect(res.status).toBe(200)
    expect(res.body.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([3, 2, 1])
    expect(res.body[0]).toHaveProperty('id')
    expect(res.body[0]).toHaveProperty('title')
    expect(res.body[0]).toHaveProperty('createdAt')
    expect(res.body[0]).not.toHaveProperty('content')
  })

  it('a freshly created note has exactly one version (FRS-8.1)', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { title: 'Solo', content: content('x') })
    const res = await listVersions(token, note.id)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].versionNumber).toBe(1)
  })

  it('returns a bare array, not a pagination envelope (SDS §6.7)', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { content: content('x') })
    const res = await listVersions(token, note.id)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.data).toBeUndefined()
  })

  it('200 for a soft-deleted note — reads allowed (ADR-004)', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { content: content('x') })
    await request(app).delete(`/api/notes/${note.id}`).set(auth(token))
    const res = await listVersions(token, note.id)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('404 for a note owned by another user (FRS-9.1)', async () => {
    const a = await registerAndLogin('a@example.com')
    const b = await registerAndLogin('b@example.com')
    const note = await createNote(a.token, { content: content('x') })
    const res = await listVersions(b.token, note.id)
    expect(res.status).toBe(404)
  })

  it('404 for a non-existent note', async () => {
    const { token } = await registerAndLogin()
    const res = await listVersions(token, 'nope')
    expect(res.status).toBe(404)
  })

  it('401 without a token (FRS-9.2)', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { content: content('x') })
    const res = await request(app).get(`/api/notes/${note.id}/versions`)
    expect(res.status).toBe(401)
  })
})

// ── GET /api/notes/:id/versions/:versionId ───────────────────────────────────────

describe('GET /api/notes/:id/versions/:versionId', () => {
  it('200 detail with content + tagIds (FRS-8.3 / ADR-003)', async () => {
    const { token } = await registerAndLogin()
    const tag = await createTag(token, 'work')
    const note = await createNote(token, { title: 'T', content: content('hello'), tagIds: [tag.id] })
    const list = await listVersions(token, note.id)
    const versionId = list.body[0].id

    const res = await viewVersion(token, note.id, versionId)
    expect(res.status).toBe(200)
    expect(res.body.version.content).toBeDefined()
    expect(res.body.version.tagIds).toEqual([tag.id])
  })

  it('404 when the version belongs to a different note', async () => {
    const { token } = await registerAndLogin()
    const noteA = await createNote(token, { content: content('a') })
    const noteB = await createNote(token, { content: content('b') })
    const listA = await listVersions(token, noteA.id)
    const aVersionId = listA.body[0].id

    const res = await viewVersion(token, noteB.id, aVersionId)
    expect(res.status).toBe(404)
  })

  it('404 for an unknown version', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { content: content('x') })
    const res = await viewVersion(token, note.id, 'nope')
    expect(res.status).toBe(404)
  })

  it('200 for a version of a soft-deleted note (ADR-004)', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { content: content('x') })
    const list = await listVersions(token, note.id)
    await request(app).delete(`/api/notes/${note.id}`).set(auth(token))
    const res = await viewVersion(token, note.id, list.body[0].id)
    expect(res.status).toBe(200)
  })
})

// ── POST /api/notes/:id/versions/:versionId/restore ──────────────────────────────

describe('POST /api/notes/:id/versions/:versionId/restore', () => {
  it('200 restores earlier title/content and appends a new version (FRS-8.4)', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { title: 'V1', content: content('one') })
    await patchNote(token, note.id, { title: 'V2', content: content('two') })

    const list = await listVersions(token, note.id)
    const v1 = list.body.find((v: { versionNumber: number }) => v.versionNumber === 1)

    const res = await restore(token, note.id, v1.id)
    expect(res.status).toBe(200)
    expect(res.body.note.title).toBe('V1')

    const after = await listVersions(token, note.id)
    expect(after.body).toHaveLength(3)
    expect(after.body[0].versionNumber).toBe(3)
    expect(after.body[0].title).toBe('V1')
  })

  it('re-applies surviving tags and drops since-deleted ones (ADR-003 / FRS-5.5)', async () => {
    const { token } = await registerAndLogin()
    const tagA = await createTag(token, 'alpha')
    const tagB = await createTag(token, 'beta')
    const note = await createNote(token, { content: content('one'), tagIds: [tagA.id, tagB.id] })
    await patchNote(token, note.id, { content: content('two') }) // v2, tags unchanged [A,B]
    await request(app).delete(`/api/tags/${tagB.id}`).set(auth(token)) // tagB gone

    const list = await listVersions(token, note.id)
    const v1 = list.body.find((v: { versionNumber: number }) => v.versionNumber === 1)

    const res = await restore(token, note.id, v1.id)
    expect(res.status).toBe(200)
    expect(res.body.note.tagIds).toEqual([tagA.id]) // tagB dropped
  })

  it('422 VERSION_ALREADY_CURRENT when restoring the latest version (D7)', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { content: content('x') })
    const list = await listVersions(token, note.id)

    const res = await restore(token, note.id, list.body[0].id)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VERSION_ALREADY_CURRENT')
  })

  it('422 NOTE_DELETED when the note is soft-deleted (ADR-004)', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { content: content('one') })
    await patchNote(token, note.id, { content: content('two') })
    const list = await listVersions(token, note.id)
    const v1 = list.body.find((v: { versionNumber: number }) => v.versionNumber === 1)
    await request(app).delete(`/api/notes/${note.id}`).set(auth(token))

    const res = await restore(token, note.id, v1.id)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('NOTE_DELETED')
  })

  it("404 when restoring a version of another user's note", async () => {
    const a = await registerAndLogin('a@example.com')
    const b = await registerAndLogin('b@example.com')
    const note = await createNote(a.token, { content: content('one') })
    await patchNote(a.token, note.id, { content: content('two') })
    const list = await listVersions(a.token, note.id)
    const v1 = list.body.find((v: { versionNumber: number }) => v.versionNumber === 1)

    const res = await restore(b.token, note.id, v1.id)
    expect(res.status).toBe(404)
  })

  it('404 when restoring an unknown version', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { content: content('x') })
    const res = await restore(token, note.id, 'nope')
    expect(res.status).toBe(404)
  })
})

// ── Retention (FRS-8.5) ──────────────────────────────────────────────────────────

describe('Version retention', () => {
  it('retains at most 50 versions, purging the oldest, numbering stays monotonic', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { content: content('v1') }) // version 1
    // 50 content patches → versions 2..51 (52nd save total would be 51 versions)
    for (let i = 2; i <= 51; i++) {
      await patchNote(token, note.id, { content: content(`v${i}`) })
    }

    const res = await listVersions(token, note.id)
    expect(res.body).toHaveLength(50)
    expect(res.body[0].versionNumber).toBe(51) // newest
    expect(res.body[49].versionNumber).toBe(2) // version 1 purged → gap, monotonic
  }, 30000)
})

// ── Snapshot-on-save (FRS-8.1 / clarification 1) ─────────────────────────────────

describe('Snapshot-on-save triggers', () => {
  it('a content update adds a version', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { content: content('one') })
    await patchNote(token, note.id, { content: content('two') })
    const res = await listVersions(token, note.id)
    expect(res.body).toHaveLength(2)
  })

  it('a tag-only update adds no version (clarification 1)', async () => {
    const { token } = await registerAndLogin()
    const tag = await createTag(token, 'work')
    const note = await createNote(token, { content: content('one') })
    await patchNote(token, note.id, { tagIds: [tag.id] })
    const res = await listVersions(token, note.id)
    expect(res.body).toHaveLength(1)
  })

  it('a no-op title update (same title) adds no version', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, { title: 'Same', content: content('one') })
    await patchNote(token, note.id, { title: 'Same' })
    const res = await listVersions(token, note.id)
    expect(res.body).toHaveLength(1)
  })
})
