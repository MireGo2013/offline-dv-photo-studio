import type { RGBAImage } from './mask';

/** Умеренные тональные поправки. Все значения в диапазоне −1…1. */
export interface Adjustments {
  brightness: number;
  contrast: number;
  /** Тёплый (+) / холодный (−) оттенок. */
  warmth: number;
  /** Автоматический баланс белого: множители каналов или null. */
  wb: [number, number, number] | null;
}

export const NO_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, warmth: 0, wb: null };

export const LIMITS = {
  /** ±40 уровней яркости из 255. */
  brightness: 40,
  /** Контраст ±35 %. */
  contrast: 0.35,
  /** Сдвиг красного/синего канала ±8 %. */
  warmth: 0.08,
  /** Автобаланс меняет каналы не более чем на ±15 %. */
  wbGain: 0.15,
};

export function isIdentity(a: Adjustments): boolean {
  return a.brightness === 0 && a.contrast === 0 && a.warmth === 0 && !a.wb;
}

export function applyAdjustments(img: RGBAImage, a: Adjustments): RGBAImage {
  if (isIdentity(a)) return img;
  const lut = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
  const b = clamp(a.brightness) * LIMITS.brightness;
  const k = 1 + clamp(a.contrast) * LIMITS.contrast;
  const warm = clamp(a.warmth) * LIMITS.warmth;
  const gains = [1 + warm, 1, 1 - warm].map((g, c) => g * (a.wb ? a.wb[c] : 1));
  for (let c = 0; c < 3; c++) {
    for (let v = 0; v < 256; v++) lut[c][v] = (v * gains[c] - 128) * k + 128 + b;
  }
  const d = img.data;
  const out = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    out[i] = lut[0][d[i]];
    out[i + 1] = lut[1][d[i + 1]];
    out[i + 2] = lut[2][d[i + 2]];
    out[i + 3] = d[i + 3];
  }
  return { data: out, width: img.width, height: img.height };
}

/**
 * Автобаланс белого по светлому фону: если старый фон заметно окрашен
 * (например, желтоватая стена под лампой), подбираем множители, делающие его
 * нейтральным. Возвращает null, если надёжной опоры нет.
 */
export function estimateWhiteBalance(img: RGBAImage, alpha: Float32Array | null): [number, number, number] | null {
  const d = img.data;
  const sum = [0, 0, 0];
  let count = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (alpha && alpha[p] > 0.05) continue;
    const r = d[i], g = d[i + 1], bl = d[i + 2];
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
    if (mx > 250 || mx < 110 || mx - mn > 60) continue;
    sum[0] += r; sum[1] += g; sum[2] += bl;
    count++;
  }
  if (count < d.length / 4 / 20) return null;
  const mean = sum.map((s) => s / count);
  const gray = (mean[0] + mean[1] + mean[2]) / 3;
  const g = mean.map((m) => Math.min(1 + LIMITS.wbGain, Math.max(1 - LIMITS.wbGain, gray / m))) as [number, number, number];
  if (g.every((x) => Math.abs(x - 1) < 0.01)) return null;
  return g;
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
