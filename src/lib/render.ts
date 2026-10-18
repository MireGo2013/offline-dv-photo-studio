import { cropMatrix, type Crop } from './geometry';
import type { RGBAImage } from './mask';

/** Исходный снимок: canvas в основном потоке, ImageBitmap в Worker. */
export type Source = HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

/**
 * Пирамида уменьшенных копий исходника: при сильном уменьшении рисуем с
 * ближайшего уровня — так картинка получается чище, чем при одном шаге.
 */
const pyramids = new WeakMap<Source, Source[]>();

function pyramid(src: Source): Source[] {
  let levels = pyramids.get(src);
  if (!levels) {
    levels = [src];
    let cur = src;
    while (Math.min(cur.width, cur.height) > 1200) {
      const next = new OffscreenCanvas(Math.max(1, Math.round(cur.width / 2)), Math.max(1, Math.round(cur.height / 2)));
      const ctx = next.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cur, 0, 0, next.width, next.height);
      levels.push(next);
      cur = next;
    }
    pyramids.set(src, levels);
  }
  return levels;
}

/** Холст для renderCrop: вызывается на каждый сдвиг кадра, создавать новый каждый раз незачем. */
let work: OffscreenCanvasRenderingContext2D | null = null;

/** Рисует кадр N×N. Области вне исходного снимка остаются прозрачными (alpha = 0). */
export function renderCrop(src: Source, crop: Crop, n: number): RGBAImage {
  if (!work || work.canvas.width !== n || work.canvas.height !== n) {
    work = new OffscreenCanvas(n, n).getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })!;
  }
  const ctx = work;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, n, n);
  const scale = crop.size / n;
  const levels = pyramid(src);
  let level = 0;
  while (level + 1 < levels.length && 2 ** (level + 1) <= scale) level++;
  const img = levels[level];
  const k = src.width / img.width;
  const [a, b, c, d, e, f] = cropMatrix(crop, n);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(a * k, b * k, c * k, d * k, e, f);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, n, n);
  return { data: data.data, width: n, height: n };
}

export function toCanvas(img: RGBAImage, target?: HTMLCanvasElement): HTMLCanvasElement {
  const c = target ?? document.createElement('canvas');
  if (c.width !== img.width) c.width = img.width;
  if (c.height !== img.height) c.height = img.height;
  const ctx = c.getContext('2d', { colorSpace: 'srgb' })!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height, { colorSpace: 'srgb' }), 0, 0);
  return c;
}

/** Заливает прозрачные области (вне снимка) цветом и делает изображение непрозрачным. */
export function flattenOn(img: RGBAImage, color: [number, number, number]): RGBAImage {
  const d = img.data;
  const out = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    out[i] = d[i] * a + color[0] * (1 - a);
    out[i + 1] = d[i + 1] * a + color[1] * (1 - a);
    out[i + 2] = d[i + 2] * a + color[2] * (1 - a);
    out[i + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}
