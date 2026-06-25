import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { NoteCard } from './NoteCard'
import type { TagOption } from '@/api/tags'

vi.mock('@/api/notes', () => ({
  useDeleteNote: () => ({ mutate: vi.fn(), isPending: false, isError: false, reset: vi.fn() }),
  useRestoreNote: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))

vi.mock('@/api/client', () => ({}))

const makeNote = (overrides = {}) => ({
  id: 'n1',
  title: 'Test',
  tagIds: [],
  createdAt: '2024-01-01',
  updatedAt: '2024-01-02',
  ...overrides,
})

const emptyTags: TagOption[] = []

describe('notes-list-ui › card', () => {
  it('renders note title', () => {
    renderWithProviders(<NoteCard note={makeNote()} tags={emptyTags} status="active" />)
    expect(screen.getByText('Test')).toBeInTheDocument()
  })

  it('falls back to Untitled when title is empty', () => {
    renderWithProviders(<NoteCard note={makeNote({ title: '' })} tags={emptyTags} status="active" />)
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('renders tag chip with tag name and color', () => {
    const note = makeNote({ tagIds: ['t1'] })
    const tags = [{ id: 't1', name: 'Work', color: '#3b82f6', noteCount: 1 }]
    renderWithProviders(<NoteCard note={note} tags={tags} status="active" />)
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('active card contains a link to /notes/:id', () => {
    renderWithProviders(<NoteCard note={makeNote()} tags={emptyTags} status="active" />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/notes/n1')
  })

  it('trashed card has no navigation link', () => {
    renderWithProviders(<NoteCard note={makeNote()} tags={emptyTags} status="trashed" />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('active card shows Delete button', () => {
    renderWithProviders(<NoteCard note={makeNote()} tags={emptyTags} status="active" />)
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument()
  })

  it('trashed card shows Restore and no Delete', () => {
    renderWithProviders(<NoteCard note={makeNote()} tags={emptyTags} status="trashed" />)
    expect(screen.getByRole('button', { name: /Restore/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
  })
})
