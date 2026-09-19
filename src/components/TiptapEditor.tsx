import { useRef, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { WikilinkDecoration } from './tiptap/WikilinkDecoration';
import { SlashCommand } from './tiptap/SlashCommand';
import { useStore } from '../store';
import { getHandle, writeMarkdownFile } from '../services/filesystem';

export function TiptapEditor({ noteId }: { noteId: string }) {
  const { state, dispatch } = useStore();
  const note = state.notes.find(n => n.id === noteId);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const currentNote = note;
      if (currentNote && fsTimer.current) clearTimeout(fsTimer.current);
      fsTimer.current = setTimeout(() => {
        saveToFS(val, currentNote?.title || 'Untitled');
      }, 2000);
    }, 500);
  }, [dispatch, noteId, note, saveToFS]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      WikilinkDecoration,
      SlashCommand,
    ],
    content: note?.content || '',
    editorProps: {
      attributes: {
        class: 'flint-tiptap-editor prose prose-invert max-w-none focus:outline-none',
        style: 'min-height: 100%;',
      },
    },
    onUpdate: ({ editor }) => {
      // @ts-ignore
      let markdown = editor.storage.markdown.getMarkdown();
      
      // Fix: tiptap-markdown escapes plain text brackets. Unescape them for wikilinks.
      markdown = markdown.replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]');
      
      save(markdown);
    },
  });

  // Handle note switch
  const prevNoteId = useRef(noteId);
  useEffect(() => {
    if (editor && prevNoteId.current !== noteId) {
      editor.commands.setContent(note?.content || '');
      prevNoteId.current = noteId;
    }
  }, [noteId, note?.content, editor]);

  // Listen for formatting events from toolbar
  useEffect(() => {
    const handler = (e: Event) => {
      if (!editor) return;
      const ce = e as CustomEvent;
      const fmt = ce.detail?.type as string;

      switch (fmt) {
        case 'bold': editor.chain().focus().toggleBold().run(); break;
        case 'italic': editor.chain().focus().toggleItalic().run(); break;
        case 'heading': editor.chain().focus().toggleHeading({ level: 2 }).run(); break;
        case 'quote': editor.chain().focus().toggleBlockquote().run(); break;
        case 'code': editor.chain().focus().toggleCodeBlock().run(); break;
        case 'list': editor.chain().focus().toggleBulletList().run(); break;
        case 'wikilink': {
          editor.chain().focus().insertContent('[[note]]').run();
          break;
        }
      }
    };

    window.addEventListener('flint-format', handler);
    return () => window.removeEventListener('flint-format', handler);
  }, [editor]);

  // CSS for Editor (specifically for tiptap)
  useEffect(() => {
    const styleId = 'tiptap-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .flint-tiptap-editor {
          width: 100%; min-height: 100%;
          background: linear-gradient(180deg, rgba(255,255,255,0.015), transparent 240px);
          color: var(--text);
          border: none; outline: none; resize: none;
          padding: 32px 48px;
          font-size: 15px; line-height: 1.8;
          font-family: inherit;
          caret-color: var(--accent-hover);
        }
        .flint-tiptap-editor p { margin: 0.6em 0; }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #555;
          pointer-events: none;
          height: 0;
        }
        .wiki-link {
          color: #bbb;
          text-decoration: none;
          cursor: pointer;
          border-bottom: 1px dashed rgba(255,255,255,0.2);
          transition: all 0.15s;
        }
        .wiki-link:hover {
          color: #fff; border-bottom-color: #888; background: rgba(255,255,255,0.04); border-radius: 2px;
        }
        .ProseMirror ul {
          list-style-type: disc;
          padding-left: 24px; margin: 0.5em 0;
        }
        .ProseMirror ol {
          list-style-type: decimal;
          padding-left: 24px; margin: 0.5em 0;
        }
        .ProseMirror li { margin: 0.2em 0; }
        .ProseMirror li::marker { color: var(--text-muted); }
        .ProseMirror h1 { font-size: 2em; margin: 0.8em 0 0.4em; font-weight: 700; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
        .ProseMirror h2 { font-size: 1.5em; margin: 0.8em 0 0.4em; font-weight: 600; }
        .ProseMirror h3 { font-size: 1.25em; margin: 0.6em 0 0.3em; font-weight: 600; color: var(--text-secondary); }
        .ProseMirror h4 { font-size: 1.1em; margin: 0.5em 0 0.3em; font-weight: 600; color: var(--text-secondary); }
        .ProseMirror pre { background: #050505; padding: 16px; border: 1px solid var(--border); border-radius: 6px; font-family: 'JetBrains Mono', 'Fira Code', monospace; margin: 1em 0; overflow-x: auto; }
        .ProseMirror code { background: #111; padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.9em; color: #ccc; }
        .ProseMirror pre code { background: none; padding: 0; color: var(--text); }
        .ProseMirror blockquote { border-left: 3px solid #333; padding: 4px 16px; color: var(--text-secondary); background: rgba(255,255,255,0.02); border-radius: 0 4px 4px 0; margin: 0.8em 0; }
        .ProseMirror hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
        .ProseMirror strong { font-weight: 600; color: var(--text); }
        .ProseMirror em { font-style: italic; color: var(--text-secondary); }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Handle clicking wikilinks within the editor
  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('.wiki-link');
    if (link) {
      const title = link.getAttribute('data-target');
      if (title) {
        const found = state.notes.find(n => n.title.toLowerCase() === title.toLowerCase());
        if (found) dispatch({ type: 'OPEN_TAB', payload: found.id });
      }
    }
  };

  if (!note) return null;

  return (
    <div className="flex-1 min-h-0 overflow-auto flint-note-scroll" onClick={handleClick}>
      <EditorContent editor={editor} className="min-h-full" />
    </div>
  );
}


