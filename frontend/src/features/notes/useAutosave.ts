import { useState, useEffect, useRef, useCallback } from 'react'
import type { MutableRefObject } from 'react'
import { toast } from 'sonner'
import type { SaveState } from './SaveStatusIndicator'
import { useUpdateNote } from '@/api/notes'
import { ApiError } from '@/api/client'
import type { NoteResponse } from '@note-app/shared/schemas/notes'

export interface UseAutosaveOptions {
  noteId: string
  title: string
  contentRef: MutableRefObject<NoteResponse['content']>
  contentVersion: number
  tagIds: string[]
  onFatalError: () => void
}

export interface UseAutosaveReturn {
  saveState: SaveState
}

const DEBOUNCE_MS = 2_000

export function useAutosave({
  noteId, title, contentRef, contentVersion, tagIds, onFatalError
}: UseAutosaveOptions): UseAutosaveReturn {
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const pendingRef  = useRef(false)
  const fatalRef    = useRef(false)
  const latestRef   = useRef({ title, content: contentRef.current, tagIds })
  const mountRef    = useRef(true)   // skip debounce on initial mount

  const { mutateAsync: updateNote } = useUpdateNote()

  // Keep latestRef current every render (no save trigger)
  useEffect(() => {
    latestRef.current = { title, content: contentRef.current, tagIds }
  })

  const executeSave = useCallback(async () => {
    if (fatalRef.current) return
    if (inFlightRef.current) { pendingRef.current = true; return }

    inFlightRef.current = true
    setSaveState('saving')
    try {
      await updateNote({ id: noteId, ...latestRef.current })
      inFlightRef.current = false
      setSaveState('saved')
      if (pendingRef.current) {
        pendingRef.current = false
        executeSave()
      }
    } catch (err) {
      inFlightRef.current = false
      const e = err as ApiError
      if (e.status === 404 || (e.status === 422 && e.code === 'NOTE_DELETED')) {
        fatalRef.current = true
        setSaveState('fatal')
        onFatalError()
      } else {
        setSaveState('error')
        toast.error("Could not save — will retry")
      }
    }
  }, [noteId, updateNote, onFatalError])

  // Debounce: reset timer on any change. Skip the very first run (initial mount).
  useEffect(() => {
    if (mountRef.current) { mountRef.current = false; return }
    if (fatalRef.current) return
    setSaveState('pending')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(executeSave, DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [title, contentVersion, tagIds, executeSave])

  return { saveState }
}
