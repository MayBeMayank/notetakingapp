import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useNavigate } from 'react-router-dom'
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

  it('active list sends status=active by default', async () => {
    const fetchMock = makeFetchMock([])
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    renderNotesList()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const notesCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/notes'))
    expect(notesCall![0] as string).toContain('status=active')
  })

  it('Trash tab click sends status=trashed', async () => {
    const user = userEvent.setup()
    const fetchMock = makeFetchMock([])
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    renderNotesList()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fetchMock.mockClear()
    await user.click(screen.getByRole('tab', { name: 'Trash' }))
    await waitFor(() => {
      const notesCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/notes'))
      expect(notesCall).toBeDefined()
      expect(notesCall![0] as string).toContain('status=trashed')
    })
  })

  it('changing sort field re-fetches with chosen sort', async () => {
    const user = userEvent.setup()
    const fetchMock = makeFetchMock([])
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    renderNotesList()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fetchMock.mockClear()
    const [sortSelect] = screen.getAllByRole('combobox')
    await user.selectOptions(sortSelect, 'createdAt')
    await waitFor(() => {
      const notesCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/notes'))
      expect(notesCall).toBeDefined()
      expect(notesCall![0] as string).toContain('sort=createdAt')
    })
  })

  it('changing sort resets page to 1', async () => {
    const user = userEvent.setup()
    const fetchMock = makeFetchMock([])
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    renderNotesList('/?page=2')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fetchMock.mockClear()
    const [sortSelect] = screen.getAllByRole('combobox')
    await user.selectOptions(sortSelect, 'createdAt')
    await waitFor(() => {
      const notesCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/notes'))
      expect(notesCall).toBeDefined()
      const url = notesCall![0] as string
      expect(url).toContain('sort=createdAt')
      expect(url).toContain('page=1')
    })
  })

  it('initial URL params are used in the fetch (reload reproduces view)', async () => {
    const fetchMock = makeFetchMock([])
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    renderNotesList('/?sort=createdAt&order=asc&page=2')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const notesCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/notes'))
    const url = notesCall![0] as string
    expect(url).toContain('sort=createdAt')
    expect(url).toContain('order=asc')
    expect(url).toContain('page=2')
  })

  it('changing page retains sort and order in the fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) => {
      if ((url as string).includes('/api/tags')) return jsonResponse(200, [])
      return jsonResponse(200, {
        data: [{ id: 'n1', title: 'A note', tagIds: [], createdAt: '2024-01-01', updatedAt: '2024-01-02' }],
        page: 1,
        limit: 1,
        total: 3,
      })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    renderNotesList('/?sort=createdAt&order=asc')
    await screen.findByText('A note')
    fetchMock.mockClear()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => {
      const notesCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/api/notes'))
      expect(notesCall).toBeDefined()
      const url = notesCall![0] as string
      expect(url).toContain('sort=createdAt')
      expect(url).toContain('order=asc')
      expect(url).toContain('page=2')
    })
  })

  it('back navigation restores previous view', async () => {
    const user = userEvent.setup()
    const fetchMock = makeFetchMock([])
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    // Pre-load both history entries so there is a valid "back" target.
    // initialIndex=1 starts us at /?sort=createdAt (the "forward" state).
    function TestWrapper() {
      const navigate = useNavigate()
      return (
        <>
          <NotesList />
          <button onClick={() => navigate(-1)}>Go back</button>
        </>
      )
    }
    const client = makeTestQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/', '/?sort=createdAt']} initialIndex={1}>
          <TestWrapper />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Starts at /?sort=createdAt — select reflects that
    await waitFor(() => {
      const [sortSelect] = screen.getAllByRole('combobox')
      expect(sortSelect).toHaveValue('createdAt')
    })

    // Navigate back → URL reverts to '/' → sort select shows the default
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await waitFor(() => {
      const [sortSelect] = screen.getAllByRole('combobox')
      expect(sortSelect).toHaveValue('updatedAt')
    })
  })
})
