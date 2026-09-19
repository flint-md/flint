import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import { FlintLogo } from './FlintLogo';
import { Grip, RotateCcw, Search, X, Plus, Type, Trash2, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CanvasCard } from '../types';

// Persistence

function getCanvasKey(vaultId: string | null) {
  return `flint-canvas-state-${vaultId || 'default'}`;
}

interface CanvasConnection {
  id: string;
  fromCard: string;
  toCard: string;
  fromSide: 'top' | 'right' | 'bottom' | 'left';
  toSide: 'top' | 'right' | 'bottom' | 'left';
  color?: string;
}

interface CanvasPersistedState {
  connections: CanvasConnection[];
}

function loadCanvasState(vaultId: string | null): CanvasPersistedState {
  try {
    const raw = localStorage.getItem(getCanvasKey(vaultId));
    return raw ? JSON.parse(raw) : { connections: [] };
  } catch {
    return { connections: [] };
  }
}

function saveCanvasState(vaultId: string | null, data: CanvasPersistedState) {
  try {
    localStorage.setItem(getCanvasKey(vaultId), JSON.stringify(data));
  } catch {
    // ignore
  }
}

// Card color palette

const CARD_COLORS = [
  { label: 'Default', border: '#2e2e2e', glow: '' },
  { label: 'Red',     border: '#e5555a', glow: 'rgba(229,85,90,0.2)' },
  { label: 'Orange',  border: '#e68a00', glow: 'rgba(230,138,0,0.2)' },
  { label: 'Yellow',  border: '#c9b400', glow: 'rgba(201,180,0,0.2)' },
  { label: 'Green',   border: '#43a047', glow: 'rgba(67,160,71,0.2)' },
  { label: 'Cyan',    border: '#00acc1', glow: 'rgba(0,172,193,0.2)' },
  { label: 'Purple',  border: '#7f6df2', glow: 'rgba(127,109,242,0.2)' },
  { label: 'Pink',    border: '#e040a0', glow: 'rgba(224,64,160,0.2)' },
];

// Connection colors

const CONN_COLORS = [
  '#56728c', // 1. Slate steel blue (default!)
  '#7f6df2', // 2. Purple
  '#e5555a', // 3. Red
  '#43a047', // 4. Green
  '#00acc1', // 5. Cyan
  '#e68a00', // 6. Orange
  '#c9b400', // 7. Yellow
  '#e040a0', // 8. Pink
  '#dcddde', // 9. Slate Gray
];

// Helpers

type Side = 'top' | 'right' | 'bottom' | 'left';

function getSidePt(card: CanvasCard, side: Side) {
  switch (side) {
    case 'top':    return { x: card.x + card.w / 2,  y: card.y };
    case 'bottom': return { x: card.x + card.w / 2,  y: card.y + card.h };
    case 'left':   return { x: card.x,               y: card.y + card.h / 2 };
    case 'right':  return { x: card.x + card.w,      y: card.y + card.h / 2 };
  }
}

function getBestSides(from: CanvasCard, to: CanvasCard) {
  const sides: Side[] = ['top', 'right', 'bottom', 'left'];
  let bestDist = Infinity;
  let bestFrom: Side = 'right';
  let bestTo: Side = 'left';
  for (const sf of sides) {
    const pf = getSidePt(from, sf);
    for (const st of sides) {
      const pt = getSidePt(to, st);
      const d = Math.hypot(pf.x - pt.x, pf.y - pt.y);
      if (d < bestDist) {
        bestDist = d;
        bestFrom = sf;
        bestTo = st;
      }
    }
  }
  return { fromSide: bestFrom, toSide: bestTo };
}

function getControlPt(pt: { x: number; y: number }, side: Side, offset: number) {
  switch (side) {
    case 'top': return { x: pt.x, y: pt.y - offset };
    case 'bottom': return { x: pt.x, y: pt.y + offset };
    case 'left': return { x: pt.x - offset, y: pt.y };
    case 'right': return { x: pt.x + offset, y: pt.y };
  }
}

