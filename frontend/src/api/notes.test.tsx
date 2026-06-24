import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDeleteNote, useNotesList, useRestoreNote } from '@/api/notes'
import { DEFAULT_NOTES_VIEW } from '@/features/notes/notesQuery'
import { jsonResponse, makeTestQueryClient } from '@/test/utils'

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('notes-list-ui › data layer', () => {
  it('useNotesList issues a single request carrying all view params', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { data: [], page: 2, limit: 20, total: 0 }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const view = {
      ...DEFAULT_NOTES_VIEW,
      sort: 'title' as const,
      order: 'asc' as const,
      tags: ['t1', 't2'],
      page: 2,
      status: 'trashed' as const,
    }
    const { result } = renderHook(() => useNotesList(view), {
      wrapper: wrapperWith(makeTestQueryClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/api/notes?')
    expect(url).toContain('status=trashed')
    expect(url).toContain('sort=title')
    expect(url).toContain('order=asc')
    expect(url).toContain('page=2')
    expect(url).toContain('tags=t1,t2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('useDeleteNote sends DELETE and invalidates the notes cache on 204', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(204))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useDeleteNote(), { wrapper: wrapperWith(client) })
    await result.current.mutateAsync('note-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/notes/note-1')
    expect((init as RequestInit).method).toBe('DELETE')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notes'] })
  })

  it('useRestoreNote POSTs restore and invalidates on success', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, {
        note: { id: 'n1', title: 'X', tagIds: [], createdAt: 'd', updatedAt: 'd' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useRestoreNote(), { wrapper: wrapperWith(client) })
    await result.current.mutateAsync('note-9')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/notes/note-9/restore')
    expect((init as RequestInit).method).toBe('POST')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notes'] })
  })

  it('useRestoreNote surfaces a 422 when the recovery window has elapsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(422, { error: { code: 'UNPROCESSABLE', message: 'window expired' } }),
      ) as unknown as typeof fetch,
    )
    const { result } = renderHook(() => useRestoreNote(), {
      wrapper: wrapperWith(makeTestQueryClient()),
    })

    await expect(result.current.mutateAsync('old-note')).rejects.toMatchObject({ status: 422 })
  })
})
