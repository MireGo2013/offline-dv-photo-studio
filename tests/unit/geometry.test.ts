import { describe, expect, it } from 'vitest';
import {
  autoCrop, centerFace, cropMatrix, cropSizeLimits, defaultCrop, measure, outsideParts, panCrop, resizeCrop, toOutput, toSource, zoomCrop,
  type Crop, type Landmarks,
} from '../../src/lib/geometry';
import { DV } from '../../src/lib/requirements';

const outsideFraction = (c: Crop, w: number, h: number) => {
  const o = outsideParts(c, w, h);
  return o.bottom + o.other;
};

const N = 600;
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** Синтетическая голова: макушка, глаза, подбородок; поворот на angle вокруг центра лица. */
function head(cx: number, cy: number, h: number, angleDeg = 0): Landmarks {
  const a = (angleDeg * Math.PI) / 180;
  const p = (dx: number, dy: number) => ({ x: cx + Math.cos(a) * dx - Math.sin(a) * dy, y: cy + Math.sin(a) * dx + Math.cos(a) * dy });
  return { crown: p(0, -h * 0.55), eyeL: p(-h * 0.17, -h * 0.07), eyeR: p(h * 0.17, -h * 0.07), chin: p(0, h * 0.45) };
}

describe('преобразования кадра', () => {
  const crop: Crop = { cx: 800, cy: 600, size: 700, angle: 0.2 };

  it('toOutput и toSource взаимно обратны', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 1234, y: 77 }, { x: 800, y: 600 }]) {
      const q = toSource(toOutput(p, crop, N), crop, N);
      close(q.x, p.x); close(q.y, p.y);
    }
    const c = toOutput({ x: crop.cx, y: crop.cy }, crop, N);
    close(c.x, N / 2); close(c.y, N / 2);
  });

  it('матрица canvas совпадает с toOutput', () => {
    const [a, b, c, d, e, f] = cropMatrix(crop, N);
    for (const p of [{ x: 10, y: 20 }, { x: 900, y: 300 }]) {
      const o = toOutput(p, crop, N);
      close(a * p.x + c * p.y + e, o.x); close(b * p.x + d * p.y + f, o.y);
    }
  });

  it('сдвиг перемещает картинку за курсором, масштаб сохраняет точку под курсором', () => {
    const p = { x: 700, y: 500 };
    const before = toOutput(p, crop, N);
    const moved = toOutput(p, panCrop(crop, 30, -12, N), N);
    close(moved.x - before.x, 30); close(moved.y - before.y, -12);
    const anchor = { x: 100, y: 450 };
    const src = toSource(anchor, crop, N);
    const z = zoomCrop(crop, 1.7, N, anchor);
    close(z.size, crop.size / 1.7);
    const back = toOutput(src, z, N);
    close(back.x, anchor.x); close(back.y, anchor.y);
  });

  it('доля кадра вне снимка', () => {
    expect(outsideFraction({ cx: 500, cy: 500, size: 400, angle: 0 }, 1000, 1000)).toBe(0);
    close(outsideFraction({ cx: 0, cy: 500, size: 400, angle: 0 }, 1000, 1000), 0.5, 1e-9);
  });
});

describe('измерения', () => {
  it('считает высоту головы и глаз от нижнего края', () => {
    const lm: Landmarks = { crown: { x: 300, y: 60 }, chin: { x: 300, y: 420 }, eyeL: { x: 250, y: 225 }, eyeR: { x: 350, y: 225 } };
    const m = measure({ cx: 300, cy: 300, size: 600, angle: 0 }, lm, 600, 600, N);
    close(m.headRatio, 0.6); close(m.eyeRatio, 0.625); close(m.rollDeg, 0); close(m.centerX, 0.5);
    close(m.topMargin, 0.1); close(m.sourceScale, 1);
  });
});

