import { z } from 'zod'

// ── Request schemas ──────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email: z.string().email('Must be a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
})

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
})

// ── Response schemas ─────────────────────────────────────────────────────────

export const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  createdAt: z.date(),
})

export const RegisterResponseSchema = z.object({
  user: UserResponseSchema,
})

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: UserResponseSchema,
})

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
})

// ── Inferred types ───────────────────────────────────────────────────────────

export type RegisterInput = z.infer<typeof RegisterSchema>
export type LoginInput = z.infer<typeof LoginSchema>
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>
export type LogoutInput = z.infer<typeof LogoutSchema>
export type UserResponse = z.infer<typeof UserResponseSchema>
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>
export type LoginResponse = z.infer<typeof LoginResponseSchema>
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>
