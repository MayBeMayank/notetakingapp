import { z } from 'zod'

// ── Content ────────────────────────────────────────────────────────────────────

// A TipTap / ProseMirror document. We validate only that it is a doc-shaped
// object (carries a `type`), not the full node schema — this rejects strings,
// arrays, and null so malformed `content` fails at the boundary with a 400.
export const TipTapContentSchema = z.object({ type: z.string() }).passthrough()

// ── Request schemas ──────────────────────────────────────────────────────────

export const CreateNoteSchema = z.object({
  title: z.string().max(255).optional(),
  content: TipTapContentSchema.optional(),
  tagIds: z.array(z.string()).optional(),
})

export const UpdateNoteSchema = z
  .object({
    title: z.string().max(255).optional(),
    content: TipTapContentSchema.optional(),
    tagIds: z.array(z.string()).optional(),
  })
  .refine(
    (data) => data.title !== undefined || data.content !== undefined || data.tagIds !== undefined,
    { message: 'At least one of title, content, or tagIds must be provided' },
  )

// page/limit arrive as query strings. `z.coerce.number()` converts them and
// `z.number()` rejects NaN, so non-numeric values (e.g. ?page=abc) fail here
// with a 400. Range/defaults are NOT enforced here — the service clamps
// out-of-range values rather than rejecting them (SDS §5.2).
//
// sort/order/status are enums: an out-of-enum value is REJECTED with 400 (an
// enum cannot be meaningfully clamped). Defaults (sort=updatedAt, order=desc,
// status=active) are applied by the service, not here (FRS-4.5.2 / 4.4.2).
//
// tags is a comma-separated list of tag IDs for the OR filter (FRS-4.5.3). The
// transform trims and drops blanks so `?tags=` / `?tags=,,` become `[]` (no
// filter). Ownership of the IDs is resolved in the service.
export const ListNotesQuerySchema = z.object({
  page: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
  sort: z.enum(['updatedAt', 'createdAt', 'title']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  status: z.enum(['active', 'trashed']).optional(),
  tags: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    ),
})

// ── Response schemas ─────────────────────────────────────────────────────────

// `content` is the API name for the stored `contentJson`. `contentText` is an
// internal FTS derivation and is never exposed.
export const NoteResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: TipTapContentSchema,
  tagIds: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const NoteEnvelopeSchema = z.object({
  note: NoteResponseSchema,
})

export const NoteListResponseSchema = z.object({
  data: z.array(NoteResponseSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
})

// ── Inferred types ───────────────────────────────────────────────────────────

export type CreateNoteInput = z.infer<typeof CreateNoteSchema>
export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>
export type ListNotesQuery = z.infer<typeof ListNotesQuerySchema>
// Narrowed enum members for backend use (repo options, service defaults) — derived
// from the schema so the union is never hand-duplicated.
export type NoteSortField = NonNullable<ListNotesQuery['sort']>
export type NoteSortOrder = NonNullable<ListNotesQuery['order']>
export type NoteListStatus = NonNullable<ListNotesQuery['status']>
export type NoteResponse = z.infer<typeof NoteResponseSchema>
export type NoteEnvelope = z.infer<typeof NoteEnvelopeSchema>
export type NoteListResponse = z.infer<typeof NoteListResponseSchema>
