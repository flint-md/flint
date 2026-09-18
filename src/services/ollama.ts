import type { Note, AIAction, AISettings } from '../types';

const AGENT_URL = 'http://127.0.0.1:5100';
const DEFAULT_OLLAMA = 'http://127.0.0.1:11434';


function timeout(ms: number) {
  return new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
}

// ── Status Checks ──────────────────────────────────────────

export async function checkOllamaStatus(url: string): Promise<'connected' | 'disconnected'> {
  try {
    const res = await Promise.race([
      fetch(`${AGENT_URL}/status`, { method: 'GET' }),
      timeout(3000),
    ]);
    const data = await (res as Response).json();
    return data.status === 'connected' ? 'connected' : 'disconnected';
  } catch {
    // Try direct Ollama
    try {
      const ollamaUrl = url || DEFAULT_OLLAMA;
      const res = await Promise.race([
        fetch(`${ollamaUrl}/api/tags`, { method: 'GET' }),
        timeout(3000),
      ]);
      return (res as Response).ok ? 'connected' : 'disconnected';
    } catch {
      return 'disconnected';
    }
  }
}

export async function fetchOllamaModels(url: string): Promise<string[]> {
  // Try agent first
  try {
    const res = await Promise.race([
      fetch(`${AGENT_URL}/models`),
      timeout(3000),
    ]);
    const data = await (res as Response).json();
    if (data.models && data.models.length > 0) return data.models;
  } catch { /* agent not running */ }

  // Try direct Ollama
  try {
    const ollamaUrl = url || DEFAULT_OLLAMA;
    const res = await Promise.race([
      fetch(`${ollamaUrl}/api/tags`),
      timeout(3000),
    ]);
    if ((res as Response).ok) {
      const data = await (res as Response).json();
      return (data.models || []).map((m: { name: string }) => m.name);
    }
  } catch { /* ollama not running */ }

  return [];
}

export interface AgentHealthReport {
  agentRunning: boolean;
  agentUrl: string;
  agentVersion?: string;
  pythonVersion?: string;
  ollamaConnected: boolean;
  ollamaUrl?: string;
  ollamaModels?: string[];
  ollamaError?: string;
  capabilities?: string[];
  latencyMs: number;
  message: string;
}

export async function checkAgentStatus(): Promise<boolean> {
  try {
    const res = await Promise.race([
      fetch(`${AGENT_URL}/status`),
      timeout(5000),
    ]);
    return (res as Response).ok;
  } catch {
    return false;
  }
}

export async function checkAgentHealthDetails(customOllamaUrl?: string): Promise<AgentHealthReport> {
  const start = Date.now();
  try {
    const res = await Promise.race([
      fetch(`${AGENT_URL}/health`),
      timeout(4000),
    ]) as Response;

    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = await res.json();
      const ollamaConnected = data.ollama?.connected ?? false;
      const modelCount = data.ollama?.models?.length ?? 0;
      return {
        agentRunning: true,
        agentUrl: AGENT_URL,
        agentVersion: data.version,
        pythonVersion: data.python_version,
        ollamaConnected,
        ollamaUrl: data.ollama?.url,
        ollamaModels: data.ollama?.models ?? [],
        ollamaError: data.ollama?.error,
        capabilities: data.capabilities ?? [],
        latencyMs,
        message: ollamaConnected
          ? `Agent is healthy and connected to Ollama (${modelCount} model${modelCount === 1 ? '' : 's'} available).`
          : `Python agent is active, but Ollama was not detected on ${data.ollama?.url || DEFAULT_OLLAMA}. Start Ollama if you wish to use local LLMs.`,
      };
    }

    return {
      agentRunning: false,
      agentUrl: AGENT_URL,
      ollamaConnected: false,
      latencyMs,
      message: `Agent returned HTTP error ${res.status}.`,
    };
  } catch {
    const latencyMs = Date.now() - start;
    // Check if Ollama is running directly
    try {
      const ollamaUrl = customOllamaUrl || DEFAULT_OLLAMA;
      const oRes = await Promise.race([
        fetch(`${ollamaUrl}/api/tags`),
        timeout(2500),
      ]) as Response;
      if (oRes.ok) {
        const oData = await oRes.json();
        const models = (oData.models || []).map((m: { name: string }) => m.name);
        return {
          agentRunning: false,
          agentUrl: AGENT_URL,
          ollamaConnected: true,
          ollamaUrl,
          ollamaModels: models,
          latencyMs,
          message: `Python agent is offline on port 5100, but Ollama is running directly on ${ollamaUrl} with ${models.length} model(s). Run 'npm run agent' for vault memory features.`,
        };
      }
    } catch {
      // Ollama also offline
    }

    return {
      agentRunning: false,
      agentUrl: AGENT_URL,
      ollamaConnected: false,
      latencyMs,
      message: `Python agent is not running (http://127.0.0.1:5100). Run 'npm run agent' in your terminal to start the agent.`,
    };
  }
}


