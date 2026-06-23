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

function makeContent(text: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

async function createNote(
  token: string,
  title: string,
  content?: ReturnType<typeof makeContent>,
) {
  const res = await request(app)
    .post('/api/notes')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, content: content ?? makeContent('') })
  return res.body.note as { id: string }
}

// ── GET /api/search ───────────────────────────────────────────────────────────

describe('GET /api/search — full-text over own active notes', () => {
  it('match on title → 200 with note present', async () => {
    const { token } = await registerAndLogin()
    await createNote(token, 'invoice report', makeContent('nothing special here'))

    const res = await request(app)
      .get('/api/search?q=invoice')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].title).toBe('invoice report')
    expect(res.body.total).toBe(1)
  })

  it('match on content (term only in body, not title) → 200 with note present', async () => {
    const { token } = await registerAndLogin()
    await createNote(token, 'untitled', makeContent('quarterly earnings review'))

    const res = await request(app)
      .get('/api/search?q=quarterly')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].title).toBe('untitled')
  })

  it('non-matching term → 200 with empty data and total=0', async () => {
    const { token } = await registerAndLogin()
    await createNote(token, 'some note', makeContent('some content'))

    const res = await request(app)
      .get('/api/search?q=xyzzy99notfound')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.total).toBe(0)
  })
})

describe('GET /api/search — ownership isolation (FRS-6.5, 9.1)', () => {
  it("user B's matching note never appears for user A", async () => {
    const { token: tokenA } = await registerAndLogin('a@example.com')
    const { token: tokenB } = await registerAndLogin('b@example.com')

    await createNote(tokenA, 'alpha note', makeContent('alpha content'))
    await createNote(tokenB, 'alpha note B', makeContent('alpha content B'))

    const res = await request(app)
      .get('/api/search?q=alpha')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].title).toBe('alpha note')
  })

  it('soft-deleted notes excluded from data and total (FRS-6.5)', async () => {
    const { token } = await registerAndLogin()
    const note = await createNote(token, 'deletedterm note', makeContent('deletedterm content'))
    await request(app).delete(`/api/notes/${note.id}`).set('Authorization', `Bearer ${token}`)

    const res = await request(app)
      .get('/api/search?q=deletedterm')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.total).toBe(0)
  })
})

