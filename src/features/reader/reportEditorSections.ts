export interface EditableReportSection { title: string; level: number; content: string; }
/** Split only Markdown headings outside fenced code; preserve all body text and evidence. */
export function splitEditableReport(text: string): EditableReportSection[] {
  const sections: EditableReportSection[] = [];
  let current: EditableReportSection = { title: '梗概与报告', level: 0, content: '' }; let fence = '';
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = ''; }
    const heading = !fence && /^(#{1,6})[ \t]+(.+?)\r?\n?$/.exec(line);
    if (heading) { if (current.content || current.level) sections.push(current); current = { title: heading[2], level: heading[1].length, content: '' }; }
    else current.content += line;
  }
  if (current.content || current.level || !sections.length) sections.push(current);
  return sections;
}
export function joinEditableReport(sections: EditableReportSection[]): string {
  return sections.map((section, index) => `${section.level || index > 0 ? `${'#'.repeat(section.level || 2)} ${section.title}\n` : ''}${section.content}${index < sections.length - 1 && !section.content.endsWith('\n') ? '\n\n' : ''}`).join('');
}
