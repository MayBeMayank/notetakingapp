import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import PublicSharePage from './PublicSharePage'
import { usePublicNote } from '@/api/shares'

vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>()
  return { ...mod, useParams: () => ({ token: 'tok123' }) }
})

vi.mock('@/features/share/PublicNoteView', () => ({
  PublicNoteView: ({ title }: { title: string }) => <div data-testid="public-note">{title}</div>,
}))

vi.mock('@/api/shares', () => ({
  usePublicNote: vi.fn(),
}))

describe('public-share-view-ui › PublicSharePage', () => {
  it('shows loading state while fetching', () => {
    vi.mocked(usePublicNote).mockReturnValue({ isLoading: true, isError: false, data: undefined, error: null } as never)
    renderWithProviders(<PublicSharePage />)
    // Loading skeleton has animate-pulse elements
    expect(document.querySelector('.animate-pulse')).not.toBeNull()
  })

  it('shows not-found message on 404', () => {
    vi.mocked(usePublicNote).mockReturnValue({ isLoading: false, isError: true, data: undefined, error: { status: 404 } } as never)
    renderWithProviders(<PublicSharePage />)
    expect(screen.getByText(/doesn't exist/i)).toBeInTheDocument()
  })

  it('shows gone message on 410', () => {
    vi.mocked(usePublicNote).mockReturnValue({ isLoading: false, isError: true, data: undefined, error: { status: 410 } } as never)
    renderWithProviders(<PublicSharePage />)
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
  })

  it('shows gone message on 410 even for note-deleted case (no content leak)', () => {
    vi.mocked(usePublicNote).mockReturnValue({ isLoading: false, isError: true, data: undefined, error: { status: 410 } } as never)
    renderWithProviders(<PublicSharePage />)
    expect(screen.queryByTestId('public-note')).toBeNull()
  })

  it('renders PublicNoteView with title when loaded', () => {
    vi.mocked(usePublicNote).mockReturnValue({ isLoading: false, isError: false, data: { title: 'Hello World', content: {} }, error: null } as never)
    renderWithProviders(<PublicSharePage />)
    expect(screen.getByTestId('public-note')).toHaveTextContent('Hello World')
  })

  it('public page shows Shared note header (no app navigation)', () => {
    vi.mocked(usePublicNote).mockReturnValue({ isLoading: false, isError: false, data: { title: 'T', content: {} }, error: null } as never)
    renderWithProviders(<PublicSharePage />)
    expect(screen.getByText(/shared note/i)).toBeInTheDocument()
  })
})
