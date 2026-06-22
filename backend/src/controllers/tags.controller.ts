import type { Request, Response } from 'express'
import * as tagsService from '../services/tags.service.js'

export async function create(req: Request, res: Response): Promise<void> {
  const tag = await tagsService.createTag(req.userId, req.body)
  res.status(201).json({ tag })
}

export async function list(req: Request, res: Response): Promise<void> {
  const tags = await tagsService.listTags(req.userId)
  res.status(200).json(tags)
}

export async function update(req: Request, res: Response): Promise<void> {
  const tag = await tagsService.updateTag(req.userId, req.params['id'] as string, req.body)
  res.status(200).json({ tag })
}

export async function remove(req: Request, res: Response): Promise<void> {
  await tagsService.deleteTag(req.userId, req.params['id'] as string)
  res.status(204).send()
}
