import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useNoteShares, useCreateShare, useRevokeShare, usePublicNote } from '@/api/shares'
import { jsonResponse, makeTestQueryClient } from '@/test/utils'

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const makeShare = (overrides = {}) => ({
  id: 's1',
  noteId: 'n1',
  token: 'tok1',
  url: '/s/tok1',
  expiresAt: null,
  viewCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
})

describe('share-ui › data layer', () => {
  it('useNoteShares filters bare array to only the given noteId', async () => {
    const shares = [
      makeShare({ id: 's1', noteId: 'n1' }),
      makeShare({ id: 's2', noteId: 'n2' }),  // different note
    ]
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, shares)) as unknown as typeof fetch)

    const { result } = renderHook(() => useNoteShares('n1'), { wrapper: wrapper(makeTestQueryClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data![0].id).toBe('s1')
  })

  it('useCreateShare POSTs to /api/notes/:id/shares and invalidates shares cache', async () => {
    const shareData = makeShare()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(201, { share: shareData })) as unknown as typeof fetch)
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useCreateShare('n1'), { wrapper: wrapper(client) })
    await result.current.mutateAsync({ expiresAt: null })

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('/api/notes/n1/shares')
    expect((init as RequestInit).method).toBe('POST')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['shares'] })
  })

  it('useRevokeShare DELETEs /api/shares/:id and invalidates shares cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(204)) as unknown as typeof fetch)
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useRevokeShare(), { wrapper: wrapper(client) })
    await result.current.mutateAsync('s1')

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('/api/shares/s1')
    expect((init as RequestInit).method).toBe('DELETE')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['shares'] })
  })

  it('usePublicNote fetches without Authorization header', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { title: 'Hello', content: {} }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const { result } = renderHook(() => usePublicNote('mytoken'), { wrapper: wrapper(makeTestQueryClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [_url, init] = fetchMock.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBeUndefined()
  })

  it('usePublicNote surfaces 404 to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not found' } })) as unknown as typeof fetch)

    const { result } = renderHook(() => usePublicNote('bad'), { wrapper: wrapper(makeTestQueryClient()) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as { status?: number })?.status).toBe(404)
  })

  it('usePublicNote surfaces 410 to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(410, { error: { code: 'SHARE_GONE', message: 'gone' } })) as unknown as typeof fetch)

    const { result } = renderHook(() => usePublicNote('revoked'), { wrapper: wrapper(makeTestQueryClient()) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as { status?: number })?.status).toBe(410)
  })
})
