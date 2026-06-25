import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { PublicNoteView } from './PublicNoteView'

vi.mock('@tiptap/react', () => ({
  useEditor: () => ({ /* minimal mock */ }),
  EditorContent: ({ editor }: { editor: unknown }) =>
    editor ? <div data-testid="editor-content" /> : null,
}))

vi.mock('@tiptap/starter-kit', () => ({ default: {} }))

describe('public-share-view-ui › PublicNoteView', () => {
  it('renders the note title', () => {
    renderWithProviders(<PublicNoteView title="My Note" content={{}} />)
    expect(screen.getByRole('heading', { name: 'My Note' })).toBeInTheDocument()
  })

  it('falls back to Untitled when title is empty', () => {
    renderWithProviders(<PublicNoteView title="" content={{}} />)
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('renders the EditorContent', () => {
    renderWithProviders(<PublicNoteView title="X" content={{ type: 'doc', content: [] }} />)
    expect(screen.getByTestId('editor-content')).toBeInTheDocument()
  })

  it('does not render any edit controls', () => {
    const { container } = renderWithProviders(<PublicNoteView title="X" content={{}} />)
    // No toolbar buttons (Bold, Italic, etc.)
    expect(container.querySelector('button')).toBeNull()
  })
})
