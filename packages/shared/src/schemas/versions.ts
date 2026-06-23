import { z } from 'zod'
import { TipTapContentSchema } from './notes.js'

// ── Response schemas ─────────────────────────────────────────────────────────

// List item — no content (SDS §6.7 list shape). The query applies reverse-chrono
// ordering (most recent first, FRS-8.2).
export const VersionListItemSchema = z.object({
  id: z.string(),
  versionNumber: z.number().int(),
  title: z.string(),
  createdAt: z.date(),
})

// The version list is a bare array, not the paginated `{ data, page, … }`
// envelope — it is bounded by the 50-version retention cap (SDS §6.7 / FRS-8.5).
export const VersionListResponseSchema = z.array(VersionListItemSchema)

// Detail — full content + the tag-id snapshot captured at that version (ADR-003).
// `content` is the API name for the stored `contentJson`, mirroring NoteResponse.
export const VersionDetailSchema = z.object({
  id: z.string(),
  versionNumber: z.number().int(),
  title: z.string(),
  content: TipTapContentSchema,
  tagIds: z.array(z.string()),
  createdAt: z.date(),
})

export const VersionEnvelopeSchema = z.object({
  version: VersionDetailSchema,
})

// ── Inferred types ───────────────────────────────────────────────────────────

export type VersionListItem = z.infer<typeof VersionListItemSchema>
export type VersionListResponse = z.infer<typeof VersionListResponseSchema>
export type VersionDetail = z.infer<typeof VersionDetailSchema>
export type VersionEnvelope = z.infer<typeof VersionEnvelopeSchema>
