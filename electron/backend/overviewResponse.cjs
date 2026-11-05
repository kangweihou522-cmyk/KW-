const aliases = ['overview', 'summary', 'synopsis', 'content', 'text', '概括', '文献概览', '文章概括', '概述', '正文', '摘要'];
function extractOverviewResponse(raw) {
  const walk = (value, depth = 0) => {
    if (depth > 6) throw new Error('概括返回结构过深。');
    if (Array.isArray(value)) return value.map(item => walk(item, depth + 1)).filter(Boolean).join('\n\n');
    if (value && typeof value === 'object') {
      for (const key of aliases) {
        if (value[key] === undefined) continue;
        try { const text = walk(value[key], depth + 1); if (text) return text; } catch { /* Try another recognized body field. */ }
      }
      if (Array.isArray(value.sections)) return walk(value.sections, depth + 1);
      throw new Error('返回对象中没有可识别的概括正文。');
    }
    if (typeof value !== 'string') return '';
    // Qwen chat templates can open the reasoning block before the returned
    // content starts. A closing tag still marks the final-answer boundary:
    // discard everything before it, even when no opening tag was returned.
    const endTags = [...value.matchAll(/<\/think>/giu)];
    const lastEnd = endTags.at(-1);
    let text = (lastEnd ? value.slice(lastEnd.index + lastEnd[0].length) : value).trim();
    if (/<\/?think>/iu.test(text)) throw new Error('模型思考内容未结束，未作为正文保存。');
    const fenced = text.match(/```json\s*\n?([\s\S]*?)\n?```/iu) || text.match(/^```(?:markdown|text)?\s*\n?([\s\S]*?)\n?```$/iu);
    if (fenced) text = fenced[1].trim();
    if (!fenced && !['{', '[', '"'].includes(text[0])) {
      const object = text.match(/\{\s*"[\s\S]*\}/u);
      if (object) { let parsed; try { parsed = JSON.parse(object[0]); } catch { throw new Error('说明文字后附带的 JSON 不完整。'); } return walk(parsed, depth + 1); }
    }
    if (!text) return '';
    if (/^(?:error\b|traceback\b|请求失败|调用失败|连接失败|无法连接)/iu.test(text)) throw new Error('模型返回错误信息，未作为概括保存。');
    if (['{', '[', '"'].includes(text[0])) {
      let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('模型返回了不完整或无效的结构化内容。'); }
      return walk(parsed, depth + 1);
    }
    if (/^(?:原文未报告[。.]?|材料不足[。.]?|尚未填写|null|undefined)$/iu.test(text)) return '';
    return text;
  };
  const overview = walk(raw);
  if (!overview.trim()) throw new Error('模型返回的概括正文为空或仅有占位内容。');
  return { overview };
}
module.exports = { extractOverviewResponse };
