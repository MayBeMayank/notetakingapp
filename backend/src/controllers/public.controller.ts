import type { Request, Response } from 'express'
import * as sharesService from '../services/shares.service.js'

// No auth context — the route is mounted before the auth middleware. Only the
// token state governs the outcome (FRS-7.3, FRS-9.2 exemption).
export async function view(req: Request, res: Response): Promise<void> {
  const note = await sharesService.viewByToken(req.params['token'] as string)
  res.status(200).json(note)
}
