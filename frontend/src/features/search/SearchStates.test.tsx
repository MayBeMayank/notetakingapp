import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SearchIdleState,
  SearchLoadingState,
  SearchErrorState,
  SearchNoResultsState,
} from './SearchStates'

describe('search-ui › states', () => {
  // SearchIdleState
  it('idle state renders Search your notes heading', () => {
    render(<SearchIdleState />)
    expect(screen.getByRole('heading', { name: /search your notes/i })).toBeInTheDocument()
  })

  it('idle state renders instructional subtext', () => {
    render(<SearchIdleState />)
    expect(screen.getByText(/type a keyword to find notes by title or content/i)).toBeInTheDocument()
  })

  // SearchLoadingState
  it('loading state has role=status accessible label', () => {
    render(<SearchLoadingState />)
    expect(screen.getByRole('status', { name: /loading search results/i })).toBeInTheDocument()
  })

  // SearchErrorState
  it('error state renders error message', () => {
    render(<SearchErrorState onRetry={() => {}} />)
    expect(screen.getByText(/couldn't load search results/i)).toBeInTheDocument()
  })

  it('error state shows Try again button', () => {
    render(<SearchErrorState onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('error state calls onRetry when Try again is clicked', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<SearchErrorState onRetry={onRetry} />)
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  // SearchNoResultsState
  it('no-results state interpolates the query string into the message', () => {
    render(<SearchNoResultsState q="typescript" />)
    expect(screen.getByText(/no notes found for/i)).toBeInTheDocument()
    expect(screen.getByText(/typescript/i)).toBeInTheDocument()
  })
})
