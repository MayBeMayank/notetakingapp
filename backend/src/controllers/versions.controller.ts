import type { Request, Response } from 'express'
import * as versionsService from '../services/versions.service.js'

export async function list(req: Request, res: Response): Promise<void> {
  // Bare array, not a pagination envelope (SDS §6.7) — bounded by the 50-cap.
  const versions = await versionsService.listVersions(req.userId, req.params['id'] as string)
  res.status(200).json(versions)
}

export async function get(req: Request, res: Response): Promise<void> {
  const version = await versionsService.getVersion(
    req.userId,
    req.params['id'] as string,
    req.params['versionId'] as string,
  )
  res.status(200).json({ version })
}

export async function restore(req: Request, res: Response): Promise<void> {
  const note = await versionsService.restoreVersion(
    req.userId,
    req.params['id'] as string,
    req.params['versionId'] as string,
  )
  res.status(200).json({ note })
}
