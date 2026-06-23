import { Router, type Router as RouterType } from 'express'
import { validateQuery } from '../middleware/validate.middleware.js'
import * as searchController from '../controllers/search.controller.js'
import { SearchQuerySchema } from '@note-app/shared/schemas/search'

export const searchRouter: RouterType = Router()

searchRouter.get('/', validateQuery(SearchQuerySchema), searchController.search)
