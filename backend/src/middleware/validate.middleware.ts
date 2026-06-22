import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { ZodError, ZodSchema, ZodTypeAny } from 'zod'

function zodErrorToFields(error: ZodError) {
  return error.errors.map((e) => ({
    field: e.path.length > 0 ? e.path.join('.') : 'body',
    message: e.message,
  }))
}

export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', fields: zodErrorToFields(result.error) },
      })
      return
    }
    req.body = result.data
    next()
  }
}

// Accepts any Zod schema, including transforming ones (input type ≠ output
// type) — e.g. the notes-list `tags` param parses a comma string into string[].
export function validateQuery<S extends ZodTypeAny>(schema: S): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', fields: zodErrorToFields(result.error) },
      })
      return
    }
    req.validatedQuery = result.data
    next()
  }
}
