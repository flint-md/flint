import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { askFlintAI, fetchOllamaModels, checkOllamaStatus, checkAgentStatus, checkAgentHealthDetails, type AgentHealthReport } from '../services/ollama';
import { FlintLogo } from './FlintLogo';
import { X, Send, Trash2, User, Loader2, Settings, Wifi, Globe, Brain, BookOpen, Network, Sparkles, Zap, Cpu, Server, AlertTriangle, Activity, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import type { AIAction } from '../types';
import { useTranslation } from 'react-i18next';

export function AIChat() {
  const { t } = useTranslation();
  const { state, dispatch } = useStore();
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [agentStatus, setAgentStatus] = useState<'checking' | 'agent-up' | 'agent-down'>('checking');
  const [ollamaStatus, setOllamaStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [models, setModels] = useState<string[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [healthReport, setHealthReport] = useState<AgentHealthReport | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [contextPreview, setContextPreview] = useState<string | null>(null);
  const [memoryStats, setMemoryStats] = useState({ notes: 0, connections: 0, tags: 0 });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const { aiMessages, aiSettings, notes, activeNoteId, openTabs } = state;

  // Calculate memory stats
  useEffect(() => {
    const connections = new Set<string>();
    let tags = 0;
    const noteTitleMap = new Map(notes.map(n => [n.title.toLowerCase(), n.id]));

    notes.forEach(n => {
      const matches = n.content.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g);
      for (const m of matches) {
        const targetId = noteTitleMap.get(m[1].toLowerCase());
        if (targetId && targetId !== n.id) {
          connections.add([n.id, targetId].sort().join('-'));
        }
      }
      const tagMatches = n.content.matchAll(/#(\w[\w-]*)/g);
      for (const _ of tagMatches) tags++;
    });
    setMemoryStats({ notes: notes.length, connections: connections.size, tags });
  }, [notes]);

  // Check agent + Ollama status periodically
  useEffect(() => {
    const check = async () => {
      const agentUp = await checkAgentStatus();
      if (agentUp) {
        setAgentStatus('agent-up');
        if (aiSettings.provider === 'ollama') {
          const oStatus = await checkOllamaStatus(aiSettings.ollamaUrl);
          setOllamaStatus(oStatus);
          if (oStatus === 'connected') {
            const fetchedModels = await fetchOllamaModels(aiSettings.ollamaUrl);
            setModels(fetchedModels);
            if (fetchedModels.length > 0 && (!aiSettings.model || !fetchedModels.includes(aiSettings.model))) {
              dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { model: fetchedModels[0] } });
            }
          }
        } else {
          setOllamaStatus('disconnected');
          setModels([]);
        }
      } else {
        setAgentStatus('agent-down');
        setOllamaStatus('disconnected');
        setModels([]);
      }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, [aiSettings.ollamaUrl, aiSettings.model, aiSettings.provider, dispatch]);

  // Scroll to bottom
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiMessages, streamContent]);

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 120;
  };

  const resolveTargetNoteId = (action: AIAction): string | null => {
    if (action.target === 'active') return activeNoteId;
    if (action.target === 'id' && action.noteId) return action.noteId;
    if (action.target === 'title' && action.matchTitle) {
      const match = notes.find(n => n.title.toLowerCase() === action.matchTitle!.toLowerCase());
      return match?.id || null;
    }
    return activeNoteId;
  };

  const applyAIActions = (actions: AIAction[]) => {
    const summaries: string[] = [];
    const editableIds = new Set(openTabs);
    actions.forEach(action => {
      const noteId = resolveTargetNoteId(action);
      const targetLabel = noteId ? notes.find(note => note.id === noteId)?.title || 'note' : 'note';
      const requiresOpenTarget = action.type !== 'create_note';
      if (requiresOpenTarget && (!noteId || !editableIds.has(noteId))) {
        summaries.push(t('ai.actionBlocked', { action: action.type.replace('_', ' '), title: targetLabel }));
        return;
      }
      if (action.type === 'rename_note') {
        if (!noteId || !action.title) return;
        dispatch({ type: 'RENAME_NOTE', payload: { id: noteId, title: action.title } });
        summaries.push(t('ai.actionRenamed', { title: action.title }));
      }
      if (action.type === 'update_note') {
        if (!noteId || !action.content) return;
        dispatch({ type: 'UPDATE_NOTE', payload: { id: noteId, content: action.content } });
        summaries.push(t('ai.actionUpdated'));
      }
      if (action.type === 'create_note' && action.title) {
        const newNote = {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          title: action.title,
          content: action.content || '# ' + action.title + '\n\n',
          folderId: null,
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        dispatch({ type: 'ADD_NOTE', payload: newNote });
        summaries.push(t('ai.actionCreated', { title: action.title }));
      }
      if (action.type === 'delete_note') {
        if (!noteId) return;
        dispatch({ type: 'DELETE_NOTE', payload: noteId });
        summaries.push(t('ai.actionDeleted'));
      }
    });
    return summaries;
  };

  const activeNote = notes.find(n => n.id === activeNoteId);
  const isCredentialProvider = aiSettings.provider === 'openai' || aiSettings.provider === 'gemini' || aiSettings.provider === 'openai-compatible';
  const isApiProvider = isCredentialProvider;
  const hasApiConfig = !!aiSettings.apiKey && !!aiSettings.model;

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    abortRef.current = false;

    const userMsg = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      role: 'user' as const,
      content: trimmed,
      timestamp: Date.now(),
      noteContext: activeNoteId ? [activeNoteId] : undefined,
    };
    dispatch({ type: 'ADD_AI_MESSAGE', payload: userMsg });
    setInput('');
    setIsStreaming(true);
    setStreamContent('');

    const chatHistory = aiMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));

    await askFlintAI(
        trimmed,
        notes,
        activeNoteId,
        openTabs,
        aiSettings,
        chatHistory,
      (chunk) => {
        if (abortRef.current) return;
        setStreamContent(prev => prev + chunk);
      },
      (fullContent, webResults, usedOllama, actions) => {
        if (abortRef.current) return;
        const actionSummaries = actions?.length ? applyAIActions(actions) : [];
        const actionSuffix = actionSummaries.length ? '\n\n' + t('ai.changes', { summary: actionSummaries.join('; ') }) : '';
        const assistantMsg = {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          role: 'assistant' as const,
          content: fullContent + actionSuffix,
          timestamp: Date.now(),
          webResults: usedOllama ? webResults : undefined,
        };
        dispatch({ type: 'ADD_AI_MESSAGE', payload: assistantMsg });
        setIsStreaming(false);
        setStreamContent('');
      },
      (err) => {
        if (abortRef.current) return;
        const errMsg = {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          role: 'assistant' as const,
          content: `${err}`,
          timestamp: Date.now(),
        };
        dispatch({ type: 'ADD_AI_MESSAGE', payload: errMsg });
        setIsStreaming(false);
        setStreamContent('');
      },
    );
  }, [input, isStreaming, notes, activeNoteId, openTabs, aiMessages, aiSettings, dispatch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const stopGeneration = () => {
    abortRef.current = true;
    setIsStreaming(false);
    if (streamContent) {
      const partial = {
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
        role: 'assistant' as const,
        content: streamContent + '\n\n' + t('ai.generationStopped'),
        timestamp: Date.now(),
      };
      dispatch({ type: 'ADD_AI_MESSAGE', payload: partial });
      setStreamContent('');
    }
  };

  const runHealthCheck = async () => {
    setIsCheckingHealth(true);
    try {
      const report = await checkAgentHealthDetails(aiSettings.ollamaUrl);
      setHealthReport(report);
    } catch (err: any) {
      setHealthReport({
        agentRunning: false,
        agentUrl: 'http://127.0.0.1:5100',
        ollamaConnected: false,
        latencyMs: 0,
        message: err?.message || 'Failed to perform health check',
      });
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const isAgentMode = agentStatus === 'agent-up';
  const isOllamaMode = isAgentMode && aiSettings.provider === 'ollama' && ollamaStatus === 'connected' && !!aiSettings.model;
  const isCloudMode = isAgentMode && isApiProvider && hasApiConfig;
  const isConfiguredMode = isOllamaMode || isCloudMode;
  const providerName = aiSettings.provider === 'openai' ? 'OpenAI' : aiSettings.provider === 'gemini' ? 'Gemini' : aiSettings.provider === 'openai-compatible' ? 'Custom API' : 'Ollama';

  return (
    <div style={{
      width: 392, height: '100%', background: '#171b21',
      borderLeft: '1px solid #303744', display: 'flex', flexDirection: 'column',
      boxShadow: 'inset 1px 0 0 rgba(255,255,255,0.03)',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #303744',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        background: 'linear-gradient(180deg, #1d222b, #171b21)',
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, background: '#232934',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid #394252',
        }}>
          <FlintLogo size={16} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#d5dbe5' }}>{t('ai.title')}</div>
          <div className="flex items-center gap-1" style={{ fontSize: 10, color: isConfiguredMode ? '#9fc59d' : isAgentMode ? '#d0b08a' : '#bf8d8d' }}>
            {isConfiguredMode ? <Wifi size={8} /> : isAgentMode ? <Server size={8} /> : <Cpu size={8} />}
            {isOllamaMode
              ? t('ai.statusOllama', { model: aiSettings.model })
              : isCloudMode
              ? t('ai.statusCloud', { provider: providerName, model: aiSettings.model })
              : isAgentMode
              ? t('ai.statusAgentNotConfigured', { provider: providerName })
              : t('ai.statusBrowser')
            }
          </div>
        </div>
        <button onClick={() => setShowConfig(!showConfig)} title={t('ai.settings')}
          style={{ background: 'none', border: 'none', color: showConfig ? '#c6cfdb' : '#758091', cursor: 'pointer', display: 'flex', padding: 4 }}>
          <Settings size={14} />
        </button>
        <button onClick={() => dispatch({ type: 'TOGGLE_AI_CHAT' })} title={t('ai.aiClose')}
          style={{ background: 'none', border: 'none', color: '#758091', cursor: 'pointer', display: 'flex', padding: 4 }}>
          <X size={14} />
        </button>
      </div>

      {/* Agent status banner */}
      {agentStatus === 'agent-down' && (
        <div style={{
          padding: '8px 14px', borderBottom: '1px solid #303744', background: '#2a2320',
          flexShrink: 0,
        }}>
          <div className="flex items-center gap-2" style={{ fontSize: 10, color: '#deb998' }}>
            <AlertTriangle size={10} />
            <span>{t('ai.agentOffline')}</span>
          </div>
          <div style={{ fontSize: 9, color: '#d9c1a5', marginTop: 4, background: '#1e1815', padding: '4px 6px', borderRadius: 4, border: '1px solid #5c4837' }}>
            {t('ai.agentOfflineHelp')}
          </div>
        </div>
      )}

      {/* Memory stats */}
      <div style={{
        padding: '6px 14px', borderBottom: '1px solid #303744',
        display: 'flex', gap: 12, background: '#14181e', flexShrink: 0,
      }}>
        <div className="flex items-center gap-1" style={{ fontSize: 9, color: '#8893a4' }}>
          <Brain size={8} /> {memoryStats.notes} {t('ai.notes')}
        </div>
        <div className="flex items-center gap-1" style={{ fontSize: 9, color: '#8893a4' }}>
          <Network size={8} /> {memoryStats.connections} {t('ai.links')}
        </div>
        <div className="flex items-center gap-1" style={{ fontSize: 9, color: '#8893a4' }}>
          <Sparkles size={8} /> {memoryStats.tags} {t('ai.tags')}
        </div>
        <div className="flex items-center gap-1" style={{ fontSize: 9, color: aiSettings.internetAccess ? '#9fc59d' : '#8893a4' }}>
          <Globe size={8} /> {aiSettings.internetAccess ? t('ai.webOn') : t('ai.webOff')}
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div style={{ padding: 12, borderBottom: '1px solid #303744', background: '#171b21', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: '#96a1b2', marginBottom: 8, padding: '4px 8px', background: '#1e232b', borderRadius: 4, border: '1px solid #303744' }}>
            {isOllamaMode
              ? t('ai.statusAgentOllama', { model: aiSettings.model })
              : isCloudMode
              ? t('ai.statusAgentCloud', { provider: providerName, model: aiSettings.model })
              : isAgentMode
              ? isApiProvider
                ? t('ai.statusAgentRunningApi', { provider: providerName })
                : t('ai.statusAgentRunningNoOllama')
              : t('ai.statusAgentOffline')}
          </div>
          <ConfigField label={t('ai.provider')}>
            <select value={aiSettings.provider}
              onChange={e => dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { provider: e.target.value as 'ollama' } })}
              style={{ ...inputStyle, fontSize: 11 }}>
              <option value="ollama">{t('common.ollamaLocal')}</option>
            </select>
          </ConfigField>
          {aiSettings.provider === 'ollama' && (
            <ConfigField label={t('ai.ollamaUrl')}>
              <input type="text" value={aiSettings.ollamaUrl}
                onChange={e => dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { ollamaUrl: e.target.value } })}
                style={{ ...inputStyle, fontSize: 11 }} />
            </ConfigField>
          )}
          {isApiProvider && (
            <ConfigField label={t('ai.apiKey')}>
              <input type="password" value={aiSettings.apiKey}
                onChange={e => dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { apiKey: e.target.value } })}
                placeholder={aiSettings.provider === 'openai' ? 'sk-...' : aiSettings.provider === 'gemini' ? 'AIza...' : t('ai.providerApiKeyPlaceholder')}
                style={{ ...inputStyle, fontSize: 11 }} />
            </ConfigField>
          )}
          {aiSettings.provider === 'openai-compatible' && (
            <ConfigField label={t('ai.apiBase')}>
              <input type="text" value={aiSettings.apiBaseUrl}
                onChange={e => dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { apiBaseUrl: e.target.value } })}
                placeholder="https://api.provider.com/v1"
                style={{ ...inputStyle, fontSize: 11 }} />
            </ConfigField>
          )}
          <ConfigField label={t('ai.model')}>
            <select value={aiSettings.model}
              onChange={e => dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { model: e.target.value } })}
              style={{ ...inputStyle, fontSize: 11 }}>
              {models.length === 0
                ? <option value="">{t('common.noModelsFound')}</option>
                : models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </ConfigField>
          <ConfigField label={t('ai.context')}>
            <input type="range" min={2} max={20} value={aiSettings.maxContextNotes}
              onChange={e => dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { maxContextNotes: parseInt(e.target.value) } })}
              style={{ flex: 1, accentColor: '#666' }} />
            <span style={{ fontSize: 10, color: '#555', width: 20, textAlign: 'right' }}>{aiSettings.maxContextNotes}</span>
          </ConfigField>
          <ConfigField label={t('ai.temperature')}>
            <input type="range" min={0} max={200} value={Math.round(aiSettings.temperature * 100)}
              onChange={e => dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { temperature: parseInt(e.target.value) / 100 } })}
              style={{ flex: 1, accentColor: '#666' }} />
            <span style={{ fontSize: 10, color: '#555', width: 30, textAlign: 'right' }}>{aiSettings.temperature.toFixed(2)}</span>
          </ConfigField>
          <ConfigField label={t('ai.maxOutput')}>
            <input type="range" min={64} max={1024} step={32} value={aiSettings.maxOutputTokens}
              onChange={e => dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { maxOutputTokens: parseInt(e.target.value) } })}
              style={{ flex: 1, accentColor: '#666' }} />
            <span style={{ fontSize: 10, color: '#555', width: 36, textAlign: 'right' }}>{aiSettings.maxOutputTokens}</span>
          </ConfigField>
          <ConfigField label={t('ai.internet')}>
            <div onClick={() => dispatch({ type: 'UPDATE_AI_SETTINGS', payload: { internetAccess: !aiSettings.internetAccess } })}
              style={{
                width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
                background: aiSettings.internetAccess ? '#3a5a3a' : '#1a1a1a', position: 'relative',
                transition: 'background 0.2s', border: `1px solid ${aiSettings.internetAccess ? '#4a6a4a' : '#222'}`,
              }}>
              <div style={{
                width: 14, height: 14, borderRadius: 7, background: aiSettings.internetAccess ? '#8c8' : '#444',
                position: 'absolute', top: 2, left: aiSettings.internetAccess ? 18 : 2,
                transition: 'all 0.2s',
              }} />
            </div>
            <span style={{ fontSize: 10, color: aiSettings.internetAccess ? '#6a6' : '#555' }}>
              {aiSettings.internetAccess ? t('ai.enabled') : t('ai.disabled')}
            </span>
          </ConfigField>

          {/* Diagnostics / Health Check */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #282f3a' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#96a1b2', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Activity size={12} style={{ color: '#5b8bf7' }} />
                Agent Health & Diagnostics
              </span>
              <button
                type="button"
                onClick={runHealthCheck}
                disabled={isCheckingHealth}
                style={{
                  fontSize: 10,
                  padding: '4px 8px',
                  borderRadius: 4,
                  background: isCheckingHealth ? '#232934' : '#283244',
                  border: '1px solid #3c4960',
                  color: '#cad5e2',
                  cursor: isCheckingHealth ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'background 0.15s ease',
                }}
              >
                {isCheckingHealth ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                {isCheckingHealth ? 'Diagnosing...' : 'Check Health'}
              </button>
            </div>

            {healthReport && (
              <div style={{
                background: '#13161c',
                borderRadius: 6,
                padding: '8px 10px',
                border: '1px solid #29303c',
                fontSize: 10,
                color: '#abb7c7',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {healthReport.agentRunning ? (
                      <CheckCircle2 size={12} style={{ color: '#4ade80' }} />
                    ) : (
                      <XCircle size={12} style={{ color: '#f87171' }} />
                    )}
                    <strong style={{ color: healthReport.agentRunning ? '#86efac' : '#fca5a5' }}>
                      Python Agent: {healthReport.agentRunning ? 'Running' : 'Offline'}
                    </strong>
                  </span>
                  <span style={{ fontSize: 9, color: '#687385' }}>{healthReport.latencyMs}ms</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 16 }}>
                  {healthReport.ollamaConnected ? (
                    <CheckCircle2 size={11} style={{ color: '#4ade80' }} />
                  ) : (
                    <AlertTriangle size={11} style={{ color: '#fbbf24' }} />
                  )}
                  <span>
                    Ollama Backend: {healthReport.ollamaConnected ? `Connected (${healthReport.ollamaModels?.length || 0} models)` : 'Not Connected'}
                  </span>
                </div>

                {healthReport.agentVersion && (
                  <div style={{ fontSize: 9, color: '#7a8799', marginLeft: 16 }}>
                    Version: v{healthReport.agentVersion} | Python: {healthReport.pythonVersion || 'N/A'}
                  </div>
                )}

                <div style={{
                  marginTop: 3,
                  fontSize: 9.5,
                  padding: '5px 7px',
                  borderRadius: 4,
                  background: healthReport.agentRunning ? '#18241e' : '#271b1b',
                  border: `1px solid ${healthReport.agentRunning ? '#284634' : '#572b2b'}`,
                  color: healthReport.agentRunning ? '#a3e4be' : '#fca5a5',
                  lineHeight: 1.35,
                }}>
                  {healthReport.message}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context preview */}
      {contextPreview && (
        <div style={{ padding: 10, borderBottom: '1px solid #1a1a1a', background: '#030303', maxHeight: 200, overflowY: 'auto', flexShrink: 0 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#666' }}>
              <Brain size={10} style={{ display: 'inline', marginRight: 4 }} />
              {t('ai.aiMemory', { chars: contextPreview.length.toLocaleString() })}
            </span>
            <button onClick={() => setContextPreview(null)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}>
              <X size={10} />
            </button>
          </div>
          <pre style={{ fontSize: 9, color: '#444', whiteSpace: 'pre-wrap', lineHeight: 1.4, fontFamily: 'monospace' }}>
            {contextPreview}
          </pre>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesContainerRef} onScroll={handleMessagesScroll} style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', overscrollBehavior: 'contain' }} className="flint-scrollbar">
        {aiMessages.length === 0 && !isStreaming && (
          <div style={{ textAlign: 'center', padding: '24px 10px' }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14, background: '#0f0f0f',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 14px', border: '1px solid #222',
            }}>
              <FlintLogo size={24} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#777', marginBottom: 6 }}>{t('ai.title')}</div>
            <div style={{ fontSize: 11, color: '#444', lineHeight: 1.6, maxWidth: 260, margin: '0 auto 4px' }}>
              {isOllamaMode
                ? t('ai.emptyOllama', { model: aiSettings.model, count: notes.length })
                : isCloudMode
                ? t('ai.emptyCloud', { provider: providerName, count: notes.length })
                : isAgentMode
                ? isApiProvider
                  ? t('ai.emptyAgentApi', { provider: providerName })
                  : t('ai.emptyAgentNoModel')
                : t('ai.emptyBrowser')}
            </div>
            <div className="flex items-center justify-center gap-3" style={{ fontSize: 9, color: '#333', marginBottom: 16 }}>
              <span>{memoryStats.notes} {t('ai.notes')}</span>
              <span>{memoryStats.connections} {t('ai.links')}</span>
              {aiSettings.internetAccess && <span>{t('common.web')}</span>}
            </div>
            {activeNote && (
              <div style={{
                fontSize: 10, color: '#444', padding: '6px 10px',
                background: '#0a0a0a', borderRadius: 6,
                border: '1px solid #1a1a1a', marginBottom: 12,
              }}>
                {t('ai.activeNote', { title: activeNote.title })}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                t('ai.promptListNotes'),
                t('ai.promptConnections'),
                t('ai.promptTopics'),
                t('ai.promptSummarize'),
                t('ai.promptHelp'),
              ].map(q => (
                <button key={q} onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  style={{
                    padding: '8px 12px', background: '#0a0a0a', border: '1px solid #1a1a1a',
                    borderRadius: 6, color: '#555', cursor: 'pointer', fontSize: 11, textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#111'; e.currentTarget.style.color = '#888'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#0a0a0a'; e.currentTarget.style.color = '#555'; }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {aiMessages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: 14 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
              {msg.role === 'user' ? (
                <div style={{ width: 18, height: 18, borderRadius: 4, background: '#141414', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <User size={10} style={{ color: '#555' }} />
                </div>
              ) : (
                <div style={{ width: 18, height: 18, borderRadius: 4, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FlintLogo size={10} />
                </div>
              )}
              <span style={{ fontSize: 10, color: '#444', fontWeight: 500 }}>
                {msg.role === 'user' ? t('ai.you') : t('ai.title')}
              </span>
              <span style={{ fontSize: 9, color: '#222' }}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              {msg.webResults && (
                <span className="flex items-center gap-1" style={{ fontSize: 9, color: '#465' }}>
                  <Globe size={8} /> {t('ai.webBadge')}
                </span>
              )}
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 12, lineHeight: 1.7,
              background: msg.role === 'user' ? '#0c0c0c' : '#0a0a0a',
              border: `1px solid ${msg.role === 'user' ? '#181818' : '#141414'}`,
              color: msg.role === 'user' ? '#aaa' : '#999',
            }}>
              <MessageContent text={msg.content} />
            </div>
          </div>
        ))}

        {isStreaming && streamContent && (
          <div style={{ marginBottom: 14 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FlintLogo size={10} />
              </div>
              <span style={{ fontSize: 10, color: '#444', fontWeight: 500 }}>{t('ai.title')}</span>
              <Loader2 size={9} className="animate-spin" style={{ color: '#444' }} />
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 12, lineHeight: 1.7,
              background: '#0a0a0a', border: '1px solid #141414', color: '#999',
            }}>
              <MessageContent text={streamContent} />
              <span style={{ display: 'inline-block', width: 6, height: 14, background: '#555', marginLeft: 2, animation: 'blink 1s infinite', verticalAlign: 'text-bottom' }} />
            </div>
          </div>
        )}

        {isStreaming && !streamContent && (
          <div style={{ marginBottom: 14 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FlintLogo size={10} />
              </div>
              <span style={{ fontSize: 10, color: '#444', fontWeight: 500 }}>{t('ai.title')}</span>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#0a0a0a', border: '1px solid #141414' }}>
              <div className="flex items-center gap-3">
                <Loader2 size={12} className="animate-spin" style={{ color: '#444' }} />
                <span style={{ fontSize: 11, color: '#444' }}>
                  <Zap size={9} style={{ display: 'inline', marginRight: 4 }} />
                  {isOllamaMode
                    ? t('ai.thinkingModel', { model: aiSettings.model })
                    : isCloudMode
                    ? t('ai.thinkingProvider', { provider: providerName })
                    : isAgentMode
                    ? t('ai.processingAgent')
                    : t('ai.searchingNotes', { count: memoryStats.notes })}
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Active note indicator */}
      <div style={{ padding: '5px 14px', borderTop: '1px solid #1a1a1a', flexShrink: 0, background: '#050505' }}>
        <div style={{ fontSize: 9, color: '#333', display: 'flex', alignItems: 'center', gap: 6 }}>
          {activeNote && (
            <span className="flex items-center gap-1">
              <BookOpen size={8} /> {activeNote.title}
            </span>
          )}
          {aiSettings.internetAccess && (
            <span className="flex items-center gap-1" style={{ color: '#345' }}>
              <Globe size={8} /> {t('ai.internetOn')}
            </span>
          )}
        </div>
      </div>

      {/* Input area — ALWAYS enabled */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #1a1a1a', flexShrink: 0, background: '#060606' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isOllamaMode
                ? t('ai.placeholderOllama')
                : isCloudMode
                ? t('ai.placeholderCloud', { provider: providerName })
                : isAgentMode
                ? t('ai.placeholderAgent')
                : t('ai.placeholderBrowser')
            }
            rows={2}
            style={{
              flex: 1, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 6,
              padding: '8px 10px', color: '#aaa', fontSize: 12, resize: 'none',
              outline: 'none', fontFamily: 'inherit', lineHeight: 1.4,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {isStreaming ? (
              <button onClick={stopGeneration} title={t('ai.stop')}
                style={{ ...sendBtnStyle, background: '#1a0808', color: '#844' }}>
                <Loader2 size={14} />
              </button>
            ) : (
              <button onClick={sendMessage} title={t('ai.send')}
                disabled={!input.trim()}
                style={{
                  ...sendBtnStyle,
                  opacity: !input.trim() ? 0.3 : 1,
                }}>
                <Send size={14} />
              </button>
            )}
            <button onClick={() => dispatch({ type: 'CLEAR_AI_MESSAGES' })} title={t('ai.clearChat')}
              style={{ ...sendBtnStyle, color: '#444' }}>
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageContent({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <div key={i} style={{ fontSize: 12, fontWeight: 700, color: '#bbb', marginTop: 6 }}>{line.slice(4)}</div>;
        if (line.startsWith('## ')) return <div key={i} style={{ fontSize: 13, fontWeight: 700, color: '#ccc', marginTop: 8 }}>{line.slice(3)}</div>;
        if (line.startsWith('# ')) return <div key={i} style={{ fontSize: 14, fontWeight: 700, color: '#ddd', marginTop: 8 }}>{line.slice(2)}</div>;
        if (line.startsWith('```')) return <div key={i} style={{ height: 4 }} />;
        const boldParsed = line.replace(/\*\*(.+?)\*\*/g, '<<BOLD>>$1<</BOLD>>');
        const codeParsed = boldParsed.replace(/`(.+?)`/g, '<<CODE>>$1<</CODE>>');
        const linkParsed = codeParsed.replace(/\[\[(.+?)\]\]/g, '<<LINK>>$1<</LINK>>');
        if (linkParsed.startsWith('- ') || linkParsed.startsWith('* ')) {
          return <div key={i} style={{ paddingLeft: 8 }}><RichText text={linkParsed.slice(2)} /></div>;
        }
        const numMatch = linkParsed.match(/^(\d+)\.\s/);
        if (numMatch) {
          return <div key={i} style={{ paddingLeft: 8 }}><RichText text={linkParsed} /></div>;
        }
        if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
        return <div key={i}><RichText text={linkParsed} /></div>;
      })}
    </>
  );
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(<<BOLD>>.*?<<\/BOLD>>|<<CODE>>.*?<<\/CODE>>|<<LINK>>.*?<<\/LINK>>)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('<<BOLD>>')) {
          return <strong key={i} style={{ color: '#ccc' }}>{part.replace(/<<BOLD>>|<\/BOLD>>/g, '')}</strong>;
        }
        if (part.startsWith('<<CODE>>')) {
          return <code key={i} style={{ background: '#181818', padding: '1px 4px', borderRadius: 3, fontSize: 11, color: '#888' }}>{part.replace(/<<CODE>>|<\/CODE>>/g, '')}</code>;
        }
        if (part.startsWith('<<LINK>>')) {
          return <span key={i} style={{ color: '#888', textDecoration: 'underline' }}>{part.replace(/<<LINK>>|<\/LINK>>/g, '')}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function ConfigField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 10, color: '#555', width: 70, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0a0a0a', border: '1px solid #1a1a1a',
  borderRadius: 4, padding: '5px 8px', color: '#aaa', outline: 'none',
  fontFamily: 'inherit',
};

const sendBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 6, background: '#111',
  border: '1px solid #1a1a1a', color: '#666', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'all 0.15s', flexShrink: 0,
};
