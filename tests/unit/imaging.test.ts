import { describe, expect, it } from 'vitest';
import { hasColor, laplacianVariance, regionStats } from '../../src/checks/analysis';
import { composeChecks } from '../../src/checks/compose';
import { initialState } from '../../src/editor/state';
import { applyAdjustments, estimateWhiteBalance, NO_ADJUSTMENTS } from '../../src/processing/adjust';
import { applyStrokes, boxMean, compositeOnColor, estimateEdgeColors, guidedFilterColor, adjustAlpha, normalizeMask, type RGBAImage } from '../../src/processing/mask';
import { contextCrop, mergeShoulderMask, resizeMask, warpMask } from '../../src/processing/pipeline';
import { parseNumber } from '../../src/shared/Slider';
import { toOutput, toSource } from '../../src/shared/geometry';

function image(w: number, h: number, f: (x: number, y: number) => [number, number, number]): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = f(x, y);
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe('маска и фон', () => {
  it('boxMean совпадает с прямым подсчётом', () => {
    const w = 9, h = 7, r = 2;
    const src = Float32Array.from({ length: w * h }, (_, i) => (i * 37) % 11);
    const fast = boxMean(src, w, h, r);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
        for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { s += src[yy * w + xx]; n++; }
      expect(fast[y * w + x]).toBeCloseTo(s / n, 4);
    }
  });

  it('управляемый фильтр выдаёт значения 0…1 и сохраняет чёткую границу', () => {
    const w = 40, h = 40;
    const guide = image(w, h, (x) => (x < 20 ? [25, 25, 25] : [230, 230, 230]));
    const p = Float32Array.from({ length: w * h }, (_, i) => (i % w < 18 ? 0 : 1)); // грубая маска смещена
    const q = guidedFilterColor(guide, p, 4, 1e-4);
    expect(Math.min(...q)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...q)).toBeLessThanOrEqual(1);
    // Граница маски прилипает к границе изображения (x = 20).
    expect(q[10 * w + 15]).toBeLessThan(0.3);
    expect(q[10 * w + 25]).toBeGreaterThan(0.7);
  });

  it('пиксели человека (маска = 1) остаются точно исходными, фон становится белым', () => {
    const img = image(10, 10, (x) => (x < 5 ? [120, 80, 60] : [30, 140, 200]));
    const alpha = Float32Array.from({ length: 100 }, (_, i) => (i % 10 < 5 ? 1 : 0));
    const out = compositeOnColor(img, alpha, [255, 255, 255], estimateEdgeColors(img, alpha, 3));
    for (let i = 0; i < 100; i++) {
      const o = i * 4;
      if (i % 10 < 5) expect([...out.data.slice(o, o + 3)]).toEqual([120, 80, 60]);
      else expect([...out.data.slice(o, o + 3)]).toEqual([255, 255, 255]);
    }
  });

  it('подавление ореола убирает цвет старого фона из полупрозрачных прядей', () => {
    // Прядь цвета (40,30,20), смешанная 50/50 с зелёным фоном (0,200,0).
    const fg = [40, 30, 20], bg = [0, 200, 0];
    const mixed = fg.map((v, c) => 0.5 * v + 0.5 * bg[c]) as [number, number, number];
    const img = image(21, 1, (x) => (x < 10 ? (bg as [number, number, number]) : x === 10 ? mixed : (fg as [number, number, number])));
    const alpha = Float32Array.from({ length: 21 }, (_, x) => (x < 10 ? 0 : x === 10 ? 0.5 : 1));
    const plain = compositeOnColor(img, alpha, [255, 255, 255], null);
    const clean = compositeOnColor(img, alpha, [255, 255, 255], estimateEdgeColors(img, alpha, 10));
    const greenPlain = plain.data[10 * 4 + 1] - plain.data[10 * 4];
    const greenClean = clean.data[10 * 4 + 1] - clean.data[10 * 4];
    expect(greenClean).toBeLessThan(greenPlain);
    expect(Math.abs(greenClean - ((0.5 * 30 + 0.5 * 255) - (0.5 * 40 + 0.5 * 255)))).toBeLessThanOrEqual(2);
  });

  it('восстановление цвета не создаёт кромку ярче или темнее соседних пикселей', () => {
    // Тёмный костюм (20,30,60) у края, рядом белое окно; оценка фона ошибочно «белая», хотя тут красная штора.
    const img = image(21, 1, (x) => (x < 10 ? [255, 255, 255] : x === 10 ? [140, 40, 50] : [20, 30, 60]));
    const alpha = Float32Array.from({ length: 21 }, (_, x) => (x < 10 ? 0 : x === 10 ? 0.5 : 1));
    const out = compositeOnColor(img, alpha, [255, 255, 255], estimateEdgeColors(img, alpha, 10));
    const edgePx = [...out.data.slice(40, 43)];
    // Итог в пределах между цветом костюма и белым (с небольшим допуском).
    edgePx.forEach((v, c) => {
      const lo = Math.min([20, 30, 60][c], 255) * 0.5 + 127 - 12;
      expect(v).toBeGreaterThanOrEqual(Math.floor(lo - 60));
      expect(v).toBeLessThanOrEqual(255);
    });
    expect(edgePx[0] - edgePx[2]).toBeLessThan(70); // нет сильного красного или синего сдвига
  });

  it('сдвиг границы маски и мазки кистью', () => {
    const a = Float32Array.from([0.03, 0.3, 0.5, 0.7, 0.97]);
    const wider = adjustAlpha(a, 1), narrower = adjustAlpha(a, -1), same = adjustAlpha(a, 0);
    expect(same[0]).toBe(0); expect(same[4]).toBe(1);
    expect(wider[1]).toBeGreaterThan(same[1]);
    expect(narrower[3]).toBeLessThan(same[3]);
    const m = new Float32Array(20 * 20);
    applyStrokes(m, 20, 20, [{ mode: 'add', radius: 4, points: [{ x: 5, y: 10 }, { x: 15, y: 10 }] }]);
    expect(m[10 * 20 + 10]).toBe(1);
    expect(m[0]).toBe(0);
    applyStrokes(m, 20, 20, [{ mode: 'remove', radius: 3, points: [{ x: 10, y: 10 }] }]);
    expect(m[10 * 20 + 10]).toBe(0);
  });

  it('нормализация маски убирает «пол» фона и «потолок» человека', () => {
    const m = Float32Array.from({ length: 1000 }, (_, i) => (i < 500 ? 0.07 : 0.98));
    const r = normalizeMask(m);
    expect(r[0]).toBe(0);
    expect(r[999]).toBe(1);
  });

  it('масштабирование маски сохраняет постоянные значения', () => {
    const r = resizeMask(new Float32Array(16).fill(0.4), 4, 4, 9, 9);
    expect(r.every((v) => Math.abs(v - 0.4) < 1e-6)).toBe(true);
  });
});

