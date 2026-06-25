import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { SearchResultCard } from './SearchResultCard'
import type { SearchResultItem } from '@note-app/shared/schemas/search'

vi.mock('@/api/client', () => ({}))

function makeItem(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return { noteId: 'n1', title: 'Test', snippet: 'some <mark>match</mark>', rank: 0.5, ...overrides }
}

describe('search-ui › result card', () => {
  it('renders note title', () => {
    renderWithProviders(<SearchResultCard item={makeItem()} />)
    expect(screen.getByText('Test')).toBeInTheDocument()
  })

  it('falls back to Untitled when title is empty', () => {
    renderWithProviders(<SearchResultCard item={makeItem({ title: '' })} />)
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('link href points to /notes/:noteId', () => {
    renderWithProviders(<SearchResultCard item={makeItem()} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/notes/n1')
  })

  it('renders snippet HTML with mark element in DOM', () => {
    const { container } = renderWithProviders(
      <SearchResultCard item={makeItem({ snippet: 'some <mark>match</mark>' })} />,
    )
    expect(container.querySelector('mark')).not.toBeNull()
  })

  it('hides snippet when snippet is empty string', () => {
    const { container } = renderWithProviders(<SearchResultCard item={makeItem({ snippet: '' })} />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('hides snippet when snippet is whitespace only', () => {
    const { container } = renderWithProviders(<SearchResultCard item={makeItem({ snippet: '   ' })} />)
    expect(container.querySelector('p')).toBeNull()
  })
})
