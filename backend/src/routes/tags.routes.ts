import { Router, type Router as RouterType } from 'express'
import { validateBody } from '../middleware/validate.middleware.js'
import * as tagsController from '../controllers/tags.controller.js'
import { CreateTagSchema, UpdateTagSchema } from '@note-app/shared/schemas/tags'

export const tagsRouter: RouterType = Router()

tagsRouter.post('/', validateBody(CreateTagSchema), tagsController.create)
tagsRouter.get('/', tagsController.list)
tagsRouter.patch('/:id', validateBody(UpdateTagSchema), tagsController.update)
tagsRouter.delete('/:id', tagsController.remove)