describe('GET /api/search — relevance ranking and tie-break (FRS-6.3)', () => {
  it('note matching in title ranks higher than note matching only in content', async () => {
    const { token } = await registerAndLogin()
    // title match → higher rank (weight A)
    await createNote(token, 'typescript guide', makeContent('programming tutorial'))
    // content-only match → lower rank (weight B)
    await createNote(token, 'general note', makeContent('typescript tips'))

    const res = await request(app)
      .get('/api/search?q=typescript')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    expect(res.body.data[0].rank).toBeGreaterThanOrEqual(res.body.data[1].rank)
    expect(res.body.data[0].title).toBe('typescript guide')
  })

  it('equal-rank results ordered by updatedAt DESC (tie-break)', async () => {
    const { token } = await registerAndLogin()
    const noteA = await createNote(token, 'tietest note', makeContent('tietest content here'))
    await createNote(token, 'tietest note', makeContent('tietest content here'))
    // Update note A so it has a later updatedAt
    await request(app)
      .patch(`/api/notes/${noteA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'tietest note' })

    const res = await request(app)
      .get('/api/search?q=tietest')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    expect(res.body.data[0].noteId).toBe(noteA.id)
  })
})

describe('GET /api/search — pagination and total (SDS §5.2, FRS-6.3)', () => {
  async function seedMatchingNotes(token: string, count: number) {
    for (let i = 1; i <= count; i++) {
      await prisma.note.create({
        data: {
          userId: (
            await prisma.user.findFirst({
              where: { email: 'alice@example.com' },
            })
          )!.id,
          title: `paginationterm note ${i}`,
          contentJson: makeContent(`paginationterm item ${i}`),
          contentText: `paginationterm item ${i}`,
        },
      })
    }
  }

  it('page=2&limit=10 over 25 matches → data has 10 items, page=2, limit=10', async () => {
    const { token } = await registerAndLogin()
    await seedMatchingNotes(token, 25)

    const res = await request(app)
      .get('/api/search?q=paginationterm&page=2&limit=10')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(10)
    expect(res.body.page).toBe(2)
    expect(res.body.limit).toBe(10)
  })

  it('total reflects full match count regardless of page size', async () => {
    const { token } = await registerAndLogin()
    await seedMatchingNotes(token, 25)

    const res = await request(app)
      .get('/api/search?q=paginationterm&page=1&limit=10')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(10)
    expect(res.body.total).toBe(25)
  })

  it('page beyond last → data=[], correct total via count-fallback', async () => {
    const { token } = await registerAndLogin()
    await seedMatchingNotes(token, 5)

    const res = await request(app)
      .get('/api/search?q=paginationterm&page=3&limit=10')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.total).toBe(5)
  })

  it('out-of-range page/limit are clamped (page=0, limit=500) → 200 not 400', async () => {
    const { token } = await registerAndLogin()
    await createNote(token, 'clampterm note', makeContent('clampterm here'))

    const res = await request(app)
      .get('/api/search?q=clampterm&page=0&limit=500')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(100)
  })
})

describe('GET /api/search — snippet highlighting (FRS-6.4)', () => {
  it('content match → snippet contains <mark>…</mark> around the term', async () => {
    const { token } = await registerAndLogin()
    await createNote(token, 'regular title', makeContent('the quantum physics experiment was fascinating'))

    const res = await request(app)
      .get('/api/search?q=quantum')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const snippet: string = res.body.data[0].snippet
    expect(snippet).toContain('<mark>')
    expect(snippet).toContain('</mark>')
  })

  it('title-only match → result present and snippet is non-empty content text', async () => {
    const { token } = await registerAndLogin()
    await createNote(
      token,
      'photosynthesis explained',
      makeContent('the leaves convert light into energy through a complex process'),
    )

    const res = await request(app)
      .get('/api/search?q=photosynthesis')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    // title match found; snippet may or may not have <mark>, but must be non-empty
    expect(res.body.data[0].snippet.length).toBeGreaterThan(0)
  })

  it('snippet is bounded — not the entire content', async () => {
    const { token } = await registerAndLogin()
    const longBody = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    await createNote(token, 'note title', makeContent(`searchterm ${longBody}`))

    const res = await request(app)
      .get('/api/search?q=searchterm')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const snippet: string = res.body.data[0].snippet
    expect(snippet.split(' ').length).toBeLessThan(100)
  })
})

describe('GET /api/search — empty / whitespace / missing q (FRS-6.6)', () => {
  it('?q= (empty string) → 200 { data: [], total: 0 }', async () => {
    const { token } = await registerAndLogin()
    await createNote(token, 'some note', makeContent('some content'))

    const res = await request(app)
      .get('/api/search?q=')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.total).toBe(0)
  })

  it('?q=%20 (whitespace) → 200 empty', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .get('/api/search?q=%20%20%20')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.total).toBe(0)
  })

  it('no q parameter at all → 200 empty', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .get('/api/search')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.total).toBe(0)
  })
})

describe('GET /api/search — validation (SDS §5.1)', () => {
  it('q longer than 200 chars → 400 VALIDATION_ERROR with fields[{field:"q"}]', async () => {
    const { token } = await registerAndLogin()
    const longQ = 'a'.repeat(201)

    const res = await request(app)
      .get(`/api/search?q=${longQ}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'q' })]),
    )
  })

  it('non-numeric page → 400 VALIDATION_ERROR', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .get('/api/search?q=test&page=abc')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('non-numeric limit → 400 VALIDATION_ERROR', async () => {
    const { token } = await registerAndLogin()

    const res = await request(app)
      .get('/api/search?q=test&limit=xyz')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('special chars in q (operators, punctuation) → 200 never 500', async () => {
    const { token } = await registerAndLogin()

    const specialQueries = [
      '"quoted phrase" or foo -bar',
      '&|!:*',
      'foo & bar | baz',
      "it's a test",
    ]

    for (const q of specialQueries) {
      const res = await request(app)
        .get(`/api/search?q=${encodeURIComponent(q)}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
    }
  })
})

describe('GET /api/search — result shape and no data leakage', () => {
  it('each result item has exactly noteId, title, snippet, rank (no extra fields)', async () => {
    const { token } = await registerAndLogin()
    await createNote(token, 'shape test note', makeContent('shape test content'))

    const res = await request(app)
      .get('/api/search?q=shape')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const item = res.body.data[0]
    expect(Object.keys(item).sort()).toEqual(['noteId', 'rank', 'snippet', 'title'])
  })

  it('response JSON does not contain contentText, contentJson, or tagIds', async () => {
    const { token } = await registerAndLogin()
    await createNote(token, 'leakcheck note', makeContent('leakcheck content'))

    const res = await request(app)
      .get('/api/search?q=leakcheck')
      .set('Authorization', `Bearer ${token}`)

    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain('contentText')
    expect(serialized).not.toContain('contentJson')
    expect(serialized).not.toContain('tagIds')
  })
})

describe('GET /api/search — authentication (FRS-9.2)', () => {
  it('no token → 401', async () => {
    const res = await request(app).get('/api/search?q=test')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('invalid token → 401', async () => {
    const res = await request(app)
      .get('/api/search?q=test')
      .set('Authorization', 'Bearer not.a.valid.token')

    expect(res.status).toBe(401)
  })
})
