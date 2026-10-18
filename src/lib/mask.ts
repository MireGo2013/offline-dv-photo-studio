import type { Pt } from './geometry';

export interface RGBAImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Среднее по окну (2r+1)² через интегральное изображение; края обрабатываются корректно. */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const sum =
        integral[(y1 + 1) * W + x1 + 1] - integral[y0 * W + x1 + 1] -
        integral[(y1 + 1) * W + x0] + integral[y0 * W + x0];
      out[y * w + x] = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
    }
  }
  return out;
}

/**
 * Цветной управляемый фильтр (He et al., вариант с RGB-ориентиром): уточняет
 * грубую маску по краям изображения — переходы «прилипают» к реальным границам
 * волос и плеч. В отличие от яркостного различает границы одинаково тёмных, но
 * разных по цвету областей — например, тёмно-синего костюма и тёмно-красной шторы.
 */
export function guidedFilterColor(img: RGBAImage, p: Float32Array, r: number, eps: number): Float32Array {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const I = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) I[c][i] = data[i * 4 + c] / 255;
  const mean = (a: Float32Array) => boxMean(a, w, h, r);
  const prod = (a: Float32Array, b: Float32Array) => {
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = a[i] * b[i];
    return o;
  };
  const mI = I.map(mean);
  const mP = mean(p);
  const mIp = I.map((c) => mean(prod(c, p)));
  // Ковариации ориентира: rr, rg, rb, gg, gb, bb.
  const pairs: [number, number][] = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]];
  const cov = pairs.map(([a, b]) => mean(prod(I[a], I[b])));
  const A = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const rr = cov[0][i] - mI[0][i] * mI[0][i] + eps;
    const rg = cov[1][i] - mI[0][i] * mI[1][i];
    const rb = cov[2][i] - mI[0][i] * mI[2][i];
    const gg = cov[3][i] - mI[1][i] * mI[1][i] + eps;
    const gb = cov[4][i] - mI[1][i] * mI[2][i];
    const bb = cov[5][i] - mI[2][i] * mI[2][i] + eps;
    const cr = mIp[0][i] - mI[0][i] * mP[i];
    const cg = mIp[1][i] - mI[1][i] * mP[i];
    const cb = mIp[2][i] - mI[2][i] * mP[i];
    // Обратная симметричная матрица 3×3.
    const i00 = gg * bb - gb * gb, i01 = rb * gb - rg * bb, i02 = rg * gb - rb * gg;
    const i11 = rr * bb - rb * rb, i12 = rb * rg - rr * gb, i22 = rr * gg - rg * rg;
    const det = rr * i00 + rg * i01 + rb * i02;
    const a0 = (i00 * cr + i01 * cg + i02 * cb) / det;
    const a1 = (i01 * cr + i11 * cg + i12 * cb) / det;
    const a2 = (i02 * cr + i12 * cg + i22 * cb) / det;
    A[0][i] = a0; A[1][i] = a1; A[2][i] = a2;
    B[i] = mP[i] - a0 * mI[0][i] - a1 * mI[1][i] - a2 * mI[2][i];
  }
  const mA = A.map(mean);
  const mB = mean(B);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    q[i] = Math.min(1, Math.max(0, mA[0][i] * I[0][i] + mA[1][i] * I[1][i] + mA[2][i] * I[2][i] + mB[i]));
  }
  return q;
}

/**
 * Растягивает маску модели на полный диапазон 0…1. Модель сегментации не
 * бывает уверена на 100 %: на чистом фоне выдаёт ~0,05–0,1, на человеке ~0,98.
 * Без этого остаток старого фона просвечивает сквозь белый.
 */
export function normalizeMask(m: Float32Array): Float32Array {
  const lowVals: number[] = [], highVals: number[] = [];
  const step = Math.max(1, Math.floor(m.length / 40000));
  for (let i = 0; i < m.length; i += step) (m[i] < 0.5 ? lowVals : highVals).push(m[i]);
  const median = (a: number[], fallback: number) => {
    if (a.length < 50) return fallback;
    a.sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  };
  const floor = Math.min(0.3, median(lowVals, 0));
  const ceil = Math.max(0.7, median(highVals, 1));
  const span = ceil - floor;
  const out = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = Math.min(1, Math.max(0, (m[i] - floor) / span));
  return out;
}

/**
 * Сдвиг границы маски: edge > 0 расширяет человека, < 0 — сужает (−1…1).
 * Значения около 0 и 1 «прижимаются», чтобы убрать шум на фоне.
 */
export function adjustAlpha(alpha: Float32Array, edge: number): Float32Array {
  const shift = edge * 0.3;
  const lo = Math.max(0, 0.06 - shift);
  const hi = Math.min(1, 0.94 - shift);
  const span = Math.max(1e-3, hi - lo);
  const out = new Float32Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) out[i] = Math.min(1, Math.max(0, (alpha[i] - lo) / span));
  return out;
}

