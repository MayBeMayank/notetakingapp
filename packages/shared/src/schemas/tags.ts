import { z } from 'zod'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export const CreateTagSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(50, 'name must be at most 50 characters'),
  color: z.string().regex(HEX_COLOR, 'color must be a #RRGGBB hex value'),
})

export const UpdateTagSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(50, 'name must be at most 50 characters').optional(),
    color: z.string().regex(HEX_COLOR, 'color must be a #RRGGBB hex value').optional(),
  })
  .refine((d) => d.name !== undefined || d.color !== undefined, {
    message: 'At least one of name or color must be provided',
  })

export const TagResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const TagWithCountSchema = TagResponseSchema.extend({ noteCount: z.number() })
export const TagEnvelopeSchema = z.object({ tag: TagResponseSchema })
export const TagListResponseSchema = z.array(TagWithCountSchema)

export type CreateTagInput = z.infer<typeof CreateTagSchema>
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>
export type TagResponse = z.infer<typeof TagResponseSchema>
export type TagWithCount = z.infer<typeof TagWithCountSchema>
export type TagListResponse = z.infer<typeof TagListResponseSchema>
