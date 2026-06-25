import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

interface PublicNoteViewProps {
  title: string
  content: unknown
}

export function PublicNoteView({ title, content }: PublicNoteViewProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: content as object,
    editable: false,
  })

  return (
    <article className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-8 text-3xl font-bold tracking-tight text-foreground">
        {title || 'Untitled'}
      </h1>
      <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
        <EditorContent editor={editor} />
      </div>
    </article>
  )
}
