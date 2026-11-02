import { PaperPersonalOverview } from './PaperPersonalOverview';
import { ChatGptAssist } from './ChatGptAssist';
﻿import {
  ExternalLink,
  FileText,
  Info,
  Languages,
  MessageSquare,
  PanelRightOpen,
  Settings2,
} from 'lucide-react';
import { useLocaleText } from '../../i18n/uiLanguage';
import type {
  Note,
  NoteAnchor,
  NoteAnchorInsertRequest,
  UpdateNoteRequest,
} from '../../types/notes';
import type { LiteraturePaper } from '../../types/library';
import type {
  AssistantPanelKey,
  DocumentChatAttachment,
  DocumentChatCitation,
  DocumentChatMessage,
  DocumentChatRenderMode,
  DocumentChatSession,
  ModelReasoningEffort,
  QaModelPreset,
  SelectedExcerpt,
} from '../../types/reader';
import { cn } from '../../utils/cn';
import { NotesSidebar } from '../notes/NotesSidebar';
import { ChatPanel, ChatWorkspacePanel } from './assistantSidebarChat';
import {
  InfoDrawerContent,
  TranslateDrawerContent,
} from './assistantSidebarDrawers';
import { SectionCard, SelectionPanel, SummaryPanel } from './assistantSidebarPrimitives';

export interface AssistantSidebarCoreProps {
  aiWorkflow?: 'web' | 'local';
  paperId?: string;
  overviewStorageId?: string;
  activePanel: AssistantPanelKey;
  onActivePanelChange: (panel: AssistantPanelKey) => void;
  documentTitle?: string;
  documentMeta?: string;
  documentSource?: string;
  documentPdfName?: string;
  documentJsonName?: string;
  blockCount?: number;
  translatedCount?: number;
  statusMessage?: string;
  hasBlocks: boolean;
  aiConfigured: boolean;
  notes: Note[];
  activeNoteId: string | null;
  notePaperCandidates?: LiteraturePaper[];
  notesLoading: boolean;
  notesSaving: boolean;
  notesError: string;
  pendingAnchorInsert?: NoteAnchorInsertRequest | null;
  onPendingAnchorInsertHandled?: (requestId: string) => void;
  noteEditorSourceId?: string;
  externalUpdateNote?: Note | null;
  onExternalUpdateApply?: (note: Note) => void;
  qaSessions: DocumentChatSession[];
  selectedQaSessionId: string;
  qaMessages: DocumentChatMessage[];
  qaInput: string;
  qaAttachments: DocumentChatAttachment[];
  qaModelPresets: QaModelPreset[];
  selectedQaPresetId: string;
  qaRagEnabled: boolean;
  qaAnswerRenderMode: DocumentChatRenderMode;
  qaReasoningEffort: ModelReasoningEffort;
  qaLoading: boolean;
  qaRunningSessionIds?: string[];
  qaError: string;
  screenshotLoading?: boolean;
  chatLayoutMode?: 'compact' | 'workspace';
  onQaInputChange: (value: string) => void;
  onQaSubmit: (inputOverride?: string) => void;
  onQaPresetChange: (presetId: string) => void;
  onQaRagEnabledChange: (value: boolean) => void;
  onQaAnswerRenderModeChange: (mode: DocumentChatRenderMode) => void;
  onQaReasoningEffortChange: (reasoningEffort: ModelReasoningEffort) => void;
  onQaSessionCreate: () => void;
  onQaSessionSelect: (sessionId: string) => void;
  onQaSessionDelete: (sessionId: string) => void;
  onSelectImageAttachments: () => void;
  onSelectFileAttachments: () => void;
  onCaptureScreenshot: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onCitationClick: (citation: DocumentChatCitation) => void;
  onCreateStandaloneNote: () => void;
  onSelectNote: (note: Note) => void;
  onUpdateNote: (noteId: string, patch: UpdateNoteRequest, options?: { sourceId?: string }) => Note | void | Promise<Note | void>;
  onDeleteNote: (noteId: string) => void;
  onJumpToNoteAnchor: (note: Note, anchor: NoteAnchor) => void;
  onNotePaperClick?: (paperId: string) => void;
  onAddSelectionToNote: () => void;
  onSaveAssistantMessageAsNote: (message: DocumentChatMessage) => void;
  selectedExcerpt: SelectedExcerpt | null;
  selectedExcerptTranslation: string;
  selectedExcerptTranslating: boolean;
  selectedExcerptError: string;
  onAppendSelectedExcerptToQa: () => void;
  onTranslateSelectedExcerpt: () => void;
  onClearSelectedExcerpt: () => void;
  onOpenPreferences?: () => void;
}

export interface AssistantSidebarChromeProps {
  panelWidth?: number;
  chatLayoutMode?: 'compact' | 'workspace';
  onDetach?: () => void;
  onAttachBack?: () => void;
}

