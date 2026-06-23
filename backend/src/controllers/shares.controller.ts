import type { Request, Response } from 'express'
import * as sharesService from '../services/shares.service.js'

export async function create(req: Request, res: Response): Promise<void> {
  const share = await sharesService.createShare(
    req.userId,
    req.params['id'] as string,
    req.body,
  )
  res.status(201).json({ share })
}

export async function list(req: Request, res: Response): Promise<void> {
  const shares = await sharesService.listShares(req.userId)
  res.status(200).json(shares)
}

export async function revoke(req: Request, res: Response): Promise<void> {
  await sharesService.revokeShare(req.userId, req.params['id'] as string)
  res.status(204).send()
}
