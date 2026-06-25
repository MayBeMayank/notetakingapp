import { Button } from '@/components/ui/button';

export function NotesLoadingState() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading notes">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="animate-pulse rounded-lg border border-border p-4 h-24">
          <div className="h-4 bg-muted rounded w-3/4 mb-3" />
          <div className="h-3 bg-muted rounded w-1/3" />
        </div>
      ))}
    </div>
  );
}

export function NotesErrorState({ onRetry }: { onRetry(): void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-muted-foreground">Couldn&apos;t load notes</p>
      <Button variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function NotesEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <h2 className="text-lg font-semibold">No notes yet</h2>
      <p className="text-muted-foreground">Create your first note to get started.</p>
    </div>
  );
}

export function NotesEmptyFilterState({ onClearFilter }: { onClearFilter(): void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-muted-foreground">No notes match this filter.</p>
      <Button variant="ghost" onClick={onClearFilter}>Clear filter</Button>
    </div>
  );
}

export function NotesEmptyTrashState() {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <h2 className="text-lg font-semibold">Trash is empty</h2>
      <p className="text-muted-foreground">Deleted notes will appear here.</p>
    </div>
  );
}
