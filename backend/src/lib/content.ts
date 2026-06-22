export const EMPTY_TIPTAP_DOC: Record<string, unknown> = { type: 'doc', content: [] };

const BLOCK_LEVEL_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
]);

function traverse(node: unknown): string {
  if (node === null || node === undefined || typeof node !== 'object') {
    return '';
  }

  const n = node as Record<string, unknown>;

  if (n['type'] === 'text') {
    return typeof n['text'] === 'string' ? n['text'] : '';
  }

  const children = Array.isArray(n['content']) ? n['content'] : [];
  const childText = children.map((child: unknown) => traverse(child)).join('');

  if (typeof n['type'] === 'string' && BLOCK_LEVEL_TYPES.has(n['type'])) {
    return childText + '\n';
  }

  return childText;
}

export function deriveContentText(doc: unknown): string {
  const raw = traverse(doc);
  return raw
    .trim()
    .replace(/\n{2,}/g, '\n');
}
