import type { Request, Response } from 'express'
import * as searchService from '../services/search.service.js'
import type { SearchQuery } from '@note-app/shared/schemas/search'

export async function search(req: Request, res: Response): Promise<void> {
  const query = (req.validatedQuery ?? {}) as SearchQuery
  const result = await searchService.search(req.userId, query)
  res.status(200).json(result)
}
