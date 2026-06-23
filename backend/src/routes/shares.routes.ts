import { Router, type Router as RouterType } from 'express'
import * as sharesController from '../controllers/shares.controller.js'

// Mounted at /api/shares, behind the auth middleware. The note-scoped create
// (POST /api/notes/:id/shares) lives on notesRouter so it resolves under /api/notes.
export const sharesRouter: RouterType = Router()

sharesRouter.get('/', sharesController.list)
sharesRouter.delete('/:id', sharesController.revoke)