export type AssistantSidebarProps = AssistantSidebarCoreProps & AssistantSidebarChromeProps;

function AssistantSidebar({
  aiWorkflow, paperId, overviewStorageId,
  activePanel,
  onActivePanelChange,
  panelWidth = 408,
  documentTitle,
  documentMeta,
  documentSource,
  documentPdfName,
  documentJsonName,
  blockCount,
  translatedCount,
  statusMessage,
  hasBlocks,
  aiConfigured,
  notes,
  activeNoteId,
  notePaperCandidates = [],
  notesLoading,
  notesSaving,
  notesError,
  pendingAnchorInsert = null,
  onPendingAnchorInsertHandled,
  noteEditorSourceId,
  externalUpdateNote = null,
  onExternalUpdateApply,
  qaSessions,
  selectedQaSessionId,
  qaMessages,
  qaInput,
  qaAttachments,
  qaModelPresets,
  selectedQaPresetId,
  qaRagEnabled,
  qaAnswerRenderMode,
  qaReasoningEffort,
  qaLoading,
  qaRunningSessionIds = [],
  qaError,
  screenshotLoading = false,
  chatLayoutMode = 'compact',
  onQaInputChange,
  onQaSubmit,
  onQaPresetChange,
  onQaRagEnabledChange,
  onQaAnswerRenderModeChange,
  onQaReasoningEffortChange,
  onQaSessionCreate,
  onQaSessionSelect,
  onQaSessionDelete,
  onSelectImageAttachments,
  onSelectFileAttachments,
  onCaptureScreenshot,
  onRemoveAttachment,
  onCitationClick,
  onCreateStandaloneNote,
  onSelectNote,
  onUpdateNote,
  onDeleteNote,
  onJumpToNoteAnchor,
  onNotePaperClick,
  onAddSelectionToNote,
  onSaveAssistantMessageAsNote,
  selectedExcerpt,
  selectedExcerptTranslation,
  selectedExcerptTranslating,
  selectedExcerptError,
  onAppendSelectedExcerptToQa,
  onTranslateSelectedExcerpt,
  onClearSelectedExcerpt,
  onDetach,
  onAttachBack,
  onOpenPreferences,
}: AssistantSidebarProps) {
  const l = useLocaleText();

  const togglePanel = (panel: Exclude<AssistantPanelKey, null>) => {
    onActivePanelChange(activePanel === panel ? null : panel);
  };

  const activityItems = [
    {
      key: 'translate' as const,
      label: l('实时翻译', 'Translate'),
      icon: Languages,
      onClick: () => togglePanel('translate'),
    },
    {
      key: 'notes' as const,
      label: l('笔记', 'Notes'),
      icon: FileText,
      onClick: () => togglePanel('notes'),
    },
    {
      key: 'info' as const,
      label: l('文献概览', 'Overview'),
      icon: Info,
      onClick: () => togglePanel('info'),
    },
  ];

  return (
    <div className="pq-saas-scope pq-reader-assistant paperquay-assistant flex h-full min-h-0 flex-col-reverse overflow-hidden" style={{ width: activePanel ? panelWidth : 48 }}>
      <div
        className={cn(
          'pq-reader-pane min-h-0 flex-1 overflow-hidden border-l transition-[width] duration-300 ease-in-out',
          !activePanel && 'border-transparent',
        )}
        style={{ width: activePanel ? panelWidth : 0 }}
      >
        <div className="flex h-full flex-col" style={{ width: panelWidth, minWidth: panelWidth }}>
          <div className="min-h-0 flex-1">
            {activePanel === 'chat' && aiWorkflow === 'web' && paperId ? <div className="h-full overflow-y-auto p-3"><ChatGptAssist paperId={paperId} paperTitle={documentTitle} /></div> : null}
            {activePanel === 'chat' && (aiWorkflow !== 'web' || !paperId) ? (
              <ChatWorkspacePanel
                sessions={qaSessions}
                selectedSessionId={selectedQaSessionId}
                messages={qaMessages}
                input={qaInput}
                loading={qaLoading}
                error={qaError}
                hasBlocks={hasBlocks}
                selectedExcerpt={selectedExcerpt}
                attachments={qaAttachments}
                qaModelPresets={qaModelPresets}
                selectedQaPresetId={selectedQaPresetId}
                qaRagEnabled={qaRagEnabled}
                qaAnswerRenderMode={qaAnswerRenderMode}
                qaReasoningEffort={qaReasoningEffort}
                screenshotLoading={screenshotLoading}
                runningSessionIds={qaRunningSessionIds}
                layoutMode={chatLayoutMode}
                onInputChange={onQaInputChange}
                onSubmit={onQaSubmit}
                onQaPresetChange={onQaPresetChange}
                onQaRagEnabledChange={onQaRagEnabledChange}
                onQaAnswerRenderModeChange={onQaAnswerRenderModeChange}
                onQaReasoningEffortChange={onQaReasoningEffortChange}
                onSessionCreate={onQaSessionCreate}
                onSessionSelect={onQaSessionSelect}
                onSessionDelete={onQaSessionDelete}
                onAppendSelectedExcerpt={onAppendSelectedExcerptToQa}
                onSelectImageAttachments={onSelectImageAttachments}
                onSelectFileAttachments={onSelectFileAttachments}
                onCaptureScreenshot={onCaptureScreenshot}
                onRemoveAttachment={onRemoveAttachment}
                onCitationClick={onCitationClick}
                onSaveAssistantMessageAsNote={onSaveAssistantMessageAsNote}
                onCollapseSidebar={() => onActivePanelChange(null)}
              />
            ) : null}

            {activePanel === 'translate' ? (
              <TranslateDrawerContent
                selectedExcerpt={selectedExcerpt}
                selectedExcerptTranslation={selectedExcerptTranslation}
                selectedExcerptTranslating={selectedExcerptTranslating}
                selectedExcerptError={selectedExcerptError}
                aiConfigured={aiConfigured}
                onAppendSelectedExcerptToQa={onAppendSelectedExcerptToQa}
                onTranslateSelectedExcerpt={onTranslateSelectedExcerpt}
                onClearSelectedExcerpt={onClearSelectedExcerpt}
                onCollapse={() => onActivePanelChange(null)}
              />
            ) : null}

            {activePanel === 'info' ? (
              <div className="h-full overflow-y-auto p-3"><PaperPersonalOverview paperId={overviewStorageId || paperId || documentPdfName || documentTitle || 'standalone'} editable /></div>
            ) : null}

            <div className="h-full min-h-0" hidden={activePanel !== 'notes'}>
              <NotesSidebar
                notes={notes}
                activeNoteId={activeNoteId}
                papers={notePaperCandidates}
                documentTitle={documentTitle}
                loading={notesLoading}
                saving={notesSaving}
                error={notesError}
                selectedExcerpt={selectedExcerpt}
                pendingAnchorInsert={pendingAnchorInsert}
                onPendingAnchorInsertHandled={onPendingAnchorInsertHandled}
                noteEditorSourceId={noteEditorSourceId}
                externalUpdateNote={externalUpdateNote}
                onExternalUpdateApply={onExternalUpdateApply}
                onAddSelectionToNote={onAddSelectionToNote}
                onCreateStandaloneNote={onCreateStandaloneNote}
                onSelectNote={onSelectNote}
                onUpdateNote={onUpdateNote}
                onDeleteNote={onDeleteNote}
                onJumpToNoteAnchor={onJumpToNoteAnchor}
                onPaperClick={onNotePaperClick}
                onCollapse={() => onActivePanelChange(null)}
              />
            </div>

          </div>
        </div>
      </div>

      <div className={cn("pq-reader-pane z-10 flex shrink-0 items-center border-b border-l px-1 py-2", !activePanel && "h-full flex-col")}>
        <div className={cn("flex items-center gap-1.5", !activePanel && "flex-col")}>
          {activityItems.map((item) => {
            const active = activePanel === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                title={item.label}
                aria-label={item.label}
                aria-pressed={active}
                className={cn(
                  'relative flex h-9 items-center justify-center gap-1 rounded-xl px-2 text-xs transition',
                  active
                    ? 'bg-[var(--pq-accent-soft)] text-[var(--pq-accent)] ring-1 ring-[var(--pq-accent-ring)]'
                    : 'text-[var(--pq-text-muted)] hover:bg-white/70 hover:text-[var(--pq-text)]',
                )}
              >
                {active ? (
                  <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-[var(--pq-accent)]" />
                ) : null}
                <Icon className="h-4 w-4" strokeWidth={1.9} />{activePanel ? <span>{item.label}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="mt-auto flex items-center gap-1.5">
          {onDetach && activePanel === 'chat' ? (
            <button
              type="button"
              onClick={onDetach}
              title={l('弹出文档问答窗口', 'Open document chat window')}
              className="pq-icon-button h-10 w-10"
            >
              <ExternalLink className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}

          {onAttachBack ? (
            <button
              type="button"
              onClick={onAttachBack}
              title={l('停靠回侧边栏', 'Dock Back to Sidebar')}
              className="pq-icon-button h-10 w-10"
            >
              <PanelRightOpen className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}

          {onOpenPreferences ? (
            <button
              type="button"
              onClick={onOpenPreferences}
              title={l('设置', 'Settings')}
              className="pq-icon-button h-10 w-10"
            >
              <Settings2 className="h-4.5 w-4.5" strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { AssistantSidebar, ChatPanel, ChatWorkspacePanel, SectionCard, SelectionPanel, SummaryPanel };
