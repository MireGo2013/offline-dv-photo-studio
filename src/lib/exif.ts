import { ascii, concatBytes as concat, type ImageKind } from './fileType';

/**
 * Работа с ориентацией EXIF.
 *
 * Чтобы результат не зависел от того, применяет ли браузер ориентацию сам,
 * мы вырезаем блок EXIF из рабочей копии байтов (исходный файл не трогаем),
 * а поворот выполняем явно матрицей из orientationTransform().
 */

export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Читает тег Orientation (0x0112) из TIFF-структуры EXIF. */
export function readTiffOrientation(tiff: Uint8Array): Orientation {
  if (tiff.length < 8) return 1;
  const order = ascii(tiff, 0, 2);
  const le = order === 'II';
  if (!le && order !== 'MM') return 1;
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (dv.getUint16(2, le) !== 42) return 1;
  const ifd = dv.getUint32(4, le);
  if (ifd + 2 > tiff.length) return 1;
  const count = dv.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (dv.getUint16(entry, le) === 0x0112) {
      const value = dv.getUint16(entry + 8, le);
      return value >= 1 && value <= 8 ? (value as Orientation) : 1;
    }
  }
  return 1;
}

interface Stripped {
  bytes: Uint8Array;
  orientation: Orientation;
  hadExif: boolean;
}

/** JPEG: удаляет сегменты APP1 «Exif», остальные (в т. ч. ICC-профиль APP2) сохраняет. */
export function stripJpegExif(src: Uint8Array): Stripped {
  let orientation: Orientation = 1;
  let hadExif = false;
  if (src[0] !== 0xff || src[1] !== 0xd8) throw new Error('Не JPEG');
  const parts: Uint8Array[] = [src.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= src.length) {
    if (src[i] !== 0xff) throw new Error('Повреждённая структура JPEG');
    const marker = src[i + 1];
    if (marker === 0xff) { i++; continue; }
    // SOS: дальше идут сжатые данные — копируем остаток целиком.
    if (marker === 0xda) { parts.push(src.subarray(i)); i = src.length; break; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(src.subarray(i, i + 2)); i += 2; continue;
    }
    const len = (src[i + 2] << 8) | src[i + 3];
    if (len < 2 || i + 2 + len > src.length) throw new Error('Повреждённая структура JPEG');
    const seg = src.subarray(i, i + 2 + len);
    if (marker === 0xe1 && ascii(src, i + 4, 6) === 'Exif\0\0') {
      hadExif = true;
      orientation = readTiffOrientation(src.subarray(i + 10, i + 2 + len));
    } else {
      parts.push(seg);
    }
    i += 2 + len;
  }
  if (i < src.length) parts.push(src.subarray(i));
  return { bytes: concat(parts), orientation, hadExif };
}

/** PNG: удаляет чанк eXIf. */
export function stripPngExif(src: Uint8Array): Stripped {
  let orientation: Orientation = 1;
  let hadExif = false;
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const parts: Uint8Array[] = [src.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= src.length) {
    const len = dv.getUint32(i);
    const type = ascii(src, i + 4, 4);
    const end = i + 12 + len;
    if (end > src.length) throw new Error('Повреждённая структура PNG');
    if (type === 'eXIf') {
      hadExif = true;
      orientation = readTiffOrientation(src.subarray(i + 8, i + 8 + len));
    } else {
      parts.push(src.subarray(i, end));
    }
    i = end;
    if (type === 'IEND') break;
  }
  return { bytes: concat(parts), orientation, hadExif };
}

/** WebP: удаляет чанк EXIF и сбрасывает флаг EXIF в VP8X. */
export function stripWebpExif(src: Uint8Array): Stripped {
  let orientation: Orientation = 1;
  let hadExif = false;
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const parts: Uint8Array[] = [];
  let i = 12;
  const riffEnd = Math.min(src.length, 8 + dv.getUint32(4, true));
  while (i + 8 <= riffEnd) {
    const type = ascii(src, i, 4);
    const len = dv.getUint32(i + 4, true);
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > src.length) throw new Error('Повреждённая структура WebP');
    if (type === 'EXIF') {
      hadExif = true;
      let tiff = src.subarray(i + 8, i + 8 + len);
      if (ascii(tiff, 0, 6) === 'Exif\0\0') tiff = tiff.subarray(6);
      orientation = readTiffOrientation(tiff);
    } else {
      parts.push(src.subarray(i, Math.min(end, src.length)));
    }
    i = end;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(src.subarray(0, 12));
  out.set(body, 12);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  if (hadExif && ascii(out, 12, 4) === 'VP8X') out[20] &= ~0x08;
  return { bytes: out, orientation, hadExif };
}

export function stripOrientation(bytes: Uint8Array, kind: ImageKind): Stripped {
  switch (kind) {
    case 'jpeg': return stripJpegExif(bytes);
    case 'png': return stripPngExif(bytes);
    case 'webp': return stripWebpExif(bytes);
  }
}

export interface OrientTransform {
  /** Размер изображения после применения ориентации. */
  width: number;
  height: number;
  /** Матрица для canvas: x' = a·x + c·y + e, y' = b·x + d·y + f. */
  matrix: [number, number, number, number, number, number];
}

/** Матрица, переводящая «сырые» пиксели (w×h) в правильно ориентированные. */
export function orientationTransform(o: Orientation, w: number, h: number): OrientTransform {
  const swap = o >= 5;
  const width = swap ? h : w;
  const height = swap ? w : h;
  const m: Record<Orientation, OrientTransform['matrix']> = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h],
    4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, h, 0],
    7: [0, -1, -1, 0, h, w],
    8: [0, -1, 1, 0, 0, w],
  };
  return { width, height, matrix: m[o] };
}

export const ORIENTATION_LABEL: Record<Orientation, string> = {
  1: 'обычная',
  2: 'зеркально по горизонтали',
  3: 'поворот на 180°',
  4: 'зеркально по вертикали',
  5: 'транспонирование',
  6: 'поворот на 90° по часовой',
  7: 'транспонирование с поворотом',
  8: 'поворот на 90° против часовой',
};
