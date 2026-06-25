import { screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { ShareLinkRow } from './ShareLinkRow'
import type { ShareLinkItem } from '@/api/shares'

vi.mock('@/api/client', () => ({}))

vi.mock('@/api/shares', () => ({
  useRevokeShare: vi.fn(),
  useNoteShares: vi.fn(),
  useCreateShare: vi.fn(),
}))

vi.mock('./shareUrl', () => ({
  toAbsoluteShareUrl: (url: string) => 'http://test.example' + url,
}))

import { useRevokeShare } from '@/api/shares'

const mockUseRevokeShare = vi.mocked(useRevokeShare)

const makeShare = (overrides: Partial<ShareLinkItem> = {}): ShareLinkItem => ({
  id: 'share-1',
  noteId: 'note-1',
  token: 'abc123',
  url: '/s/abc123',
  expiresAt: null,
  viewCount: 5,
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeMockRevoke = (extra = {}) => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  ...extra,
})

describe('share › ShareLinkRow', () => {
  beforeEach(() => {
    mockUseRevokeShare.mockReturnValue(makeMockRevoke() as ReturnType<typeof useRevokeShare>)
  })

  it('renders the absolute URL built from toAbsoluteShareUrl', () => {
    renderWithProviders(<ShareLinkRow share={makeShare()} />)
    expect(screen.getByText('http://test.example/s/abc123')).toBeInTheDocument()
  })

  it('shows "Never expires" badge when expiresAt is null', () => {
    renderWithProviders(<ShareLinkRow share={makeShare({ expiresAt: null })} />)
    expect(screen.getByText('Never expires')).toBeInTheDocument()
  })

  it('shows future expiry date when expiresAt is set', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    renderWithProviders(<ShareLinkRow share={makeShare({ expiresAt: future })} />)
    const badge = screen.getByText(/Expires/i)
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toMatch(/^Expires /)
  })

  it('shows "Expired" state for past expiry dates', () => {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    renderWithProviders(<ShareLinkRow share={makeShare({ expiresAt: past })} />)
    expect(screen.getByText(/^Expired /)).toBeInTheDocument()
  })

  it('shows view count (singular)', () => {
    renderWithProviders(<ShareLinkRow share={makeShare({ viewCount: 1 })} />)
    expect(screen.getByText('1 view')).toBeInTheDocument()
  })

  it('shows view count (plural)', () => {
    renderWithProviders(<ShareLinkRow share={makeShare({ viewCount: 42 })} />)
    expect(screen.getByText('42 views')).toBeInTheDocument()
  })

  it('shows zero views', () => {
    renderWithProviders(<ShareLinkRow share={makeShare({ viewCount: 0 })} />)
    expect(screen.getByText('0 views')).toBeInTheDocument()
  })

  it('copy button writes absolute URL to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })

    renderWithProviders(<ShareLinkRow share={makeShare()} />)
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    // Wait for async handleCopy
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('http://test.example/s/abc123')
    })
  })

  it('clicking Revoke button opens confirmation dialog', () => {
    renderWithProviders(<ShareLinkRow share={makeShare()} />)
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
    expect(screen.getByText('Revoke share link?')).toBeInTheDocument()
  })

  it('confirms revoke calls mutate with share id', () => {
    const mutate = vi.fn()
    mockUseRevokeShare.mockReturnValue(makeMockRevoke({ mutate }) as ReturnType<typeof useRevokeShare>)

    renderWithProviders(<ShareLinkRow share={makeShare({ id: 'share-99' })} />)
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
    // Confirm dialog should be open — click the confirm button inside the dialog
    const dialog = screen.getByRole('alertdialog', { name: /revoke share link/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Revoke$/ }))
    expect(mutate).toHaveBeenCalledWith('share-99', expect.any(Object))
  })

  it('cancel in confirmation dialog closes it without calling mutate', () => {
    const mutate = vi.fn()
    mockUseRevokeShare.mockReturnValue(makeMockRevoke({ mutate }) as ReturnType<typeof useRevokeShare>)

    renderWithProviders(<ShareLinkRow share={makeShare()} />)
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.queryByText('Revoke share link?')).toBeNull()
  })

  it('shows Revoking… text while isPending', () => {
    mockUseRevokeShare.mockReturnValue(makeMockRevoke({ isPending: true }) as ReturnType<typeof useRevokeShare>)
    renderWithProviders(<ShareLinkRow share={makeShare()} />)
    expect(screen.getByRole('button', { name: /revoking/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revoking/i })).toBeDisabled()
  })
})
