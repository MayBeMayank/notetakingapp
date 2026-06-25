import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { TagFilter } from './TagFilter'

const makeTags = () => [
  { id: 't1', name: 'Work', color: '#3b82f6', noteCount: 2 },
  { id: 't2', name: 'Personal', color: '#ef4444', noteCount: 1 },
]

describe('notes-list-ui › tag filter', () => {
  it('renders nothing when tags is empty', () => {
    const { container } = render(
      <TagFilter tags={[]} selectedTags={[]} onTagsChange={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a chip per tag', () => {
    render(
      <TagFilter tags={makeTags()} selectedTags={[]} onTagsChange={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Personal' })).toBeInTheDocument()
  })

  it('clicking an unselected tag adds it to selection', async () => {
    const cb = vi.fn()
    render(
      <TagFilter tags={makeTags()} selectedTags={[]} onTagsChange={cb} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Work' }))
    expect(cb).toHaveBeenCalledWith(['t1'])
  })

  it('clicking a selected tag removes it', async () => {
    const cb = vi.fn()
    render(
      <TagFilter tags={makeTags()} selectedTags={['t1']} onTagsChange={cb} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Work' }))
    expect(cb).toHaveBeenCalledWith([])
  })

  it('Clear button visible when tags selected, hidden when none', () => {
    const { rerender } = render(
      <TagFilter tags={makeTags()} selectedTags={['t1']} onTagsChange={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()

    rerender(
      <TagFilter tags={makeTags()} selectedTags={[]} onTagsChange={vi.fn()} />,
    )
    expect(screen.queryByText('Clear')).toBeNull()
  })

  it('clicking Clear calls onTagsChange with []', async () => {
    const cb = vi.fn()
    render(
      <TagFilter tags={makeTags()} selectedTags={['t1']} onTagsChange={cb} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(cb).toHaveBeenCalledWith([])
  })

  it('selecting two tags passes both IDs to onTagsChange (OR filter)', async () => {
    const cb = vi.fn()
    const { rerender } = render(
      <TagFilter tags={makeTags()} selectedTags={[]} onTagsChange={cb} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Work' }))
    expect(cb).toHaveBeenCalledWith(['t1'])

    rerender(
      <TagFilter tags={makeTags()} selectedTags={['t1']} onTagsChange={cb} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Personal' }))
    expect(cb).toHaveBeenCalledWith(['t1', 't2'])
  })
})
