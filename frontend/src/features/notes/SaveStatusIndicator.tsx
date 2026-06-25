import * as React from 'react'
import { Loader2, Check } from 'lucide-react'

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'fatal'

interface SaveStatusIndicatorProps {
  state: SaveState
}

export function SaveStatusIndicator({ state }: SaveStatusIndicatorProps) {
  if (state === 'idle' || state === 'fatal') return null

  if (state === 'pending') {
    return <span className="text-sm text-muted-foreground">Unsaved changes</span>
  }

  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    )
  }

  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <Check className="h-3 w-3" />
        Saved
      </span>
    )
  }

  if (state === 'error') {
    return <span className="text-sm text-destructive">Save failed</span>
  }

  return null
}