// Physics-enhanced dynamic curved bezier calculation to prevent overlapping loops
function smartBezier(
  p1: { x: number; y: number }, s1: Side,
  p2: { x: number; y: number }, s2: Side | null
) {
  if (!s2) {
    // Free drag mode
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);
    const offset = Math.min(dist * 0.4, 75);
    const c1 = getControlPt(p1, s1, offset);
    return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${p2.x} ${p2.y}, ${p2.x} ${p2.y}`;
  }

  // Active connected line mode (Enhanced Organic Bends)
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  
  let offset1 = Math.min(dist * 0.35, 120);
  let offset2 = Math.min(dist * 0.35, 120);

  // If cards are very close, decrease stiffness to prevent overlapping loops
  if (dist < 120) {
    offset1 = dist * 0.22;
    offset2 = dist * 0.22;
  }

  const c1 = getControlPt(p1, s1, offset1);
  const c2 = getControlPt(p2, s2, offset2);

  return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
}

function isPointInsideCard(mx: number, my: number, card: CanvasCard, padding: number = 0): boolean {
  return mx >= card.x - padding && mx <= card.x + card.w + padding &&
         my >= card.y - padding && my <= card.y + card.h + padding;
}

function findNearestAnchor(
  mx: number, my: number,
  cards: CanvasCard[], excludeId: string,
  snapRadius: number
): { cardId: string; side: Side; pt: { x: number; y: number } } | null {
  const sides: Side[] = ['top', 'right', 'bottom', 'left'];
  let best: { cardId: string; side: Side; pt: { x: number; y: number } } | null = null;
  let bestDist = Infinity;

  for (const card of cards) {
    if (card.id === excludeId || card.id.startsWith('frame')) continue;

    // Full-card-body snap: if mouse is inside or near the card, snap to nearest border anchor
    const isInsideOrNear = isPointInsideCard(mx, my, card, snapRadius);
    if (!isInsideOrNear) {
      // Also check traditional radius-based proximity to side midpoints
      for (const side of sides) {
        const pt = getSidePt(card, side);
        const d = Math.hypot(mx - pt.x, my - pt.y);
        if (d < snapRadius && d < bestDist) {
          bestDist = d;
          best = { cardId: card.id, side, pt };
        }
      }
      continue;
    }

    // Mouse is inside/near the card — find the nearest anchor side
    for (const side of sides) {
      const pt = getSidePt(card, side);
      const d = Math.hypot(mx - pt.x, my - pt.y);
      if (d < bestDist) {
        bestDist = d;
        best = { cardId: card.id, side, pt };
      }
    }
  }
  return best;
}

interface HistoryState {
  cards: CanvasCard[];
  connections: CanvasConnection[];
  cardColors: Record<string, number>;
}

interface LineContextMenu {
  connId: string;
  x: number;
  y: number;
}

interface CardContextMenu {
  cardId: string;
  x: number;
  y: number;
}

// Sub-component for drag and drop image cards

interface ImageCardBodyProps {
  card: CanvasCard;
  zoom: number;
  updateCard: (id: string, updates: Partial<CanvasCard>) => void;
  pushHistorySnapshot: () => void;
}

function ImageCardBody({ card, zoom, updateCard, pushHistorySnapshot }: ImageCardBodyProps) {
  const { t } = useTranslation();
  const [isDragHover, setIsDragHover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | undefined) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          pushHistorySnapshot();
          updateCard(card.id, { content: e.target.result as string });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  if (card.content) {
    return (
      <div 
        style={{ 
          position: 'relative', 
          width: '100%', 
          height: '100%', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: '#09090b',
          overflow: 'hidden',
          borderRadius: '0 0 6px 6px',
        }}
      >
        <img
          src={card.content}
          alt={t('canvas.pngAlt')}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
          }}
        />
        {/* Hover overlay to change the loaded image */}
        <div 
          className="image-overlay-layer"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            opacity: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'opacity 0.15s ease',
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <span style={{ color: '#fff', fontSize: 11 / zoom, fontWeight: 500, background: 'rgba(0,0,0,0.6)', padding: '4px 10px', borderRadius: 4 }}>
            {t('canvas.changeImage')}
          </span>
        </div>
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <style>{`
          .image-overlay-layer { opacity: 0; }
          div:hover > .image-overlay-layer { opacity: 1 !important; }
        `}</style>
      </div>
    );
  }

  return (
    <div
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setIsDragHover(true); }}
      onDragLeave={() => setIsDragHover(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragHover(false); handleFile(e.dataTransfer.files?.[0]); }}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: `2px dashed ${isDragHover ? '#7f6df2' : '#2e2e31'}`,
        background: isDragHover ? 'rgba(127,109,242,0.06)' : 'rgba(0,0,0,0.15)',
        borderRadius: 6,
        margin: 6,
        padding: 16,
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'all 0.15s ease',
      }}
    >
      <svg 
        width={22 / zoom} 
        height={22 / zoom} 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke={isDragHover ? '#7f6df2' : '#555558'} 
        strokeWidth="1.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ marginBottom: 6, transition: 'stroke 0.15s' }}
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      <span style={{ fontSize: 11 / zoom, color: isDragHover ? '#7f6df2' : '#b3b3b3', fontWeight: 500, display: 'block', marginBottom: 2 }}>
        {t('canvas.dragDropImage')}
      </span>
      <span style={{ fontSize: 9.5 / zoom, color: '#666668' }}>
        {t('canvas.orClickToBrowse')}
      </span>
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}

// Main component

export function CanvasView() {
  const { t } = useTranslation();
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  
  const dragRef = useRef<{ 
    id: string; 
    offsetX: number; 
    offsetY: number; 
    enclosedCardIds?: string[]; 
  } | null>(null);
  
  const resizeRef = useRef<{ id: string; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const canvasDragRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const connDragRef = useRef<{
    fromCard: string;
    fromSide: Side;
    mx: number;
    my: number;
    toSide: Side | null;
  } | null>(null);
  
  const [connDrag, setConnDrag] = useState<{
    fromCard: string;
    fromSide: Side;
    mx: number;
    my: number;
    toSide: Side | null;
  } | null>(null);
  
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [snapTarget, setSnapTarget] = useState<{ cardId: string; side: Side } | null>(null);
  const [selectedConnColor, setSelectedConnColor] = useState<string>(CONN_COLORS[0]); // Soft steel blue default
  const [hoveredConn, setHoveredConn] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);
  
  // Custom right click context menus state
  const [lineContextMenu, setLineContextMenu] = useState<LineContextMenu | null>(null);
  const [cardContextMenu, setCardContextMenu] = useState<CardContextMenu | null>(null);
  
  // Dynamic Option Toggles
  const [showArrows, setShowArrows] = useState(true);
  
  // Note adding dropdown
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [noteSearch, setNoteSearch] = useState('');

  const activeVaultId = state.activeVaultId;
  const [connections, setConnections] = useState<CanvasConnection[]>(
    () => loadCanvasState(activeVaultId).connections
  );

  useEffect(() => {
    saveCanvasState(activeVaultId, { connections });
  }, [connections, activeVaultId]);

  const workspace = activeVaultId ? state.vaultData[activeVaultId] : null;
  const cards = workspace?.canvasCards || [];

  const [cardColors, setCardColors] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(`flint-canvas-colors-${activeVaultId || 'default'}`);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        `flint-canvas-colors-${activeVaultId || 'default'}`,
        JSON.stringify(cardColors)
      );
    } catch {}
  }, [cardColors, activeVaultId]);

  // Close context menus on any outside click
  useEffect(() => {
    const closeMenus = () => {
      setLineContextMenu(null);
      setCardContextMenu(null);
    };
    window.addEventListener('click', closeMenus);
    window.addEventListener('contextmenu', closeMenus);
    return () => {
      window.removeEventListener('click', closeMenus);
      window.removeEventListener('contextmenu', closeMenus);
    };
  }, []);

  // Undo and redo history

  const [undoStack, setUndoStack] = useState<HistoryState[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryState[]>([]);

  const pushHistorySnapshot = useCallback(() => {
    setUndoStack(prev => {
      const next = [...prev, { cards, connections, cardColors }];
      // Keep safety limit of 50 states
      if (next.length > 50) return next.slice(1);
      return next;
    });
    setRedoStack([]); // Reset redo stack on new action
  }, [cards, connections, cardColors]);

  const updateCards = useCallback((newCards: CanvasCard[]) => {
    dispatch({ type: 'UPDATE_CANVAS_CARDS', payload: newCards });
  }, [dispatch]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    
    setRedoStack(r => [...r, { cards, connections, cardColors }]);
    setUndoStack(u => u.slice(0, -1));
    
    updateCards(prev.cards);
    setConnections(prev.connections);
    setCardColors(prev.cardColors);
  }, [undoStack, cards, connections, cardColors, updateCards]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    
    setUndoStack(u => [...u, { cards, connections, cardColors }]);
    setRedoStack(r => r.slice(0, -1));
    
    updateCards(next.cards);
    setConnections(next.connections);
    setCardColors(next.cardColors);
  }, [redoStack, cards, connections, cardColors, updateCards]);

  // Use refs so that global keyboard listener has always-fresh closures without rebuilding listeners
  const undoRef = useRef(handleUndo);
  const redoRef = useRef(handleRedo);
  const deleteCardRef = useRef<(id: string) => void>(() => {});
  const selectedCardRef = useRef<string | null>(null);

  useEffect(() => {
    undoRef.current = handleUndo;
    redoRef.current = handleRedo;
    selectedCardRef.current = selectedCard;
  });

  const filteredCards = useMemo(() => {
    if (!query.trim()) return cards;
    const q = query.toLowerCase();
    return cards.filter(card => {
      if (card.type === 'note' && card.noteId) {
        const note = state.notes.find(n => n.id === card.noteId);
        return note && (
          note.title.toLowerCase().includes(q) ||
          note.content.toLowerCase().includes(q)
        );
      }
      return card.content?.toLowerCase().includes(q);
    });
  }, [cards, query, state.notes]);

  const wikilinkEdges = useMemo(() => {
    // Build a map from noteId -> cardId for cards on the canvas
    const noteIdToCardId = new Map<string, string>();
    filteredCards.forEach(c => {
      if (c.type === 'note' && c.noteId) noteIdToCardId.set(c.noteId, c.id);
    });
    const noteTitleIdMap = new Map(state.notes.map(note => [note.title.toLowerCase(), note.id] as [string, string]));
    const pairs = new Set<string>();
    const list: Array<{ from: string; to: string }> = [];
    filteredCards.forEach(card => {
      if (card.type !== 'note' || !card.noteId) return;
      const note = state.notes.find(n => n.id === card.noteId);
      if (!note) return;
      const matches = note.content.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g);
      for (const match of matches) {
        const targetNoteId = noteTitleIdMap.get(match[1].toLowerCase());
        if (!targetNoteId || targetNoteId === note.id) continue;
        // Map note IDs to canvas card IDs
        const fromCardId = noteIdToCardId.get(note.id);
        const toCardId = noteIdToCardId.get(targetNoteId);
        if (!fromCardId || !toCardId) continue;
        const key = [fromCardId, toCardId].sort().join('::');
        if (pairs.has(key)) continue;
        pairs.add(key);
        list.push({ from: fromCardId, to: toCardId });
      }
    });
    return list;
  }, [filteredCards, state.notes]);

  const updateCard = (id: string, updates: Partial<CanvasCard>) => {
    updateCards(cards.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const addTextCard = () => {
    pushHistorySnapshot();
    const newCard: CanvasCard = {
      id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'text',
      content: '',
      x: Math.round(((window.innerWidth / 2 - pan.x) / zoom) / 20) * 20,
      y: Math.round(((window.innerHeight / 2 - pan.y) / zoom) / 20) * 20,
      w: 260,
      h: 180,
    };
    updateCards([...cards, newCard]);
    setSelectedCard(newCard.id);
  };

  const addNoteCard = (noteId: string) => {
    pushHistorySnapshot();
    const newCard: CanvasCard = {
      id: `note-card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'note',
      noteId,
      x: Math.round(((window.innerWidth / 2 - pan.x) / zoom) / 20) * 20,
      y: Math.round(((window.innerHeight / 2 - pan.y) / zoom) / 20) * 20,
      w: 280,
      h: 220,
    };
    updateCards([...cards, newCard]);
    setSelectedCard(newCard.id);
    setNotePickerOpen(false);
  };

  const addImageCard = () => {
    pushHistorySnapshot();
    const newCard: CanvasCard = {
      id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'text', // Safe fallback typing
      content: '', // Holds Base64 Image string
      x: Math.round(((window.innerWidth / 2 - pan.x) / zoom) / 20) * 20,
      y: Math.round(((window.innerHeight / 2 - pan.y) / zoom) / 20) * 20,
      w: 280,
      h: 220,
    };
    updateCards([...cards, newCard]);
    setSelectedCard(newCard.id);
  };

  const deleteCard = useCallback((id: string) => {
    pushHistorySnapshot();
    updateCards(cards.filter(c => c.id !== id));
    setConnections(prev => prev.filter(c => c.fromCard !== id && c.toCard !== id));
    setCardColors(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (colorPickerOpen === id) setColorPickerOpen(null);
    if (selectedCardRef.current === id) setSelectedCard(null);
  }, [cards, colorPickerOpen, pushHistorySnapshot, updateCards]);

  useEffect(() => {
    deleteCardRef.current = deleteCard;
  }, [deleteCard]);

  const deleteConnection = useCallback((id: string) => {
    pushHistorySnapshot();
    setConnections(prev => prev.filter(c => c.id !== id));
    if (hoveredConn === id) setHoveredConn(null);
  }, [hoveredConn, pushHistorySnapshot]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC cancels current operations
      if (e.key === 'Escape') {
        if (connDragRef.current) {
          connDragRef.current = null;
          setConnDrag(null);
          setSnapTarget(null);
        }
        setSelectedCard(null);
        setColorPickerOpen(null);
        setNotePickerOpen(false);
        setLineContextMenu(null);
        setCardContextMenu(null);
      }
      
      // Delete card with Backspace or Delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCardRef.current) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        deleteCardRef.current(selectedCardRef.current);
      }

      // Undo with Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        if (e.shiftKey) {
          redoRef.current();
        } else {
          undoRef.current();
        }
      }

      // Redo with Ctrl+Y / Cmd+Y
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        redoRef.current();
      }
    };
    
    const handleContextMenu = (e: MouseEvent) => {
      if (connDragRef.current) {
        e.preventDefault();
        connDragRef.current = null;
        setConnDrag(null);
        setSnapTarget(null);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      // Dragging card or Frame (Smooth movement!)
      const targetId = dragRef.current.id;
      const isFrame = targetId.startsWith('frame');
      
      const rawX = (e.clientX - pan.x - dragRef.current.offsetX) / zoom;
      const rawY = (e.clientY - pan.y - dragRef.current.offsetY) / zoom;
      
      const nextX = Math.round(rawX / 20) * 20;
      const nextY = Math.round(rawY / 20) * 20;
      
      const frameCard = cards.find(c => c.id === targetId);
      if (frameCard) {
        const deltaX = nextX - frameCard.x;
        const deltaY = nextY - frameCard.y;
        
        if (isFrame && dragRef.current.enclosedCardIds && dragRef.current.enclosedCardIds.length > 0) {
          // If moving a Frame, translate all enclosed note/text/image cards accordingly!
          const enclosedSet = new Set(dragRef.current.enclosedCardIds);
          const updated = cards.map(c => {
            if (c.id === targetId) {
              return { ...c, x: nextX, y: nextY };
            }
            if (enclosedSet.has(c.id)) {
              return { ...c, x: c.x + deltaX, y: c.y + deltaY };
            }
            return c;
          });
          updateCards(updated);
        } else {
          // Normal drag
          updateCard(targetId, { x: nextX, y: nextY });
        }
      }
    } else if (resizeRef.current) {
      // Resizing card
      const dx = (e.clientX - resizeRef.current.startX) / zoom;
      const dy = (e.clientY - resizeRef.current.startY) / zoom;
      const newW = Math.round((resizeRef.current.startW + dx) / 20) * 20;
      const newH = Math.round((resizeRef.current.startH + dy) / 20) * 20;
      updateCard(resizeRef.current.id, {
        w: Math.max(160, newW),
        h: Math.max(80, newH)
      });
    } else if (canvasDragRef.current) {
      // Panning Canvas (Left click empty background dragging - Ultra smooth!)
      setPan({
        x: e.clientX - canvasDragRef.current.x,
        y: e.clientY - canvasDragRef.current.y,
      });
    } else if (connDragRef.current) {
      // Dragging connection line — generous snap radius for full-card detection
      const rect = containerRef.current!.getBoundingClientRect();
      const mx = (e.clientX - rect.left - pan.x) / zoom;
      const my = (e.clientY - rect.top - pan.y) / zoom;
      
      const anchor = findNearestAnchor(mx, my, filteredCards, connDragRef.current.fromCard, 40 / zoom);
      if (anchor) {
        connDragRef.current = { ...connDragRef.current, mx: anchor.pt.x, my: anchor.pt.y, toSide: anchor.side };
        setSnapTarget({ cardId: anchor.cardId, side: anchor.side });
      } else {
        connDragRef.current = { ...connDragRef.current, mx, my, toSide: null };
        setSnapTarget(null);
      }
      setConnDrag({ ...connDragRef.current });
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (connDragRef.current) {
      const rect = containerRef.current!.getBoundingClientRect();
      const mx = (e.clientX - rect.left - pan.x) / zoom;
      const my = (e.clientY - rect.top - pan.y) / zoom;
      const anchor = findNearestAnchor(mx, my, filteredCards, connDragRef.current.fromCard, 40 / zoom);
      if (anchor && anchor.cardId !== connDragRef.current.fromCard) {
        pushHistorySnapshot(); // Snapshot connections before adding
        const newConn: CanvasConnection = {
          id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          fromCard: connDragRef.current.fromCard,
          toCard: anchor.cardId,
          fromSide: connDragRef.current.fromSide,
          toSide: anchor.side,
          color: selectedConnColor,
        };
        setConnections(prev => [...prev, newConn]);
      }
      setSnapTarget(null);
    }
    dragRef.current = null;
    resizeRef.current = null;
    canvasDragRef.current = null;
    connDragRef.current = null;
    setConnDrag(null);
    if (containerRef.current) containerRef.current.style.cursor = 'default';
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    setColorPickerOpen(null);
    setSelectedCard(null);
    setNotePickerOpen(false);
    
    // Left click, middle click, or right click on background now pans the canvas seamlessly!
    canvasDragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = containerRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      const newZoom = Math.max(0.15, Math.min(4, zoom * delta));
      setPan(p => ({
        x: mx - (mx - p.x) * (newZoom / zoom),
        y: my - (my - p.y) * (newZoom / zoom),
      }));
      setZoom(newZoom);
    } else {
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  const resetLayout = () => {
    if (confirm(t('canvas.resetConfirm'))) {
      pushHistorySnapshot();
      updateCards([]);
      setConnections([]);
      setCardColors({});
      setPan({ x: 0, y: 0 });
      setZoom(1);
    }
  };

  // Zoom helpers
  const zoomIn = () => setZoom(z => Math.min(4, z * 1.15));
  const zoomOut = () => setZoom(z => Math.max(0.15, z / 1.15));
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const findCard = (id: string) => filteredCards.find(c => c.id === id);

  const accentColor = '#7f6df2'; // Purple accent
  const canvasBg = '#0f0f11'; // Dark canvas background
  const cardBg = '#18181a'; // Dark matte card background
  const cardBgActive = '#1d1d21'; // Highlighted card background
  const cardBorderDefault = '#2a2a2c'; // Extremely subtle border
  const textPrimary = '#e3e3e3'; // Main text
  const textSecondary = '#b3b3b3'; // Gray text
  const textMuted = '#666668'; // Muted dark grey

  // Note Search Filtering
  const filteredNotes = useMemo(() => {
    if (!noteSearch.trim()) return state.notes;
    return state.notes.filter(note => 
      note.title.toLowerCase().includes(noteSearch.toLowerCase()) ||
      note.content.toLowerCase().includes(noteSearch.toLowerCase())
    );
  }, [state.notes, noteSearch]);

  const renderConnections = () => {
    const allEdges: JSX.Element[] = [];
    
    // Wiki links relationships between notes
    wikilinkEdges.forEach(edge => {
      const from = findCard(edge.from);
      const to = findCard(edge.to);
      if (!from || !to) return;
      const { fromSide, toSide } = getBestSides(from, to);
      const p1 = getSidePt(from, fromSide);
      const p2 = getSidePt(to, toSide);
      allEdges.push(
        <g key={`wiki-${edge.from}-${edge.to}`}>
          <path
            d={smartBezier(p1, fromSide, p2, toSide)}
            stroke="rgba(127,109,242,0.22)"
            strokeWidth={1.5 / zoom}
            strokeDasharray={`${6 / zoom} ${4 / zoom}`}
            fill="none"
            style={{ pointerEvents: 'none' }}
          />
        </g>
      );
    });

    // Explicit manual arrow connections
    connections.forEach(conn => {
      const from = findCard(conn.fromCard);
      const to = findCard(conn.toCard);
      if (!from || !to) return;
      // Dynamically recalculate best sides based on current card positions
      // This prevents Bezier curves from cutting through cards when they move
      const { fromSide: dynFromSide, toSide: dynToSide } = getBestSides(from, to);
      const p1 = getSidePt(from, dynFromSide);
      const p2 = getSidePt(to, dynToSide);
      const color = conn.color || CONN_COLORS[0]; // Soothing steel-blue slate color default
      
      allEdges.push(
        <g key={conn.id}>
          {/* Broad transparent path to capture hover & right-click context menu */}
          <path
            d={smartBezier(p1, dynFromSide, p2, dynToSide)}
            stroke="transparent"
            strokeWidth={14 / zoom}
            fill="none"
            style={{ cursor: 'context-menu', pointerEvents: 'stroke' }}
            onMouseEnter={() => setHoveredConn(conn.id)}
            onMouseLeave={() => setHoveredConn(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setLineContextMenu({
                connId: conn.id,
                x: e.clientX,
                y: e.clientY,
              });
            }}
          />
          {/* Main visual connection path with toggled arrows markerEnd */}
          <path
            d={smartBezier(p1, dynFromSide, p2, dynToSide)}
            stroke={color}
            strokeWidth={hoveredConn === conn.id || lineContextMenu?.connId === conn.id ? 2.5 / zoom : 1.8 / zoom}
            fill="none"
            strokeOpacity={0.85}
            markerEnd={showArrows ? `url(#arrow-${color.replace('#', '')})` : undefined}
            style={{ pointerEvents: 'none', transition: 'stroke-width 0.1s ease' }}
          />
        </g>
      );
    });
    
    return allEdges;
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 animate-fade-in overflow-hidden select-none"
      style={{ zIndex: 110, background: canvasBg, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Infinite grid background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.065) 1.2px, transparent 1.2px)`,
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x % (20 * zoom)}px ${pan.y % (20 * zoom)}px`,
          pointerEvents: 'none',
        }}
      />

      {/* Cards viewport layer */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          zIndex: 1,
        }}
        onMouseDown={handleCanvasMouseDown}
      >
        {/* Card and Frame node maps */}
        {filteredCards.map(card => {
          const isNote = card.type === 'note';
          const isImage = card.id.startsWith('image');
          const isFrame = card.id.startsWith('frame');
          
          const note = isNote ? state.notes.find(n => n.id === card.noteId) : null;
          const isActive = isNote && note?.id === state.activeNoteId;
          
          const previewLines = isNote && note
            ? note.content.split('\n').filter(line => line.trim() && !line.startsWith('#')).slice(0, 10).join('\n')
            : '';
            
          const titleLine = isNote && note
            ? note.content.split('\n').find(l => l.startsWith('# '))?.replace(/^# /, '') || note.title
            : isImage
            ? t('canvas.pngAttachment')
            : isFrame
            ? t('canvas.frameGroup')
            : t('canvas.textCard');
            
          const colorIdx = cardColors[card.id] ?? 0;
          const cardColor = CARD_COLORS[colorIdx];
          const isColorPickerOpen = colorPickerOpen === card.id;
          const isSelected = selectedCard === card.id;
          
          const cardBorder = isSelected 
            ? (colorIdx > 0 ? cardColor.border : accentColor)
            : isActive 
            ? accentColor 
            : colorIdx > 0 
            ? cardColor.border 
            : cardBorderDefault;
            
          const edges: Side[] = ['top', 'right', 'bottom', 'left'];
          
          const getAnchorDotStyle = (side: Side): React.CSSProperties => {
            const dotSize = 10 / zoom;
            const isSnapped = snapTarget?.cardId === card.id && snapTarget?.side === side;
            const isSource = connDrag?.fromCard === card.id && connDrag?.fromSide === side;
            const isVisible = hoveredCard === card.id || connDrag !== null;
            const isAnchorActive = isSnapped || isSource;
            const finalSize = isAnchorActive ? dotSize * 1.5 : dotSize;
            
            const dotBorderColor = isAnchorActive ? '#ffffff' : (colorIdx > 0 ? cardColor.border : 'rgba(127,109,242,0.8)');
            const dotBg = isAnchorActive ? accentColor : '#18181a';
            
            const base: React.CSSProperties = {
              position: 'absolute',
              width: finalSize,
              height: finalSize,
              borderRadius: '50%',
              background: dotBg,
              border: `${1.5 / zoom}px solid ${dotBorderColor}`,
              cursor: 'crosshair',
              zIndex: 12,
              opacity: isVisible || isAnchorActive ? 1 : 0,
              transition: 'opacity 0.15s ease, transform 0.1s ease, width 0.1s ease, height 0.1s ease',
              transform: 'translate(-50%, -50%)',
              boxShadow: isAnchorActive
                ? `0 0 ${8 / zoom}px ${accentColor}, 0 0 ${16 / zoom}px rgba(127,109,242,0.4)`
                : `0 2px ${5 / zoom}px rgba(0,0,0,0.5)`,
              pointerEvents: isVisible || isAnchorActive ? 'auto' : 'none',
            };
            if (side === 'top') return { ...base, top: 0, left: '50%' };
            if (side === 'bottom') return { ...base, top: '100%', left: '50%' };
            if (side === 'left') return { ...base, top: '50%', left: 0 };
            return { ...base, top: '50%', left: '100%' };
          };

          return (
            <div
              key={card.id}
              style={{
                position: 'absolute',
                left: card.x,
                top: card.y,
                width: card.w,
                height: card.h,
                // If it is a Frame, render it transparent, glassy, and with a dashed border
                background: isFrame 
                  ? (isSelected ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.005)') 
                  : (isActive ? cardBgActive : cardBg),
                border: isFrame 
                  ? `${isSelected ? 2 : 1.5}px dashed ${isSelected ? accentColor : (colorIdx > 0 ? cardColor.border : '#444448')}`
                  : `${isSelected ? 2 : 1.5}px solid ${cardBorder}`,
                borderRadius: isFrame ? 12 / zoom : 8 / zoom,
                boxShadow: isSelected
                  ? `0 0 0 1px ${cardBorder}40, 0 10px 30px rgba(0,0,0,0.6)`
                  : colorIdx > 0
                  ? `0 4px 20px ${cardColor.glow}, 0 4px 20px rgba(0,0,0,0.4)`
                  : '0 4px 20px rgba(0,0,0,0.4)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'visible',
                transition: 'box-shadow 0.15s ease, border-color 0.15s ease, background-color 0.15s',
                // frames must have lower zIndex and allow clicks inside to fall through
                zIndex: isFrame ? 1 : 2,
                pointerEvents: isFrame ? 'none' : 'auto',
              }}
              onClick={e => {
                e.stopPropagation();
                setSelectedCard(card.id);
                setColorPickerOpen(null);
              }}
              onDoubleClick={() => {
                if (isNote && card.noteId) {
                  dispatch({ type: 'OPEN_TAB', payload: card.noteId });
                }
              }}
              onMouseEnter={() => setHoveredCard(card.id)}
              onMouseLeave={() => { setHoveredCard(null); }}
              // Right-Click on Card opens custom Context Menu to change colors or delete card!
              onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                setSelectedCard(card.id);
                setCardContextMenu({
                  cardId: card.id,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              {/* Connection anchor dots */}
              {!isFrame && edges.map(side => (
                <div
                  key={side}
                  style={getAnchorDotStyle(side)}
                  onMouseDown={e => {
                    e.stopPropagation();
                    e.preventDefault();
                    const fromCard = filteredCards.find(c => c.id === card.id)!;
                    const pt = getSidePt(fromCard, side);
                    connDragRef.current = { fromCard: card.id, fromSide: side, mx: pt.x, my: pt.y, toSide: null };
                    setConnDrag({ fromCard: card.id, fromSide: side, mx: pt.x, my: pt.y, toSide: null });
                  }}
                />
              ))}

              {/* Resizing handles */}
              {isSelected && (
                <>
                  {/* Top-Left handle */}
                  <div style={{ position: 'absolute', top: -4, left: -4, width: 7, height: 7, background: cardBorder, border: '1px solid #fff', borderRadius: 1 }} />
                  {/* Top-Right handle */}
                  <div style={{ position: 'absolute', top: -4, right: -4, width: 7, height: 7, background: cardBorder, border: '1px solid #fff', borderRadius: 1 }} />
                  {/* Bottom-Left handle */}
                  <div style={{ position: 'absolute', bottom: -4, left: -4, width: 7, height: 7, background: cardBorder, border: '1px solid #fff', borderRadius: 1 }} />
                  {/* Bottom-Right active handle */}
                  <div style={{ position: 'absolute', bottom: -4, right: -4, width: 7, height: 7, background: cardBorder, border: '1px solid #fff', borderRadius: 1, zIndex: 11, pointerEvents: 'auto' }} />
                  {/* Top Center handle */}
                  <div style={{ position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)', width: 6, height: 6, background: cardBorder, border: '1px solid #fff', borderRadius: 1 }} />
                  {/* Bottom Center handle */}
                  <div style={{ position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)', width: 6, height: 6, background: cardBorder, border: '1px solid #fff', borderRadius: 1 }} />
                  {/* Left Center handle */}
                  <div style={{ position: 'absolute', left: -4, top: '50%', transform: 'translateY(-50%)', width: 6, height: 6, background: cardBorder, border: '1px solid #fff', borderRadius: 1 }} />
                  {/* Right Center handle */}
                  <div style={{ position: 'absolute', right: -4, top: '50%', transform: 'translateY(-50%)', width: 6, height: 6, background: cardBorder, border: '1px solid #fff', borderRadius: 1 }} />
                </>
              )}

              {/* Card header */}
              <div
                onMouseDown={e => {
                  e.stopPropagation();
                  setSelectedCard(card.id);
                  pushHistorySnapshot(); // Snapshot card position before moving
                  
                  // Compute all card IDs enclosed inside this frame card's box boundaries to translate them as well!
                  const isFrameDrag = card.id.startsWith('frame');
                  const enclosed = isFrameDrag 
                    ? cards.filter(c => c.id !== card.id && c.x >= card.x && (c.x + c.w) <= (card.x + card.w) && c.y >= card.y && (c.y + c.h) <= (card.y + card.h)).map(c => c.id)
                    : [];
                  
                  dragRef.current = {
                    id: card.id,
                    offsetX: e.clientX - pan.x - card.x * zoom,
                    offsetY: e.clientY - pan.y - card.y * zoom,
                    enclosedCardIds: enclosed,
                  };
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: isFrame ? '4px 6px' : '6px 8px',
                  borderBottom: isFrame ? 'none' : '1px solid rgba(255,255,255,0.04)',
                  cursor: 'grab',
                  background: isFrame ? 'none' : 'rgba(0,0,0,0.12)',
                  flexShrink: 0,
                  borderRadius: isFrame ? '11px 11px 0 0' : '7px 7px 0 0',
                  pointerEvents: 'auto', // Re-enable click actions for drag on Frame header
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                  <Grip size={11} style={{ color: textMuted, flexShrink: 0 }} />
                  {isNote ? (
                    <FileText size={11} style={{ color: colorIdx > 0 ? cardColor.border : '#8c7ae6', flexShrink: 0 }} />
                  ) : isImage ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={colorIdx > 0 ? cardColor.border : '#0fbcf9'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  ) : isFrame ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={colorIdx > 0 ? cardColor.border : '#e2b659'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                    </svg>
                  ) : (
                    <Type size={11} style={{ color: colorIdx > 0 ? cardColor.border : '#00a8ff', flexShrink: 0 }} />
                  )}
                  
                  {isFrame ? (
                    // Flat inline editable input for naming Frame Groups
                    <input
                      value={card.content || t('canvas.groupFrame')}
                      onChange={e => updateCard(card.id, { content: e.target.value })}
                      onMouseDown={e => e.stopPropagation()}
                      placeholder={t('canvas.nameFrameGroup')}
                      style={{
                        background: 'none', border: 'none', outline: 'none',
                        color: isSelected ? '#ffffff' : textSecondary, fontSize: 11.5, fontWeight: 600,
                        width: '100%', fontFamily: 'inherit', padding: '2px 0',
                      }}
                    />
                  ) : (
                    <span style={{
                      fontSize: 11, fontWeight: 500,
                      color: isActive ? '#ffffff' : textSecondary,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {titleLine}
                    </span>
                  )}
                </div>
                
                {/* Minimal top card corner details */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: colorIdx > 0 ? cardColor.border : 'rgba(255,255,255,0.12)',
                  }} />
                </div>
              </div>

              {/* Card body content */}
              {/* Frames do not render a content body; they let notes inside them show through */}
              {!isFrame && (
                <div style={{ padding: isImage ? 0 : '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {isNote ? (
                    <div style={{
                      fontSize: 11.5, color: textSecondary, lineHeight: 1.5,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'auto',
                      fontFamily: 'Inter, -apple-system, sans-serif',
                      paddingRight: 4,
                    }} className="canvas-card-scroll">
                      {previewLines ? (
                        previewLines.slice(0, 300) + (previewLines.length > 300 ? '...' : '')
                      ) : (
                        <span style={{ color: textMuted, fontStyle: 'italic' }}>{t('canvas.emptyNoteFile')}</span>
                      )}
                    </div>
                  ) : isImage ? (
                    <ImageCardBody 
                      card={card} 
                      zoom={zoom} 
                      updateCard={updateCard} 
                      pushHistorySnapshot={pushHistorySnapshot} 
                    />
                  ) : (
                    <textarea
                      value={card.content || ''}
                      onChange={e => updateCard(card.id, { content: e.target.value })}
                      onMouseDown={e => e.stopPropagation()}
                      placeholder={t('canvas.writeAnything')}
                      style={{
                        flex: 1, width: '100%', background: 'none', border: 'none', outline: 'none',
                        color: textPrimary, fontSize: 12, resize: 'none',
                        fontFamily: 'Inter, -apple-system, sans-serif',
                        lineHeight: 1.5, minHeight: 60,
                        padding: 0, margin: 0,
                      }}
                    />
                  )}
                </div>
              )}

              {/* Resizing node handle */}
              <div
                onMouseDown={e => {
                  e.stopPropagation(); e.preventDefault();
                  pushHistorySnapshot(); // Snapshot card size before resizing
                  resizeRef.current = { id: card.id, startX: e.clientX, startY: e.clientY, startW: card.w, startH: card.h };
                }}
                style={{
                  position: 'absolute', bottom: 0, right: 0, width: 14, height: 14,
                  cursor: 'nwse-resize', zIndex: 12, opacity: hoveredCard === card.id || isSelected ? 0.75 : 0,
                  transition: 'opacity 0.15s ease', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 2,
                  pointerEvents: 'auto', // Re-enable pointer events for Frame resize handle drag
                }}
              >
                <svg width={7} height={7} viewBox="0 0 10 10">
                  <path d="M9 1L1 9M9 5L5 9" stroke={textMuted} strokeWidth="1.8" strokeLinecap="round" fill="none" />
                </svg>
              </div>
            </div>
          );
        })}
      </div>

      {/* Connection paths layer */}
      <svg
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          pointerEvents: 'none', overflow: 'visible', zIndex: 2,
        }}
      >
        <defs>
          {CONN_COLORS.map(color => (
            <marker
              key={`arrow-${color}`}
              id={`arrow-${color.replace('#', '')}`}
              viewBox="0 0 10 10"
              refX="1"
              refY="5"
              markerWidth={6.5}
              markerHeight={6.5}
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 Z" fill={color} fillOpacity={0.9} />
            </marker>
          ))}
          <marker
            id="arrow-drag-preview"
            viewBox="0 0 10 10"
            refX="1"
            refY="5"
            markerWidth={6.5}
            markerHeight={6.5}
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 Z" fill={accentColor} fillOpacity={0.8} />
          </marker>
        </defs>
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {renderConnections()}
          {/* Connection Drag Preview Path */}
          {connDrag && (() => {
            const fromCard = findCard(connDrag.fromCard);
            if (!fromCard) return null;
            const p1 = getSidePt(fromCard, connDrag.fromSide);
            const p2 = { x: connDrag.mx, y: connDrag.my };
            return (
              <path
                d={smartBezier(p1, connDrag.fromSide, p2, connDrag.toSide)}
                stroke={accentColor}
                strokeWidth={1.8 / zoom}
                strokeDasharray={`${6 / zoom} ${3 / zoom}`}
                fill="none"
                strokeOpacity={0.8}
                markerEnd={showArrows ? 'url(#arrow-drag-preview)' : undefined}
                style={{ pointerEvents: 'none' }}
              />
            );
          })()}
        </g>
      </svg>

      {/* Custom right-click context menu for connection lines */}
      {lineContextMenu && (
        <div
          style={{
            position: 'fixed',
            left: lineContextMenu.x,
            top: lineContextMenu.y,
            background: '#1c1c1e',
            border: '1px solid #2e2e31',
            borderRadius: 6,
            boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
            padding: '4px 0',
            width: 170,
            zIndex: 200,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Option 1: Delete Line */}
          <button
            onClick={() => {
              deleteConnection(lineContextMenu.connId);
              setLineContextMenu(null);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              background: 'none',
              border: 'none',
              color: '#ff5f5f',
              padding: '7px 12px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,95,95,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <Trash2 size={12} />
            <span>{t('canvas.deleteConnection')}</span>
          </button>

          <div style={{ height: 1, background: '#2e2e31', margin: '4px 0' }} />

          {/* Option 2: Change Line Color Grid */}
          <div style={{ padding: '6px 12px' }}>
            <span style={{ fontSize: 10.5, color: textSecondary, fontWeight: 500, display: 'block', marginBottom: 6 }}>{t('canvas.changeColor')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5 }}>
              {CONN_COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => {
                    pushHistorySnapshot();
                    setConnections(prev => prev.map(c => c.id === lineContextMenu.connId ? { ...c, color } : c));
                    setLineContextMenu(null);
                  }}
                  title={t('canvas.changeColorTo', { color })}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: color,
                    border: '1px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                    transition: 'transform 0.1s ease',
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.2)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Custom right-click context menu for note, text, and PNG cards */}
      {cardContextMenu && (
        <div
          style={{
            position: 'fixed',
            left: cardContextMenu.x,
            top: cardContextMenu.y,
            background: '#1c1c1e',
            border: '1px solid #2e2e31',
            borderRadius: 6,
            boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
            padding: '4px 0',
            width: 175,
            zIndex: 200,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Option 1: Remove Card */}
          <button
            onClick={() => {
              deleteCard(cardContextMenu.cardId);
              setCardContextMenu(null);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              background: 'none',
              border: 'none',
              color: '#ff5f5f',
              padding: '7px 12px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,95,95,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <Trash2 size={12} />
            <span>{t('canvas.deleteCard')}</span>
          </button>

          <div style={{ height: 1, background: '#2e2e31', margin: '4px 0' }} />

          {/* Option 2: Change Card Outline Color Preset */}
          <div style={{ padding: '6px 12px' }}>
            <span style={{ fontSize: 10.5, color: textSecondary, fontWeight: 500, display: 'block', marginBottom: 6 }}>{t('canvas.changeCardColor')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
              {CARD_COLORS.map((col, idx) => (
                <button
                  key={col.label}
                  onClick={() => {
                    pushHistorySnapshot();
                    setCardColors(prev => ({ ...prev, [cardContextMenu.cardId]: idx }));
                    setCardContextMenu(null);
                  }}
                  title={`Card color: ${col.label}`}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: idx === 0 ? 'rgba(255,255,255,0.15)' : col.border,
                    border: cardColors[cardContextMenu.cardId] === idx ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                    transition: 'transform 0.1s ease',
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.2)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top header actions panel */}
      <div
        className="flex items-center justify-between"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, padding: '10px 16px',
          background: 'rgba(15,15,17,0.85)', borderBottom: `1px solid #1c1c1f`,
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', zIndex: 30,
        }}
      >
        <div className="flex items-center gap-3">
          <FlintLogo size={14} />
          <span style={{ fontSize: 13, fontWeight: 600, color: textPrimary, letterSpacing: '0.2px' }}>{t('canvas.title')}</span>
          <span style={{
            fontSize: 10.5, color: textSecondary, background: 'rgba(255,255,255,0.03)',
            padding: '2px 8px', borderRadius: 4, border: `1px solid #232326`,
          }}>
            {t('canvas.nodesAndLinks', { nodes: filteredCards.length, edges: wikilinkEdges.length + connections.length })}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Search/Filter Box */}
          <div className="flex items-center gap-2" style={{
            padding: '5px 10px', background: 'rgba(255,255,255,0.025)',
            border: `1px solid #232326`, borderRadius: 6,
          }}>
            <Search size={12} style={{ color: textMuted }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('canvas.filterCanvas')}
              style={{ background: 'none', border: 'none', outline: 'none', color: textPrimary, fontSize: 12, width: 140, fontFamily: 'inherit' }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{ background: 'none', border: 'none', color: textMuted, cursor: 'pointer', padding: 0, display: 'flex' }}
                onMouseEnter={e => e.currentTarget.style.color = textPrimary}
                onMouseLeave={e => e.currentTarget.style.color = textMuted}
              >
                <X size={12} />
              </button>
            )}
          </div>

          <button
            onClick={() => dispatch({ type: 'TOGGLE_CANVAS_VIEW' })}
            style={{ background: 'none', border: 'none', color: textSecondary, cursor: 'pointer', display: 'flex', padding: 5, borderRadius: 4, transition: 'background-color 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = textSecondary; e.currentTarget.style.background = 'none'; }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Bottom center floating toolbar */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          zIndex: 30,
        }}
      >
        {/* Note Adding Search Dropdown Panel (Mounts above button) */}
        {notePickerOpen && (
          <div
            style={{
              width: 320,
              background: '#1d1d20',
              border: '1px solid #333336',
              borderRadius: 8,
              boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.15)', border: '1px solid #2e2e31', borderRadius: 4, padding: '4px 8px' }}>
              <Search size={12} style={{ color: textMuted }} />
              <input
                autoFocus
                placeholder={t('canvas.searchNoteFromVault')}
                value={noteSearch}
                onChange={e => setNoteSearch(e.target.value)}
                style={{ background: 'none', border: 'none', outline: 'none', color: textPrimary, fontSize: 11.5, width: '100%' }}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: 200 }} className="canvas-card-scroll">
              {filteredNotes.length === 0 ? (
                <div style={{ color: textMuted, fontSize: 11, textAlign: 'center', padding: 12, fontStyle: 'italic' }}>{t('canvas.noNotesFound')}</div>
              ) : (
                filteredNotes.map(note => (
                  <button
                    key={note.id}
                    onClick={() => addNoteCard(note.id)}
                    style={{
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 8px',
                      fontSize: 11.5,
                      color: textSecondary,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(127,109,242,0.15)'; e.currentTarget.style.color = '#ffffff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = textSecondary; }}
                  >
                    <FileText size={11} style={{ color: textMuted }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{note.title}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* The main floating control pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(29, 29, 32, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 9999,
            padding: '5px 12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {/* Add Text Card Button */}
          <button
            onClick={addTextCard}
            title={t('canvas.createTextCard')}
            style={{
              background: 'none', border: 'none', color: textSecondary,
              cursor: 'pointer', padding: '6px 12px', borderRadius: 9999, fontSize: 11.5,
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = textSecondary; e.currentTarget.style.background = 'none'; }}
          >
            <Type size={12} />
            <span>{t('canvas.addCard')}</span>
          </button>

          <div style={{ height: 16, width: 1, background: 'rgba(255,255,255,0.08)' }} />

          {/* Add Note Card Button */}
          <button
            onClick={() => { setNotePickerOpen(!notePickerOpen); setNoteSearch(''); }}
            title={t('canvas.addExistingNote')}
            style={{
              background: 'none', border: 'none', color: textSecondary,
              cursor: 'pointer', padding: '6px 12px', borderRadius: 9999, fontSize: 11.5,
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = textSecondary; e.currentTarget.style.background = 'none'; }}
          >
            <FileText size={12} />
            <span>{t('canvas.addNote')}</span>
          </button>

          <div style={{ height: 16, width: 1, background: 'rgba(255,255,255,0.08)' }} />

          {/* Add PNG Image Card Button (Added near Note as requested!) */}
          <button
            onClick={addImageCard}
            title={t('canvas.addImageCard')}
            style={{
              background: 'none', border: 'none', color: textSecondary,
              cursor: 'pointer', padding: '6px 12px', borderRadius: 9999, fontSize: 11.5,
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = textSecondary; e.currentTarget.style.background = 'none'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>{t('canvas.addPng')}</span>
          </button>

          <div style={{ height: 16, width: 1, background: 'rgba(255,255,255,0.08)' }} />

          {/* Active drawing line color picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px' }}>
            <span style={{ fontSize: 10, color: textMuted, marginRight: 2 }}>{t('canvas.line')}</span>
            {CONN_COLORS.slice(0, 5).map(color => (
              <button
                key={color}
                onClick={() => setSelectedConnColor(color)}
                title={t('canvas.lineColorTo', { color })}
                style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: color, border: selectedConnColor === color ? '1.5px solid #fff' : '1px solid rgba(255,255,255,0.1)',
                  padding: 0, cursor: 'pointer', transition: 'transform 0.1s ease',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.2)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              />
            ))}
          </div>

          <div style={{ height: 16, width: 1, background: 'rgba(255,255,255,0.08)' }} />

          {/* Dynamic Arrow Toggle Checkbox */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
            color: textSecondary, cursor: 'pointer', padding: '0 8px', userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={showArrows}
              onChange={e => setShowArrows(e.target.checked)}
              style={{
                cursor: 'pointer', accentColor: '#7f6df2', width: 12, height: 12,
              }}
            />
            <span>{t('canvas.arrows')}</span>
          </label>

          <div style={{ height: 16, width: 1, background: 'rgba(255,255,255,0.08)' }} />

          {/* Clear Canvas Action */}
          <button
            onClick={resetLayout}
            title={t('canvas.resetCanvas')}
            style={{
              background: 'none', border: 'none', color: '#ff5f5f',
              cursor: 'pointer', padding: '6px 10px', borderRadius: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background-color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,95,95,0.15)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* Bottom right floating zoom panel */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          right: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          background: 'rgba(29, 29, 32, 0.9)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 8,
          padding: '4px 6px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          zIndex: 30,
        }}
      >
        {/* Zoom Out */}
        <button
          onClick={zoomOut}
          title={t('canvas.zoomOut')}
          style={{
            background: 'none', border: 'none', color: textSecondary,
            cursor: 'pointer', width: 24, height: 24, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            transition: 'background-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = textSecondary; e.currentTarget.style.background = 'none'; }}
        >
          -
        </button>

        {/* Zoom level label */}
        <span style={{
          fontSize: 10.5, fontWeight: 600, color: textSecondary,
          fontVariantNumeric: 'tabular-nums', width: 42, textAlign: 'center',
        }}>
          {Math.round(zoom * 100)}%
        </span>

        {/* Zoom In */}
        <button
          onClick={zoomIn}
          title={t('canvas.zoomIn')}
          style={{
            background: 'none', border: 'none', color: textSecondary,
            cursor: 'pointer', width: 24, height: 24, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            transition: 'background-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = textSecondary; e.currentTarget.style.background = 'none'; }}
        >
          +
        </button>

        <div style={{ height: 14, width: 1, background: 'rgba(255,255,255,0.08)', margin: '0 3px' }} />

        {/* Centering view / reset zoom */}
        <button
          onClick={resetZoom}
          title={t('canvas.resetZoom')}
          style={{
            background: 'none', border: 'none', color: textSecondary,
            cursor: 'pointer', width: 24, height: 24, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = textSecondary; e.currentTarget.style.background = 'none'; }}
        >
          <RotateCcw size={11} />
        </button>
      </div>

      {/* Bottom keyboard shortcut helper panel */}
      <div style={{
        position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
        fontSize: 9.5, color: textMuted, display: 'flex', gap: 8, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
        background: 'rgba(15,15,17,0.35)', padding: '2px 8px', borderRadius: 4, backdropFilter: 'blur(4px)',
      }}>
        <span>{t('canvas.hintPan')}</span> <span>-</span>
        <span>{t('canvas.hintMoveCard')}</span> <span>-</span>
        <span>{t('canvas.hintRightClick')}</span> <span>-</span>
        <span>{t('canvas.hintUndo')}</span> <span>-</span>
        <span>{t('canvas.hintCancel')}</span>
      </div>

      {/* Global scrollbar CSS */}
      <style>{`
        .canvas-card-scroll::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        .canvas-card-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .canvas-card-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 999px;
        }
        .canvas-card-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.15);
        }
      `}</style>
    </div>
  );
}