describe('коррекция и анализ', () => {
  it('нулевые поправки не меняют изображение', () => {
    const img = image(4, 4, () => [10, 20, 30]);
    expect(applyAdjustments(img, NO_ADJUSTMENTS)).toBe(img);
  });

  it('поправки умеренные даже на краях шкалы', () => {
    const img = image(2, 2, () => [128, 128, 128]);
    const bright = applyAdjustments(img, { ...NO_ADJUSTMENTS, brightness: 5 }); // значение за пределом шкалы
    expect(bright.data[0]).toBe(168); // не больше +40 уровней
    const warm = applyAdjustments(img, { ...NO_ADJUSTMENTS, warmth: 1 });
    expect(warm.data[0]).toBeLessThanOrEqual(139);
    expect(warm.data[2]).toBeGreaterThanOrEqual(117);
  });

  it('автобаланс белого делает желтоватый фон нейтральным', () => {
    const img = image(20, 20, () => [230, 215, 180]);
    const g = estimateWhiteBalance(img, null)!;
    const out = applyAdjustments(img, { ...NO_ADJUSTMENTS, wb: g });
    const [r, gg, b] = out.data;
    expect(Math.max(r, gg, b) - Math.min(r, gg, b)).toBeLessThan(12);
    expect(estimateWhiteBalance(image(20, 20, () => [200, 200, 200]), null)).toBeNull();
  });

  it('распознаёт чёрно-белое изображение и размытие', () => {
    expect(hasColor(image(30, 30, (x) => [x * 8, x * 8, x * 8]))).toBe(false);
    expect(hasColor(image(30, 30, (x) => [200, 100 + x, 90]))).toBe(true);
    const sharp = image(40, 40, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0]));
    const flat = image(40, 40, () => [128, 128, 128]);
    const rect = { x: 0, y: 0, w: 40, h: 40 };
    expect(laplacianVariance(sharp, rect)).toBeGreaterThan(laplacianVariance(flat, rect));
    expect(regionStats(flat, rect).meanLuma).toBeCloseTo(128, 0);
  });
});

