import * as React from 'react'
import { cn } from '@/lib/utils'

interface NoteTitleProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export function NoteTitle({ value, onChange, disabled, className }: NoteTitleProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Untitled"
      disabled={disabled}
      className={cn(
        'w-full bg-transparent text-2xl font-bold outline-none',
        'placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    />
  )
}
