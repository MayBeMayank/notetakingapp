import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../lib/errors.js'

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const body: Record<string, unknown> = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
      },
    }
    res.status(err.statusCode).json(body)
    return
  }
  console.error('Unhandled error:', err)
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  })
}
