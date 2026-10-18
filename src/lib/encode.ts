import { DV, minBytesForSize } from './requirements';

export type Encoder = (quality: number) => Promise<Uint8Array>;

export interface EncodeResult {
  bytes: Uint8Array;
  quality: number;
  attempts: { quality: number; bytes: number }[];
  /** Пришлось ли снижать качество, чтобы уложиться в лимит. */
  reduced: boolean;
  /** Уложились ли в лимит размера. */
  fitsMax: boolean;
  /** Не превышена ли степень сжатия 20:1. */
  fitsRatio: boolean;
  /** Качество ниже этого порога может заметно ухудшить чёткость. */
  lowQuality: boolean;
}

export const START_QUALITY = 0.95;
export const MIN_QUALITY = 0.5;
export const LOW_QUALITY_THRESHOLD = 0.7;

/**
 * Подбирает максимальное качество JPEG, при котором файл не больше лимита.
 * Если файл получается слишком маленьким (сжатие сильнее 20:1), пробует
 * поднять качество до 1,0.
 */
export async function encodeWithinLimits(
  encode: Encoder,
  size: number,
  maxBytes: number = DV.maxBytes,
): Promise<EncodeResult> {
  const minBytes = minBytesForSize(size);
  const attempts: EncodeResult['attempts'] = [];
  const run = async (q: number) => {
    const b = await encode(q);
    attempts.push({ quality: q, bytes: b.length });
    return b;
  };

  let best = await run(START_QUALITY);
  let quality = START_QUALITY;
  let reduced = false;

  if (best.length > maxBytes) {
    reduced = true;
    // Двоичный поиск наибольшего качества, укладывающегося в лимит.
    let lo = MIN_QUALITY;
    let hi = START_QUALITY;
    let fit: { b: Uint8Array; q: number } | null = null;
    const atLo = await run(lo);
    if (atLo.length <= maxBytes) {
      fit = { b: atLo, q: lo };
      for (let k = 0; k < 7; k++) {
        const mid = Math.round(((lo + hi) / 2) * 1000) / 1000;
        const b = await run(mid);
        if (b.length <= maxBytes) { fit = { b, q: mid }; lo = mid; } else { hi = mid; }
      }
      best = fit.b;
      quality = fit.q;
    } else {
      best = atLo;
      quality = lo;
    }
  } else if (best.length < minBytes) {
    const b = await run(1);
    if (b.length <= maxBytes) { best = b; quality = 1; }
  }

  return {
    bytes: best,
    quality,
    attempts,
    reduced,
    fitsMax: best.length <= maxBytes,
    fitsRatio: best.length >= minBytes,
    lowQuality: quality < LOW_QUALITY_THRESHOLD,
  };
}
