import type { Request, Response } from 'express'
import * as notesService from '../services/notes.service.js'
import type { ListNotesQuery } from '@note-app/shared/schemas/notes'

export async function create(req: Request, res: Response): Promise<void> {
  const note = await notesService.createNote(req.userId, req.body)
  res.status(201).json({ note })
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = (req.validatedQuery ?? {}) as ListNotesQuery
  const result = await notesService.listNotes(req.userId, query)
  res.status(200).json(result)
}

export async function get(req: Request, res: Response): Promise<void> {
  const note = await notesService.getNoteById(req.userId, req.params['id'] as string)
  res.status(200).json({ note })
}

export async function update(req: Request, res: Response): Promise<void> {
  const note = await notesService.updateNote(req.userId, req.params['id'] as string, req.body)
  res.status(200).json({ note })
}

export async function remove(req: Request, res: Response): Promise<void> {
  await notesService.deleteNote(req.userId, req.params['id'] as string)
  res.status(204).send()
}

export async function restore(req: Request, res: Response): Promise<void> {
  const note = await notesService.restoreNote(req.userId, req.params['id'] as string)
  res.status(200).json({ note })
}
