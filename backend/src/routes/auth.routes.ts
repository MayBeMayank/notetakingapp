import { Router, type Router as RouterType } from 'express'
import { validateBody } from '../middleware/validate.middleware.js'
import { authMiddleware } from '../middleware/auth.middleware.js'
import * as authController from '../controllers/auth.controller.js'
import {
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
  LogoutSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from '@note-app/shared/schemas/auth'

export const authRouter: RouterType = Router()

authRouter.post('/register', validateBody(RegisterSchema), authController.register)
authRouter.post('/login', validateBody(LoginSchema), authController.login)
authRouter.post('/refresh', validateBody(RefreshTokenSchema), authController.refresh)
authRouter.post('/logout', authMiddleware, validateBody(LogoutSchema), authController.logout)
authRouter.post('/forgot-password', validateBody(ForgotPasswordSchema), authController.forgotPassword)
authRouter.post('/reset-password', validateBody(ResetPasswordSchema), authController.resetPassword)
