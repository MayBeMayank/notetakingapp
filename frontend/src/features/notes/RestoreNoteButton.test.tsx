import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { RestoreNoteButton } from './RestoreNoteButton'

let mockMutate: ReturnType<typeof vi.fn>
let mockState: { isPending: boolean; isError: boolean; error: unknown }

vi.mock('@/api/notes', () => ({ useRestoreNote: () => ({ mutate: mockMutate, ...mockState }) }))

beforeEach(() => {
  mockMutate = vi.fn()
  mockState = { isPending: false, isError: false, error: null }
})

describe('notes-list-ui › restore', () => {
  it('renders Restore button', () => {
    renderWithProviders(<RestoreNoteButton noteId="n1" />)
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
  })

  it('clicking Restore calls mutate with noteId', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RestoreNoteButton noteId="n1" />)
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    expect(mockMutate).toHaveBeenCalledWith('n1')
  })

  it('button disabled and shows Restoring while pending', () => {
    mockState.isPending = true
    renderWithProviders(<RestoreNoteButton noteId="n1" />)
    const button = screen.getByRole('button', { name: 'Restoring…' })
    expect(button).toBeDisabled()
  })

  it('shows expired-window message on 422', () => {
    mockState.isError = true
    mockState.error = { status: 422 }
    renderWithProviders(<RestoreNoteButton noteId="n1" />)
    expect(screen.getByText(/Recovery window has expired/)).toBeInTheDocument()
  })

  it('shows generic error on non-422', () => {
    mockState.isError = true
    mockState.error = { status: 500 }
    renderWithProviders(<RestoreNoteButton noteId="n1" />)
    expect(screen.getByText(/Failed to restore/)).toBeInTheDocument()
  })
})
