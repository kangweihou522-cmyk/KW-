import clsx from 'clsx';
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  BookOpenText,
  FilePlus2,
  GripVertical,
  RefreshCw,
  CheckCircle2,
  Sparkles,
  Loader2,
  Search,
  Star,
} from 'lucide-react';
import { useAppLocale, useLocaleText } from '../../../i18n/uiLanguage';
import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import type { ListPapersRequest, LiteraturePaper } from '../../../types/library';
import { paperAuthors } from '../literatureUi';
import { PaperTags } from './PaperTags';
import { PaperImpactFactor, PaperMetadataEditor } from './PaperMetadataEditor';
import type { UpdatePaperRequest, MetadataLayout } from '../../../types/library';

export interface LiteraturePaperListStatus {
  mineruParsed: boolean;
  overviewGenerated: boolean;
  checkingMineru?: boolean;
}

export type LiteraturePaperListSortBy = NonNullable<ListPapersRequest['sortBy']>;
export type LiteraturePaperListSortDirection = NonNullable<ListPapersRequest['sortDirection']>;

interface LiteraturePaperListProps {
  loading: boolean;
  metadataLayout?: MetadataLayout;
  metadataWorking?: boolean;
  onEnrichMetadata?: () => void;
  working: boolean;
  papers: LiteraturePaper[];
  paperStatuses: Record<string, LiteraturePaperListStatus>;
  showReadingHeatmap?: boolean;
  storageDir?: string;
  selectedPaper: LiteraturePaper | null;
  searchQuery: string;
  sortBy: LiteraturePaperListSortBy;
  sortDirection: LiteraturePaperListSortDirection;
  statusMessage: string;
  error: string;
  saving: boolean;
  onSavePaper: (request: UpdatePaperRequest) => Promise<boolean>;
  onSearchQueryChange: (value: string) => void;
  onSortChange: (sortBy: LiteraturePaperListSortBy, sortDirection: LiteraturePaperListSortDirection) => void;
  onImportPdfs: () => void;
  onRefresh: () => void;
  onSelectPaper: (paperId: string) => void;
  onOpenPaper: (paper: LiteraturePaper) => void;
  onPaperDragStart: (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => void;
  onPaperReorder: (
    draggedPaperId: string,
    targetPaperId: string,
    placement: 'before' | 'after',
  ) => void;
  onPaperDropOnCategory: (paperId: string, categoryId: string) => void;
  onPaperPointerDragOverCategory: (categoryId: string | null) => void;
  onPaperContextMenu: (
    event: MouseEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => void;
}

export default function LiteraturePaperList({
  loading,
  metadataLayout, metadataWorking, onEnrichMetadata,
  working,
  papers,
  paperStatuses,
  saving,
  onSavePaper,
  selectedPaper,
  searchQuery,
  sortBy,
  sortDirection,
  statusMessage,
  error,
  onSearchQueryChange,
  onSortChange,
  onImportPdfs,
  onRefresh,
  onSelectPaper,
  onOpenPaper,
  onPaperDragStart,
  onPaperReorder,
  onPaperDropOnCategory,
  onPaperPointerDragOverCategory,
  onPaperContextMenu,
}: LiteraturePaperListProps) {
  const l = useLocaleText();
  const locale = useAppLocale();
  const rootRef = useRef<HTMLElement | null>(null);
  const handleWheelCapture = useWheelScrollDelegate({ rootRef });
  const [dropIndicator, setDropIndicator] = useState<{
    paperId: string;
    placement: 'before' | 'after';
  } | null>(null);
  const [draggingPaperId, setDraggingPaperId] = useState<string | null>(null);
  const sortDragRef = useRef<{
    paperId: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const categoryDragRef = useRef<{
    paperId: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const [sortDraggingPaperId, setSortDraggingPaperId] = useState<string | null>(null);
  const [categoryDraggingPaperId, setCategoryDraggingPaperId] = useState<string | null>(null);
  const [suppressClickPaperId, setSuppressClickPaperId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState('');
  const manualSortingEnabled = sortBy === 'manual';
  const hiddenMetadata = new Set(metadataLayout?.hiddenFields || []);
  const sortValue = `${sortBy}:${sortDirection}`;
  const tags = [...new Set(papers.flatMap(paper => paper.tags.map(tag => tag.name)))].sort((a, b) => a.localeCompare(b));
  const visiblePapers = tagFilter ? papers.filter(paper => paper.tags.some(tag => tag.name === tagFilter)) : papers;
  useEffect(() => { if (tagFilter && !tags.includes(tagFilter)) setTagFilter(''); }, [tagFilter, tags.join('\0')]);

  const findPointerDropTarget = (
    clientX: number,
    clientY: number,
  ): { paperId: string; placement: 'before' | 'after' } | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>('[data-paper-row-id]');
    const paperId = row?.dataset.paperRowId;

    if (!row || !paperId) {
      return null;
    }

    const rect = row.getBoundingClientRect();
    const placement: 'before' | 'after' =
      clientY < rect.top + rect.height / 2 ? 'before' : 'after';

    return { paperId, placement };
  };

  const findCategoryDropTarget = (clientX: number, clientY: number): string | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const target = element?.closest<HTMLElement>('[data-paperquay-category-drop-id]');

    return target?.dataset.paperquayCategoryDropId ?? null;
  };

  const handlePaperDragOver = (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    const draggedPaperId =
      draggingPaperId || event.dataTransfer.getData('application/x-paperquay-paper-id');

    if (!draggedPaperId || draggedPaperId === paper.id) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropIndicator({ paperId: paper.id, placement });
  };

  const handlePaperDrop = (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    const draggedPaperId =
      draggingPaperId || event.dataTransfer.getData('application/x-paperquay-paper-id');

    setDropIndicator(null);
    setDraggingPaperId(null);

    if (!draggedPaperId || draggedPaperId === paper.id) {
      return;
    }

    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    onPaperReorder(draggedPaperId, paper.id, placement);
  };

  const resetSortDrag = () => {
    sortDragRef.current = null;
    setDropIndicator(null);
    setSortDraggingPaperId(null);
    onPaperPointerDragOverCategory(null);
  };

  const resetCategoryDrag = () => {
    categoryDragRef.current = null;
    setCategoryDraggingPaperId(null);
    onPaperPointerDragOverCategory(null);
  };

  const handleSortPointerDown = (
    event: PointerEvent<HTMLElement>,
    paper: LiteraturePaper,
  ) => {
    if (!manualSortingEnabled) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    sortDragRef.current = {
      paperId: paper.id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

  const handleSortPointerMove = (event: PointerEvent<HTMLElement>) => {
    const dragState = sortDragRef.current;

    if (!dragState) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );

    if (!dragState.active && distance < 4) {
      return;
    }

    dragState.active = true;
    setSortDraggingPaperId(dragState.paperId);

    const categoryId = findCategoryDropTarget(event.clientX, event.clientY);

    if (categoryId) {
      setDropIndicator(null);
      onPaperPointerDragOverCategory(categoryId);
      return;
    }

    onPaperPointerDragOverCategory(null);

    const target = findPointerDropTarget(event.clientX, event.clientY);

    if (!target || target.paperId === dragState.paperId) {
      setDropIndicator(null);
      return;
    }

    setDropIndicator(target);
  };

  const handleSortPointerUp = (event: PointerEvent<HTMLElement>) => {
    const dragState = sortDragRef.current;

    if (!dragState) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    const categoryId = findCategoryDropTarget(event.clientX, event.clientY);
    const target = findPointerDropTarget(event.clientX, event.clientY);

    if (dragState.active) {
      setSuppressClickPaperId(dragState.paperId);
      window.setTimeout(() => setSuppressClickPaperId(null), 0);
    }

    if (dragState.active && categoryId) {
      onPaperDropOnCategory(dragState.paperId, categoryId);
    } else if (dragState.active && target && target.paperId !== dragState.paperId) {
      onPaperReorder(dragState.paperId, target.paperId, target.placement);
    }

    resetSortDrag();
  };

  const handleCategoryPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    if (event.button !== 0) {
      return;
    }

    if ((event.target as HTMLElement).closest('[data-paper-sort-handle]')) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    categoryDragRef.current = {
      paperId: paper.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

  const handleCategoryPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = categoryDragRef.current;

    if (!dragState) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );

    if (!dragState.active && distance < 6) {
      return;
    }

    event.preventDefault();
    dragState.active = true;
    setCategoryDraggingPaperId(dragState.paperId);
    onPaperPointerDragOverCategory(findCategoryDropTarget(event.clientX, event.clientY));
  };

  const handleCategoryPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = categoryDragRef.current;

    if (!dragState) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    const categoryId = findCategoryDropTarget(event.clientX, event.clientY);

    if (dragState.active) {
      event.preventDefault();
      setSuppressClickPaperId(dragState.paperId);
      window.setTimeout(() => setSuppressClickPaperId(null), 0);

      if (categoryId) {
        onPaperDropOnCategory(dragState.paperId, categoryId);
      }
    }

    resetCategoryDrag();
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') {
      onOpenPaper(paper);
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      onSelectPaper(paper.id);
    }
  };

  return (
    <section
      ref={rootRef}
      onWheelCapture={handleWheelCapture}
      className="pq-library-pane flex h-full min-h-0 flex-col overflow-hidden border-r"
    >
      <header className="pq-toolbar px-4 py-3">
        <div className="mb-3 flex items-baseline gap-2"><h2 className="text-lg font-semibold">{l('我的文献', 'My papers')}</h2><span className="text-xs text-[var(--pq-text-muted)]">{l(`${visiblePapers.length} 篇`, `${visiblePapers.length} papers`)}</span></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.8} />
            <input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder={l('搜索标题、作者、期刊、DOI…', 'Search title, author, abstract, DOI...')}
              className="pq-input h-9 w-full pl-9 pr-3 text-sm placeholder:text-[var(--pq-text-faint)]"
            />
          </div>

          <select
            value={sortValue}
            onChange={(event) => {
              const [nextSortBy, nextDirection] = event.target.value.split(':') as [
                LiteraturePaperListSortBy,
                LiteraturePaperListSortDirection,
              ];

              onSortChange(nextSortBy, nextDirection);
            }}
            className="pq-input h-9 w-[126px] px-3 text-sm"
            title={l('排序', 'Sort')}
          >
            <option value="manual:asc">{l('手动排序', 'Manual Order')}</option>
            <option value="title:asc">{l('名称 A-Z', 'Name A-Z')}</option>
            <option value="title:desc">{l('名称 Z-A', 'Name Z-A')}</option>
            <option value="importedAt:desc">{l('添加时间 新-旧', 'Added New-Old')}</option>
            <option value="importedAt:asc">{l('添加时间 旧-新', 'Added Old-New')}</option>
            <option value="year:desc">{l('出版时间 新-旧', 'Year New-Old')}</option>
            <option value="year:asc">{l('出版时间 旧-新', 'Year Old-New')}</option>
            <option value="updatedAt:desc">{l('更新时间 新-旧', 'Updated New-Old')}</option>
            <option value="author:asc">{l('作者 A-Z', 'Author A-Z')}</option>
          </select>

          <select aria-label={l('按标签筛选', 'Filter by tag')} value={tagFilter} onChange={event => { const tag = event.target.value; setTagFilter(tag); const first = papers.find(paper => !tag || paper.tags.some(value => value.name === tag)); if (first) onSelectPaper(first.id); }} className="pq-input h-9 max-w-[140px] px-2 text-xs"><option value="">{l('全部标签', 'All tags')}</option>{tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select>
          <button type="button" title={l('补全文献信息', 'Complete paper metadata')} aria-label={l('补全文献信息', 'Complete paper metadata')} disabled={working || metadataWorking} className="pq-button h-9 px-2 text-xs" onClick={onEnrichMetadata}>{metadataWorking ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}{l('补全', 'Complete')}</button>
          <button
            type="button"
            onClick={onImportPdfs}
            disabled={working}
            className="pq-button-primary h-9 px-3 text-sm"
          >
            <FilePlus2 className="mr-2 h-4 w-4" strokeWidth={1.9} />
            {l('导入 PDF', 'Import PDF')}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={working}
            title={l('刷新', 'Refresh')}
            aria-label={l('刷新', 'Refresh')}
            className="pq-icon-button h-9 w-9"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        {error ? <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p> : statusMessage ? <p role="status" className={[l('文献信息已保存', 'Paper metadata saved'), l('文献库已就绪', 'Library is ready')].includes(statusMessage) ? 'sr-only' : 'mt-2 text-[11px] text-[var(--pq-text-muted)]'}>{statusMessage}</p> : null}
      </header>

      <div
        data-wheel-scroll-target
        className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3"
      >
        {loading ? (
          <div className="pq-card p-6 text-sm text-[var(--pq-text-muted)]">
            {l('正在加载文献库...', 'Loading library...')}
          </div>
        ) : visiblePapers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--pq-border)] bg-white/58 p-8 text-center dark:bg-white/5">
            <BookOpenText className="mx-auto h-9 w-9 text-slate-400 dark:text-[#a0a0a0]" strokeWidth={1.7} />
            <div className="mt-4 text-lg font-semibold">
              {tagFilter ? l('此标签下暂无文献', 'No papers with this tag') : l('还没有文献', 'No papers yet')}
            </div>
            <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-[#a0a0a0]">
              {l(
                '点击“导入 PDF”选择一个或多个文件。应用会把路径、附件和基础元数据保存到本地文库。',
                'Click "Import PDF" to select one or more files. The app will save paths, attachments, and basic metadata into the local library.',
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {visiblePapers.map((paper) => {
              const active = selectedPaper?.id === paper.id;
              const showBeforeIndicator =
                dropIndicator?.paperId === paper.id && dropIndicator.placement === 'before';
              const showAfterIndicator =
                dropIndicator?.paperId === paper.id && dropIndicator.placement === 'after';
              const status = paperStatuses[paper.id];
              const mineruParsed = status?.mineruParsed ?? false;
              const overviewGenerated =
                status?.overviewGenerated ?? Boolean(paper.aiSummary?.trim());

              return (
                <div key={paper.id} className="relative">
                  {showBeforeIndicator ? (
                    <div className="pointer-events-none absolute -top-1 left-3 right-3 z-10 h-0.5 rounded-full bg-[#2f7f85]" />
                  ) : null}
                  <div
                    role="button"
                    tabIndex={0}
                    data-paper-row-id={paper.id}
                    data-selected={active}
                    draggable={false}
                    onPointerDown={(event) => handleCategoryPointerDown(event, paper)}
                    onPointerMove={handleCategoryPointerMove}
                    onPointerUp={handleCategoryPointerUp}
                    onPointerCancel={resetCategoryDrag}
                    onDragStart={(event) => {
                      setDraggingPaperId(paper.id);
                      onPaperDragStart(event, paper);
                    }}
                    onDragOver={(event) => handlePaperDragOver(event, paper)}
                    onDragLeave={() => setDropIndicator(null)}
                    onDragEnd={() => {
                      setDropIndicator(null);
                      setDraggingPaperId(null);
                    }}
                    onDrop={(event) => handlePaperDrop(event, paper)}
                    onContextMenu={(event) => onPaperContextMenu(event, paper)}
                    onClick={() => {
                      if (suppressClickPaperId === paper.id) {
                        return;
                      }

                      onSelectPaper(paper.id);
                    }}
                    onDoubleClick={() => onOpenPaper(paper)}
                    onKeyDown={(event) => handleRowKeyDown(event, paper)}
                    className={clsx(
                      'pq-card grid w-full grid-cols-[22px_minmax(0,1fr)] gap-2 px-3 py-3 text-left transition',
                      manualSortingEnabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                      active
                        ? 'border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent-soft)] ring-1 ring-[var(--pq-accent-ring)]'
                        : dropIndicator?.paperId === paper.id
                          ? 'border-[var(--pq-accent-border-strong)] bg-[var(--pq-accent-soft)]'
                          : 'hover:border-[var(--pq-accent-border)] hover:bg-white/92',
                      sortDraggingPaperId === paper.id && 'opacity-60 ring-2 ring-teal-300/60',
                      categoryDraggingPaperId === paper.id && 'opacity-70 ring-2 ring-teal-300/70',
                    )}
                  >
                    <span
                      data-paper-sort-handle
                      draggable={false}
                      title={
                        manualSortingEnabled
                          ? l('拖拽排序', 'Drag to reorder')
                          : l('切换到手动排序后可拖拽排序', 'Switch to manual order to drag-sort')
                      }
                      onPointerDown={(event) => handleSortPointerDown(event, paper)}
                      onPointerMove={handleSortPointerMove}
                      onPointerUp={handleSortPointerUp}
                      onPointerCancel={resetSortDrag}
                      className={clsx(
                        'mt-0.5 flex h-8 w-7 items-center justify-center rounded-lg text-[var(--pq-text-faint)] transition',
                        manualSortingEnabled
                          ? 'cursor-grab hover:bg-[var(--pq-accent-soft)] hover:text-[var(--pq-accent)] active:cursor-grabbing'
                          : 'cursor-not-allowed opacity-45',
                      )}
                    >
                      <GripVertical className="h-4 w-4" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="min-w-0 text-sm font-semibold leading-6">{paper.title}</h3>
                        <div className="shrink-0 text-right">
                          <time dateTime={new Date(paper.updatedAt).toISOString()} title={new Date(paper.updatedAt).toLocaleString()} className="text-[10px] text-[var(--pq-text-faint)]">{l('更新于 ', 'Updated ')}{new Date(paper.updatedAt).toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit' })}</time>
                          <div className="mt-0.5 flex items-center justify-end" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
                            <button type="button" disabled={saving} aria-label={paper.isFavorite ? l('取消收藏', 'Remove from favorites') : l('加入收藏', 'Add to favorites')} title={paper.isFavorite ? l('取消收藏', 'Remove from favorites') : l('加入收藏', 'Add to favorites')} onClick={() => void onSavePaper({ paperId: paper.id, isFavorite: !paper.isFavorite })} className={`pq-icon-button h-7 w-7 ${paper.isFavorite ? 'text-amber-500' : 'text-[var(--pq-text-faint)]'}`}><Star className="h-3.5 w-3.5" fill={paper.isFavorite ? 'currentColor' : 'none'} /></button>
                            <PaperMetadataEditor metadataLayout={metadataLayout} paper={paper} saving={saving} onSave={onSavePaper} />
                          </div>
                        </div>
                      </div>
                      {!hiddenMetadata.has('authors') && <p className="mt-0.5 break-words text-xs leading-5 text-[var(--pq-text-muted)]" title={paperAuthors(paper, locale)}>{paperAuthors(paper, locale)}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">{!hiddenMetadata.has('publication') && <span className="text-sm font-semibold text-[var(--pq-accent)]">{paper.publication || l('期刊待补充', 'Journal not recorded')}</span>}{!hiddenMetadata.has('impactFactor') && <PaperImpactFactor paper={paper} saving={saving} onSave={onSavePaper} />}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--pq-text-muted)]">
                        <span>{!hiddenMetadata.has('publishedDate') && paper.publishedDate || !hiddenMetadata.has('year') && paper.year || ''}</span>
                        {(!hiddenMetadata.has('volume') && paper.volume || !hiddenMetadata.has('issue') && paper.issue) && <span>{!hiddenMetadata.has('volume') && paper.volume}{!hiddenMetadata.has('issue') && paper.issue ? `(${paper.issue})` : ''}</span>}
                        {!hiddenMetadata.has('pages') && paper.pages && <span>{paper.pages}</span>}
                        {!hiddenMetadata.has('doi') && paper.doi && <span className="min-w-0 break-all select-text">DOI {paper.doi}</span>}
                        {mineruParsed && <span title={l('已完成本地解析', 'Locally parsed')}><CheckCircle2 className="h-3 w-3 text-emerald-600" /></span>}
                        {overviewGenerated && <span title={l('概览已生成', 'Overview ready')}><Sparkles className="h-3 w-3 text-sky-600" /></span>}
                      </div>
                      {metadataLayout?.customFields.filter(field => !hiddenMetadata.has(field.id) && paper.customFields?.[field.id]?.trim()).map(field => <p key={field.id} className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5"><span>{paper.customFields?.[field.id]}</span></p>)}
                      <PaperTags paper={paper} saving={saving} onSave={onSavePaper} />
                    </div>
                  </div>
                  {showAfterIndicator ? (
                    <div className="pointer-events-none absolute -bottom-1 left-3 right-3 z-10 h-0.5 rounded-full bg-[#2f7f85]" />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

