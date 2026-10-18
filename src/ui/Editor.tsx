import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { panCrop, toOutput, toSource, zoomCrop, type Landmarks, type Pt } from '../lib/geometry';
import type { RGBAImage } from '../lib/mask';
import { DV } from '../lib/requirements';
import type { EditState } from '../lib/state';

export type Tool = 'move' | 'add' | 'remove';

interface Props {
  n: number;
  state: EditState;
  before: RGBAImage | null;
  after: RGBAImage | null;
  /** Маска человека: при showMask области, уходящие в фон, подсвечиваются красным. */
  alpha: Float32Array | null;
  showMask: boolean;
  tool: Tool;
  /** Радиус кисти в пикселях кадра. */
  brush: number;
  showGuides: boolean;
  compare: boolean;
  busy: boolean;
  onPreview: (fn: (s: EditState) => EditState) => void;
  onCommit: () => void;
  onSet: (fn: (s: EditState) => EditState) => void;
}

type Drag =
  | { kind: 'pan'; last: Pt }
  | { kind: 'marker'; which: 'crown' | 'chin' | 'eyes' }
  | { kind: 'brush'; points: Pt[] }
  | { kind: 'split' };

export function Editor(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [split, setSplit] = useState(0.5);
  const { n, state } = p;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !p.after) return;
    const ctx = c.getContext('2d')!;
    if (p.showMask && p.alpha && p.before && !p.compare) {
      ctx.putImageData(new ImageData(maskOverlay(p.before, p.alpha), n, n), 0, 0);
      return;
    }
    ctx.putImageData(asImageData(p.after), 0, 0);
    if (p.compare && p.before) {
      const x = Math.round(split * n);
      if (x > 0) ctx.putImageData(asImageData(p.before), 0, 0, 0, 0, x, n);
    }
  }, [p.after, p.before, p.alpha, p.showMask, p.compare, split, n]);

  const toLocal = (e: { clientX: number; clientY: number }): Pt => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * n, y: ((e.clientY - r.top) / r.height) * n };
  };

  const onDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') as 'crown' | 'chin' | 'eyes' | null;
    const pt = toLocal(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (p.compare) {
      drag.current = { kind: 'split' };
      setSplit(Math.min(1, Math.max(0, pt.x / n)));
    } else if (handle && state.landmarks) {
      drag.current = { kind: 'marker', which: handle };
    } else if (p.tool === 'move') {
      drag.current = { kind: 'pan', last: pt };
    } else {
      drag.current = { kind: 'brush', points: [pt] };
      setStroke([pt]);
    }
    e.preventDefault();
  };

  const onMove = (e: RPointerEvent) => {
    const pt = toLocal(e);
    setHover(pt);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'split') {
      setSplit(Math.min(1, Math.max(0, pt.x / n)));
    } else if (d.kind === 'pan') {
      const dx = pt.x - d.last.x, dy = pt.y - d.last.y;
      d.last = pt;
      p.onPreview((s) => ({ ...s, crop: panCrop(s.crop, dx, dy, n) }));
    } else if (d.kind === 'marker') {
      const y = Math.min(n, Math.max(0, pt.y));
      p.onPreview((s) => moveMarker(s, d.which, y, n));
    } else if (d.kind === 'brush') {
      d.points.push(pt);
      setStroke([...d.points]);
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'pan' || d.kind === 'marker') p.onCommit();
    if (d.kind === 'brush') {
      setStroke(null);
      const crop = state.crop;
      const src = d.points.map((q) => toSource(q, crop, n));
      p.onSet((s) => ({
        ...s,
        strokes: [...s.strokes, { mode: p.tool === 'add' ? 'add' : 'remove', radius: (p.brush * crop.size) / n, points: src }],
      }));
    }
  };

  const wheelTimer = useRef<number | null>(null);
  const onWheel = (e: RWheelEvent) => {
    if (p.compare) return;
    const pt = toLocal(e);
    const zoom = Math.exp(-e.deltaY * 0.0012);
    p.onPreview((s) => ({ ...s, crop: zoomCrop(s.crop, zoom, n, pt) }));
    if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => p.onCommit(), 300);
  };

  // Колесо мыши не должно прокручивать страницу над редактором.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const lm = state.landmarks;
  const out = lm ? outputMarks(lm, state, n) : null;
  const cursor = p.compare ? 'ew-resize' : p.tool === 'move' ? 'grab' : 'none';

  return (
    <div
      className="editor"
      ref={wrapRef}
      style={{ cursor }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => setHover(null)}
      onWheel={onWheel}
      data-testid="editor"
    >
      <canvas ref={canvasRef} width={n} height={n} className="editor-canvas" aria-label="Итоговое изображение" />
      <svg className="editor-overlay" viewBox={`0 0 ${n} ${n}`} aria-hidden>
        {p.showGuides && !p.compare && (
          <>
            <EyeZone n={n} />
            <line x1={n / 2} y1={0} x2={n / 2} y2={n} className="guide-center" />
            {out && <HeadZone n={n} crownY={out.crown.y} />}
            {out && (
              <>
                <Marker n={n} y={out.crown.y} label="Макушка" which="crown" cls={state.crownSource === 'estimate' ? 'mk-est' : 'mk-crown'} />
                <Marker n={n} y={out.eyeY} label="Глаза" which="eyes" cls="mk-eyes" />
                <Marker n={n} y={out.chin.y} label="Подбородок" which="chin" cls="mk-chin" />
                <circle cx={out.eyeL.x} cy={out.eyeL.y} r={4} className="eye-dot" />
                <circle cx={out.eyeR.x} cy={out.eyeR.y} r={4} className="eye-dot" />
              </>
            )}
          </>
        )}
        {p.compare && (
          <>
            <line x1={split * n} y1={0} x2={split * n} y2={n} className="split-line" />
            <text x={12} y={24} className="split-label">До</text>
            <text x={n - 12} y={24} className="split-label" textAnchor="end">После</text>
          </>
        )}
        {stroke && stroke.length > 0 && (
          <polyline
            points={stroke.map((q) => `${q.x},${q.y}`).join(' ')}
            className={p.tool === 'add' ? 'stroke-add' : 'stroke-remove'}
            strokeWidth={p.brush * 2}
          />
        )}
        {hover && p.tool !== 'move' && !p.compare && (
          <circle cx={hover.x} cy={hover.y} r={p.brush} className="brush-cursor" />
        )}
      </svg>
      {p.busy && <div className="editor-busy">Обработка…</div>}
    </div>
  );
}