describe('автокадрирование', () => {
  const cases: [string, Landmarks, number, number][] = [
    ['портрет по центру', head(1000, 900, 700), 2000, 2400],
    ['маленькая голова', head(1500, 1200, 300), 3000, 3000],
    ['наклон головы 7°', head(1000, 1000, 600, 7), 2000, 2000],
    ['голова у края снимка', head(300, 500, 500), 2000, 1600],
    ['крупный план', head(500, 520, 900), 1000, 1100],
  ];

  it.each(cases)('%s: голова 50–69 %%, глаза 56–69 %%, всё в кадре', (_name, lm, w, h) => {
    const c = autoCrop(lm, w, h);
    const m = measure(c, lm, w, h, N);
    expect(m.headRatio).toBeGreaterThanOrEqual(DV.headMin + 0.005 - 1e-9);
    expect(m.headRatio).toBeLessThanOrEqual(DV.headMax - 0.005 + 1e-9);
    expect(m.eyeRatio).toBeGreaterThanOrEqual(DV.eyeMin + 0.005 - 1e-9);
    expect(m.eyeRatio).toBeLessThanOrEqual(DV.eyeMax - 0.005 + 1e-9);
    expect(m.topMargin).toBeGreaterThan(0);
    expect(m.bottomMargin).toBeGreaterThan(0);
    expect(Math.abs(m.rollDeg)).toBeLessThan(1);
    expect(Math.abs(m.centerX - 0.5)).toBeLessThan(0.01);
  });

  it('по возможности целится в середину диапазонов', () => {
    const lm = head(1000, 900, 700);
    const m = measure(autoCrop(lm, 2000, 2400), lm, 2000, 2400, N);
    close(m.headRatio, DV.headTarget, 0.02);
    close(m.eyeRatio, DV.eyeTarget, 0.02);
  });

  it('если снимок обрывается под подбородком, кадр не выходит за нижний край, пока это позволяют нормы', () => {
    // Голова 400 px, подбородок на y = 680, снимок заканчивается на y = 820.
    const lm = head(1000, 500, 400);
    const roomy = autoCrop(lm, 2000, 3000);
    expect(outsideParts(roomy, 2000, 3000).bottom).toBe(0);
    const c = autoCrop(lm, 2000, 820);
    const m = measure(c, lm, 2000, 820, N);
    expect(m.outsideBottom).toBe(0);
    expect(m.headRatio).toBeLessThanOrEqual(DV.headMax);
    expect(m.eyeRatio).toBeGreaterThanOrEqual(DV.eyeMin);
    // По сравнению с «просторным» снимком голова крупнее — использован запас нормы.
    expect(m.headRatio).toBeGreaterThan(measure(roomy, lm, 2000, 3000, N).headRatio);
  });

  it('если запаса норм не хватает, выход за нижний край минимален и отражён в измерениях', () => {
    const lm = head(1000, 500, 400);
    const c = autoCrop(lm, 2000, 700);
    const m = measure(c, lm, 2000, 700, N);
    expect(m.outsideBottom).toBeGreaterThan(0);
    expect(m.headRatio).toBeGreaterThan(0.66); // голова у верхней границы нормы
    expect(m.headRatio).toBeLessThanOrEqual(DV.headMax);
  });

  it('без выравнивания наклона угол кадра 0', () => {
    expect(autoCrop(head(1000, 1000, 600, 7), 2000, 2000, { levelTilt: false }).angle).toBe(0);
  });

  it('центрирование лица не меняет масштаб и высоту', () => {
    const lm = head(1000, 900, 700);
    const c = { ...autoCrop(lm, 2000, 2400) };
    const shifted = panCrop(c, 80, 0, N);
    const fixed = centerFace(shifted, lm, N);
    close(fixed.size, c.size);
    const m = measure(fixed, lm, 2000, 2400, N);
    close(m.centerX, 0.5, 1e-6);
    close(m.eyeRatio, measure(c, lm, 2000, 2400, N).eyeRatio, 1e-9);
  });

  it('кадр по умолчанию квадратный и внутри снимка', () => {
    const c = defaultCrop(1200, 1600);
    expect(c.size).toBe(1200);
    expect(outsideFraction(c, 1200, 1600)).toBe(0);
  });
});

describe('изменение размера рамки за угол', () => {
  const limits = { min: 50, max: 5000 };
  const corner = (c: Crop, i: number) => toSource({ x: [0, N, N, 0][i], y: [0, 0, N, N][i] }, c, N);

  it('противоположный угол стоит на месте, кадр квадратный, поворот сохранён', () => {
    const start: Crop = { cx: 500, cy: 400, size: 300, angle: 0.2 };
    for (let i = 0; i < 4; i++) {
      const opp = corner(start, (i + 2) % 4);
      // Тянем угол наружу по диагонали.
      const c0 = corner(start, i);
      const p = { x: opp.x + (c0.x - opp.x) * 1.5, y: opp.y + (c0.y - opp.y) * 1.5 };
      const r = resizeCrop(start, i, p, limits);
      close(r.size, 450, 1e-6);
      expect(r.angle).toBe(start.angle);
      const opp2 = corner(r, (i + 2) % 4);
      close(opp2.x, opp.x, 1e-6); close(opp2.y, opp.y, 1e-6);
      const c1 = corner(r, i);
      close(c1.x, p.x, 1e-6); close(c1.y, p.y, 1e-6);
    }
  });

  it('размер ограничен, а за противоположный угол рамка не выворачивается', () => {
    const start: Crop = { cx: 500, cy: 500, size: 300, angle: 0 };
    expect(resizeCrop(start, 2, { x: 351, y: 351 }, limits).size).toBe(50);
    expect(resizeCrop(start, 2, { x: 0, y: 0 }, limits).size).toBe(50);
    expect(resizeCrop(start, 2, { x: 99999, y: 99999 }, limits).size).toBe(5000);
  });

  it('пределы размера общие для ползунка и рамки', () => {
    expect(cropSizeLimits(1000, 2000)).toEqual({ min: 120, max: 2800 });
  });
});
