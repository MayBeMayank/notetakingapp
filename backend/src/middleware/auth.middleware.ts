import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../lib/jwt.js'
import { UnauthorizedError } from '../lib/errors.js'

export function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const header = req.headers['authorization']
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError())
    return
  }
  const token = header.slice(7)
  try {
    const payload = verifyAccessToken(token)
    req.userId = payload.sub
    next()
  } catch {
    next(new UnauthorizedError())
  }
}
