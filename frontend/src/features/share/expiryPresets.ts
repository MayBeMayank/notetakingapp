export type ExpiryPreset = 'never' | '1d' | '7d' | '30d'

export interface ExpiryOption {
  value: ExpiryPreset
  label: string
}

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { value: 'never', label: 'Never expires' },
  { value: '1d',    label: 'Expires in 1 day' },
  { value: '7d',    label: 'Expires in 7 days' },
  { value: '30d',   label: 'Expires in 30 days' },
]

/**
 * Converts a preset to a strictly-future ISO 8601 datetime string, or null for
 * "never". Computed at call time so the value is always in the future when
 * CreateShareSchema validates it server-side (AD-4).
 */
export function presetToExpiresAt(preset: ExpiryPreset): string | null {
  if (preset === 'never') return null
  const ms = { '1d': 1, '7d': 7, '30d': 30 }[preset] * 86_400_000
  return new Date(Date.now() + ms).toISOString()
}
