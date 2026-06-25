import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { DeleteNoteButton } from './DeleteNoteButton'

let mockMutate: ReturnType<typeof vi.fn>
let mockMutationState: { isPending: boolean; isError: boolean; reset: () => void }

vi.mock('@/api/notes', () => ({
  useDeleteNote: () => ({ mutate: mockMutate, ...mockMutationState }),
}))

beforeEach(() => {
  mockMutate = vi.fn()
  mockMutationState = { isPending: false, isError: false, reset: vi.fn() }
})

describe('notes-list-ui › soft-delete', () => {
  it('shows Delete button and no dialog initially', () => {
    renderWithProviders(<DeleteNoteButton noteId="n1" noteTitle="My note" />)

    expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('clicking Delete opens the confirm dialog', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DeleteNoteButton noteId="n1" noteTitle="My note" />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('clicking Cancel closes dialog without calling mutate', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DeleteNoteButton noteId="n1" noteTitle="My note" />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('clicking confirm calls mutate with the noteId', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DeleteNoteButton noteId="n1" noteTitle="My note" />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))

    expect(mockMutate).toHaveBeenCalledWith('n1', expect.any(Object))
  })

  it('Delete button disabled and shows Deleting while pending', () => {
    mockMutationState.isPending = true
    renderWithProviders(<DeleteNoteButton noteId="n1" noteTitle="My note" />)

    const button = screen.getByRole('button', { name: 'Deleting…' })
    expect(button).toBeDisabled()
  })

  it('shows error message when mutation has errored', () => {
    mockMutationState.isError = true
    renderWithProviders(<DeleteNoteButton noteId="n1" noteTitle="My note" />)

    expect(screen.getByText(/Failed to delete/)).toBeInTheDocument()
  })

  it('Delete button remains visible and usable after a failure — no false-deleted UI', () => {
    mockMutationState.isError = true
    renderWithProviders(<DeleteNoteButton noteId="n1" noteTitle="My note" />)

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled()
    expect(screen.getByText(/Failed to delete/)).toBeInTheDocument()
  })
})