export interface BrushStroke {
  mode: 'add' | 'remove';
  /** Радиус и точки — в координатах исходного снимка. */
  radius: number;
  points: Pt[];
}

/** Мазки в координатах кадра (после пересчёта из исходника). */
export interface OutputStroke {
  mode: 'add' | 'remove';
  radius: number;
  points: Pt[];
}

/** Применяет ручные мазки к маске. Края кисти мягкие. */
export function applyStrokes(alpha: Float32Array, w: number, h: number, strokes: OutputStroke[]): void {
  for (const s of strokes) {
    const r = Math.max(1, s.radius);
    const pts = densify(s.points, r / 3);
    for (const p of pts) {
      const x0 = Math.max(0, Math.floor(p.x - r)), x1 = Math.min(w - 1, Math.ceil(p.x + r));
      const y0 = Math.max(0, Math.floor(p.y - r)), y1 = Math.min(h - 1, Math.ceil(p.y + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - p.x, y - p.y) / r;
          if (d >= 1) continue;
          const f = d < 0.6 ? 1 : 1 - (d - 0.6) / 0.4;
          const i = y * w + x;
          alpha[i] = s.mode === 'add' ? Math.max(alpha[i], f) : Math.min(alpha[i], 1 - f);
        }
      }
    }
  }
}

function densify(points: Pt[], step: number): Pt[] {
  if (points.length < 2) return points;
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** Локальное взвешенное среднее цвета: сначала по малому радиусу, где данных мало — по большому. */
function localColor(img: RGBAImage, weightOf: (i: number) => number, r: number): Float32Array[] {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const weight = new Float32Array(n);
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const gs = [0, 0, 0];
  let gc = 0;
  for (let i = 0; i < n; i++) {
    const wt = weightOf(i);
    weight[i] = wt;
    for (let c = 0; c < 3; c++) {
      ch[c][i] = data[i * 4 + c] * wt;
      gs[c] += data[i * 4 + c] * wt;
    }
    gc += wt;
  }
  const global = gc > 0 ? gs.map((v) => v / gc) : [255, 255, 255];
  const near = { w: boxMean(weight, w, h, r), c: ch.map((c) => boxMean(c, w, h, r)) };
  const far = { w: boxMean(weight, w, h, r * 3), c: ch.map((c) => boxMean(c, w, h, r * 3)) };
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      out[c][i] = near.w[i] > 0.05 ? near.c[c][i] / near.w[i] : far.w[i] > 0.01 ? far.c[c][i] / far.w[i] : global[c];
    }
  }
  return out;
}

export interface EdgeColors {
  /** Локальный цвет старого фона. */
  bg: Float32Array[];
  /** Локальный цвет человека (волос, одежды) рядом с краем. */
  fg: Float32Array[];
}

/**
 * Оценивает цвета по обе стороны границы маски. Нужны, чтобы убрать
 * «просвечивание» старого фона в полупрозрачных прядях (иначе появляется ореол).
 */
export function estimateEdgeColors(img: RGBAImage, alpha: Float32Array, r: number): EdgeColors {
  return {
    bg: localColor(img, (i) => (alpha[i] < 0.15 ? 1 : 0), r),
    fg: localColor(img, (i) => (alpha[i] > 0.9 ? 1 : 0), r),
  };
}

/** Насколько восстановленный цвет может выйти за пределы «исходный пиксель — цвет человека рядом». */
const DECONTAM_SLACK = 12;

/**
 * Собирает итог: человек поверх однотонного фона. Там, где маска = 1 (лицо),
 * пиксели остаются в точности исходными.
 */
export function compositeOnColor(
  img: RGBAImage,
  alpha: Float32Array,
  bg: [number, number, number],
  edge: EdgeColors | null,
): RGBAImage {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i];
    const o = i * 4;
    if (a >= 0.999) {
      out[o] = data[o]; out[o + 1] = data[o + 1]; out[o + 2] = data[o + 2];
    } else if (a <= 0.001) {
      out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2];
    } else {
      for (let c = 0; c < 3; c++) {
        const v = data[o + c];
        let f = v;
        if (edge && a > 0.08) {
          // Восстанавливаем цвет пряди без примеси старого фона, но не дальше,
          // чем позволяет цвет человека рядом, — иначе появляется цветная кромка.
          const raw = (v - (1 - a) * edge.bg[c][i]) / a;
          const ref = edge.fg[c][i];
          const lo = Math.min(v, ref) - DECONTAM_SLACK, hi = Math.max(v, ref) + DECONTAM_SLACK;
          f = Math.min(255, Math.max(0, Math.min(hi, Math.max(lo, raw))));
        }
        out[o + c] = a * f + (1 - a) * bg[c];
      }
    }
    out[o + 3] = 255;
  }
  return { data: out, width: w, height: h };
}
