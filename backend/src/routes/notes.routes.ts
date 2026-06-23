import { Router, type Router as RouterType } from 'express'
import { validateBody, validateQuery } from '../middleware/validate.middleware.js'
import * as notesController from '../controllers/notes.controller.js'
import * as sharesController from '../controllers/shares.controller.js'
import {
  CreateNoteSchema,
  UpdateNoteSchema,
  ListNotesQuerySchema,
} from '@note-app/shared/schemas/notes'
import { CreateShareSchema } from '@note-app/shared/schemas/shares'

export const notesRouter: RouterType = Router()

notesRouter.post('/', validateBody(CreateNoteSchema), notesController.create)
notesRouter.get('/', validateQuery(ListNotesQuerySchema), notesController.list)
notesRouter.get('/:id', notesController.get)
notesRouter.patch('/:id', validateBody(UpdateNoteSchema), notesController.update)
notesRouter.delete('/:id', notesController.remove)
notesRouter.post('/:id/restore', notesController.restore)

// Note-scoped share creation (FRS-7.1) — resolves as POST /api/notes/:id/shares.
notesRouter.post('/:id/shares', validateBody(CreateShareSchema), sharesController.create)
