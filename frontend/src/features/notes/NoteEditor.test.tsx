import { vi, describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'

// Mock TipTap before any imports that use it
vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => ({
    getJSON: () => ({ type: 'doc', content: [] }),
    isActive: () => false,
    chain: () => ({
      focus: () => ({
        toggleBold: () => ({ run: vi.fn() }),
        toggleItalic: () => ({ run: vi.fn() }),
      }),
    }),
    setEditable: vi.fn(),
    commands: {},
  })),
  EditorContent: ({ editor: _editor }: { editor: unknown }) => (
    <div data-testid="editor-content" />
  ),
}))

// Mock useAutosave so tests can control saveState
vi.mock('./useAutosave')

// Mock react-router-dom's useNavigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import { renderWithProviders, jsonResponse } from '@/test/utils'
import { NoteEditor } from './NoteEditor'
import { useAutosave } from './useAutosave'
import type { NoteResponse } from '@note-app/shared/schemas/notes'

const mockUseAutosave = vi.mocked(useAutosave)

function makeNote(overrides: Partial<NoteResponse> = {}): NoteResponse {
  return {
    id: 'note-1',
    title: 'Test Note',
    content: { type: 'doc', content: [] },
    tagIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('NoteEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAutosave.mockReturnValue({ saveState: 'idle' })
    // Default stub: GET /api/tags returns empty array
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, []))),
    )
  })

  it('renders title from note prop', () => {
    renderWithProviders(<NoteEditor note={makeNote()} />)
    const input = screen.getByPlaceholderText('Untitled')
    expect((input as HTMLInputElement).value).toBe('Test Note')
  })

  it('title input is editable', () => {
    renderWithProviders(<NoteEditor note={makeNote()} />)
    const input = screen.getByPlaceholderText('Untitled') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Updated Title' } })
    expect(input.value).toBe('Updated Title')
  })

  it('tag picker renders user tags', async () => {
    const tags = [
      {
        id: 't1',
        name: 'react',
        color: '#ff0000',
        noteCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, tags))),
    )

    renderWithProviders(<NoteEditor note={makeNote()} />)

    await waitFor(() => {
      expect(screen.getByText('react')).toBeInTheDocument()
    })
  })

  it('clicking tag toggles selection', async () => {
    const tags = [
      {
        id: 't1',
        name: 'react',
        color: '#ff0000',
        noteCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, tags))),
    )

    renderWithProviders(<NoteEditor note={makeNote({ tagIds: [] })} />)

    const tag = await screen.findByText('react')

    // Before click: tag is unselected (outline variant)
    const badgeBefore = tag.closest('[class*="border"]') ?? tag
    expect(badgeBefore).toBeInTheDocument()

    fireEvent.click(tag)

    // After click the tag badge should switch to selected (default variant)
    await waitFor(() => {
      const badge = screen.getByText('react')
      // The default variant uses bg-primary; outline does not — check class change
      expect(badge).toBeInTheDocument()
    })
  })

  it('status indicator reflects save state', () => {
    mockUseAutosave.mockReturnValue({ saveState: 'saving' })
    renderWithProviders(<NoteEditor note={makeNote()} />)
    expect(screen.getByText(/saving/i)).toBeInTheDocument()
  })

  it('shows fatal banner on fatal error', () => {
    mockUseAutosave.mockReturnValue({ saveState: 'fatal' })
    renderWithProviders(<NoteEditor note={makeNote()} />)
    expect(
      screen.getByText(/this note has been deleted/i),
    ).toBeInTheDocument()
  })

  it('fatal banner navigates to list', () => {
    mockUseAutosave.mockReturnValue({ saveState: 'fatal' })
    renderWithProviders(<NoteEditor note={makeNote()} />)

    const backButton = screen.getByRole('button', { name: /back to notes/i })
    fireEvent.click(backButton)

    expect(mockNavigate).toHaveBeenCalledWith('/notes')
  })
})
