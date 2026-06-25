import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { makeTestQueryClient, jsonResponse } from '@/test/utils'
import { useAuthStore } from '@/stores/auth.store'
import { SearchResultsList } from './SearchResultsList'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Renders SearchResultsList inside a fresh QueryClient + MemoryRouter.
 *  route = '/search?q=foo' to pre-seed the query in the URL. */
function renderSearchList(route = '/search') {
  const client = makeTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <SearchResultsList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function makeSearchResult(overrides: Partial<{
  noteId: string
  title: string
  snippet: string
  rank: number
}> = {}) {
  return {
    noteId: 'n1',
    title: 'Meeting Notes',
    snippet: 'Discussed the <mark>meeting</mark> agenda',
    rank: 0.5,
    ...overrides,
  }
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

describe('search-ui › results list', () => {
  it('shows idle state on initial render with no q param — no fetch issued', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    renderSearchList('/search')

    // Idle state should be visible immediately
    expect(screen.getByText('Search your notes')).toBeInTheDocument()
    expect(
      screen.getByText('Type a keyword to find notes by title or content.'),
    ).toBeInTheDocument()

    // No fetch to /api/search should have been issued
    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls.filter(([url]: [string]) =>
        url.includes('/api/search'),
      )
      expect(searchCalls).toHaveLength(0)
    }, { timeout: 500 })
  })

  it('shows idle state when q is only whitespace — no fetch issued', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    // URL has a whitespace-only q — component trims it, shows idle
    renderSearchList('/search?q=   ')

    expect(screen.getByText('Search your notes')).toBeInTheDocument()

    // No /api/search call should have gone out
    await waitFor(() => {
      const searchCalls = fetchMock.mock.calls.filter(([url]: [string]) =>
        url.includes('/api/search'),
      )
      expect(searchCalls).toHaveLength(0)
    }, { timeout: 500 })
  })

  it('shows loading state while fetch is pending', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})) as unknown as typeof fetch,
    )

    renderSearchList('/search?q=meeting')

    expect(
      screen.getByRole('status', { name: 'Loading search results' }),
    ).toBeInTheDocument()
  })

  it('renders result cards when fetch resolves with data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/search')) {
          return jsonResponse(200, {
            data: [makeSearchResult({ noteId: 'n1', title: 'Meeting Notes' })],
            page: 1,
            limit: 20,
            total: 1,
          })
        }
        return jsonResponse(404, {})
      }) as unknown as typeof fetch,
    )

    renderSearchList('/search?q=meeting')

    // Card with the note title should appear
    await screen.findByText('Meeting Notes')
  })

  it('shows no-results state when total is 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/search')) {
          return jsonResponse(200, {
            data: [],
            page: 1,
            limit: 20,
            total: 0,
          })
        }
        return jsonResponse(404, {})
      }) as unknown as typeof fetch,
    )

    renderSearchList('/search?q=noresults')

    await screen.findByText(/No notes found for/)
    expect(screen.getByText(/noresults/)).toBeInTheDocument()
  })

  it('shows error state when fetch rejects; clicking Try again calls refetch', async () => {
    const user = userEvent.setup()

    // First: reject to trigger error state
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network error')
      }) as unknown as typeof fetch,
    )

    renderSearchList('/search?q=meeting')

    await screen.findByText("Couldn't load search results")

    // Re-stub to succeed on retry
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/search')) {
          return jsonResponse(200, {
            data: [makeSearchResult()],
            page: 1,
            limit: 20,
            total: 1,
          })
        }
        return jsonResponse(404, {})
      }) as unknown as typeof fetch,
    )

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await screen.findByText('Meeting Notes')
  })

  it('pre-fills the input value from URL q param on initial render', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as unknown as typeof fetch)

    renderSearchList('/search?q=quarterly')

    expect(screen.getByRole('searchbox', { name: 'Search notes' })).toHaveValue('quarterly')
  })

  it('input has maxLength of 200', () => {
    vi.stubGlobal('fetch', vi.fn() as unknown as typeof fetch)

    renderSearchList('/search')

    const input = screen.getByRole('searchbox', { name: 'Search notes' })
    expect(input).toHaveAttribute('maxLength', '200')
  })

  it('pagination is hidden when results fit on one page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/search')) {
          return jsonResponse(200, {
            data: [makeSearchResult()],
            page: 1,
            limit: 20,
            total: 1, // 1 result, limit 20 → totalPages = 1 → hidden
          })
        }
        return jsonResponse(404, {})
      }) as unknown as typeof fetch,
    )

    renderSearchList('/search?q=meeting')

    await screen.findByText('Meeting Notes')

    // Pagination buttons should not be rendered
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  it('pagination is shown when total exceeds page limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/search')) {
          return jsonResponse(200, {
            data: [makeSearchResult({ noteId: 'n1', title: 'Meeting Notes' })],
            page: 1,
            limit: 20,
            total: 25, // 25 results, limit 20 → totalPages = 2 → shown
          })
        }
        return jsonResponse(404, {})
      }) as unknown as typeof fetch,
    )

    renderSearchList('/search?q=meeting')

    await screen.findByText('Meeting Notes')

    // Pagination should be rendered
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })
})
