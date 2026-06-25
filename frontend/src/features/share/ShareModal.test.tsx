import { screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { ShareModal } from './ShareModal'
import type { ShareLinkItem } from '@/api/shares'

vi.mock('@/api/client', () => ({}))

vi.mock('@/api/shares', () => ({
  useNoteShares: vi.fn(),
  useCreateShare: vi.fn(),
  useRevokeShare: vi.fn(),
}))

vi.mock('./CreateShareForm', () => ({
  CreateShareForm: () => <div data-testid="create-form" />,
}))

vi.mock('./ShareLinkRow', () => ({
  ShareLinkRow: ({ share }: { share: ShareLinkItem }) => (
    <div data-testid={`link-row-${share.id}`}>{share.token}</div>
  ),
}))

import { useNoteShares } from '@/api/shares'

const mockUseNoteShares = vi.mocked(useNoteShares)

const makeIdleQuery = (data: ShareLinkItem[] | undefined, extra = {}) => ({
  data,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  ...extra,
})

const makeShareLink = (overrides: Partial<ShareLinkItem> = {}): ShareLinkItem => ({
  id: 'share-1',
  noteId: 'note-1',
  token: 'abc123token',
  url: '/s/abc123token',
  expiresAt: null,
  viewCount: 0,
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('share › ShareModal', () => {
  beforeEach(() => {
    mockUseNoteShares.mockReturnValue(makeIdleQuery([]) as ReturnType<typeof useNoteShares>)
  })

  it('renders nothing when open=false', () => {
    const { container } = renderWithProviders(
      <ShareModal noteId="note-1" open={false} onClose={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the modal when open=true', () => {
    renderWithProviders(<ShareModal noteId="note-1" open={true} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: /share note/i })).toBeInTheDocument()
  })

  it('shows loading skeleton when isLoading=true', () => {
    mockUseNoteShares.mockReturnValue({
      ...makeIdleQuery(undefined),
      isLoading: true,
    } as ReturnType<typeof useNoteShares>)

    renderWithProviders(<ShareModal noteId="note-1" open={true} onClose={vi.fn()} />)
    const busy = document.querySelector('[aria-busy="true"]')
    expect(busy).toBeInTheDocument()
  })

  it('shows empty state message when links array is empty', () => {
    mockUseNoteShares.mockReturnValue(makeIdleQuery([]) as ReturnType<typeof useNoteShares>)

    renderWithProviders(<ShareModal noteId="note-1" open={true} onClose={vi.fn()} />)
    expect(screen.getByText('No active links')).toBeInTheDocument()
  })

  it('renders each link row when links exist', () => {
    const links = [makeShareLink({ id: 'share-1', token: 'token-one' }), makeShareLink({ id: 'share-2', token: 'token-two' })]
    mockUseNoteShares.mockReturnValue(makeIdleQuery(links) as ReturnType<typeof useNoteShares>)

    renderWithProviders(<ShareModal noteId="note-1" open={true} onClose={vi.fn()} />)
    expect(screen.getByTestId('link-row-share-1')).toBeInTheDocument()
    expect(screen.getByTestId('link-row-share-2')).toBeInTheDocument()
    expect(screen.getByText('token-one')).toBeInTheDocument()
    expect(screen.getByText('token-two')).toBeInTheDocument()
  })

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn()
    renderWithProviders(<ShareModal noteId="note-1" open={true} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<ShareModal noteId="note-1" open={true} onClose={onClose} />)
    // The backdrop is the outermost fixed div (parent of the dialog)
    const dialog = screen.getByRole('dialog', { name: /share note/i })
    const backdrop = dialog.parentElement!
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<ShareModal noteId="note-1" open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows error state when isError=true', () => {
    mockUseNoteShares.mockReturnValue({
      ...makeIdleQuery(undefined),
      isError: true,
    } as ReturnType<typeof useNoteShares>)

    renderWithProviders(<ShareModal noteId="note-1" open={true} onClose={vi.fn()} />)
    expect(screen.getByText('Failed to load links')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('renders the create form section', () => {
    renderWithProviders(<ShareModal noteId="note-1" open={true} onClose={vi.fn()} />)
    expect(screen.getByTestId('create-form')).toBeInTheDocument()
  })

  it('does not call onClose when dialog content is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<ShareModal noteId="note-1" open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog', { name: /share note/i }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
