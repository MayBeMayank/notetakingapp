import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from '@/api/client'

/**
 * Map a backend 400 `fields[]` validation error onto react-hook-form fields.
 * Returns true if field-level errors were applied, false otherwise (so the
 * caller can fall back to a form-level message).
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): boolean {
  if (error instanceof ApiError && error.fields && error.fields.length > 0) {
    for (const f of error.fields) {
      setError(f.field as Path<T>, { type: 'server', message: f.message })
    }
    return true
  }
  return false
}