describe('проверки композиции', () => {
  const lm = { crown: { x: 300, y: 60 }, chin: { x: 300, y: 420 }, eyeL: { x: 250, y: 225 }, eyeR: { x: 350, y: 225 } };
  const white = image(600, 600, () => [255, 255, 255]);
  const base = (crop = { cx: 300, cy: 300, size: 600, angle: 0 }, crownSource: 'mask' | 'estimate' = 'mask') => ({
    analysis: null, state: initialState(crop, lm, crownSource, false), imgW: 600, imgH: 600, downscale: 1, after: white, alpha: null, n: 600,
  });
  const st = (r: ReturnType<typeof composeChecks>, id: string) => r.checks.find((c) => c.id === id)?.status;

  it('хороший кадр: голова и глаза соответствуют, фон белый', () => {
    const r = composeChecks(base());
    expect(st(r, 'head')).toBe('pass');
    expect(st(r, 'eyes')).toBe('pass');
    expect(st(r, 'center')).toBe('pass');
    expect(st(r, 'background')).toBe('pass');
    expect(r.manual.every((c) => c.status === 'unknown')).toBe(true);
  });

  it('голова слишком мелкая — не соответствует', () => {
    expect(st(composeChecks(base({ cx: 300, cy: 300, size: 900, angle: 0 })), 'head')).toBe('fail');
  });

  it('приблизительная макушка не выдаётся за точное измерение', () => {
    expect(st(composeChecks(base(undefined, 'estimate')), 'head')).toBe('unknown');
  });

  it('без анализа лицо помечено как «не удалось проверить»', () => {
    expect(st(composeChecks(base()), 'face')).toBe('unknown');
  });

  it('цветной фон без замены — не соответствует', () => {
    const blue = image(600, 600, () => [40, 90, 200]);
    expect(st(composeChecks({ ...base(), after: blue }), 'background')).toBe('fail');
  });

  it('недостаточное разрешение исходника отмечается', () => {
    const r = composeChecks({ ...base({ cx: 150, cy: 150, size: 300, angle: 0 }), imgW: 300, imgH: 300 });
    expect(st(r, 'resolution')).toBe('fail');
  });
});

describe('цветной управляемый фильтр', () => {
  it('разделяет области одинаковой яркости, но разного цвета', () => {
    const w = 40, h = 20;
    // Слева тёмно-синий, справа тёмно-красный примерно той же яркости.
    const img = image(w, h, (x) => (x < 20 ? [30, 40, 110] : [120, 30, 30]));
    const p = Float32Array.from({ length: w * h }, (_, i) => (i % w < 23 ? 1 : 0)); // грубая маска шире на 3 px
    const color = guidedFilterColor(img, p, 4, 1e-3);
    // Суммарная ошибка по строке относительно истинной границы (x = 20).
    const err = (q: Float32Array) => { let s = 0; for (let x = 0; x < w; x++) s += Math.abs(q[5 * w + x] - (x < 20 ? 1 : 0)); return s; };
    expect(err(color)).toBeLessThan(err(p) + 0.2);
    expect(color[5 * w + 10]).toBeGreaterThan(0.9);
    expect(color[5 * w + 35]).toBeLessThan(0.1);
  });
});

