import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { ZodSchema } from 'zod'

export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const fields = result.error.errors.map((e) => ({
        field: (e.path.join('.') || e.path[0]?.toString()) ?? 'unknown',
        message: e.message,
      }))
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', fields },
      })
      return
    }
    req.body = result.data
    next()
  }
}
