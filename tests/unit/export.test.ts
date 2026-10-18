import { describe, expect, it } from 'vitest';
import { DV, minBytesForSize } from '../../src/checks/requirements';
import { encodeWithinLimits, MIN_QUALITY } from '../../src/export/encode';
import { validateExportFile } from '../../src/export/validateFile';
import { gradient, iccSegment, insertSegments, makeJpeg, noise, texture } from '../helpers/images';

const status = (r: ReturnType<typeof validateExportFile>, id: string) => r.checks.find((c) => c.id === id)?.status;

describe('официальные константы', () => {
  it('соответствуют требованиям Госдепартамента', () => {
    expect(DV).toMatchObject({ exportSize: 600, minSize: 600, maxSize: 1200, maxBytes: 240_000, maxCompressionRatio: 20, headMin: 0.5, headMax: 0.69, eyeMin: 0.56, eyeMax: 0.69 });
    expect(minBytesForSize(600)).toBe(54_000);
  });
});

describe('проверка готового файла', () => {
  it('нормальный JPEG 600×600 проходит все проверки', () => {
    const jpg = makeJpeg(600, 600, texture(20), 80);
    expect(jpg.length).toBeGreaterThan(54_000);
    expect(jpg.length).toBeLessThanOrEqual(240_000);
    const r = validateExportFile(jpg, { decoded: true, hasColor: true });
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
    expect(r.info).toMatchObject({ width: 600, height: 600 });
  });

  it('размер 800×800 — допустим, но требует внимания', () => {
    expect(status(validateExportFile(makeJpeg(800, 800, gradient)), 'file-size-px')).toBe('warn');
  });

  it('слишком маленькое, слишком большое и неквадратное разрешение — не соответствует', () => {
    expect(status(validateExportFile(makeJpeg(500, 500, gradient)), 'file-size-px')).toBe('fail');
    expect(status(validateExportFile(makeJpeg(1300, 1300, gradient)), 'file-size-px')).toBe('fail');
    const r = validateExportFile(makeJpeg(600, 601, gradient));
    expect(status(r, 'file-square')).toBe('fail');
    expect(status(r, 'file-size-px')).toBe('fail');
  });

  it('файл больше 240 кБ — не соответствует', () => {
    const big = makeJpeg(600, 600, noise(7), 100);
    expect(big.length).toBeGreaterThan(240_000);
    expect(status(validateExportFile(big), 'file-bytes')).toBe('fail');
  });

  it('слишком сильное сжатие (меньше 54 000 байт для 600×600) — требует внимания', () => {
    const tiny = makeJpeg(600, 600, () => [250, 250, 250], 50);
    expect(tiny.length).toBeLessThan(54_000);
    expect(status(validateExportFile(tiny), 'file-compression')).toBe('warn');
  });

  it('проверяет содержимое, а не расширение: PNG-байты — не JPEG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const r = validateExportFile(png);
    expect(status(r, 'file-format')).toBe('fail');
    expect(r.checks[0].message).toContain('PNG');
  });

  it('повреждённый JPEG — не соответствует', () => {
    const jpg = makeJpeg(600, 600, gradient);
    const r = validateExportFile(jpg.subarray(0, 300));
    expect(status(r, 'file-format')).toBe('fail');
  });

  it('профиль не-sRGB — не соответствует, sRGB — соответствует', () => {
    const base = makeJpeg(600, 600, texture(20), 80);
    expect(status(validateExportFile(insertSegments(base, iccSegment('Display P3'))), 'file-srgb')).toBe('fail');
    expect(status(validateExportFile(insertSegments(base, iccSegment('sRGB IEC61966-2.1'))), 'file-srgb')).toBe('pass');
    expect(status(validateExportFile(base), 'file-srgb')).toBe('pass');
  });

  it('чёрно-белое содержимое и ошибка декодирования отмечаются', () => {
    const r = validateExportFile(makeJpeg(600, 600, texture(20), 80), { decoded: false, hasColor: false });
    expect(status(r, 'file-color')).toBe('fail');
    expect(status(r, 'file-decode')).toBe('fail');
  });
});

describe('подбор качества JPEG', () => {
  // Модель кодировщика: размер монотонно растёт с качеством.
  const model = (k: number) => async (q: number) => new Uint8Array(Math.round(k * Math.exp(4 * q)));

  it('если файл помещается сразу, качество не снижается', async () => {
    const r = await encodeWithinLimits(model(3000), 600);
    expect(r.quality).toBe(0.95);
    expect(r.reduced).toBe(false);
    expect(r.fitsMax && r.fitsRatio).toBe(true);
  });

  it('снижает качество ровно настолько, чтобы уложиться в 240 000 байт', async () => {
    const r = await encodeWithinLimits(model(8000), 600);
    expect(r.reduced).toBe(true);
    expect(r.bytes.length).toBeLessThanOrEqual(240_000);
    expect(r.bytes.length).toBeGreaterThan(230_000); // близко к пределу — качество не занижено зря
    expect(r.quality).toBeGreaterThanOrEqual(MIN_QUALITY);
  });

  it('если не помещается даже при минимальном качестве — честно сообщает', async () => {
    const r = await encodeWithinLimits(model(200_000), 600);
    expect(r.fitsMax).toBe(false);
    expect(r.lowQuality).toBe(true);
  });

  it('слишком маленький файл — пробует качество 1,0', async () => {
    const r = await encodeWithinLimits(model(500), 600);
    expect(r.quality).toBe(1);
  });

  it('работает с настоящим кодировщиком JPEG', async () => {
    const enc = async (q: number) => makeJpeg(600, 600, texture(20), Math.round(q * 100));
    const r = await encodeWithinLimits(enc, 600);
    expect(r.bytes.length).toBeLessThanOrEqual(240_000);
    const v = validateExportFile(r.bytes, { decoded: true, hasColor: true });
    expect(v.checks.filter((c) => c.status !== 'pass')).toEqual([]);
  });
});

describe('несжимаемое изображение', () => {
  it('если даже при минимальном качестве больше 240 кБ — результат помечен как не уложившийся', async () => {
    const enc = async (q: number) => makeJpeg(600, 600, noise(11), Math.round(q * 100));
    const r = await encodeWithinLimits(enc, 600);
    expect(r.fitsMax).toBe(false);
    expect(validateExportFile(r.bytes).checks.find((c) => c.id === 'file-bytes')?.status).toBe('fail');
  });
});
