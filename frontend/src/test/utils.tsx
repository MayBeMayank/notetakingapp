import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

interface RenderOptions {
  route?: string
  state?: unknown
}

/** Render a UI tree inside QueryClientProvider + MemoryRouter. */
export function renderWithProviders(ui: ReactElement, opts: RenderOptions = {}): RenderResult {
  const { route = '/', state } = opts
  const client = makeTestQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: route, state }]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A Response-shaped stub for mocking global.fetch in client tests. */
export function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  } as unknown as Response
}

export function Providers({ children }: { children: ReactNode }) {
  const client = makeTestQueryClient()
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
