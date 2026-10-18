import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { CORNERS, cropSizeLimits, resizeCrop, toSource, type Crop, type Pt } from '../shared/geometry';

interface Props {
  src: HTMLCanvasElement;
  /** Без кадра — просто предпросмотр. */
  crop?: Crop;
  n: number;
  /** Изменение кадра, пока зажата кнопка мыши. */
  onPreview?: (fn: (c: Crop) => Crop) => void;
  /** Кнопку отпустили — один шаг в истории. */
  onCommit?: () => void;
}

const MAX = 320;
/** Радиус захвата угла рамки, CSS-пиксели. */
const GRAB = 12;
const HANDLE = 8;
/** Поле вокруг снимка в долях длинной стороны: на нём видна и захватывается часть рамки за краем фото. */
const PAD = 0.15;

type Drag = { kind: 'move'; last: Pt } | { kind: 'resize'; corner: number; start: Crop };

/** Исходная фотография с контуром текущего кадра. Рамку можно двигать и тянуть за углы. */
export function SourceView({ src, crop, n, onPreview, onCommit }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [hoverCorner, setHoverCorner] = useState<number | null>(null);
  // Поле только в редакторе: при простом предпросмотре рамки нет.
  const pad = onPreview ? Math.round(Math.max(src.width, src.height) * PAD) : 0;
  const scale = Math.min(MAX / (src.width + 2 * pad), MAX / (src.height + 2 * pad), 1);
  const w = Math.round((src.width + 2 * pad) * scale), h = Math.round((src.height + 2 * pad) * scale);
  /** Точка снимка → пиксель холста. */
  const cx = (x: number) => (x + pad) * scale;
  const cy = (y: number) => (y + pad) * scale;

  // Уменьшенная копия строится один раз: перерисовывать большой снимок на каждый сдвиг дорого.
  const thumb = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e4e7ec';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, pad * scale, pad * scale, src.width * scale, src.height * scale);
    return c;
  }, [src, w, h, pad, scale]);

  // Углы рамки на снимке, в порядке CORNERS.
  const corners = useMemo(
    () => (crop ? CORNERS.map((k) => toSource({ x: ((k.x + 1) / 2) * n, y: ((k.y + 1) / 2) * n }, crop, n)) : null),
    [crop, n],
  );

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(thumb, 0, 0);
    if (!corners) return;
    const outline = () => {
      corners.forEach((p, i) => (i ? ctx.lineTo(cx(p.x), cy(p.y)) : ctx.moveTo(cx(p.x), cy(p.y))));
      ctx.closePath();
    };
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    outline();
    ctx.fill('evenodd');
    ctx.strokeStyle = '#4f8cff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    outline();
    ctx.stroke();
    if (onPreview) {
      ctx.fillStyle = '#fff';
      corners.forEach((p) => {
        ctx.fillRect(cx(p.x) - HANDLE / 2, cy(p.y) - HANDLE / 2, HANDLE, HANDLE);
        ctx.strokeRect(cx(p.x) - HANDLE / 2, cy(p.y) - HANDLE / 2, HANDLE, HANDLE);
      });
    }
    ctx.restore();
  }, [thumb, corners, w, h, pad, scale, onPreview]);

  /** Точка курсора на снимке и сколько пикселей снимка в одном CSS-пикселе. */
  const locate = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = w / scale / r.width;
    return { p: { x: (e.clientX - r.left) * k - pad, y: (e.clientY - r.top) * k - pad }, k };
  };

  const cornerAt = (p: Pt, k: number): number | null => {
    if (!corners) return null;
    let best: number | null = null, bestD = GRAB * k;
    corners.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= bestD) { best = i; bestD = d; }
    });
    return best;
  };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!onPreview || !crop || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { p, k } = locate(e);
    const corner = cornerAt(p, k);
    drag.current = corner === null ? { kind: 'move', last: p } : { kind: 'resize', corner, start: crop };
    e.preventDefault();
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const { p, k } = locate(e);
    const d = drag.current;
    if (!d) {
      if (onPreview) setHoverCorner(cornerAt(p, k));
      return;
    }
    if (d.kind === 'move') {
      const dx = p.x - d.last.x, dy = p.y - d.last.y;
      d.last = p;
      onPreview!((c) => ({ ...c, cx: c.cx + dx, cy: c.cy + dy }));
    } else {
      const limits = cropSizeLimits(src.width, src.height);
      onPreview!(() => resizeCrop(d.start, d.corner, p, limits));
    }
  };

  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    onCommit?.();
  };

  const resizing = drag.current?.kind === 'resize' ? drag.current.corner : hoverCorner;
  const cursor = !onPreview ? undefined : resizing !== null ? (resizing % 2 === 0 ? 'nwse-resize' : 'nesw-resize') : undefined;

  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      className={`source-view${onPreview ? ' draggable' : ''}`}
      style={cursor ? { cursor } : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => setHoverCorner(null)}
      data-testid="source-view"
      data-corners={corners?.map((p) => `${cx(p.x).toFixed(1)},${cy(p.y).toFixed(1)}`).join(' ')}
      title={onPreview ? 'Исходная фотография. Перетащите рамку, чтобы сдвинуть кадр, или потяните за угол, чтобы изменить размер.' : undefined}
    />
  );
}
