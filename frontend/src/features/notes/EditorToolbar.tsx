import { type Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Code2,
  Minus,
} from 'lucide-react'

interface EditorToolbarProps {
  editor: Editor | null
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  if (!editor) return null

  return (
    <div className="flex flex-wrap gap-1 p-1">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cn(editor.isActive('bold') && 'bg-muted')}
        aria-label="Bold"
      >
        <Bold className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cn(editor.isActive('italic') && 'bg-muted')}
        aria-label="Italic"
      >
        <Italic className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={cn(editor.isActive('heading', { level: 1 }) && 'bg-muted')}
        aria-label="Heading 1"
      >
        <Heading1 className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={cn(editor.isActive('heading', { level: 2 }) && 'bg-muted')}
        aria-label="Heading 2"
      >
        <Heading2 className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={cn(editor.isActive('heading', { level: 3 }) && 'bg-muted')}
        aria-label="Heading 3"
      >
        <Heading3 className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={cn(editor.isActive('bulletList') && 'bg-muted')}
        aria-label="Bullet List"
      >
        <List className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={cn(editor.isActive('orderedList') && 'bg-muted')}
        aria-label="Ordered List"
      >
        <ListOrdered className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={cn(editor.isActive('blockquote') && 'bg-muted')}
        aria-label="Blockquote"
      >
        <Quote className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={cn(editor.isActive('code') && 'bg-muted')}
        aria-label="Code"
      >
        <Code className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={cn(editor.isActive('codeBlock') && 'bg-muted')}
        aria-label="Code Block"
      >
        <Code2 className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className={cn(false && 'bg-muted')}
        aria-label="Horizontal Rule"
      >
        <Minus className="h-4 w-4" />
      </Button>
    </div>
  )
}
