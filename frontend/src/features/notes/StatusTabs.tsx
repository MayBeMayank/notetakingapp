import React from 'react';

interface Props {
  status: 'active' | 'trashed';
  onStatusChange: (s: 'active' | 'trashed') => void;
}

export function StatusTabs({ status, onStatusChange }: Props) {
  return (
    <div role="tablist" className="flex gap-1 rounded-lg border border-border p-1 w-fit">
      <button
        role="tab"
        aria-selected={status === 'active'}
        onClick={() => onStatusChange('active')}
        className={
          status === 'active'
            ? 'rounded-md bg-background px-4 py-1.5 text-sm font-medium shadow-sm'
            : 'rounded-md px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors'
        }
      >
        Active
      </button>
      <button
        role="tab"
        aria-selected={status === 'trashed'}
        onClick={() => onStatusChange('trashed')}
        className={
          status === 'trashed'
            ? 'rounded-md bg-background px-4 py-1.5 text-sm font-medium shadow-sm'
            : 'rounded-md px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors'
        }
      >
        Trash
      </button>
    </div>
  );
}
