import { useEffect, useMemo, useRef } from 'react';
import type { RGBAImage } from '../processing/mask';
import type { Rendered } from '../processing/pipeline';
import { EditorOverlay } from './EditorOverlay';
import type { EditState } from './state';
import { useEditorDrag, type Tool } from './useEditorDrag';

export type { Tool };

interface Props {
  n: number;
  state: EditState;
  rendered: Rendered | null;
  /** Исходный снимок: в режиме сравнения «до» показывает его целиком. */
  original: HTMLCanvasElement;
  /** Подсветить красным то, что уходит в фон (нужна маска). */
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

/** Итоговый кадр N×N с разметкой; мышью двигается фото, линии, кисть. */
export function Editor(p: Props) {
  const { n, rendered, compare } = p;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { wrapRef, handlers, stroke, hover, split } = useEditorDrag(p);
  const original = useMemo(() => fitOriginal(p.original, n), [p.original, n]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !rendered) return;
    const { before, after, alpha } = rendered;
    if (p.showMask && alpha && !compare) {
      ctx.putImageData(new ImageData(maskOverlay(before, alpha), n, n), 0, 0);
      return;
    }
    ctx.putImageData(asImageData(after), 0, 0);
    const x = Math.round(split * n);
    if (compare && x > 0) ctx.putImageData(original, 0, 0, 0, 0, x, n);
  }, [rendered, original, p.showMask, compare, split, n]);

  const cursor = compare ? 'ew-resize' : p.tool === 'move' ? 'grab' : 'none';
  return (
    <div className="editor" ref={wrapRef} style={{ cursor }} {...handlers} data-testid="editor">
      <canvas ref={canvasRef} width={n} height={n} className="editor-canvas" aria-label="Итоговое изображение" />
      <EditorOverlay
        n={n} state={p.state} showGuides={p.showGuides} compare={compare}
        split={split} stroke={stroke} hover={hover} tool={p.tool} brush={p.brush}
      />
      {p.busy && <div className="editor-busy">Обработка…</div>}
    </div>
  );
}

/** Серые поля вокруг исходника: на белом их не отличить от белого фона. */
const ORIGINAL_PAD = '#808080';

/** Исходный снимок целиком, вписанный в квадрат N×N по центру. */
function fitOriginal(src: HTMLCanvasElement, n: number): ImageData {
  const ctx = new OffscreenCanvas(n, n).getContext('2d', { colorSpace: 'srgb' })!;
  ctx.fillStyle = ORIGINAL_PAD;
  ctx.fillRect(0, 0, n, n);
  const k = Math.min(n / src.width, n / src.height);
  const w = src.width * k, h = src.height * k;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (n - w) / 2, (n - h) / 2, w, h);
  return ctx.getImageData(0, 0, n, n);
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
