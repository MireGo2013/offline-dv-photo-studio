import type { RGBAImage } from '../processing/mask';

export interface Rect { x: number; y: number; w: number; h: number }

export interface RegionStats {
  meanLuma: number;
  stdLuma: number;
  /** Доля пересвеченных пикселей (яркость ≥ 250). */
  clippedHigh: number;
  /** Средняя «цветность»: max(R,G,B) − min(R,G,B). */
  meanChroma: number;
  count: number;
}

const luma = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

export function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w)), y1 = Math.min(h, Math.ceil(r.y + r.h));
  return { x, y, w: Math.max(0, x1 - x), h: Math.max(0, y1 - y) };
}

/** Статистика яркости и цвета по области; filter позволяет учитывать только часть пикселей. */
export function regionStats(img: RGBAImage, rect: Rect, filter?: (pixelIndex: number) => boolean): RegionStats {
  const r = clampRect(rect, img.width, img.height);
  const d = img.data;
  let n = 0, s = 0, s2 = 0, hi = 0, chroma = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const p = y * img.width + x;
      if (filter && !filter(p)) continue;
      const i = p * 4;
      const l = luma(d, i);
      s += l; s2 += l * l; n++;
      if (l >= 250) hi++;
      chroma += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    }
  }
  if (!n) return { meanLuma: 0, stdLuma: 0, clippedHigh: 0, meanChroma: 0, count: 0 };
  const mean = s / n;
  return {
    meanLuma: mean,
    stdLuma: Math.sqrt(Math.max(0, s2 / n - mean * mean)),
    clippedHigh: hi / n,
    meanChroma: chroma / n,
    count: n,
  };
}

/** Дисперсия лапласиана яркости — простая мера резкости. */
export function laplacianVariance(img: RGBAImage, rect: Rect): number {
  const r = clampRect(rect, img.width, img.height);
  const d = img.data, w = img.width;
  let n = 0, s = 0, s2 = 0;
  for (let y = Math.max(1, r.y); y < Math.min(img.height - 1, r.y + r.h); y++) {
    for (let x = Math.max(1, r.x); x < Math.min(w - 1, r.x + r.w); x++) {
      const i = (y * w + x) * 4;
      const v = 4 * luma(d, i) - luma(d, i - 4) - luma(d, i + 4) - luma(d, i - w * 4) - luma(d, i + w * 4);
      s += v; s2 += v * v; n++;
    }
  }
  if (!n) return 0;
  const m = s / n;
  return s2 / n - m * m;
}

/** Есть ли в изображении цвет: доля заметно окрашенных пикселей больше 1 %. */
export function hasColor(img: RGBAImage): boolean {
  const d = img.data;
  let colored = 0, total = 0;
  for (let i = 0; i < d.length; i += 4 * 3) {
    total++;
    if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 12) colored++;
  }
  return colored / Math.max(1, total) > 0.01;
}
