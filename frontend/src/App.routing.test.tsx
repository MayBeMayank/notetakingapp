import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import App from './App'
import { useAuthStore } from '@/stores/auth.store'
import { renderWithProviders } from '@/test/utils'

describe('frontend-app-shell › Application routing', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null, accessToken: null, status: 'anonymous' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders public auth routes without a session', () => {
    renderWithProviders(<App />, { route: '/login' })
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()

    renderWithProviders(<App />, { route: '/register' })
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument()

    renderWithProviders(<App />, { route: '/forgot-password' })
    expect(screen.getByRole('heading', { name: 'Forgot password' })).toBeInTheDocument()

    renderWithProviders(<App />, { route: '/reset-password' })
    expect(screen.getByRole('heading', { name: 'Reset password' })).toBeInTheDocument()
  })

  it('redirects an unknown route to /login when anonymous', () => {
    renderWithProviders(<App />, { route: '/does-not-exist' })
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('redirects an unknown route to home when authenticated', () => {
    useAuthStore.setState({ status: 'authenticated' })
    renderWithProviders(<App />, { route: '/does-not-exist' })
    expect(screen.getByRole('heading', { name: 'Your notes' })).toBeInTheDocument()
  })

  it('redirects an authenticated visitor away from /login to home', () => {
    useAuthStore.setState({ status: 'authenticated' })
    renderWithProviders(<App />, { route: '/login' })
    expect(screen.getByRole('heading', { name: 'Your notes' })).toBeInTheDocument()
  })

  it('renders the notes list at /', async () => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 'u', email: 'x@y.com' }, accessToken: 'tok' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const { jsonResponse } = await import('@/test/utils')
      if ((url as string).includes('/api/tags')) return jsonResponse(200, [])
      if ((url as string).includes('/api/notes')) return jsonResponse(200, { data: [], page: 1, limit: 20, total: 0 })
      return jsonResponse(404, {})
    }))
    renderWithProviders(<App />, { route: '/' })
    await screen.findByRole('heading', { name: 'Your notes' })
  })

  it('/notes/new redirects anonymous user to /login', () => {
    renderWithProviders(<App />, { route: '/notes/new' })
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('/notes/:id redirects anonymous user to /login', () => {
    renderWithProviders(<App />, { route: '/notes/abc' })
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('/notes/new creates note and renders editor for authenticated user', async () => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 'u', email: 'x@y.com' }, accessToken: 'tok' })
    const note = { id: 'n1', title: '', content: { type: 'doc', content: [] }, tagIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      const { jsonResponse } = await import('@/test/utils')
      if ((opts as RequestInit)?.method === 'POST' && (url as string).includes('/api/notes')) return jsonResponse(201, { note })
      if ((url as string).includes('/api/notes/n1')) return jsonResponse(200, { note })
      if ((url as string).includes('/api/tags')) return jsonResponse(200, [])
      return jsonResponse(404, {})
    }))
    renderWithProviders(<App />, { route: '/notes/new' })
    await screen.findByText('Tags')
  })

  it('/notes/:id redirects to list on 404', async () => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 'u', email: 'x@y.com' }, accessToken: 'tok' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const { jsonResponse } = await import('@/test/utils')
      if ((url as string).includes('/api/notes/not-found')) return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Note not found' } })
      if ((url as string).includes('/api/notes')) return jsonResponse(200, { data: [], page: 1, limit: 20, total: 0 })
      if ((url as string).includes('/api/tags')) return jsonResponse(200, [])
      return jsonResponse(404, {})
    }))
    renderWithProviders(<App />, { route: '/notes/not-found' })
    await screen.findByRole('heading', { name: 'Your notes' })
  })

  it('/notes/:id renders editor for authenticated user', async () => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 'u', email: 'x@y.com' }, accessToken: 'tok' })
    const note = { id: 'abc', title: 'My Note', content: { type: 'doc', content: [] }, tagIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const { jsonResponse } = await import('@/test/utils')
      if ((url as string).includes('/api/notes/abc')) return jsonResponse(200, { note })
      if ((url as string).includes('/api/tags')) return jsonResponse(200, [])
      return jsonResponse(404, {})
    }))
    renderWithProviders(<App />, { route: '/notes/abc' })
    await screen.findByText('Tags')
  })
})
