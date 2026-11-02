import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  MoreHorizontal,
  Undo2,
  Redo2,
  ChevronLeft,
  ChevronRight,
  Download,
  Highlighter,
  Loader2,
  MousePointer2,
  PenTool,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import {
  getPdfAnnotationColorValue,
  PDF_ANNOTATION_COLOR_PRESETS,
  type PdfAnnotationColorTool,
  type PdfAnnotationToolColors,
} from './annotationColors';
import {
  getPdfAnnotationColorLabel,
  getPercentProgress,
} from './pdfViewerUtils';

type Localize = (zh: string, en: string) => string;

export type AnnotationEditorTool = 'none' | 'highlight' | 'freetext' | 'ink';

type ToolbarToolKey = 'select' | 'highlight' | 'freetext' | 'ink';
type EditableToolbarToolKey = Extract<ToolbarToolKey, 'freetext' | 'ink'>;

interface ToolbarTool {
  key: ToolbarToolKey;
  label: string;
  icon: ReactNode;
}

interface PdfViewerToolbarProps {
  annotationDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  activeColorTool: PdfAnnotationColorTool;
  annotationColors: PdfAnnotationToolColors;
  canShowReadingHeatmapBar: boolean;
  currentPage: number;
  documentError: string;
  editorTool: AnnotationEditorTool;
  enableReadingHeatmap: boolean;
  hasLiveTextSelection: boolean;
  hasSelectedEditor: boolean;
  hideToolbar: boolean;
  l: Localize;
  loading: boolean;
  onActiveColorToolChange: Dispatch<SetStateAction<PdfAnnotationColorTool>>;
  onAnnotationToolColorChange: (tool: PdfAnnotationColorTool, value: string) => void;
  onCreateHighlight: () => void | Promise<void>;
  onDeleteSelected: () => void;
  onEditorToolChange: Dispatch<SetStateAction<AnnotationEditorTool>>;
  onSave: () => void | Promise<void>;
  onScrollToPage: (pageIndex: number) => void;
  onToggleReadingHeatmapBar: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  pageCount: number;
  readingHeatmapToggleLabel: string;
  saveMessage: string;
  saving: boolean;
  showReadingHeatmapBar: boolean;
  translating: boolean;
  translationProgressCompleted: number;
  translationProgressTotal: number;
  zoomLabel: string;
}

