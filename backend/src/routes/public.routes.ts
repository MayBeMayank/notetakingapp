import { Router, type Router as RouterType } from 'express'
import * as publicController from '../controllers/public.controller.js'

// Mounted at /api/public, BEFORE the auth middleware (FRS-9.2 exemption, SDS §6.2).
export const publicRouter: RouterType = Router()

publicRouter.get('/notes/:token', publicController.view)
