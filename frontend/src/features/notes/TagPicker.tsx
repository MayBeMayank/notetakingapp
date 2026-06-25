import { Badge } from '@/components/ui/badge'
import { useTags } from '@/api/tags'

export interface TagPickerProps {
  selectedIds: string[]
  onToggle: (id: string) => void
  disabled?: boolean
}

export function TagPicker({ selectedIds, onToggle, disabled }: TagPickerProps) {
  const { data: tags, isLoading } = useTags()

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-6 w-16 animate-pulse rounded-full bg-muted" />
        ))}
      </div>
    )
  }

  if (tags?.length === 0) {
    return <p className="text-sm text-muted-foreground">No tags yet</p>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags?.map((tag) => (
        <Badge
          key={tag.id}
          variant={selectedIds.includes(tag.id) ? 'default' : 'outline'}
          onClick={() => {
            if (!disabled) onToggle(tag.id)
          }}
          className={disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer select-none'}
        >
          {tag.name}
        </Badge>
      ))}
    </div>
  )
}
