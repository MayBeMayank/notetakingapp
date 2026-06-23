import { Router, type Router as RouterType } from 'express'
import { validateBody, validateQuery } from '../middleware/validate.middleware.js'
import * as notesController from '../controllers/notes.controller.js'
import { versionsRouter } from './versions.routes.js'
import {
  CreateNoteSchema,
  UpdateNoteSchema,
  ListNotesQuerySchema,
} from '@note-app/shared/schemas/notes'

export const notesRouter: RouterType = Router()

notesRouter.post('/', validateBody(CreateNoteSchema), notesController.create)
notesRouter.get('/', validateQuery(ListNotesQuerySchema), notesController.list)
notesRouter.get('/:id', notesController.get)
notesRouter.patch('/:id', validateBody(UpdateNoteSchema), notesController.update)
notesRouter.delete('/:id', notesController.remove)
notesRouter.post('/:id/restore', notesController.restore)

// Version history sub-resource (AB-1009): /api/notes/:id/versions[...]
notesRouter.use('/:id/versions', versionsRouter)
