import { describe, expect, it } from 'vitest'
import { presetToExpiresAt } from './expiryPresets'

describe('share-ui › expiry presets', () => {
  it('never → null', () => {
    expect(presetToExpiresAt('never')).toBeNull()
  })

  it('1d → ISO string approximately 1 day in future', () => {
    const result = presetToExpiresAt('1d')!
    const ms = new Date(result).getTime() - Date.now()
    expect(ms).toBeGreaterThan(86_400_000 - 5_000)
    expect(ms).toBeLessThan(86_400_000 + 5_000)
  })

  it('7d → ISO string approximately 7 days in future', () => {
    const result = presetToExpiresAt('7d')!
    const ms = new Date(result).getTime() - Date.now()
    expect(ms).toBeGreaterThan(7 * 86_400_000 - 5_000)
    expect(ms).toBeLessThan(7 * 86_400_000 + 5_000)
  })

  it('30d → ISO string approximately 30 days in future', () => {
    const result = presetToExpiresAt('30d')!
    const ms = new Date(result).getTime() - Date.now()
    expect(ms).toBeGreaterThan(30 * 86_400_000 - 5_000)
    expect(ms).toBeLessThan(30 * 86_400_000 + 5_000)
  })

  it('result is a valid ISO 8601 string (non-never)', () => {
    const result = presetToExpiresAt('7d')!
    expect(() => new Date(result)).not.toThrow()
    expect(new Date(result).toISOString()).toBe(result)
  })
})
