import { Button } from '@/components/ui/button'

interface Props {
  page: number
  total: number
  limit: number
  onPageChange(p: number): void
}

export function NotesPagination({ page, total, limit, onPageChange }: Props) {
  const totalPages = Math.ceil(total / limit)

  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-4 mt-4">
      <Button
        variant="outline"
        size="sm"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </div>
  )
}
