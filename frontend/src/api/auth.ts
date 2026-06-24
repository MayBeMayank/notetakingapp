import { useMutation } from '@tanstack/react-query'
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@note-app/shared/schemas/auth'
import { ApiError, apiFetch } from '@/api/client'
import { getStoredRefreshToken, useAuthStore, type AuthUser } from '@/stores/auth.store'

// Response shapes are typed locally (read-only consumption); we do NOT re-validate
// them with the shared request schemas, whose `createdAt` is `z.date()` and would
// throw on the JSON string returned over the wire.
interface LoginResult {
  accessToken: string
  refreshToken: string
  user: AuthUser
}
interface RegisterResult {
  user: AuthUser
}
interface OkResult {
  ok: true
}

export function useRegister() {
  return useMutation<RegisterResult, ApiError, RegisterInput>({
    mutationFn: (input) =>
      apiFetch<RegisterResult>('/auth/register', { method: 'POST', body: input, auth: false }),
  })
}

export function useLogin() {
  return useMutation<LoginResult, ApiError, LoginInput>({
    mutationFn: (input) =>
      apiFetch<LoginResult>('/auth/login', { method: 'POST', body: input, auth: false }),
    onSuccess: (data) => {
      useAuthStore.getState().setSession(data)
    },
  })
}

export function useLogout() {
  return useMutation<void, ApiError, void>({
    mutationFn: async () => {
      const refreshToken = getStoredRefreshToken()
      try {
        if (refreshToken) {
          await apiFetch<void>('/auth/logout', {
            method: 'POST',
            body: { refreshToken },
            auth: true,
          })
        }
      } finally {
        // Always clear locally — never leave the browser in a stale authed state.
        useAuthStore.getState().clear()
      }
    },
  })
}

export function useForgotPassword() {
  return useMutation<OkResult, ApiError, ForgotPasswordInput>({
    mutationFn: (input) =>
      apiFetch<OkResult>('/auth/forgot-password', { method: 'POST', body: input, auth: false }),
  })
}

export function useResetPassword() {
  return useMutation<OkResult, ApiError, ResetPasswordInput>({
    mutationFn: (input) =>
      apiFetch<OkResult>('/auth/reset-password', { method: 'POST', body: input, auth: false }),
  })
}
