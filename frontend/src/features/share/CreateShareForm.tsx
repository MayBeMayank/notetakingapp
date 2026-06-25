import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useCreateShare } from '@/api/shares'
import { EXPIRY_OPTIONS, type ExpiryPreset, presetToExpiresAt } from './expiryPresets'

interface CreateShareFormProps {
  noteId: string
  onCreated?: () => void
}

export function CreateShareForm({ noteId, onCreated }: CreateShareFormProps) {
  const [preset, setPreset] = useState<ExpiryPreset>('never')
  const create = useCreateShare(noteId)

  function handleGenerate() {
    create.mutate(
      { expiresAt: presetToExpiresAt(preset) },
      {
        onSuccess: () => {
          setPreset('never')
          onCreated?.()
        },
      },
    )
  }

  const errorMessage = create.isError
    ? create.error.code === 'NOTE_DELETED'
      ? 'This note is in the trash — restore it before sharing.'
      : create.error.status === 404
        ? 'Note not found.'
        : 'Failed to generate link. Please try again.'
    : null

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Select
          value={preset}
          onChange={(e) => setPreset(e.target.value as ExpiryPreset)}
          className="h-9 flex-1 text-sm"
          aria-label="Link expiry"
        >
          {EXPIRY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          className="h-9 shrink-0"
          disabled={create.isPending}
          onClick={handleGenerate}
        >
          {create.isPending ? 'Generating…' : 'Generate link'}
        </Button>
      </div>
      {errorMessage && (
        <p className="text-xs text-destructive">{errorMessage}</p>
      )}
    </div>
  )
}
