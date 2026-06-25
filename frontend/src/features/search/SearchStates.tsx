import { Button } from '@/components/ui/button';

export function SearchLoadingState() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading search results">
      {[0, 1, 2].map(i => (
        <div key={i} className="animate-pulse rounded-lg border border-border p-4 h-24">
          <div className="h-4 bg-muted rounded w-3/4 mb-3" />
          <div className="h-3 bg-muted rounded w-1/2 mb-2" />
          <div className="h-3 bg-muted rounded w-1/3" />
        </div>
      ))}
    </div>
  );
}

export function SearchErrorState({ onRetry }: { onRetry(): void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-muted-foreground">Couldn&apos;t load search results</p>
      <Button variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  );
}

export function SearchIdleState() {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <h2 className="text-lg font-semibold">Search your notes</h2>
      <p className="text-muted-foreground">Type a keyword to find notes by title or content.</p>
    </div>
  );
}

export function SearchNoResultsState({ q }: { q: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p className="text-muted-foreground">No notes found for &ldquo;{q}&rdquo;</p>
    </div>
  );
}
