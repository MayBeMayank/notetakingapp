import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { ZodError, ZodSchema } from 'zod'

function zodErrorToFields(error: ZodError) {
  return error.errors.map((e) => ({
    field: (e.path.join('.') || e.path[0]?.toString()) ?? 'unknown',
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

export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
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
