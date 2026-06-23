import { Router, type Router as RouterType } from 'express'
import * as versionsController from '../controllers/versions.controller.js'

// mergeParams: true so the `:id` (note id) from the parent `/api/notes/:id`
// mount is visible alongside this router's own `:versionId` param.
export const versionsRouter: RouterType = Router({ mergeParams: true })

versionsRouter.get('/', versionsController.list)
versionsRouter.get('/:versionId', versionsController.get)
versionsRouter.post('/:versionId/restore', versionsController.restore)