// ── Memory Context Preview ─────────────────────────────────

export function buildMemoryContext(
  notes: Note[],
  activeNoteId: string | null,
  query: string,
  maxNotes: number,
  openNoteIds: string[] = [],
): string {
  if (!notes.length) return 'No notes available.';

  const queryTokens = query.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) || [];
  const lines: string[] = [];
  lines.push(`Vault: ${notes.length} notes`);
  if (openNoteIds.length) {
    const openTitles = openNoteIds
      .map(id => notes.find(note => note.id === id)?.title)
      .filter(Boolean)
      .slice(0, 8);
    if (openTitles.length) lines.push(`Open notes: ${openTitles.join(', ')}`);
  }

  const connections: string[] = [];
  const noteTitleMap = new Map(notes.map(n => [n.title.toLowerCase(), n.title]));

  notes.forEach(n => {
    const matches = n.content.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g);
    for (const m of matches) {
      const targetTitle = noteTitleMap.get(m[1].toLowerCase());
      if (targetTitle && targetTitle !== n.title) {
        connections.push(`"${n.title}" → "${targetTitle}"`);
      }
    }
  });

  if (connections.length > 0) {
    lines.push(`\n${connections.length} connections:`);
    connections.slice(0, 18).forEach(c => lines.push(`  ${c}`));
  }

  const ranked = [...notes]
    .map(note => {
      const content = `${note.title}\n${note.content}`.toLowerCase();
      const title = note.title.toLowerCase();
      let score = note.id === activeNoteId ? 8 : 0;
      score += openNoteIds.includes(note.id) ? 5 : 0;
      queryTokens.forEach(token => {
        if (title.includes(token)) score += 6;
        if (content.includes(token)) score += 3;
      });
      score += Math.min((note.content.match(/\[\[/g) || []).length, 6);
      return { note, score };
    })
    .sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt)
    .slice(0, Math.max(3, maxNotes));

  lines.push('\nRelevant note memory:');
  ranked.forEach(({ note }) => {
    const summary = note.content
      .split('\n')
      .map(line => line.trim())
      .find(line => line && !line.startsWith('#')) || note.content.slice(0, 140);
    lines.push(`- ${note.id === activeNoteId ? '[active] ' : ''}${note.title}: ${summary.slice(0, 180)}`);
  });

  lines.push(`\nQuery: "${query}"`);
  return lines.join('\n');
}

// ============================================================
// Main Chat Function — 3-Level Fallback
// ============================================================

