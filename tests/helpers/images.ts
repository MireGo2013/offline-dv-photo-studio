import jpeg from 'jpeg-js';

export type Fill = (x: number, y: number) => [number, number, number];

/** Кодирует RGB-картинку в JPEG (jpeg-js, baseline, 3 компоненты, JFIF). */
export function makeJpeg(w: number, h: number, fill: Fill, quality = 90): Uint8Array {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return new Uint8Array(jpeg.encode({ data, width: w, height: h }, quality).data);
}

export function decodeJpeg(bytes: Uint8Array) {
  return jpeg.decode(Buffer.from(bytes), { useTArray: true, formatAsRGBA: true });
}

/** TIFF-блок EXIF с одним тегом Orientation. */
export function tiffWithOrientation(o: number, littleEndian = true): Uint8Array {
  const b = new Uint8Array(26);
  const dv = new DataView(b.buffer);
  b.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  dv.setUint16(2, 42, littleEndian);
  dv.setUint32(4, 8, littleEndian);
  dv.setUint16(8, 1, littleEndian); // одна запись
  dv.setUint16(10, 0x0112, littleEndian);
  dv.setUint16(12, 3, littleEndian); // SHORT
  dv.setUint32(14, 1, littleEndian);
  dv.setUint16(18, o, littleEndian);
  dv.setUint32(22, 0, littleEndian); // следующего IFD нет
  return b;
}

function segment(marker: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + body.length);
  out[0] = 0xff; out[1] = marker;
  out[2] = (body.length + 2) >> 8; out[3] = (body.length + 2) & 0xff;
  out.set(body, 4);
  return out;
}

/** Вставляет сегменты сразу после SOI. */
export function insertSegments(jpg: Uint8Array, ...segs: Uint8Array[]): Uint8Array {
  const total = jpg.length + segs.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(total);
  out.set(jpg.subarray(0, 2), 0);
  let o = 2;
  for (const s of segs) { out.set(s, o); o += s.length; }
  out.set(jpg.subarray(2), o);
  return out;
}

export function exifSegment(o: number, littleEndian = true): Uint8Array {
  const tiff = tiffWithOrientation(o, littleEndian);
  const body = new Uint8Array(6 + tiff.length);
  body.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  body.set(tiff, 6);
  return segment(0xe1, body);
}

/** Минимальный ICC-профиль с тегом desc. */
export function iccSegment(description: string, colorSpace = 'RGB '): Uint8Array {
  const descTag = new Uint8Array(12 + description.length + 1 + 67 + 3);
  const tdv = new DataView(descTag.buffer);
  descTag.set([0x64, 0x65, 0x73, 0x63], 0); // 'desc'
  tdv.setUint32(8, description.length + 1);
  for (let i = 0; i < description.length; i++) descTag[12 + i] = description.charCodeAt(i);
  const size = 128 + 4 + 12 + descTag.length;
  const p = new Uint8Array(size);
  const dv = new DataView(p.buffer);
  dv.setUint32(0, size);
  for (let i = 0; i < 4; i++) p[16 + i] = colorSpace.charCodeAt(i);
  p.set([0x61, 0x63, 0x73, 0x70], 36); // 'acsp'
  dv.setUint32(128, 1);
  p.set([0x64, 0x65, 0x73, 0x63], 132);
  dv.setUint32(136, 144);
  dv.setUint32(140, descTag.length);
  p.set(descTag, 144);
  const head = new TextEncoder().encode('ICC_PROFILE\0');
  const body = new Uint8Array(head.length + 2 + p.length);
  body.set(head, 0);
  body[head.length] = 1; body[head.length + 1] = 1;
  body.set(p, head.length + 2);
  return segment(0xe2, body);
}

/** Шум — плохо сжимается, удобно для проверки лимита размера. */
export function noise(seed = 1): Fill {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 255;
  return () => [rnd(), rnd(), rnd()];
}

export const gradient: Fill = (x, y) => [(x * 7) % 256, (y * 5) % 256, ((x + y) * 3) % 256];

/** Плавный «фотоподобный» рисунок с зерном амплитуды amp — сжимается как обычное фото. */
export function texture(amp = 20, seed = 5): Fill {
  let s = seed;
  return (x, y) => {
    const out: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const n = (s / 0x7fffffff - 0.5) * 2 * amp;
      out[c] = Math.max(0, Math.min(255, 128 + 90 * Math.sin(x / 37 + c) * Math.cos(y / 53) + n));
    }
    return out;
  };
}