/** Обёртка без копирования: пиксели приходят из Worker в собственном ArrayBuffer. */
const asImageData = (img: RGBAImage) => new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height);

/** Исходный кадр, где всё, что заменяется фоном, закрашено полупрозрачным красным. */
function maskOverlay(img: RGBAImage, alpha: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(img.data.length);
  out.set(img.data);
  for (let i = 0; i < alpha.length; i++) {
    const k = (1 - alpha[i]) * 0.6;
    if (k <= 0) continue;
    const o = i * 4;
    out[o] = out[o] * (1 - k) + 230 * k;
    out[o + 1] = out[o + 1] * (1 - k) + 30 * k;
    out[o + 2] = out[o + 2] * (1 - k) + 40 * k;
  }
  return out;
}

function outputMarks(lm: Landmarks, st: EditState, n: number) {
  const crown = toOutput(lm.crown, st.crop, n);
  const chin = toOutput(lm.chin, st.crop, n);
  const eyeL = toOutput(lm.eyeL, st.crop, n);
  const eyeR = toOutput(lm.eyeR, st.crop, n);
  return { crown, chin, eyeL, eyeR, eyeY: (eyeL.y + eyeR.y) / 2 };
}

/** Перемещение линии разметки по вертикали кадра. */
export function moveMarker(s: EditState, which: 'crown' | 'chin' | 'eyes', y: number, n: number): EditState {
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

function EyeZone({ n }: { n: number }) {
  const y0 = (1 - DV.eyeMax) * n, y1 = (1 - DV.eyeMin) * n;
  return (
    <g className="eye-zone">
      <rect x={0} y={y0} width={10} height={y1 - y0} />
      <rect x={n - 10} y={y0} width={10} height={y1 - y0} />
      <line x1={0} y1={y0} x2={n} y2={y0} />
      <line x1={0} y1={y1} x2={n} y2={y1} />
    </g>
  );
}

/** Где должен оказаться подбородок при текущей макушке (50–69 % высоты). */
function HeadZone({ n, crownY }: { n: number; crownY: number }) {
  const y0 = crownY + DV.headMin * n, y1 = Math.min(n, crownY + DV.headMax * n);
  if (y0 >= n) return null;
  return <rect x={n - 22} y={y0} width={8} height={Math.max(0, y1 - y0)} className="head-zone" />;
}

function Marker({ n, y, label, which, cls }: { n: number; y: number; label: string; which: string; cls: string }) {
  const w = 104;
  return (
    <g className={`marker ${cls}`}>
      <line x1={0} y1={y} x2={n} y2={y} />
      <g data-handle={which} className="marker-handle" transform={`translate(${n - w - 28}, ${y - 13})`}>
        <rect width={w} height={26} rx={13} />
        <text x={w / 2} y={17.5} textAnchor="middle">{label}</text>
      </g>
      {/* Невидимая широкая полоса у правого края — за линию легче взяться, а перемещение фото не мешает. */}
      <line data-handle={which} x1={n - w - 40} y1={y} x2={n} y2={y} className="marker-hit" />
    </g>
  );
}
