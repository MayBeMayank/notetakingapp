import type { TagOption } from '@/api/tags'

interface Props {
  tags: TagOption[]
  selectedTags: string[]
  onTagsChange(ids: string[]): void
}

export function TagFilter({ tags, selectedTags, onTagsChange }: Props) {
  if (tags.length === 0) return null

  function handleToggle(id: string) {
    if (selectedTags.includes(id)) {
      onTagsChange(selectedTags.filter((t) => t !== id))
    } else {
      onTagsChange([...selectedTags, id])
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => {
        const isSelected = selectedTags.includes(tag.id)
        const baseClass =
          'rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer'
        const mutedClass =
          'border border-border text-muted-foreground hover:border-foreground'

        return (
          <button
            key={tag.id}
            className={isSelected ? baseClass : `${baseClass} ${mutedClass}`}
            style={
              isSelected
                ? {
                    backgroundColor: tag.color,
                    color: '#fff',
                    border: '1px solid ' + tag.color,
                  }
                : undefined
            }
            onClick={() => handleToggle(tag.id)}
          >
            {tag.name}
          </button>
        )
      })}
      {selectedTags.length > 0 && (
        <button
          className="text-sm text-muted-foreground underline ml-1"
          onClick={() => onTagsChange([])}
        >
          Clear
        </button>
      )}
    </div>
  )
}
