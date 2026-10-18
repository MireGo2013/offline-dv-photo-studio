import { describe, expect, it } from 'vitest';
import { parseJpeg, JpegParseError } from '../../src/export/jpegInfo';
import {
  orientationTransform, readTiffOrientation, stripJpegExif, stripOrientation, stripPngExif, stripWebpExif,
  type Orientation,
} from '../../src/photo/exif';
import { sniffImageType } from '../../src/photo/fileType';
import { decodeJpeg, exifSegment, gradient, iccSegment, insertSegments, makeJpeg, tiffWithOrientation } from '../helpers/images';

const applyMatrix = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out; // CRC не нужен для разбора структуры
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

function webp(...chunks: Uint8Array[]): Uint8Array {
  const body = concat(...chunks);
  const head = new Uint8Array(12);
  head.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  head.set([0x57, 0x45, 0x42, 0x50], 8);
  return concat(head, body);
}

describe('определение формата по содержимому', () => {
  it('распознаёт JPEG, PNG и WebP независимо от расширения', () => {
    expect(sniffImageType(makeJpeg(8, 8, gradient))).toBe('jpeg');
    expect(sniffImageType(new Uint8Array([...PNG_SIG, 0, 0, 0, 0]))).toBe('png');
    expect(sniffImageType(webp(riffChunk('VP8 ', new Uint8Array(10))))).toBe('webp');
  });
  it('отвергает посторонние и повреждённые данные', () => {
    expect(sniffImageType(new TextEncoder().encode('GIF89a......'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('ориентация EXIF', () => {
  it('читает Orientation в обоих порядках байтов', () => {
    for (let o = 1; o <= 8; o++) {
      expect(readTiffOrientation(tiffWithOrientation(o, true))).toBe(o);
      expect(readTiffOrientation(tiffWithOrientation(o, false))).toBe(o);
    }
    expect(readTiffOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
  });

  it('вырезает EXIF из JPEG, сохраняя ICC и само изображение', () => {
    const base = makeJpeg(16, 8, gradient);
    const withExif = insertSegments(base, exifSegment(6), iccSegment('sRGB IEC61966-2.1'));
    const before = withExif.slice();
    const r = stripJpegExif(withExif);
    expect(r.orientation).toBe(6);
    expect(r.hadExif).toBe(true);
    expect(parseJpeg(r.bytes).exif).toBe(false);
    expect(parseJpeg(r.bytes).icc?.description).toBe('sRGB IEC61966-2.1');
    // Пиксели не изменились.
    expect(Buffer.from(decodeJpeg(r.bytes).data)).toEqual(Buffer.from(decodeJpeg(base).data));
    // Входной массив не изменён.
    expect(Buffer.from(withExif)).toEqual(Buffer.from(before));
  });

  it('JPEG без EXIF остаётся байт в байт', () => {
    const base = makeJpeg(8, 8, gradient);
    const r = stripOrientation(base, 'jpeg');
    expect(r.orientation).toBe(1);
    expect(r.hadExif).toBe(false);
    expect(Buffer.from(r.bytes)).toEqual(Buffer.from(base));
  });

  it('обрабатывает eXIf в PNG', () => {
    const ihdr = pngChunk('IHDR', new Uint8Array(13));
    const png = concat(new Uint8Array(PNG_SIG), ihdr, pngChunk('eXIf', tiffWithOrientation(8)), pngChunk('IDAT', new Uint8Array(4)), pngChunk('IEND', new Uint8Array()));
    const r = stripPngExif(png);
    expect(r.orientation).toBe(8);
    expect(new TextDecoder().decode(r.bytes)).not.toContain('eXIf');
    expect(r.bytes.length).toBe(png.length - (12 + 26));
  });

  it('обрабатывает EXIF в WebP и сбрасывает флаг VP8X', () => {
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x08; // флаг EXIF
    const exif = concat(new TextEncoder().encode('Exif\0\0'), tiffWithOrientation(3));
    const file = webp(riffChunk('VP8X', vp8x), riffChunk('VP8 ', new Uint8Array(10)), riffChunk('EXIF', exif));
    const r = stripWebpExif(file);
    expect(r.orientation).toBe(3);
    expect(new TextDecoder().decode(r.bytes)).not.toContain('EXIF');
    expect(r.bytes[20] & 0x08).toBe(0);
    expect(new DataView(r.bytes.buffer).getUint32(4, true)).toBe(r.bytes.length - 8);
  });

  it('повреждённая структура JPEG вызывает ошибку', () => {
    const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2, 3]);
    expect(() => stripJpegExif(bad)).toThrow();
  });

  // Эталон: как должен выглядеть пиксель (x, y) исходника после ориентации.
  const expected: Record<Orientation, (x: number, y: number, w: number, h: number) => [number, number]> = {
    1: (x, y) => [x, y],
    2: (x, y, w) => [w - 1 - x, y],
    3: (x, y, w, h) => [w - 1 - x, h - 1 - y],
    4: (x, y, _w, h) => [x, h - 1 - y],
    5: (x, y) => [y, x],
    6: (x, y, _w, h) => [h - 1 - y, x],
    7: (x, y, w, h) => [h - 1 - y, w - 1 - x],
    8: (x, y, w) => [y, w - 1 - x],
  };

  it.each([1, 2, 3, 4, 5, 6, 7, 8] as Orientation[])('матрица ориентации %i переставляет пиксели правильно', (o) => {
    const w = 5, h = 3;
    const t = orientationTransform(o, w, h);
    expect([t.width, t.height]).toEqual(o >= 5 ? [h, w] : [w, h]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Центр пикселя переводится в центр нужного пикселя.
        const [X, Y] = applyMatrix(t.matrix, x + 0.5, y + 0.5);
        expect([X - 0.5, Y - 0.5].map((v) => Math.round(v * 1e6) / 1e6)).toEqual(expected[o](x, y, w, h));
      }
    }
  });
});

describe('разбор JPEG', () => {
  it('читает размеры, глубину и способ кодирования', () => {
    const info = parseJpeg(makeJpeg(600, 600, gradient));
    expect(info).toMatchObject({ width: 600, height: 600, components: 3, precision: 8, process: 'baseline', jfif: true, hasEOI: true, icc: null });
  });

  it('видит обрезанный файл', () => {
    const full = makeJpeg(64, 64, gradient);
    expect(parseJpeg(full.subarray(0, full.length - 200)).hasEOI).toBe(false);
  });

  it('отвергает не-JPEG и файл без сжатых данных', () => {
    expect(() => parseJpeg(new Uint8Array([1, 2, 3, 4]))).toThrow(JpegParseError);
    expect(() => parseJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow(JpegParseError);
  });

  it('распознаёт оттенки серого и CMYK по заголовку кадра', () => {
    const jpg = makeJpeg(16, 16, gradient);
    // Находим SOF0 и подменяем число компонент.
    const find = () => { for (let i = 2; i < jpg.length; i++) if (jpg[i] === 0xff && jpg[i + 1] === 0xc0) return i; return -1; };
    const sof = find();
    const gray = jpg.slice(); gray[sof + 9] = 1;
    const cmyk = jpg.slice(); cmyk[sof + 9] = 4;
    expect(parseJpeg(gray).components).toBe(1);
    expect(parseJpeg(cmyk).components).toBe(4);
  });

  it('читает описание ICC-профиля', () => {
    const jpg = insertSegments(makeJpeg(8, 8, gradient), iccSegment('Display P3'));
    expect(parseJpeg(jpg).icc).toEqual({ colorSpace: 'RGB', description: 'Display P3' });
  });
});
