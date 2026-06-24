import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { renderWithProviders, makeTestQueryClient, jsonResponse } from '@/test/utils'
import { useAuthStore } from '@/stores/auth.store'
import { NotesList } from './NotesList'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchMock(notes: object[], tagsBody: object[] = []) {
  return vi.fn(async (url: string) => {
    if ((url as string).includes('/api/tags')) return jsonResponse(200, tagsBody)
    return jsonResponse(200, { data: notes, page: 1, limit: 20, total: notes.length })
  })
}

/** Renders NotesList inside a fresh QueryClient + MemoryRouter with the given
 *  initial URL string (e.g. '/?tags=tid1'). */
function renderNotesList(route = '/') {
  const client = makeTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <NotesList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 'u1', email: 'a@b.com' },
    accessToken: 'tok',
    status: 'authenticated',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('notes-list-ui › list', () => {
  it('renders active note cards', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchMock([
        { id: 'n1', title: 'Hello', tagIds: [], createdAt: '2024-01-01', updatedAt: '2024-01-02' },
      ]) as unknown as typeof fetch,
    )

    renderWithProviders(<NotesList />)

    await screen.findByText('Hello')
  })

  it('shows Untitled for a note with an empty title', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchMock([
        { id: 'n1', title: '', tagIds: [], createdAt: 'd', updatedAt: 'd' },
      ]) as unknown as typeof fetch,
    )

    renderWithProviders(<NotesList />)

    await screen.findByText('Untitled')
  })

  it('shows loading state while fetching', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})) as unknown as typeof fetch,
    )

    renderWithProviders(<NotesList />)

    expect(screen.getByRole('status', { name: 'Loading notes' })).toBeInTheDocument()
  })

  it('shows error state with retry', async () => {
    const user = userEvent.setup()

    // First fetch: reject to trigger error state
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network error')
      }) as unknown as typeof fetch,
    )

    renderWithProviders(<NotesList />)

    await screen.findByText(/Couldn't load notes/)

    // Re-stub fetch to return empty notes successfully
    vi.stubGlobal(
      'fetch',
      makeFetchMock([]) as unknown as typeof fetch,
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByText('No notes yet')
  })

  it('shows empty-account state when there are no notes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if ((url as string).includes('/api/tags')) return jsonResponse(200, [])
        return jsonResponse(200, { data: [], page: 1, limit: 20, total: 0 })
      }) as unknown as typeof fetch,
    )

    renderWithProviders(<NotesList />)

    await screen.findByText('No notes yet')
  })

  it('shows empty-filter state when tags filter yields no results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if ((url as string).includes('/api/tags')) return jsonResponse(200, [])
        return jsonResponse(200, { data: [], page: 1, limit: 20, total: 0 })
      }) as unknown as typeof fetch,
    )

    renderNotesList('/?tags=tid1')

    await screen.findByText('No notes match this filter.')
  })

  it('default fetch includes sort=updatedAt and order=desc', async () => {
    const fetchMock = makeFetchMock([])
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    renderWithProviders(<NotesList />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const notesCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('/api/notes'),
    )
    expect(notesCall).toBeDefined()
    const url = notesCall![0] as string
    expect(url).toContain('sort=updatedAt')
    expect(url).toContain('order=desc')
  })
})