export function PdfViewerToolbar({
  annotationDirty, canUndo, canRedo, onUndo, onRedo,
  activeColorTool,
  annotationColors,
  canShowReadingHeatmapBar,
  currentPage,
  documentError,
  editorTool,
  enableReadingHeatmap,
  hasLiveTextSelection,
  hasSelectedEditor,
  hideToolbar,
  l,
  loading,
  onActiveColorToolChange,
  onAnnotationToolColorChange,
  onCreateHighlight,
  onDeleteSelected,
  onEditorToolChange,
  onSave,
  onScrollToPage,
  onToggleReadingHeatmapBar,
  onZoomIn,
  onZoomOut,
  pageCount,
  readingHeatmapToggleLabel,
  saveMessage,
  saving,
  showReadingHeatmapBar,
  translating,
  translationProgressCompleted,
  translationProgressTotal,
  zoomLabel,
}: PdfViewerToolbarProps) {
  const activeToolColor = annotationColors[activeColorTool];
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [pageInput, setPageInput] = useState(String(currentPage));
  useEffect(() => setPageInput(String(currentPage)), [currentPage]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !anchorRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape);
    const reposition = () => setMenuOpen(false); window.addEventListener('resize', reposition);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); window.removeEventListener('resize', reposition); };
  }, [menuOpen]);
  const button = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800';
  function toggleHighlight() {
    onActiveColorToolChange('highlight');
    if (hasLiveTextSelection && editorTool === 'none') void onCreateHighlight();
    else onEditorToolChange(current => current === 'highlight' ? 'none' : 'highlight');
  }
  const menu = menuOpen ? <div ref={menuRef} role="dialog" aria-label={l('PDF批注工具', 'PDF annotation tools')} className="fixed z-[12000] w-72 space-y-3 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl dark:border-white/10 dark:bg-slate-900 dark:text-slate-200" style={position}>
    <div className="flex flex-wrap gap-2">{[{key:'none' as const,label:l('选择','Select'),icon:MousePointer2},{key:'freetext' as const,label:l('文本批注','Text'),icon:Type},{key:'ink' as const,label:l('手写批注','Ink'),icon:PenTool}].map(tool=><button key={tool.key} type="button" className="pq-button flex items-center gap-1 p-2" disabled={loading || saving} aria-pressed={editorTool===tool.key} onClick={()=>{onEditorToolChange(tool.key);if(tool.key!=='none')onActiveColorToolChange(tool.key);}}><tool.icon className="h-4 w-4"/>{tool.label}</button>)}</div>
    <div className="flex items-center gap-2">{PDF_ANNOTATION_COLOR_PRESETS.map(preset=>{const value=getPdfAnnotationColorValue(preset,activeColorTool);return <button key={preset.id} type="button" className={cn('h-6 w-6 rounded-full border-2',value.toLowerCase()===activeToolColor.toLowerCase()?'border-slate-900 ring-2 ring-indigo-300':'border-white')} style={{backgroundColor:value}} title={getPdfAnnotationColorLabel(preset.id,l)} aria-label={getPdfAnnotationColorLabel(preset.id,l)} onMouseDown={e=>e.preventDefault()} onClick={()=>onAnnotationToolColorChange(activeColorTool,value)}/>;})}<input aria-label={l('自定义批注颜色','Custom annotation color')} type="color" className="h-7 w-8" value={activeToolColor} onChange={e=>onAnnotationToolColorChange(activeColorTool,e.target.value)}/></div>
    <div className="flex gap-2"><button type="button" className="pq-button flex items-center gap-1 p-2" disabled={!canUndo} onClick={onUndo}><Undo2 className="h-4 w-4"/>撤销</button><button type="button" className="pq-button flex items-center gap-1 p-2" disabled={!canRedo} onClick={onRedo}><Redo2 className="h-4 w-4"/>重做</button><button type="button" className="pq-button flex items-center gap-1 p-2 text-rose-600" disabled={!hasSelectedEditor || loading || saving} onClick={onDeleteSelected}><Trash2 className="h-4 w-4"/>删除选中</button></div>
    <p>{annotationDirty ? '有未保存的 PDF 批注' : 'PDF 批注无待保存修改'}</p><p className="leading-6 text-slate-500">H 连续高亮 · T 文本批注 · Esc 选择 · Ctrl+S 保存。原PDF始终保留。</p>
    {saveMessage && <p role="status" className="break-words text-emerald-600">{saveMessage}</p>}{documentError && <p role="alert" className="break-words text-rose-600">{documentError}</p>}
    {translating && <p>全文翻译：{translationProgressCompleted}/{translationProgressTotal}</p>}
  </div> : null;
  return <div className={cn('flex shrink-0 items-center gap-0.5',hideToolbar && 'hidden')}>
    <button type="button" className={button} disabled={loading || saving} aria-pressed={editorTool==='highlight'} aria-label={l('高亮','Highlight')} title={l('连续高亮（H）','Continuous highlight (H)')} onMouseDown={e=>e.preventDefault()} onClick={toggleHighlight}><Highlighter className={cn('h-4 w-4',editorTool==='highlight'&&'text-indigo-600')} /></button>
    <button type="button" className={button} disabled={currentPage<=1 || loading} title={l('上一页','Previous page')} aria-label={l('上一页','Previous page')} onClick={()=>onScrollToPage(Math.max(0,currentPage-2))}><ChevronLeft className="h-4 w-4"/></button>
    <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-500"><input aria-label={l('PDF页码','PDF page')} className="w-9 rounded border bg-transparent px-1 py-1 text-center" inputMode="numeric" value={pageInput} onChange={e=>setPageInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){const value=Number(pageInput);if(Number.isInteger(value)&&value>=1&&value<=pageCount)onScrollToPage(value-1);else setPageInput(String(currentPage));}}}/><span>/{Math.max(1,pageCount)}</span></label>
    <button type="button" className={button} disabled={currentPage>=pageCount || loading} title={l('下一页','Next page')} aria-label={l('下一页','Next page')} onClick={()=>onScrollToPage(Math.min(pageCount-1,currentPage))}><ChevronRight className="h-4 w-4"/></button>
    <button type="button" className={button} title={l('缩小','Zoom out')} aria-label={l('缩小','Zoom out')} onClick={onZoomOut}><ZoomOut className="h-4 w-4"/></button><span className="hidden text-xs text-slate-500 2xl:inline">{zoomLabel}</span><button type="button" className={button} title={l('放大','Zoom in')} aria-label={l('放大','Zoom in')} onClick={onZoomIn}><ZoomIn className="h-4 w-4"/></button>
    {enableReadingHeatmap && <button type="button" className={cn(button,showReadingHeatmapBar&&'bg-indigo-50 text-indigo-600')} disabled={!canShowReadingHeatmapBar} aria-expanded={showReadingHeatmapBar} title={readingHeatmapToggleLabel} aria-label={readingHeatmapToggleLabel} onClick={onToggleReadingHeatmapBar}><Activity className="h-4 w-4"/></button>}
    <button type="button" className={cn(button,annotationDirty&&'text-amber-600')} disabled={saving||loading} title={saveMessage || l('保存批注PDF（Ctrl+S）','Save annotated PDF (Ctrl+S)')} aria-label={l('保存批注PDF','Save annotated PDF')} onClick={()=>void onSave()}>{saving?<Loader2 className="h-4 w-4 animate-spin"/>:<Download className="h-4 w-4"/>}</button>
    <button type="button" ref={anchorRef} className={cn(button,documentError&&'text-rose-600')} title={l('更多PDF工具与保存状态','More PDF tools and save status')} aria-label={l('更多PDF工具','More PDF tools')} aria-expanded={menuOpen} onClick={()=>{const rect=anchorRef.current?.getBoundingClientRect();if(rect)setPosition({top:rect.bottom+6,left:Math.max(8,Math.min(window.innerWidth-296,rect.right-288))});setMenuOpen(!menuOpen);}}><MoreHorizontal className="h-4 w-4"/></button>
    {!hideToolbar && menu && createPortal(menu,document.body)}
  </div>;
}
