async function updatePaperCategories(store, request) {
  if (!request || typeof request.paperId !== 'string') throw new Error('文献分类请求无效。');
  const add = request.addCategoryIds ?? []; const remove = request.removeCategoryIds ?? [];
  if (![add, remove].every(ids => Array.isArray(ids) && ids.every(id => typeof id === 'string' && id.trim()))) throw new Error('文献分类列表无效。');
  const additions = new Set(add); const removals = new Set(remove);
  if ([...additions].some(id => removals.has(id))) throw new Error('不能同时添加和移除同一个分类。');
  const library = store.load();
  const paper = library.papers.find(item => item.id === request.paperId);
  if (!paper) throw new Error('文献不存在。');
  for (const id of [...additions, ...removals]) {
    const category = library.categories.find(item => item.id === id);
    if (!category || category.isSystem) throw new Error('分类不存在或属于系统分组，请重新打开分类列表。');
  }
  // Apply only the user's additions/removals to the latest membership. A second
  // window may have added another group since this dialog was opened.
  const next = [...new Set(paper.categoryIds.filter(id => !removals.has(id)).concat([...additions]))];
  if (JSON.stringify(next) !== JSON.stringify(paper.categoryIds)) {
    paper.categoryIds = next; paper.updatedAt = Date.now();
    await store.save(library);
  }
  return paper;
}
module.exports = { updatePaperCategories };
