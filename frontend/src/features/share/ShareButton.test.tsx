import { screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { ShareButton } from './ShareButton'

vi.mock('@/api/client', () => ({}))

vi.mock('./ShareModal', () => ({
  ShareModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="share-modal">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}))

describe('share › ShareButton', () => {
  it('renders a "Share" button', () => {
    renderWithProviders(<ShareButton noteId="note-1" />)
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument()
  })

  it('modal is not visible initially', () => {
    renderWithProviders(<ShareButton noteId="note-1" />)
    expect(screen.queryByTestId('share-modal')).toBeNull()
  })

  it('clicking Share button opens the modal', () => {
    renderWithProviders(<ShareButton noteId="note-1" />)
    fireEvent.click(screen.getByRole('button', { name: /share/i }))
    expect(screen.getByTestId('share-modal')).toBeInTheDocument()
  })

  it('modal can be closed via onClose callback', () => {
    renderWithProviders(<ShareButton noteId="note-1" />)
    fireEvent.click(screen.getByRole('button', { name: /share/i }))
    expect(screen.getByTestId('share-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByTestId('share-modal')).toBeNull()
  })

  it('can be reopened after closing', () => {
    renderWithProviders(<ShareButton noteId="note-1" />)
    fireEvent.click(screen.getByRole('button', { name: /share/i }))
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    fireEvent.click(screen.getByRole('button', { name: /share/i }))
    expect(screen.getByTestId('share-modal')).toBeInTheDocument()
  })
})