describe('защита плеч от «съедания» фоном', () => {
  it('ниже середины кадра плечо сохраняется, если его видит хотя бы одна маска; вверху — только точная маска', () => {
    const n = 100;
    const tight = new Float32Array(n * n); // точная маска «потеряла» всё
    const wide = new Float32Array(n * n).fill(1); // расширенная видит человека везде
    const m = mergeShoulderMask(tight, wide, n);
    expect(m[10 * n + 50]).toBe(0); // верх (волосы, фон над головой) — не трогаем
    expect(m[95 * n + 5]).toBeCloseTo(1, 5); // нижний угол (плечо) — восстановлено
    expect(m[60 * n + 5]).toBeGreaterThan(0); // плавный переход
    expect(m[60 * n + 5]).toBeLessThan(1);
    // Если точная маска видит человека, расширенная ничего не убирает.
    const keep = mergeShoulderMask(new Float32Array(n * n).fill(1), new Float32Array(n * n), n);
    expect(keep.every((v) => v === 1)).toBe(true);
  });

  it('расширенная область содержит кадр целиком и смещена вниз', () => {
    const crop = { cx: 500, cy: 400, size: 300, angle: 0.1 };
    const ctx = contextCrop(crop);
    for (const p of [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 0, y: 600 }, { x: 600, y: 600 }]) {
      const q = toOutput(toSource(p, crop, 600), ctx, 600);
      expect(q.x).toBeGreaterThan(0); expect(q.x).toBeLessThan(600);
      expect(q.y).toBeGreaterThan(0); expect(q.y).toBeLessThan(600);
    }
    // Низ кадра ближе к краю расширенной области меньше, чем верх, — запас больше снизу.
    const top = toOutput(toSource({ x: 300, y: 0 }, crop, 600), ctx, 600).y;
    const bottom = toOutput(toSource({ x: 300, y: 600 }, crop, 600), ctx, 600).y;
    expect(600 - bottom).toBeGreaterThan(top - 60);
  });
});

describe('перенос маски в новый кадр (предпросмотр при перетаскивании)', () => {
  const n = 40;
  const crop = { cx: 100, cy: 100, size: 80, angle: 0.1 };
  const m = new Float32Array(n * n).map((_, i) => (i % n) / n);

  it('тот же кадр — маска не меняется', () => {
    const w = warpMask(m, crop, crop, n);
    for (let i = 0; i < m.length; i++) expect(w[i]).toBeCloseTo(m[i], 4);
  });

  it('сдвиг кадра сдвигает маску, открывшаяся область — фон', () => {
    // Сдвиг на 10 px кадра вправо (вдоль оси кадра с учётом поворота).
    const s = crop.size / n;
    const shifted = { ...crop, cx: crop.cx + Math.cos(crop.angle) * 10 * s, cy: crop.cy + Math.sin(crop.angle) * 10 * s };
    const w = warpMask(m, crop, shifted, n);
    expect(w[20 * n + 5]).toBeCloseTo(m[20 * n + 15], 3);
    expect(w[20 * n + n - 2]).toBe(0);
  });
});

describe('ввод чисел в поле параметра', () => {
  it('понимает точку, запятую, знак; отвергает мусор', () => {
    expect(parseNumber('1.5')).toBe(1.5);
    expect(parseNumber(' -0,25 ')).toBe(-0.25);
    expect(parseNumber('+3')).toBe(3);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('2.')).toBe(2);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber('1.2.3')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });
});
