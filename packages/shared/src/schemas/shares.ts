import { z } from 'zod'

// ── Request schema ─────────────────────────────────────────────────────────────

// `expiresAt`, if provided, MUST be a strictly-future ISO datetime. null/omitted
// = no expiry (the link never expires). A past-or-present value, or a malformed
// datetime, fails here with 400 + fields:[{ field: "expiresAt" }] (clarification 2,
// FRS-7.2). Expiry enforced at *view* time (a once-valid link now past expiry) is a
// separate 410 owned by the public-share-view route.
export const CreateShareSchema = z.object({
  expiresAt: z
    .string()
    .datetime({ offset: true, message: 'expiresAt must be an ISO 8601 datetime' })
    .refine((v) => new Date(v).getTime() > Date.now(), {
      message: 'expiresAt must be in the future',
    })
    .nullish(),
})

// ── Response schemas ───────────────────────────────────────────────────────────

// The owner-facing share resource. `url` is the relative path "/s/<token>" — no
// host, no base URL (clarification 4). `expiresAt` is null when the link never
// expires.
export const ShareResponseSchema = z.object({
  id: z.string(),
  noteId: z.string(),
  token: z.string(),
  url: z.string(),
  expiresAt: z.date().nullable(),
  viewCount: z.number(),
  createdAt: z.date(),
})

export const ShareEnvelopeSchema = z.object({ share: ShareResponseSchema })

// Bare array — no { data, page, limit, total } envelope (FRS-7.7).
export const ShareListResponseSchema = z.array(ShareResponseSchema)

// The public view payload — ONLY the note's current title + content (the TipTap
// `contentJson` document). No id, owner, tags, versions, timestamps, or share
// metadata are ever exposed (FRS-7.8).
export const PublicNoteViewSchema = z.object({
  title: z.string(),
  content: z.unknown(),
})

// ── Inferred types ───────────────────────────────────────────────────────────

export type CreateShareInput = z.infer<typeof CreateShareSchema>
export type ShareResponse = z.infer<typeof ShareResponseSchema>
export type ShareEnvelope = z.infer<typeof ShareEnvelopeSchema>
export type ShareListResponse = z.infer<typeof ShareListResponseSchema>
export type PublicNoteView = z.infer<typeof PublicNoteViewSchema>
