/**
 * E2E — Share link journey (AB-1014, Task 5.1)
 *
 * Assumes the full stack is running:
 *   backend:  http://localhost:3000  (PostgreSQL connected, .env.test populated)
 *   frontend: http://localhost:5173  (started by playwright.config.ts webServer)
 */

import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const EMAIL = `share-e2e-${randomUUID().slice(0, 8)}@example.com`
const PASSWORD = 'TestPassword1!'

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/auth/register', {
    data: { email: EMAIL, password: PASSWORD },
  })
  expect(res.status()).toBe(201)
})

test('generate link → anonymous view → revoke → gone', async ({ browser }) => {
  // ── 1. Owner logs in via the UI ─────────────────────────────────────────
  const ownerCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()

  await owner.goto('/login')
  await owner.fill('input[name="email"]', EMAIL)
  await owner.fill('input[name="password"]', PASSWORD)
  await owner.click('button[type="submit"]')
  // Wait until we leave the login page
  await expect(owner).not.toHaveURL(/\/login/, { timeout: 10_000 })

  // Extract the access token from the Zustand auth store persisted in localStorage
  const accessToken = await owner.evaluate((): string | null => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '') as {
          state?: { accessToken?: string }
        }
        if (parsed?.state?.accessToken) return parsed.state.accessToken
      } catch {
        // not JSON or not the auth store — skip
      }
    }
    return null
  })
  expect(accessToken).toBeTruthy()

  // ── 2. Create a test note via API (faster than TipTap UI) ───────────────
  const noteRes = await owner.request.post('/api/notes', {
    headers: { Authorization: `Bearer ${accessToken!}` },
    data: {
      title: 'E2E Share Test Note',
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Visible to the public.' }],
          },
        ],
      },
      contentText: 'Visible to the public.',
    },
  })
  expect(noteRes.status()).toBe(201)
  const { id: noteId } = (await noteRes.json()) as { id: string }

  // ── 3. Navigate to the note editor ─────────────────────────────────────
  await owner.goto(`/notes/${noteId}`)
  const shareBtn = owner.getByRole('button', { name: /share/i }).first()
  await expect(shareBtn).toBeVisible({ timeout: 10_000 })

  // ── 4. Open the Share modal and generate a never-expiring link ──────────
  await shareBtn.click()
  const dialog = owner.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: /generate link/i }).click()

  // Wait for the link row — the absolute URL appears in the monospace span
  const linkUrlSpan = dialog.locator('span.font-mono').first()
  await expect(linkUrlSpan).toBeVisible({ timeout: 8_000 })

  const shareUrl = (await linkUrlSpan.textContent()) ?? ''
  expect(shareUrl).toMatch(/\/s\//)

  // ── 5. Anonymous visitor opens the link ────────────────────────────────
  const anonCtx = await browser.newContext()
  const anon = await anonCtx.newPage()

  await anon.goto(shareUrl)

  // Must NOT redirect to /login
  await expect(anon).not.toHaveURL(/\/login/)

  // Title and content are visible
  await expect(anon.getByText('E2E Share Test Note')).toBeVisible()
  await expect(anon.getByText('Visible to the public.')).toBeVisible()

  // No editable surface (FRS-7.3, FRS-7.8)
  await expect(anon.locator('[contenteditable="true"]')).toHaveCount(0)

  // No authenticated app navigation (FRS-7.8)
  await expect(anon.getByRole('link', { name: /notes/i })).toHaveCount(0)

  // ── 6. Owner revokes the link ───────────────────────────────────────────
  await dialog.getByRole('button', { name: /revoke/i }).click()
  // Confirm dialog appears — click the confirm "Revoke" button
  await expect(owner.getByText('Revoke share link?')).toBeVisible()
  await owner.getByRole('button', { name: 'Revoke' }).last().click()

  // Link row is removed from the list
  await expect(linkUrlSpan).not.toBeVisible({ timeout: 8_000 })

  // ── 7. Anonymous reloads the link — should see 410 "no longer available" ─
  await anon.reload()
  await expect(anon.getByText(/no longer available/i)).toBeVisible()

  await ownerCtx.close()
  await anonCtx.close()
})
