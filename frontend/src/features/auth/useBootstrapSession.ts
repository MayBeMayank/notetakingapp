import { useEffect, useRef } from 'react'
import { bootstrapSession } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'

/**
 * Runs once on app mount. If a refresh token survived a reload (status 'pending'),
 * exchange it for an access token before protected content renders.
 */
export function useBootstrapSession(): void {
  const started = useRef(false)
  const status = useAuthStore((s) => s.status)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (status === 'pending') {
      void bootstrapSession()
    }
  }, [status])
}
