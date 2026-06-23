import { z } from 'zod'

// q is optional and length-bounded. Missing/empty/whitespace q is NOT a 400 —
// the service returns an empty result (FRS-6.6). The 200-char cap guards the DB.
// page/limit are coerced ints (like ListNotesQuerySchema): non-numeric → 400;
// range is clamped by the service (SDS §5.2), not rejected here.
export const SearchQuerySchema = z.object({
  q: z.string().max(200, 'q must be at most 200 characters').optional(),
  page: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
})

export const SearchResultItemSchema = z.object({
  noteId: z.string(),
  title: z.string(),
  snippet: z.string(),
  rank: z.number(),
})

export const SearchListResponseSchema = z.object({
  data: z.array(SearchResultItemSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
})

export type SearchQuery = z.infer<typeof SearchQuerySchema>
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>
export type SearchListResponse = z.infer<typeof SearchListResponseSchema>
