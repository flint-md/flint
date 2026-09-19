import { useEffect, useState, useRef } from 'react';
import { StoreProvider, useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';
import { TiptapEditor } from './components/TiptapEditor';
import { GraphView } from './components/GraphView';
import { CanvasView } from './components/CanvasView';
import { SearchModal } from './components/SearchModal';
import { StatusBar } from './components/StatusBar';
import { BacklinksPanel } from './components/BacklinksPanel';
import { VaultScreen } from './components/VaultScreen';
import { SettingsPanel } from './components/Settings';
import { AIChat } from './components/AIChat';
import { FlintLogo } from './components/FlintLogo';
import {
  PanelLeftOpen, PenLine, Eye, Columns2,
  PanelRightOpen, PanelRightClose, Plus, Waypoints, Search,
  Bold, Italic, Code, List, Link2, Heading2, Quote,
  Command, FolderPlus, Settings, Hash, Brackets, Brain, CalendarDays, LayoutGrid,
} from 'lucide-react';
import i18n from './i18n';
import { useTranslation } from 'react-i18next';

function CommandPalette() {
  const { t } = useTranslation();
  const { dispatch, createNote, createFolder, openDailyNote } = useStore();
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = [
    { icon: <Plus size={14} />, label: t('app.commands.newNote'), action: () => { createNote(); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <CalendarDays size={14} />, label: t('app.commands.openDailyNote'), action: () => { openDailyNote(); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <FolderPlus size={14} />, label: t('app.commands.newFolder'), action: () => { createFolder('New Folder'); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <Waypoints size={14} />, label: t('app.commands.openGraphView'), action: () => { dispatch({ type: 'TOGGLE_GRAPH_VIEW' }); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <LayoutGrid size={14} />, label: t('app.commands.openCanvas'), action: () => { dispatch({ type: 'TOGGLE_CANVAS_VIEW' }); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <Search size={14} />, label: t('app.commands.searchNotes'), action: () => { dispatch({ type: 'TOGGLE_SEARCH' }); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <PenLine size={14} />, label: t('app.commands.switchToEditor'), action: () => { dispatch({ type: 'SET_VIEW_MODE', payload: 'edit' }); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <Eye size={14} />, label: t('app.commands.switchToPreview'), action: () => { dispatch({ type: 'SET_VIEW_MODE', payload: 'preview' }); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <Columns2 size={14} />, label: t('app.commands.switchToSplitView'), action: () => { dispatch({ type: 'SET_VIEW_MODE', payload: 'split' }); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <PanelLeftOpen size={14} />, label: t('app.commands.toggleSidebar'), action: () => { dispatch({ type: 'TOGGLE_SIDEBAR' }); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <PanelRightOpen size={14} />, label: t('app.commands.toggleRightPanel'), action: () => { dispatch({ type: 'TOGGLE_RIGHT_PANEL' }); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <Settings size={14} />, label: t('app.commands.openSettings'), action: () => { dispatch({ type: 'TOGGLE_SETTINGS' }); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
    { icon: <Brain size={14} />, label: t('app.commands.openFlintAI'), action: () => { dispatch({ type: 'TOGGLE_AI_CHAT' }); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); } },
  ];

  const filtered = query.trim() ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase())) : commands;

  useEffect(() => { inputRef.current?.focus(); setIdx(0); }, [query]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[idx]) filtered[idx].action();
    if (e.key === 'Escape') dispatch({ type: 'TOGGLE_COMMAND_PALETTE' });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 100 }}
      onClick={() => dispatch({ type: 'TOGGLE_COMMAND_PALETTE' })}>
      <div className="animate-scale-in" style={{ width: 440, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid #1a1a1a' }}>
          <Command size={14} style={{ color: '#444' }} />
          <input ref={inputRef} type="text" placeholder={t('app.commandPalettePlaceholder')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKey}
            style={{ flex: 1, background: 'none', border: 'none', color: '#bbb', fontSize: 14, outline: 'none' }} />
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {filtered.map((cmd, i) => (
            <div key={cmd.label}
              className="flex items-center gap-3 cursor-pointer"
              style={{ padding: '8px 14px', background: i === idx ? '#141414' : 'transparent', color: i === idx ? '#bbb' : '#555', fontSize: 13, transition: 'background 0.08s' }}
              onMouseEnter={() => setIdx(i)}
              onClick={() => cmd.action()}>
              {cmd.icon} {cmd.label}
            </div>
          ))}
        </div>
        <div style={{ padding: '6px 14px', borderTop: '1px solid #1a1a1a', fontSize: 10, color: '#333', display: 'flex', gap: 12 }}>
          <span>{t('app.navigate')}</span><span>{t('app.execute')}</span><span>{t('app.escClose')}</span>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const { t } = useTranslation();
  const { state, dispatch, createNote, openDailyNote } = useStore();
  const { activeNoteId, viewMode, showGraphView, showCanvasView, showSearch, showCommandPalette, sidebarOpen, rightPanelOpen, activeVaultId, settingsOpen, showAIChat } = state;
  
  useEffect(() => {
  i18n.changeLanguage(state.appSettings.language);
}, [state.appSettings.language]);

  // Dynamic style tag for settings
  useEffect(() => {
    let el = document.getElementById('flint-dynamic-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'flint-dynamic-style';
      document.head.appendChild(el);
    }
  }, []);

  // ALL hooks before any conditional return
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') { e.preventDefault(); dispatch({ type: 'TOGGLE_SEARCH' }); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); createNote(); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); openDailyNote(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') { e.preventDefault(); dispatch({ type: 'TOGGLE_GRAPH_VIEW' }); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); dispatch({ type: 'TOGGLE_CANVAS_VIEW' }); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        if (viewMode === 'edit') dispatch({ type: 'SET_VIEW_MODE', payload: 'preview' });
        else if (viewMode === 'preview') dispatch({ type: 'SET_VIEW_MODE', payload: 'split' });
        else dispatch({ type: 'SET_VIEW_MODE', payload: 'edit' });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); dispatch({ type: 'TOGGLE_SIDEBAR' }); }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); dispatch({ type: 'TOGGLE_SETTINGS' }); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') { e.preventDefault(); dispatch({ type: 'TOGGLE_AI_CHAT' }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch, createNote, openDailyNote, viewMode]);

  if (!activeVaultId) return <VaultScreen />;

  const activeNote = state.notes.find(n => n.id === activeNoteId);

  const format = (type: string) => {
    window.dispatchEvent(new CustomEvent('flint-format', { detail: { type } }));
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-base)', color: 'var(--text)' }}>
      <div className="flex-1 flex min-h-0">

        {/* Ribbon */}
        <div className="flex flex-col items-center py-2 gap-0.5 shrink-0"
          style={{ width: 50, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.03)' }}>

          <button style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8, border: '1px solid var(--border-light)', cursor: 'pointer' }}>
            <FlintLogo size={18} />
          </button>

          <RibbonBtn icon={<PanelLeftOpen size={16} />} active={sidebarOpen} onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })} title={t('app.toolbar.toggleSidebar')} />
          <RibbonBtn icon={<Search size={16} />} onClick={() => dispatch({ type: 'TOGGLE_SEARCH' })} title={t('app.toolbar.search')} />
          <RibbonBtn icon={<Plus size={16} />} onClick={() => createNote()} title={t('app.toolbar.newNote')} />
          <RibbonBtn icon={<CalendarDays size={16} />} onClick={() => openDailyNote()} title={t('app.toolbar.dailyNote')} />
          <RibbonBtn icon={<Waypoints size={16} />} active={showGraphView} onClick={() => dispatch({ type: 'TOGGLE_GRAPH_VIEW' })} title={t('app.toolbar.graphView')} />
          <RibbonBtn icon={<LayoutGrid size={16} />} active={showCanvasView} onClick={() => dispatch({ type: 'TOGGLE_CANVAS_VIEW' })} title={t('app.toolbar.canvas')} />
          <RibbonBtn icon={<Command size={16} />} onClick={() => dispatch({ type: 'TOGGLE_COMMAND_PALETTE' })} title={t('app.toolbar.commandPalette')} />
          <RibbonBtn icon={<Brain size={16} />} active={showAIChat} onClick={() => dispatch({ type: 'TOGGLE_AI_CHAT' })} title={t('app.toolbar.flintAI')} />

          <div className="flex-1" />

          <RibbonBtn icon={rightPanelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />} active={rightPanelOpen}
            onClick={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL' })} title={t('app.toolbar.toggleRightPanel')} />
          <RibbonBtn icon={<Settings size={16} />} active={settingsOpen}
            onClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })} title={t('app.toolbar.settings')} />
        </div>

        {/* Sidebar */}
        {sidebarOpen && <Sidebar />}

        {/* Center */}
        {(() => {
          if (!activeNoteId || !activeNote) {
            return (
              <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
                <div className="text-center animate-fade-in">
                  <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', border: '1px solid var(--border-light)' }}>
                    <FlintLogo size={28} />
                  </div>
                  <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{t('app.noNoteSelected')}</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20, maxWidth: 260, lineHeight: 1.5, margin: '0 auto 20px' }}>
                    Create a new note or select one from the sidebar.
                  </p>
                  <div className="flex items-center gap-2 justify-center">
                    <button onClick={() => createNote()}
                      className="flex items-center gap-2"
                      style={{ padding: '7px 14px', background: 'var(--accent)', color: 'var(--bg-deep)', border: 'none', cursor: 'pointer', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                      <Plus size={12} /> {t('app.commands.newNote')}
                    </button>
                    <button onClick={() => dispatch({ type: 'TOGGLE_GRAPH_VIEW' })}
                      className="flex items-center gap-2"
                      style={{ padding: '7px 14px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)', cursor: 'pointer', borderRadius: 6, fontSize: 12 }}>
                      <Waypoints size={12} /> Graph
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--bg-base)' }}>

              {/* Note title bar */}
              <div className="flex items-center px-4 shrink-0" style={{ height: 38, borderBottom: '1px solid var(--border)', background: 'linear-gradient(180deg, var(--bg-elevated), var(--bg-base))' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1 }}>{activeNote.title}</span>
                <div className="flex items-center gap-1">
                  {state.appSettings.editorStyle !== 'tiptap' && ([
                    { mode: 'edit' as const, icon: <PenLine size={13} />, label: t('app.commands.edit') },
                    { mode: 'split' as const, icon: <Columns2 size={13} />, label: t('app.commands.split') },
                    { mode: 'preview' as const, icon: <Eye size={13} />, label: t('app.commands.preview') },
                  ]).map(v => (
                    <button key={v.mode} title={v.label}
                      className="flex items-center gap-1"
                      style={{
                        padding: '4px 8px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', fontSize: 11,
                        background: viewMode === v.mode ? 'var(--bg-elevated)' : 'transparent',
                        color: viewMode === v.mode ? 'var(--text)' : 'var(--text-dim)',
                        transition: 'all 0.1s',
                      }}
                      onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: v.mode })}>
                      {v.icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* Formatting toolbar — buttons now work! */}
              <div className="flex items-center gap-0.5 px-4 shrink-0" style={{ height: 34, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                {[
                  { icon: <Bold size={13} />, title: 'Bold', fmt: 'bold' },
                  { icon: <Italic size={13} />, title: 'Italic', fmt: 'italic' },
                  { icon: <Heading2 size={13} />, title: 'Heading', fmt: 'heading' },
                  { icon: <Quote size={13} />, title: 'Quote', fmt: 'quote' },
                  { icon: <Code size={13} />, title: 'Code', fmt: 'code' },
                  { icon: <Link2 size={13} />, title: 'Link', fmt: 'link' },
                  { icon: <List size={13} />, title: 'List', fmt: 'list' },
                  { icon: <Brackets size={13} />, title: 'Wiki Link', fmt: 'wikilink' },
                  { icon: <Hash size={13} />, title: 'Tag', fmt: 'tag' },
                ].map((btn) => (
                  <button key={btn.fmt} title={btn.title}
                    onClick={() => format(btn.fmt)}
                    style={{ padding: '4px 6px', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', borderRadius: 5, display: 'flex', alignItems: 'center', transition: 'all 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-dim)'; }}>
                    {btn.icon}
                  </button>
                ))}
              </div>

              {/* Tab bar */}
              <TabBar />

              {/* Content */}
              <div className="flex-1 min-h-0 flex">
                {state.appSettings.editorStyle === 'tiptap' ? (
                  <div className="flex-1 flex flex-col min-h-0" style={{ background: 'var(--bg-base)' }}>
                    <TiptapEditor noteId={activeNoteId} />
                  </div>
                ) : (
                  <>
                    {(viewMode === 'edit' || viewMode === 'split') && (
                      <div className={`${viewMode === 'split' ? 'w-1/2' : 'flex-1'} flex flex-col min-h-0`} style={{ borderRight: viewMode === 'split' ? '1px solid var(--border)' : 'none', background: 'var(--bg-base)' }}>
                        <Editor noteId={activeNoteId} />
                      </div>
                    )}
                    {(viewMode === 'preview' || viewMode === 'split') && (
                      <div className={`${viewMode === 'split' ? 'w-1/2' : 'flex-1'} flex flex-col min-h-0 flint-note-scroll`} style={{ overflow: 'auto', background: 'var(--bg-base)' }}>
                        <Preview noteId={activeNoteId} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* Right panel */}
        {rightPanelOpen && activeNoteId && <BacklinksPanel noteId={activeNoteId} />}

        {/* AI Chat panel */}
        {showAIChat && <AIChat />}
      </div>

      <StatusBar />
      {showGraphView && <GraphView />}
      {showCanvasView && <CanvasView />}
      {showSearch && <SearchModal />}
      {showCommandPalette && <CommandPalette />}
      {settingsOpen && <SettingsPanel />}
    </div>
  );
}

function RibbonBtn({ icon, onClick, active, title }: { icon: React.ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button title={title}
      className="flex items-center justify-center"
      style={{
        width: 34, height: 34, borderRadius: 6, border: 'none',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-dim)',
        cursor: 'pointer', transition: 'all 0.1s',
      }}
      onClick={onClick}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)'; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)'; } }}>
      {icon}
    </button>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}

