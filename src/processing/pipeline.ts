import { DV } from '../checks/requirements';
import { BG_RGB, type EditState } from '../editor/state';
import { segment } from '../face/vision';
import { toOutput, toSource, type Crop } from '../shared/geometry';
import { applyAdjustments } from './adjust';
import {
  adjustAlpha, applyStrokes, compositeOnColor, estimateEdgeColors, guidedFilterColor, normalizeMask,
  type BrushStroke, type OutputStroke, type RGBAImage,
} from './mask';
import { flattenOn, renderCrop, type Source } from './render';

export const N = DV.exportSize;

export interface Rendered {
  /** Кадр без замены фона и коррекции (для подсветки маски и баланса белого). */
  before: RGBAImage;
  /** Итог. */
  after: RGBAImage;
  /** Итоговая маска человека (если фон заменялся). */
  alpha: Float32Array | null;
}

const cropKey = (c: Crop) => `${c.cx.toFixed(2)}|${c.cy.toFixed(2)}|${c.size.toFixed(2)}|${c.angle.toFixed(5)}`;

/** Кэш уточнённой маски для последнего кадра: сегментация — самая дорогая часть. */
let maskCache: { src: Source; key: string; crop: Crop; alpha: Float32Array } | null = null;

async function segmentPerson(img: RGBAImage): Promise<Float32Array> {
  const masks = await segment(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height));
  let raw = masks.person;
  if (masks.width !== img.width || masks.height !== img.height) raw = resizeMask(raw, masks.width, masks.height, img.width, img.height);
  return normalizeMask(raw);
}

/**
 * Область с запасом вокруг кадра (больше вниз): плечи в кадре упираются в
 * нижние углы, а у краёв изображения модель видит человека хуже всего.
 */
export function contextCrop(crop: Crop): Crop {
  const scale = 1.6;
  const down = 0.25 * crop.size; // смещение центра вниз в системе кадра
  return {
    cx: crop.cx - Math.sin(crop.angle) * down,
    cy: crop.cy + Math.cos(crop.angle) * down,
    size: crop.size * scale,
    angle: crop.angle,
  };
}

/**
 * Объединяет маску кадра с маской расширенной области. Выше подбородка
 * (волосы, уши) берём точную маску кадра; ниже середины кадра плавно
 * подмешиваем максимум из двух — если хотя бы одна видит человека, плечо остаётся.
 */
export function mergeShoulderMask(tight: Float32Array, wide: Float32Array, n: number): Float32Array {
  const out = new Float32Array(tight.length);
  for (let y = 0; y < n; y++) {
    const t = Math.min(1, Math.max(0, (y / n - 0.5) / 0.2));
    const w = t * t * (3 - 2 * t);
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      out[i] = Math.max(tight[i], w * wide[i]);
    }
  }
  return out;
}

export async function personMask(src: Source, crop: Crop, base: RGBAImage): Promise<Float32Array> {
  const key = cropKey(crop);
  if (maskCache && maskCache.src === src && maskCache.key === key) return maskCache.alpha;
  const flat = flattenOn(base, [255, 255, 255]);
  const tight = await segmentPerson(flat);

  // Маска по расширенной области, пересчитанная в координаты кадра.
  const ctx = contextCrop(crop);
  const wideImg = flattenOn(renderCrop(src, ctx, N), [255, 255, 255]);
  const wide = warpMask(await segmentPerson(wideImg), ctx, crop, N);
  const merged = mergeShoulderMask(tight, wide, N);
  const refined = guidedFilterColor(flat, merged, 6, 1e-3);
  maskCache = { src, key, crop, alpha: refined };
  return refined;
}

/**
 * Маска для предпросмотра во время перетаскивания: последняя готовая маска,
 * пересчитанная в новый кадр без сегментации. Новые области кадра — фон.
 */
function previewMask(src: Source, crop: Crop): Float32Array | null {
  if (!maskCache || maskCache.src !== src) return null;
  if (maskCache.key === cropKey(crop)) return maskCache.alpha;
  return warpMask(maskCache.alpha, maskCache.crop, crop, N);
}

/** Переносит маску кадра `from` в кадр `to`: оба кадра связаны аффинно, поэтому хватает двух шагов на строку. */
export function warpMask(m: Float32Array, from: Crop, to: Crop, n: number): Float32Array {
  const out = new Float32Array(n * n);
  const map = (x: number, y: number) => toOutput(toSource({ x, y }, to, n), from, n);
  const o = map(0.5, 0.5), ex = map(1.5, 0.5), ey = map(0.5, 1.5);
  const dxx = ex.x - o.x, dxy = ex.y - o.y, dyx = ey.x - o.x, dyy = ey.y - o.y;
  for (let y = 0; y < n; y++) {
    let fx = o.x + dyx * y - 0.5, fy = o.y + dyy * y - 0.5;
    for (let x = 0; x < n; x++, fx += dxx, fy += dxy) {
      if (fx < -0.5 || fy < -0.5 || fx > n - 0.5 || fy > n - 0.5) continue;
      out[y * n + x] = sampleBilinear(m, n, n, fx, fy);
    }
  }
  return out;
}

function sampleBilinear(m: Float32Array, w: number, h: number, fx: number, fy: number): number {
  const x = Math.min(w - 1, Math.max(0, fx)), y = Math.min(h - 1, Math.max(0, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  return (m[y0 * w + x0] * (1 - tx) + m[y0 * w + x1] * tx) * (1 - ty) + (m[y1 * w + x0] * (1 - tx) + m[y1 * w + x1] * tx) * ty;
}

export function strokesToOutput(strokes: BrushStroke[], crop: Crop): OutputStroke[] {
  return strokes.map((s) => ({
    mode: s.mode,
    radius: (s.radius * N) / crop.size,
    points: s.points.map((p) => toOutput(p, crop, N)),
  }));
}

/**
 * Полный расчёт итогового изображения из состояния редактора.
 * preview — быстрый вариант для перетаскивания: без сегментации и без подавления ореола.
 */
export async function renderState(src: Source, st: EditState, preview = false): Promise<Rendered> {
  const base = renderCrop(src, st.crop, N);
  const before = flattenOn(base, [255, 255, 255]);
  const bg = BG_RGB[st.bg.color];
  const adjusted = applyAdjustments(base, st.adj);

  const refined = !st.bg.replace ? null : preview ? previewMask(src, st.crop) : await personMask(src, st.crop, base);
  if (!refined) {
    return { before, after: flattenOn(adjusted, bg), alpha: null };
  }

  const alpha = adjustAlpha(refined, st.bg.edge);
  applyStrokes(alpha, N, N, strokesToOutput(st.strokes, st.crop));
  // За пределами исходного снимка — только фон.
  for (let i = 0; i < alpha.length; i++) alpha[i] *= base.data[i * 4 + 3] / 255;
  const edge = st.bg.decontaminate && !preview ? estimateEdgeColors(adjusted, alpha, 8) : null;
  const after = compositeOnColor(adjusted, alpha, bg, edge);
  return { before, after, alpha };
}

/** Билинейное масштабирование маски. */
export function resizeMask(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const b = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * dw + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}
