import { splitEditableReport } from '../reader/reportEditorSections.ts';

/** Every saved heading is a separate tab, including custom and repeated headings. */
export function parseOverviewSections(text: string) {
  if (!text.trim()) return [];
  return splitEditableReport(text).map((section, index) => ({ ...section, id: `section-${index}` }));
}

export function overviewSectionLabel(title: string, level: number, l: <T>(zh: T, en: T) => T) {
  if (!level) return l('概览', 'Overview');
  // Translate exact legacy English labels only. A user's custom title is never reclassified.
  const legacy: Record<string, string> = {
    overview: l('概览', 'Overview'), background: l('背景', 'Background'),
    'research problem': l('问题', 'Research problem'), approach: l('方法', 'Approach'),
    'experiment setup': l('实验', 'Experiments'), 'data analysis': l('数据分析', 'Data analysis'),
    'key findings': l('发现', 'Findings'), discussion: l('讨论整合', 'Discussion'),
    conclusions: l('结论', 'Conclusions'), 'evidence evaluation': l('证据评价', 'Evidence evaluation'),
    limitations: l('局限', 'Limitations'), takeaways: l('要点', 'Takeaways'), keywords: l('关键词', 'Keywords'),
  };
  return legacy[title.toLocaleLowerCase().trim()] || title;
}
