import { useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { getHandle, writeMarkdownFile } from '../services/filesystem';
import { useTranslation } from 'react-i18next';

export function Editor({ noteId }: { noteId: string }) {
  const { t } = useTranslation();
  const { state, dispatch } = useStore();
  const note = state.notes.find(n => n.id === noteId);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (taRef.current && note) {
      if (taRef.current.value !== note.content) taRef.current.value = note.content;
    }
  }, [noteId, note]);

  const saveToFS = useCallback(async (content: string, noteTitle: string) => {
    if (!state.activeVaultId || !state.hasFolderHandle) return;
    try {
      const handle = await getHandle(state.activeVaultId);
      if (handle) {
        await writeMarkdownFile(handle, noteTitle, content);
      }
    } catch (e) {
      console.warn('Failed to save to file system:', e);
    }
  }, [state.activeVaultId, state.hasFolderHandle]);

  const save = useCallback((val: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      dispatch({ type: 'UPDATE_NOTE', payload: { id: noteId, content: val } });
      // Also save to file system with a longer debounce
      const currentNote = note;
      if (currentNote && fsTimer.current) clearTimeout(fsTimer.current);
      fsTimer.current = setTimeout(() => {
        saveToFS(val, currentNote?.title || 'Untitled');
      }, 2000);
    }, 500);
  }, [dispatch, noteId, note, saveToFS]);

  const handleChange = (val: string) => { save(val); };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = taRef.current!;
      const s = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = s + 2;
      handleChange(ta.value);
    }
  };

  const insertAtCursor = useCallback((text: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    const next = val.substring(0, start) + text + val.substring(end);
    ta.value = next;
    const caret = start + text.length;
    ta.selectionStart = caret;
    ta.selectionEnd = caret;
    ta.focus();
    handleChange(next);
  }, [handleChange]);

  const handleDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (e.dataTransfer.types.includes('text/flint-note-title') || e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const title = e.dataTransfer.getData('text/flint-note-title');
    if (title) {
      insertAtCursor(`[[${title}]]`);
      return;
    }
    const text = e.dataTransfer.getData('text/plain');
    if (!text) return;
    if (/^\[\[[^\]]+\]\]$/.test(text.trim())) {
      insertAtCursor(text.trim());
    }
  };

  // Listen for formatting events from toolbar
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      const ta = taRef.current;
      if (!ta) return;
      const fmt = ce.detail?.type as string;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const selected = val.substring(start, end);
      const before = val.substring(0, start);
      const after = val.substring(end);

      let newVal = val;
      let cursorStart = start;
      let cursorEnd = end;

      switch (fmt) {
        case 'bold': {
          newVal = before + '**' + selected + '**' + after;
          cursorStart = start + 2;
          cursorEnd = end + 2;
          break;
        }
        case 'italic': {
          newVal = before + '*' + selected + '*' + after;
          cursorStart = start + 1;
          cursorEnd = end + 1;
          break;
        }
        case 'heading': {
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          const lineEnd = val.indexOf('\n', end);
          const line = val.substring(lineStart, lineEnd === -1 ? val.length : lineEnd);
          const prefix = line.startsWith('# ') ? '' : '# ';
          newVal = val.substring(0, lineStart) + prefix + line + val.substring(lineEnd === -1 ? val.length : lineEnd);
          cursorStart = start + (line.startsWith('# ') ? -2 : 2);
          cursorEnd = end + (line.startsWith('# ') ? -2 : 2);
          break;
        }
        case 'quote': {
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          const lineEnd = val.indexOf('\n', end);
          const line = val.substring(lineStart, lineEnd === -1 ? val.length : lineEnd);
          const prefix = line.startsWith('> ') ? '' : '> ';
          newVal = val.substring(0, lineStart) + prefix + line + val.substring(lineEnd === -1 ? val.length : lineEnd);
          cursorStart = start + (line.startsWith('> ') ? -2 : 2);
          cursorEnd = end + (line.startsWith('> ') ? -2 : 2);
          break;
        }
        case 'code': {
          if (selected.includes('\n')) {
            newVal = before + '```\n' + selected + '\n```' + after;
            cursorStart = start + 4;
            cursorEnd = end + 4;
          } else {
            newVal = before + '`' + selected + '`' + after;
            cursorStart = start + 1;
            cursorEnd = end + 1;
          }
          break;
        }
        case 'link': {
          const text = selected || 'link text';
          newVal = before + '[' + text + '](url)' + after;
          cursorStart = start + 1;
          cursorEnd = start + 1 + text.length;
          break;
        }
        case 'list': {
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          const lineEnd = val.indexOf('\n', end);
          const line = val.substring(lineStart, lineEnd === -1 ? val.length : lineEnd);
          const prefix = line.startsWith('- ') ? '' : '- ';
          newVal = val.substring(0, lineStart) + prefix + line + val.substring(lineEnd === -1 ? val.length : lineEnd);
          cursorStart = start + (line.startsWith('- ') ? -2 : 2);
          cursorEnd = end + (line.startsWith('- ') ? -2 : 2);
          break;
        }
        case 'tag': {
          newVal = before + '#' + selected + after;
          cursorStart = start + 1;
          cursorEnd = end + 1;
          break;
        }
        case 'wikilink': {
          const text = selected || 'note name';
          newVal = before + '[[' + text + ']]' + after;
          cursorStart = start + 2;
          cursorEnd = start + 2 + text.length;
          break;
        }
      }

      ta.value = newVal;
      ta.selectionStart = cursorStart;
      ta.selectionEnd = cursorEnd;
      ta.focus();
      handleChange(newVal);
    };

    window.addEventListener('flint-format', handler);
    return () => window.removeEventListener('flint-format', handler);
  }, [noteId]);

  if (!note) return null;

  return (
    <textarea ref={taRef} className="flint-editor flint-note-scroll"
      defaultValue={note.content}
      onChange={e => handleChange(e.target.value)}
      onKeyDown={handleKey}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      placeholder={t('editor.startWriting')}
      spellCheck={false}
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
    />
  );
}
