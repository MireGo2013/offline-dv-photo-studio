import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { panCrop, toOutput, toSource, zoomCrop, type Pt } from '../lib/geometry';
import type { EditState } from '../lib/state';

export type Tool = 'move' | 'add' | 'remove';
export type MarkerKind = 'crown' | 'chin' | 'eyes';

type Drag =
  | { kind: 'pan'; last: Pt }
  | { kind: 'marker'; which: MarkerKind }
  | { kind: 'brush'; points: Pt[] }
  | { kind: 'split' };

interface Options {
  n: number;
  state: EditState;
  tool: Tool;
  /** Радиус кисти в пикселях кадра. */
  brush: number;
  compare: boolean;
  onPreview: (fn: (s: EditState) => EditState) => void;
  onCommit: () => void;
  onSet: (fn: (s: EditState) => EditState) => void;
}

/**
 * Мышь над редактором: сдвиг фото, линии разметки, кисть маски, разделитель
 * «до/после» и масштаб колесом. Возвращает обработчики для обёртки и то,
 * что нужно нарисовать поверх (текущий мазок, курсор кисти, разделитель).
 */
export function useEditorDrag(o: Options) {
  const { n } = o;
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const wheelTimer = useRef<number | null>(null);
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [split, setSplit] = useState(0.5);

  const toLocal = (e: { clientX: number; clientY: number }): Pt => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * n, y: ((e.clientY - r.top) / r.height) * n };
  };
  const setSplitAt = (pt: Pt) => setSplit(Math.min(1, Math.max(0, pt.x / n)));

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    const handle = (e.target as Element).closest('[data-handle]')?.getAttribute('data-handle') as MarkerKind | null;
    const pt = toLocal(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (o.compare) {
      drag.current = { kind: 'split' };
      setSplitAt(pt);
    } else if (handle && o.state.landmarks) {
      drag.current = { kind: 'marker', which: handle };
    } else if (o.tool === 'move') {
      drag.current = { kind: 'pan', last: pt };
    } else {
      drag.current = { kind: 'brush', points: [pt] };
      setStroke([pt]);
    }
    e.preventDefault();
  };

  const onPointerMove = (e: RPointerEvent) => {
    const pt = toLocal(e);
    setHover(pt);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'split') {
      setSplitAt(pt);
    } else if (d.kind === 'pan') {
      const dx = pt.x - d.last.x, dy = pt.y - d.last.y;
      d.last = pt;
      o.onPreview((s) => ({ ...s, crop: panCrop(s.crop, dx, dy, n) }));
    } else if (d.kind === 'marker') {
      const y = Math.min(n, Math.max(0, pt.y));
      o.onPreview((s) => moveMarker(s, d.which, y, n));
    } else {
      d.points.push(pt);
      setStroke([...d.points]);
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'pan' || d.kind === 'marker') o.onCommit();
    if (d.kind === 'brush') {
      setStroke(null);
      const crop = o.state.crop;
      const mode = o.tool === 'add' ? 'add' : 'remove';
      const radius = (o.brush * crop.size) / n;
      const points = d.points.map((q) => toSource(q, crop, n));
      o.onSet((s) => ({ ...s, strokes: [...s.strokes, { mode, radius, points }] }));
    }
  };

  const onWheel = (e: RWheelEvent) => {
    if (o.compare) return;
    const pt = toLocal(e);
    const zoom = Math.exp(-e.deltaY * 0.0012);
    o.onPreview((s) => ({ ...s, crop: zoomCrop(s.crop, zoom, n, pt) }));
    if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(o.onCommit, 300);
  };

  // Колесо мыши не должно прокручивать страницу над редактором (React вешает wheel как passive).
  useEffect(() => {
    const el = wrapRef.current!;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => {
      el.removeEventListener('wheel', stop);
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
    };
  }, []);

  return {
    wrapRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onPointerLeave: () => setHover(null), onWheel },
    stroke,
    hover,
    split,
  };
}

/** Перемещение линии разметки по вертикали кадра. */
function moveMarker(s: EditState, which: MarkerKind, y: number, n: number): EditState {
  const lm = s.landmarks;
  if (!lm) return s;
  const move = (pt: Pt, dy: number) => {
    const o = toOutput(pt, s.crop, n);
    return toSource({ x: o.x, y: o.y + dy }, s.crop, n);
  };
  if (which === 'crown') {
    const o = toOutput(lm.crown, s.crop, n);
    return { ...s, crownSource: 'manual', landmarks: { ...lm, crown: move(lm.crown, y - o.y) } };
  }
  if (which === 'chin') {
    const o = toOutput(lm.chin, s.crop, n);
    return { ...s, chinManual: true, landmarks: { ...lm, chin: move(lm.chin, y - o.y) } };
  }
  const l = toOutput(lm.eyeL, s.crop, n), r = toOutput(lm.eyeR, s.crop, n);
  const dy = y - (l.y + r.y) / 2;
  return { ...s, eyesManual: true, landmarks: { ...lm, eyeL: move(lm.eyeL, dy), eyeR: move(lm.eyeR, dy) } };
}
