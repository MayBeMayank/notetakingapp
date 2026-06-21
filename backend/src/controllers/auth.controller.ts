import type { Request, Response } from 'express'
import * as authService from '../services/auth.service.js'

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body)
  res.status(201).json(result)
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body)
  res.status(200).json(result)
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const result = await authService.refresh(req.body)
  res.status(200).json(result)
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.body, req.userId)
  res.status(204).send()
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const result = await authService.forgotPassword(req.body)
  res.status(200).json(result)
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const result = await authService.resetPassword(req.body)
  res.status(200).json(result)
}
