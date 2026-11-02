export function paperDoi(text: string): string | null {
  const normalized = text.replace(/(10\.\d{4,9}\/)\s+/g, '$1');
  const explicit = normalized.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi\s*:\s*)(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i);
  const match = explicit?.[1] || normalized.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0];
  if (!match) return null;
  let value = match.replace(/[.,;\]}]+$/, '');
  while (value.endsWith(')') && (value.match(/\)/g)?.length || 0) > (value.match(/\(/g)?.length || 0)) value = value.slice(0, -1);
  return value.toLowerCase();
}

export function isPublisherAuthor(value: string): boolean {
  if (/^(?:mdpi|elsevier)(?:$|[,;\s])/i.test(value.trim())) return true;
  return /^(?:mdpi(?:\s*ag)?|elsevier(?:\s*(?:b\.?v\.?|ltd\.?))?|springer(?:\s*nature)?|wiley(?:\s*blackwell)?|taylor\s*&\s*francis|adobe|acrobat|microsoft(?:\s*word)?|latex|typeset(?:ter)?|publisher|admin)$/i.test(value.trim());
}
