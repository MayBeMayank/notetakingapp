import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { NotesPagination } from './NotesPagination'

describe('notes-list-ui › pagination', () => {
  it('returns null when total <= limit', () => {
    const { container } = render(
      <NotesPagination page={1} total={10} limit={20} onPageChange={vi.fn()} />,
    )
    expect(container.querySelector('button[aria-label="Previous"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Next"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('renders Page X of N text', () => {
    render(<NotesPagination page={2} total={50} limit={20} onPageChange={vi.fn()} />)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('Previous disabled on first page', () => {
    render(<NotesPagination page={1} total={50} limit={20} onPageChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  it('Next disabled on last page', () => {
    render(<NotesPagination page={3} total={50} limit={20} onPageChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('clicking Next calls onPageChange(page+1)', async () => {
    const cb = vi.fn()
    render(<NotesPagination page={1} total={50} limit={20} onPageChange={cb} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(cb).toHaveBeenCalledWith(2)
  })

  it('clicking Previous calls onPageChange(page-1)', async () => {
    const cb = vi.fn()
    render(<NotesPagination page={2} total={50} limit={20} onPageChange={cb} />)
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(cb).toHaveBeenCalledWith(1)
  })
})
