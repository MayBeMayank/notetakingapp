import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { NoteResponse } from '@note-app/shared/schemas/notes'
import { NoteTitle } from './NoteTitle'
import { EditorToolbar } from './EditorToolbar'
import { TagPicker } from './TagPicker'
import { SaveStatusIndicator } from './SaveStatusIndicator'
import { useAutosave } from './useAutosave'
import { Button } from '@/components/ui/button'
import { ShareButton } from '@/features/share/ShareButton'

interface NoteEditorProps {
  note: NoteResponse
}

export function NoteEditor({ note }: NoteEditorProps) {
  const navigate = useNavigate()

  const [title, setTitle] = useState(note.title)
  const [tagIds, setTagIds] = useState<string[]>(note.tagIds)
  const [contentVersion, setContentVersion] = useState(0)
  const contentRef = useRef<NoteResponse['content']>(note.content)

  const editor = useEditor({
    extensions: [StarterKit],
    content: note.content as object,
    onUpdate: ({ editor }) => {
      contentRef.current = editor.getJSON() as NoteResponse['content']
      setContentVersion((v) => v + 1)
    },
  })

  const handleTagToggle = (id: string) =>
    setTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    )

  const { saveState } = useAutosave({
    noteId: note.id,
    title,
    contentRef,
    contentVersion,
    tagIds,
    onFatalError: () => {},
  })

  useEffect(() => {
    editor?.setEditable(saveState !== 'fatal')
  }, [editor, saveState])

  return (
    <div className="relative flex h-full flex-col">
      {/* Header: title + save status */}
      <div className="flex items-center gap-4 border-b px-6 py-3">
        <NoteTitle
          value={title}
          onChange={setTitle}
          disabled={saveState === 'fatal'}
          className="flex-1"
        />
        <SaveStatusIndicator state={saveState} />
        <ShareButton noteId={note.id} />
      </div>

      {/* Toolbar */}
      <div className="border-b px-4 py-1">
        <EditorToolbar editor={editor} />
      </div>

      {/* Editor body */}
      <div className="prose prose-sm dark:prose-invert max-w-none flex-1 overflow-auto px-6 py-4">
        <EditorContent editor={editor} />
      </div>

      {/* Tag picker */}
      <div className="border-t px-6 py-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tags
        </p>
        <TagPicker
          selectedIds={tagIds}
          onToggle={handleTagToggle}
          disabled={saveState === 'fatal'}
        />
      </div>

      {/* Fatal overlay */}
      {saveState === 'fatal' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="max-w-sm rounded-lg border bg-card p-6 text-center shadow-lg">
            <p className="mb-4 text-sm font-medium">This note has been deleted.</p>
            <Button onClick={() => navigate('/notes')} variant="outline">
              Back to notes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
