import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAutosave, type UseAutosaveOptions } from './useAutosave'
import { ApiError } from '@/api/client'
import { Providers } from '@/test/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal UseAutosaveOptions object. */
function makeOptions(
  overrides: Partial<UseAutosaveOptions> = {},
): UseAutosaveOptions {
  return {
    noteId: 'note-1',
    title: 'Initial Title',
    contentRef: { current: { type: 'doc', content: [] } },
    contentVersion: 0,
    tagIds: [],
    onFatalError: vi.fn(),
    ...overrides,
  }
}

/** Build a fetch stub that resolves ok with a minimal NoteEnvelope. */
function okFetch() {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        note: {
          id: 'note-1',
          title: 'Initial Title',
          contentJson: {},
          contentText: '',
          tagIds: [],
          deletedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  )
}

/** Advance fake timers by ms and flush all pending microtasks/promises. */
async function tickAndFlush(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // 1. fires PATCH 2 s after last change
  // -------------------------------------------------------------------------
  it('fires PATCH 2 s after last change', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const opts = makeOptions()
    const { rerender } = renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: opts,
      wrapper: Providers,
    })

    // Trigger a change so the debounce effect fires (mountRef skips first run)
    rerender({ ...opts, title: 'Changed Title' })

    // Advance exactly 2 s — debounce fires
    await tickAndFlush(2000)

    // At least one PATCH call to /api/notes/note-1
    const patchCalls = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/notes/note-1') &&
        (c[1] as RequestInit)?.method === 'PATCH',
    )
    expect(patchCalls.length).toBe(1)
  })

  // -------------------------------------------------------------------------
  // 2. rapid changes send one PATCH
  // -------------------------------------------------------------------------
  it('rapid changes send one PATCH', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const opts = makeOptions()
    const { rerender } = renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: opts,
      wrapper: Providers,
    })

    // Two rapid changes well within 2 s
    rerender({ ...opts, title: 'First Change' })
    rerender({ ...opts, title: 'Second Change' })

    // Advance 2 s — debounce fires once for the last change only
    await tickAndFlush(2000)

    const patchCalls = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/notes/note-1') &&
        (c[1] as RequestInit)?.method === 'PATCH',
    )
    expect(patchCalls.length).toBe(1)
  })

  // -------------------------------------------------------------------------
  // 3. queues one pending save while in-flight
  // -------------------------------------------------------------------------
  it('queues one pending save while in-flight', async () => {
    // First fetch stays in-flight until we resolve it manually
    let resolveFirst!: (value: Response) => void
    const firstFetchPromise = new Promise<Response>((res) => {
      resolveFirst = res
    })

    // Factory for response bodies so each call gets a fresh readable stream
    const makeNoteResponse = (title: string) =>
      new Response(
        JSON.stringify({
          note: {
            id: 'note-1',
            title,
            contentJson: {},
            contentText: '',
            tagIds: [],
            deletedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstFetchPromise)
      .mockImplementation(() => Promise.resolve(makeNoteResponse('Second')))
    vi.stubGlobal('fetch', fetchMock)

    const opts = makeOptions()
    const { rerender } = renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: opts,
      wrapper: Providers,
    })

    // First change — debounce starts
    rerender({ ...opts, title: 'First' })

    // Advance 2 s — first PATCH fires (in-flight, blocked on firstFetchPromise)
    await tickAndFlush(2001)

    // Verify first PATCH was sent
    const patchCallsAfterFirst = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/notes/note-1') &&
        (c[1] as RequestInit)?.method === 'PATCH',
    )
    expect(patchCallsAfterFirst.length).toBe(1)

    // While in-flight, trigger another change — gets queued
    rerender({ ...opts, title: 'Second' })
    // Advance debounce; the save is queued (inFlightRef=true), not sent yet
    await tickAndFlush(2001)

    // Still only one PATCH (first still in-flight)
    const patchCallsMidFlight = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/notes/note-1') &&
        (c[1] as RequestInit)?.method === 'PATCH',
    )
    expect(patchCallsMidFlight.length).toBe(1)

    // Resolve the first fetch — executeSave detects pendingRef=true and fires the second PATCH
    await act(async () => {
      resolveFirst(makeNoteResponse('First'))
      // Drain the full microtask queue: apiFetch parses JSON (1 tick),
      // mutateAsync resolves (1+ ticks), executeSave calls itself (1 tick),
      // second mutateAsync dispatches fetch (1 tick), response resolves (1 tick).
      for (let i = 0; i < 20; i++) {
        await Promise.resolve()
      }
    })

    const patchCallsFinal = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/notes/note-1') &&
        (c[1] as RequestInit)?.method === 'PATCH',
    )
    expect(patchCallsFinal.length).toBe(2)
  })

  // -------------------------------------------------------------------------
  // 4. cancels debounce on unmount
  // -------------------------------------------------------------------------
  it('cancels debounce on unmount', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const opts = makeOptions()
    const { rerender, unmount } = renderHook(
      (props: UseAutosaveOptions) => useAutosave(props),
      { initialProps: opts, wrapper: Providers },
    )

    // Trigger a change to start the debounce timer
    rerender({ ...opts, title: 'Will be cancelled' })

    // Unmount before 2 s — should clear the timer
    unmount()

    // Advance past 2 s — timer should have been cleared, no fetch
    await tickAndFlush(2000)

    const patchCalls = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/notes/note-1') &&
        (c[1] as RequestInit)?.method === 'PATCH',
    )
    expect(patchCalls.length).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 5. transitions to saved on 200
  // -------------------------------------------------------------------------
  it('transitions to saved on 200', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const opts = makeOptions()
    const { result, rerender } = renderHook(
      (props: UseAutosaveOptions) => useAutosave(props),
      { initialProps: opts, wrapper: Providers },
    )

    rerender({ ...opts, title: 'Save me' })

    await tickAndFlush(2000)

    expect(result.current.saveState).toBe('saved')
  })

  // -------------------------------------------------------------------------
  // 6. transitions to error on network failure, re-arms on next change
  // -------------------------------------------------------------------------
  it('transitions to error on network failure, re-arms on next change', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network Error'))
    vi.stubGlobal('fetch', fetchMock)

    const opts = makeOptions()
    const { result, rerender } = renderHook(
      (props: UseAutosaveOptions) => useAutosave(props),
      { initialProps: opts, wrapper: Providers },
    )

    // Trigger first change
    rerender({ ...opts, title: 'Network fail' })

    await tickAndFlush(2000)

    expect(result.current.saveState).toBe('error')

    // Re-render with a new title — should re-arm (back to 'pending')
    act(() => {
      rerender({ ...opts, title: 'Re-armed' })
    })

    expect(result.current.saveState).toBe('pending')
  })

  // -------------------------------------------------------------------------
  // 7. calls onFatalError on 404
  // -------------------------------------------------------------------------
  it('calls onFatalError on 404', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'not found'))
    vi.stubGlobal('fetch', fetchMock)

    const onFatalError = vi.fn()
    const opts = makeOptions({ onFatalError })
    const { result, rerender } = renderHook(
      (props: UseAutosaveOptions) => useAutosave(props),
      { initialProps: opts, wrapper: Providers },
    )

    rerender({ ...opts, title: '404 Note', onFatalError })

    await tickAndFlush(2000)

    expect(result.current.saveState).toBe('fatal')
    expect(onFatalError).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 8. calls onFatalError on 422 NOTE_DELETED
  // -------------------------------------------------------------------------
  it('calls onFatalError on 422 NOTE_DELETED', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new ApiError(422, 'NOTE_DELETED', 'deleted'))
    vi.stubGlobal('fetch', fetchMock)

    const onFatalError = vi.fn()
    const opts = makeOptions({ onFatalError })
    const { result, rerender } = renderHook(
      (props: UseAutosaveOptions) => useAutosave(props),
      { initialProps: opts, wrapper: Providers },
    )

    rerender({ ...opts, title: 'Deleted note', onFatalError })

    await tickAndFlush(2000)

    expect(result.current.saveState).toBe('fatal')
    expect(onFatalError).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 9. does not fire on initial mount
  // -------------------------------------------------------------------------
  it('does not fire on initial mount', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const opts = makeOptions()
    renderHook((props: UseAutosaveOptions) => useAutosave(props), {
      initialProps: opts,
      wrapper: Providers,
    })

    // Advance well past the debounce — no changes were made, mountRef prevents it
    await tickAndFlush(3000)

    const patchCalls = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/notes/note-1') &&
        (c[1] as RequestInit)?.method === 'PATCH',
    )
    expect(patchCalls.length).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 10. 5xx response treated as recoverable (non-fatal)
  // -------------------------------------------------------------------------
  it('treats 5xx response as recoverable and sets error state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const opts = makeOptions()
    const { result, rerender } = renderHook(
      (props: UseAutosaveOptions) => useAutosave(props),
      { initialProps: opts, wrapper: Providers },
    )

    rerender({ ...opts, title: '5xx error' })
    await tickAndFlush(2000)

    expect(result.current.saveState).toBe('error')
  })

  // -------------------------------------------------------------------------
  // 11. successful retry after recoverable error transitions back to saved
  // -------------------------------------------------------------------------
  it('successful retry after error transitions saveState back to saved', async () => {
    const makeOkResponse = () =>
      new Response(
        JSON.stringify({
          note: {
            id: 'note-1',
            title: 'Retried',
            contentJson: {},
            contentText: '',
            tagIds: [],
            deletedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'fail' } }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockImplementation(() => Promise.resolve(makeOkResponse()))
    vi.stubGlobal('fetch', fetchMock)

    const opts = makeOptions()
    const { result, rerender } = renderHook(
      (props: UseAutosaveOptions) => useAutosave(props),
      { initialProps: opts, wrapper: Providers },
    )

    // First change → 500 error
    rerender({ ...opts, title: 'Will fail' })
    await tickAndFlush(2000)
    expect(result.current.saveState).toBe('error')

    // Second change → re-arms debounce to pending
    act(() => { rerender({ ...opts, title: 'Will succeed' }) })
    expect(result.current.saveState).toBe('pending')

    // Debounce fires → 200 success → back to saved
    await tickAndFlush(2000)
    expect(result.current.saveState).toBe('saved')
  })
})
