import { ascii, concatBytes as concat } from './fileType';

/** Сведения о фактически закодированном JPEG, извлечённые из его маркеров. */
export interface JpegInfo {
  width: number;
  height: number;
  /** 1 — оттенки серого, 3 — цвет (YCbCr/RGB), 4 — CMYK/YCCK. */
  components: number;
  /** Бит на компоненту. */
  precision: number;
  /** 'baseline' | 'progressive' | 'extended' | 'lossless' | ... */
  process: string;
  jfif: boolean;
  exif: boolean;
  /** Встроенный ICC-профиль, если есть. */
  icc: { colorSpace: string; description: string | null } | null;
  /** Есть ли маркер конца изображения EOI. */
  hasEOI: boolean;
}

export class JpegParseError extends Error {}

const SOF_NAMES: Record<number, string> = {
  0xc0: 'baseline', 0xc1: 'extended', 0xc2: 'progressive', 0xc3: 'lossless',
  0xc5: 'differential', 0xc6: 'differential-progressive', 0xc7: 'differential-lossless',
  0xc9: 'arithmetic-extended', 0xca: 'arithmetic-progressive', 0xcb: 'arithmetic-lossless',
  0xcd: 'differential-arithmetic', 0xce: 'differential-arithmetic-progressive',
  0xcf: 'differential-arithmetic-lossless',
};

export function parseJpeg(bytes: Uint8Array): JpegInfo {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new JpegParseError('Файл не начинается с сигнатуры JPEG (FFD8)');
  }
  let i = 2;
  let sof: Pick<JpegInfo, 'width' | 'height' | 'components' | 'precision' | 'process'> | null = null;
  let jfif = false;
  let exif = false;
  const iccChunks: Uint8Array[] = [];
  let sawSOS = false;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new JpegParseError(`Ожидался маркер в позиции ${i}`);
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd9) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) throw new JpegParseError('Сегмент JPEG обрезан');
    const body = bytes.subarray(i + 4, i + 2 + len);
    if (marker === 0xe0 && ascii(body, 0, 5) === 'JFIF\0') jfif = true;
    if (marker === 0xe1 && ascii(body, 0, 6) === 'Exif\0\0') exif = true;
    if (marker === 0xe2 && ascii(body, 0, 12) === 'ICC_PROFILE\0') iccChunks.push(body.subarray(14));
    if (SOF_NAMES[marker] && !sof) {
      if (body.length < 6) throw new JpegParseError('Заголовок кадра JPEG повреждён');
      sof = {
        precision: body[0],
        height: (body[1] << 8) | body[2],
        width: (body[3] << 8) | body[4],
        components: body[5],
        process: SOF_NAMES[marker],
      };
    }
    i += 2 + len;
    if (marker === 0xda) {
      sawSOS = true;
      break;
    }
  }
  if (!sof) throw new JpegParseError('В файле нет заголовка кадра (SOF)');
  if (!sawSOS) throw new JpegParseError('В файле нет сжатых данных изображения');
  // Маркер EOI ищем в конце (допускаются хвостовые нули).
  let hasEOI = false;
  for (let k = bytes.length - 2; k >= Math.max(i, bytes.length - 64); k--) {
    if (bytes[k] === 0xff && bytes[k + 1] === 0xd9) { hasEOI = true; break; }
  }
  return {
    ...sof,
    jfif,
    exif,
    icc: iccChunks.length ? parseIcc(concat(iccChunks)) : null,
    hasEOI,
  };
}

function parseIcc(p: Uint8Array): { colorSpace: string; description: string | null } {
  const colorSpace = ascii(p, 16, 4).trim();
  let description: string | null = null;
  try {
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const count = dv.getUint32(128);
    for (let t = 0; t < count; t++) {
      const e = 132 + t * 12;
      if (ascii(p, e, 4) !== 'desc') continue;
      const off = dv.getUint32(e + 4);
      const type = ascii(p, off, 4);
      if (type === 'desc') {
        const n = dv.getUint32(off + 8);
        description = ascii(p, off + 12, Math.max(0, n - 1));
      } else if (type === 'mluc') {
        const strLen = dv.getUint32(off + 20);
        const strOff = dv.getUint32(off + 24);
        let s = '';
        for (let k = 0; k < strLen; k += 2) s += String.fromCharCode(dv.getUint16(off + strOff + k));
        description = s;
      }
    }
  } catch {
    // Описание необязательно — оставляем null.
  }
  return { colorSpace, description };
}
