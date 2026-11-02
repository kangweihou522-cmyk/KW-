export interface EditableOverviewPart { id: string; title: string; start: number; end: number; }

// Offsets refer to the original string. Editing one part never rebuilds or
// merges the other headings, including old or unrecognized section names.
export function editableOverviewParts(text: string): EditableOverviewPart[] {
  const headings = [...text.matchAll(/^#{1,4}[ \t]+([^\r\n]+)\r?\n?/gm)];
  const parts: EditableOverviewPart[] = [];
  if (!headings.length) return parts;
  if (headings[0].index! > 0) parts.push({ id: 'preamble', title: '开头说明', start: 0, end: headings[0].index! });
  headings.forEach((heading, index) => parts.push({ id: `part-${index}`, title: heading[1].trim(),
    start: heading.index! + heading[0].length, end: headings[index + 1]?.index ?? text.length }));
  return parts;
}
export function replaceOverviewPart(text: string, id: string, content: string): string {
  const part = editableOverviewParts(text).find(item => item.id === id);
  if (!part) throw new Error('该部分已变化，请重新选择或编辑全文。');
  const boundary = part.end < text.length && !content.endsWith('\n') ? '\n\n' : '';
  return text.slice(0, part.start) + content + boundary + text.slice(part.end);
}
