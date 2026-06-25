import { describe, expect, it } from 'vitest'
import { toAbsoluteShareUrl } from './shareUrl'

describe('share-ui › shareUrl', () => {
  it('prepends window.location.origin to relative path', () => {
    const result = toAbsoluteShareUrl('/s/abc123')
    expect(result).toBe(`${window.location.origin}/s/abc123`)
  })

  it('full URL contains the token', () => {
    const result = toAbsoluteShareUrl('/s/mytoken')
    expect(result).toContain('mytoken')
  })
})