export async function askFlintAI(
  userQuery: string,
  notes: Note[],
  activeNoteId: string | null,
  openNoteIds: string[],
  settings: AISettings,
  chatHistory: { role: string; content: string }[],
  onChunk: (chunk: string) => void,
  onDone: (fullContent: string, webResults?: string, usedOllama?: boolean, actions?: AIAction[]) => void,
  onError: (err: string) => void,
): Promise<void> {

  const notesData = notes.map(n => ({
    id: n.id,
    title: n.title,
    content: n.content,
  }));

  const body = {
    query: userQuery,
    notes: notesData,
    activeNoteId,
    settings: {
      provider: settings.provider,
      model: settings.model,
      ollamaUrl: settings.ollamaUrl || DEFAULT_OLLAMA,
      apiKey: settings.apiKey,
      apiBaseUrl: settings.apiBaseUrl,
      maxOutputTokens: settings.maxOutputTokens,
      temperature: settings.temperature,
      maxContextNotes: settings.maxContextNotes,
      internetAccess: settings.internetAccess,
      systemPrompt: settings.systemPrompt,
    },
    history: chatHistory,
    openNoteIds,
  };

  let fullContent = '';

  // ── Level 1: Try Python Agent ──────────────────────────
  try {
    console.log('[Flint AI] Trying Python agent...');
    const response = await Promise.race([
      fetch(`${AGENT_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      timeout(120000),
    ]) as Response;

    if (!response.ok) throw new Error(`Agent error ${response.status}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No stream');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const data = JSON.parse(jsonStr);
          if (data.content) {
            fullContent += data.content;
            onChunk(data.content);
          }
          if (data.done) {
            if (data.error && !fullContent) {
              onError(data.error);
            } else {
              onDone(fullContent, data.webResults || undefined, data.usedOllama ?? true, data.actions || undefined);
            }
            return;
          }
        } catch { /* skip bad json */ }
      }
    }

    if (fullContent) {
      onDone(fullContent, undefined, true);
      return;
    }
    throw new Error('Empty response from agent');
  } catch (agentErr) {
    console.warn('[Flint AI] Agent failed:', agentErr instanceof Error ? agentErr.message : agentErr);
  }

  // ── Level 2: Try Direct Ollama ─────────────────────────
  if (settings.provider === 'ollama' && settings.model) {
    try {
      console.log('[Flint AI] Trying direct Ollama with model:', settings.model);
      const ollamaUrl = settings.ollamaUrl || DEFAULT_OLLAMA;

      // Build a simple system prompt with note context
      const memoryLines = buildMemoryContext(notes, activeNoteId, userQuery, settings.maxContextNotes, openNoteIds);
      const systemContent = `${settings.systemPrompt}\n\n${memoryLines}`;

      const messages = [
        { role: 'system', content: systemContent },
        ...chatHistory.slice(-8).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userQuery },
      ];

      const response = await Promise.race([
        fetch(`${ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: settings.model,
            messages,
            stream: true,
            options: { temperature: settings.temperature, num_ctx: 8192 },
          }),
        }),
        timeout(120000),
      ]) as Response;

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Ollama error ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            const content = data.message?.content || '';
            if (content) {
              fullContent += content;
              onChunk(content);
            }
            if (data.done) {
              onDone(fullContent, undefined, true);
              return;
            }
          } catch { /* skip */ }
        }
      }

      if (fullContent) {
        onDone(fullContent, undefined, true);
        return;
      }
      throw new Error('Empty response from Ollama');
    } catch (ollamaErr) {
      const msg = ollamaErr instanceof Error ? ollamaErr.message : String(ollamaErr);
      console.warn('[Flint AI] Direct Ollama failed:', msg);

      // If we got a specific model error, report it
      if (msg.includes('not found') || msg.includes('model')) {
        onError(`Model "${settings.model}" not found. Run: ollama pull ${settings.model}`);
        return;
      }
    }
  }

  // ── Level 3: Browser Built-in Fallback ──────────────────
  console.log('[Flint AI] Using browser built-in fallback');
  fullContent = '';
  const builtin = getBuiltinResponse(userQuery, notes, activeNoteId, openNoteIds);
  const chars = builtin.content.split('');
  let idx = 0;

  const streamBuiltin = () => {
    if (idx < chars.length) {
      const batch = chars.slice(idx, idx + 2).join('');
      fullContent += batch;
      onChunk(batch);
      idx += 2;
      setTimeout(streamBuiltin, 10);
    } else {
      onDone(fullContent, undefined, false, builtin.actions);
    }
  };
  streamBuiltin();
}

// ============================================================
// Built-in Browser Fallback
// ============================================================

function getBuiltinResponse(
  query: string,
  notes: Note[],
  activeNoteId: string | null,
  openNoteIds: string[],
): { content: string; actions?: AIAction[] } {
  const q = query.toLowerCase().trim();
  const noteMap = new Map(notes.map(n => [n.id, n]));
  const activeNote = noteMap.get(activeNoteId || '');
  const openNotes = openNoteIds.map(id => noteMap.get(id)).filter(Boolean) as Note[];
  const editableIds = new Set(openNoteIds);

  const resolveEditableNote = (label: string | null | undefined): Note | null => {
    if (!label) return activeNote || openNotes[0] || null;
    const lowered = label.toLowerCase().trim();
    if (['active', 'current', 'open'].includes(lowered)) return activeNote || openNotes[0] || null;
    const direct = notes.find(n => n.title.toLowerCase() === lowered);
    if (!direct) return null;
    return editableIds.has(direct.id) ? direct : null;
  };

  const rankNotes = (terms: string[]) => {
    return [...notes]
      .map(note => {
        const haystack = `${note.title}\n${note.content}`.toLowerCase();
        let score = note.id === activeNoteId ? 3 : 0;
        score += editableIds.has(note.id) ? 2 : 0;
        for (const term of terms) {
          if (note.title.toLowerCase().includes(term)) score += 5;
          if (haystack.includes(term)) score += 2;
        }
        return { note, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt)
      .map(item => item.note);
  };

  const greetingMatch = q.match(/^\s*(hi|hello|hey|yo|good (morning|afternoon|evening))\b/);
  if (greetingMatch) {
    const noteCount = notes.length;
    return { content: activeNote
      ? `Hi. You are viewing "${activeNote.title}". I can help edit notes, summarize them, or find links. You have ${noteCount} notes.`
      : `Hi. I can help edit notes, summarize them, or find links. You have ${noteCount} notes.` };
  }

  if (q === 'reply' || q === 'replay' || q.includes('reply to this')) {
    return { content: activeNote
      ? `I’m on the active note "${activeNote.title}". Tell me what change you want.`
      : 'Tell me which note you want to work on.' };
  }

  if (q.includes('help') || q === '?') {
    return { content: 'I can answer across all notes, summarize your vault, search links and tags, and perform note actions inside the open-note sandbox.' };
  }

  const shortIntent = (text: string) => /^(summarize|summary|list|show|find|search|rename|update|edit|create|delete|remove|add|what|how)\b/.test(text);
  if (!shortIntent(q) && q.length <= 24) {
    return { content: activeNote
      ? `Ask me to summarize, edit, rename, or find links in "${activeNote.title}".`
      : 'Ask me to summarize, edit, rename, or find links in your notes.' };
  }

  const renameMatch = query.match(/rename\s+(?:the\s+)?(?:(current|active|open)\s+note|note\s+"([^"]+)"|note\s+([^\n]+?))\s+to\s+"?([^"\n]+)"?/i);
  if (renameMatch) {
    const target = resolveEditableNote(renameMatch[1] || renameMatch[2] || renameMatch[3]);
    if (!target) {
      return { content: 'I can only rename notes that are currently open in Flint. Open the note first, then ask again.' };
    }
    return {
      content: `Renaming "${target.title}" to "${renameMatch[4].trim()}".`,
      actions: [{ type: 'rename_note', target: 'id', noteId: target.id, title: renameMatch[4].trim() }],
    };
  }

  const deleteMatch = query.match(/(?:delete|remove)\s+(?:the\s+)?(?:(current|active|open)\s+note|note\s+"([^"]+)"|note\s+([^\n]+))/i);
  if (deleteMatch) {
    const target = resolveEditableNote(deleteMatch[1] || deleteMatch[2] || deleteMatch[3]);
    if (!target) {
      return { content: 'I can only delete notes that are open in Flint right now.' };
    }
    return {
      content: `Deleting "${target.title}" inside the current workspace sandbox.`,
      actions: [{ type: 'delete_note', target: 'id', noteId: target.id }],
    };
  }

  const createMatch = query.match(/create\s+(?:a\s+)?note(?:\s+called|\s+named)?\s+"?([^"\n]+)"?(?:\s+(?:about|with)\s+([\s\S]+))?/i);
  if (createMatch) {
    const title = createMatch[1].trim();
    const body = createMatch[2]?.trim();
    return {
      content: `Creating note "${title}".`,
      actions: [{ type: 'create_note', title, content: body ? `# ${title}\n\n${body}\n` : `# ${title}\n\n` }],
    };
  }

  const appendMatch = query.match(/(?:append|add)\s+([\s\S]+?)\s+to\s+(?:the\s+)?(?:(current|active|open)\s+note|note\s+"([^"]+)"|note\s+([^\n]+))/i);
  if (appendMatch) {
    const target = resolveEditableNote(appendMatch[2] || appendMatch[3] || appendMatch[4]);
    if (!target) {
      return { content: 'I can only edit notes that are open in Flint. Open the note you want me to change first.' };
    }
    const addition = appendMatch[1].trim().replace(/^["']|["']$/g, '');
    return {
      content: `Adding that text to "${target.title}".`,
      actions: [{ type: 'update_note', target: 'id', noteId: target.id, content: `${target.content.trimEnd()}\n\n${addition}\n` }],
    };
  }

  const replaceMatch = query.match(/(?:replace|set|update)\s+(?:the\s+)?(?:(current|active|open)\s+note|note\s+"([^"]+)"|note\s+([^\n]+))\s+(?:with|to)\s+([\s\S]+)/i);
  if (replaceMatch) {
    const target = resolveEditableNote(replaceMatch[1] || replaceMatch[2] || replaceMatch[3]);
    if (!target) {
      return { content: 'I can only update notes that are open in Flint right now.' };
    }
    const nextContent = replaceMatch[4].trim().replace(/^["']|["']$/g, '');
    return {
      content: `Updating "${target.title}" inside the workspace sandbox.`,
      actions: [{ type: 'update_note', target: 'id', noteId: target.id, content: nextContent }],
    };
  }

  // Build graph
  const graph = new Map<string, Set<string>>();
  const noteTitleIdMap = new Map(notes.map(n => [n.title.toLowerCase(), n.id]));

  notes.forEach(n => graph.set(n.id, new Set()));
  notes.forEach(n => {
    const matches = n.content.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g);
    for (const m of matches) {
      const targetId = noteTitleIdMap.get(m[1].toLowerCase());
      if (targetId && targetId !== n.id) {
        graph.get(n.id)!.add(targetId);
        graph.get(targetId)!.add(n.id);
      }
    }
  });

  const totalConns = [...graph.values()].reduce((sum, s) => sum + s.size, 0) / 2;

  // Help
  if (q.includes('what can you')) {
    return { content: 'I can summarize your whole vault, search across note memory, inspect graph links, and edit only the notes that are open in Flint.' };
  }

  // List notes
  if ((q.includes('list') || q.includes('show') || q.includes('what')) && (q.includes('note') || q.includes('all') || q.includes('everything'))) {
    if (!notes.length) return { content: 'Your vault is empty. Create some notes!' };
    const rankedNotes = [...notes].sort((a, b) => (graph.get(b.id)?.size || 0) - (graph.get(a.id)?.size || 0));
    let resp = `You have ${notes.length} notes and ${totalConns} connections. Top notes:\n`;
    rankedNotes.slice(0, 8).forEach(n => {
      const conns = graph.get(n.id)?.size || 0;
      resp += `- ${n.title} (${conns} link${conns !== 1 ? 's' : ''})\n`;
    });
    return { content: resp };
  }

  // Connections
  if (q.includes('connection') || q.includes('graph') || q.includes('link')) {
    const connected = [...graph.entries()].filter(([, c]) => c.size > 0);
    if (!connected.length) return { content: 'No connections yet. Use `[[Note Name]]` to link notes together!' };
    let resp = `${connected.length} notes have connections. Top links:\n`;
    connected.sort((a, b) => b[1].size - a[1].size);
    for (const [nid, conns] of connected.slice(0, 8)) {
      const names = [...conns].map(id => noteMap.get(id)?.title).filter(Boolean);
      resp += `- ${noteMap.get(nid)?.title}: ${names.join(', ')}\n`;
    }
    return { content: resp };
  }

  // Tags
  if (q.includes('tag')) {
    const allTags = new Map<string, string[]>();
    notes.forEach(n => {
      const tagMatches = n.content.matchAll(/#(\w[\w-]*)/g);
      for (const m of tagMatches) {
        const tag = m[1];
        if (!allTags.has(tag)) allTags.set(tag, []);
        allTags.get(tag)!.push(n.title);
      }
    });
    if (!allTags.size) return { content: 'No tags found. Use `#tag` to categorize notes.' };
    let resp = `${allTags.size} tags found. Top tags:\n`;
    for (const [tag, noteList] of [...allTags.entries()].slice(0, 8)) {
      resp += `- #${tag} (${noteList.length} note${noteList.length > 1 ? 's' : ''}): ${noteList.join(', ')}\n`;
    }
    return { content: resp };
  }

  // Summarize
  if (q.includes('summarize') || q.includes('summary')) {
    if (!notes.length) return { content: 'Nothing to summarize — vault is empty.' };
    const ranked = rankNotes(q.match(/[a-z0-9][a-z0-9_-]*/g) || []).slice(0, 8);
    const picked = ranked.length ? ranked : notes.slice(0, 8);
    let resp = `Vault summary: ${notes.length} notes, ${totalConns} connections, ${openNotes.length} open notes. Key notes:\n`;
    picked.forEach(n => {
      const firstLine = n.content.split('\n').find(l => l.trim() && !l.startsWith('#')) || '';
      resp += `- ${n.title}: ${firstLine.slice(0, 90)}${firstLine.length > 90 ? '...' : ''}\n`;
    });
    return { content: resp };
  }

  // Search by keywords
  const words = q.replace(/[?.,!]/g, '').split(/\s+/).filter(w => w.length > 2);
  const matched = notes.filter(n => {
    const content = (n.title + ' ' + n.content).toLowerCase();
    return words.some(w => content.includes(w));
  });

  if (matched.length > 0) {
    let resp = activeNote
      ? `Viewing "${activeNote?.title}". Related notes:\n`
      : `Found ${matched.length} relevant notes:\n`;

    matched.slice(0, 5).forEach(n => {
      const conns = [...(graph.get(n.id) || [])].map(id => noteMap.get(id)?.title).filter(Boolean);
      resp += `- ${n.title}${conns.length ? ` (linked to ${conns.join(', ')})` : ''}\n`;
      const paragraphs = n.content.split('\n\n').filter(p => p.trim());
      const relevant = paragraphs.filter(p => words.some(w => p.toLowerCase().includes(w))).slice(0, 1);
      const snippet = (relevant.length ? relevant : paragraphs.slice(0, 1))[0] || '';
      resp += `  ${snippet.slice(0, 160)}${snippet.length > 160 ? '...' : ''}\n`;
    });

    if (matched.length > 5) resp += `...and ${matched.length - 5} more.\n`;
    resp += `\nFound across ${notes.length} notes with ${totalConns} connections.`;
    return { content: resp };
  }

  // Default
  let resp = `I couldn't find a direct match for "${query}".\n`;
  if (notes.length > 0) {
    resp += 'Try one of these notes:\n';
    notes.slice(0, 6).forEach(n => { resp += `- ${n.title}\n`; });
    if (notes.length > 6) resp += `...and ${notes.length - 6} more\n`;
  }
  resp += 'Ask for summarize, list notes, links, rename, or update note.';
  return { content: resp };
}
