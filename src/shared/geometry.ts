import { DV } from '../checks/requirements';

export interface Pt { x: number; y: number }

/**
 * Квадратная область кадрирования в координатах исходного (уже правильно
 * ориентированного) изображения: центр, сторона и угол поворота (радианы).
 * Угол > 0 означает, что кадр повёрнут по часовой стрелке относительно снимка —
 * так компенсируется наклон головы.
 */
export interface Crop { cx: number; cy: number; size: number; angle: number }

/** Ориентиры головы в координатах исходного изображения. */
export interface Landmarks {
  crown: Pt;
  chin: Pt;
  /** Глаз, который на снимке слева. */
  eyeL: Pt;
  /** Глаз, который на снимке справа. */
  eyeR: Pt;
}

export type Matrix = [number, number, number, number, number, number];

const rot = (p: Pt, a: number): Pt => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
};

/** Перевод точки исходника в координаты итогового кадра N×N. */
export function toOutput(p: Pt, crop: Crop, n: number): Pt {
  const q = rot({ x: p.x - crop.cx, y: p.y - crop.cy }, -crop.angle);
  return { x: (q.x / crop.size + 0.5) * n, y: (q.y / crop.size + 0.5) * n };
}

/** Обратный перевод: точка кадра N×N → исходник. */
export function toSource(o: Pt, crop: Crop, n: number): Pt {
  const q = rot({ x: (o.x / n - 0.5) * crop.size, y: (o.y / n - 0.5) * crop.size }, crop.angle);
  return { x: q.x + crop.cx, y: q.y + crop.cy };
}

/** Матрица для canvas setTransform: рисует исходник сразу в кадр N×N. */
export function cropMatrix(crop: Crop, n: number): Matrix {
  const s = n / crop.size;
  const cos = Math.cos(crop.angle), sin = Math.sin(crop.angle);
  const a = s * cos, b = -s * sin, c = s * sin, d = s * cos;
  return [a, b, c, d, n / 2 - (a * crop.cx + c * crop.cy), n / 2 - (b * crop.cx + d * crop.cy)];
}

export function eyeMid(l: Landmarks): Pt {
  return { x: (l.eyeL.x + l.eyeR.x) / 2, y: (l.eyeL.y + l.eyeR.y) / 2 };
}

/** Угол линии глаз на снимке (радианы). */
export function eyeLineAngle(l: Landmarks): number {
  return Math.atan2(l.eyeR.y - l.eyeL.y, l.eyeR.x - l.eyeL.x);
}

export interface Metrics {
  /** Высота головы / высота кадра. */
  headRatio: number;
  /** Высота линии глаз от нижнего края / высота кадра. */
  eyeRatio: number;
  /** Наклон линии глаз в кадре, градусы. */
  rollDeg: number;
  /** Горизонтальное положение центра лица, доля ширины кадра (0,5 — центр). */
  centerX: number;
  /** Отступ макушки от верхнего края, доля. Отрицательный — макушка обрезана. */
  topMargin: number;
  /** Отступ подбородка от нижнего края, доля. */
  bottomMargin: number;
  /** Сколько пикселей исходника приходится на пиксель результата. */
  sourceScale: number;
  /** Доля площади кадра, выходящая за пределы исходного снимка. */
  outsideFraction: number;
  /** Из неё — ниже нижнего края снимка (там, где должны быть плечи). */
  outsideBottom: number;
}

export function measure(crop: Crop, lm: Landmarks, imgW: number, imgH: number, n: number = DV.exportSize): Metrics {
  const crown = toOutput(lm.crown, crop, n);
  const chin = toOutput(lm.chin, crop, n);
  const l = toOutput(lm.eyeL, crop, n);
  const r = toOutput(lm.eyeR, crop, n);
  const eyeY = (l.y + r.y) / 2;
  const out = outsideParts(crop, imgW, imgH);
  return {
    headRatio: (chin.y - crown.y) / n,
    eyeRatio: 1 - eyeY / n,
    rollDeg: (Math.atan2(r.y - l.y, r.x - l.x) * 180) / Math.PI,
    centerX: ((l.x + r.x) / 2 + chin.x) / 2 / n,
    topMargin: crown.y / n,
    bottomMargin: 1 - chin.y / n,
    sourceScale: crop.size / n,
    outsideFraction: out.bottom + out.other,
    outsideBottom: out.bottom,
  };
}

/**
 * Доля кадра вне снимка, отдельно для нижнего края. Пустота снизу заметнее
 * всего: там должны быть плечи, а их не дорисуешь. Сверху и по бокам при
 * белом фоне дополнение почти не видно.
 */
export function outsideParts(crop: Crop, imgW: number, imgH: number): { bottom: number; other: number } {
  const g = 16;
  let bottom = 0, other = 0;
  for (let i = 0; i < g; i++) {
    // Нижнюю часть считаем точно: вдоль столбца кадра y меняется линейно.
    const a = toSource({ x: (i + 0.5) / g, y: 0 }, crop, 1);
    const b = toSource({ x: (i + 0.5) / g, y: 1 }, crop, 1);
    let below: number;
    if (a.y === b.y) below = a.y > imgH ? 1 : 0;
    else below = Math.min(1, Math.max(0, b.y > a.y ? (b.y - imgH) / (b.y - a.y) : (a.y - imgH) / (a.y - b.y)));
    bottom += below / g;
    let side = 0;
    for (let j = 0; j < g; j++) {
      const p = toSource({ x: (i + 0.5) / g, y: (j + 0.5) / g }, crop, 1);
      if (p.y <= imgH && (p.x < 0 || p.y < 0 || p.x > imgW)) side++;
    }
    other += side / (g * g);
  }
  return { bottom, other };
}

export const MAX_AUTO_TILT = (12 * Math.PI) / 180;
/** Наклон меньше этого не исправляем: поворот кадра скашивает края снимка, а проверку такой наклон проходит. */
export const MIN_AUTO_TILT = (1 * Math.PI) / 180;

export interface AutoCropOptions {
  /** Выравнивать наклон головы поворотом кадра. */
  levelTilt?: boolean;
  /** Фон заменяется на белый — дополнение сверху и по бокам почти незаметно. */
  bgReplaced?: boolean;
}

/**
 * Автоматическое кадрирование: подбирает масштаб и положение так, чтобы
 * голова занимала около 60 % высоты, глаза были на ~62,5 % от низа и голова
 * целиком помещалась в кадр. Выход кадра за нижний край снимка (обрезанные
 * плечи) штрафуется сильнее отклонения от середины норм: если снимок
 * обрывается у подбородка, используется весь допустимый диапазон.
 */
export function autoCrop(lm: Landmarks, imgW: number, imgH: number, opts: AutoCropOptions = {}): Crop {
  const { levelTilt = true, bgReplaced = true } = opts;
  const raw = eyeLineAngle(lm);
  const angle = levelTilt && Math.abs(raw) >= MIN_AUTO_TILT ? Math.max(-MAX_AUTO_TILT, Math.min(MAX_AUTO_TILT, raw)) : 0;
  // Работаем в повёрнутой системе координат, где кадр выровнен по осям.
  const crown = rot(lm.crown, -angle);
  const chin = rot(lm.chin, -angle);
  const eye = rot(eyeMid(lm), -angle);
  const head = Math.max(1, chin.y - crown.y);
  const cx = (eye.x + chin.x) / 2;

  let best: { crop: Crop; score: number } | null = null;
  // От границ норм держим запас 0,005; к середине тянет штраф ниже.
  const steps = (lo: number, hi: number) => Array.from({ length: Math.floor((hi - lo) / 0.005 + 1e-6) + 1 }, (_, k) => lo + k * 0.005);
  for (const h of steps(DV.headMin + 0.005, DV.headMax - 0.005)) {
    for (const e of steps(DV.eyeMin + 0.005, DV.eyeMax - 0.005)) {
      const size = head / h;
      const top = eye.y - (1 - e) * size;
      const topMargin = (crown.y - top) / size;
      const bottomMargin = (top + size - chin.y) / size;
      if (topMargin < 0.02 || bottomMargin < 0.03) continue;
      const centre = rot({ x: cx, y: top + size / 2 }, angle);
      const crop = { cx: centre.x, cy: centre.y, size, angle };
      const out = outsideParts(crop, imgW, imgH);
      const score =
        (h - DV.headTarget) ** 2 + (e - DV.eyeTarget) ** 2 +
        out.bottom * 4 + out.other * (bgReplaced ? 0.02 : 0.5);
      if (!best || score < best.score) best = { crop, score };
    }
  }
  if (best) return best.crop;
  // Пропорции лица необычные — просто центрируем голову.
  const size = head / DV.headTarget;
  const centre = rot({ x: cx, y: (crown.y + chin.y) / 2 }, angle);
  return { cx: centre.x, cy: centre.y, size, angle };
}

/** Начальный кадр без анализа: наибольший квадрат по центру, ближе к верху. */
export function defaultCrop(imgW: number, imgH: number): Crop {
  const size = Math.min(imgW, imgH);
  return { cx: imgW / 2, cy: imgH > imgW ? size / 2 + (imgH - size) * 0.2 : imgH / 2, size, angle: 0 };
}

/** Сдвиг кадра на (dx, dy) пикселей результата (картинка «тянется» за курсором). */
export function panCrop(crop: Crop, dx: number, dy: number, n: number): Crop {
  const d = rot({ x: (-dx / n) * crop.size, y: (-dy / n) * crop.size }, crop.angle);
  return { ...crop, cx: crop.cx + d.x, cy: crop.cy + d.y };
}

/** Масштабирование вокруг точки кадра (по умолчанию — центра). zoom > 1 — приблизить. */
export function zoomCrop(crop: Crop, zoom: number, n: number, anchor: Pt = { x: n / 2, y: n / 2 }): Crop {
  const fixed = toSource(anchor, crop, n);
  const size = crop.size / zoom;
  const next = { ...crop, size };
  const moved = toSource(anchor, next, n);
  return { ...next, cx: next.cx + fixed.x - moved.x, cy: next.cy + fixed.y - moved.y };
}

/** Допустимый размер стороны кадра (в пикселях снимка) — общий для ползунка и рамки. */
export function cropSizeLimits(imgW: number, imgH: number): { min: number; max: number } {
  return { min: Math.min(imgW, imgH) * 0.12, max: Math.max(imgW, imgH) * 1.4 };
}

/** Знаки углов кадра в его системе координат: 0 — левый верхний, дальше по часовой. */
export const CORNERS: readonly Pt[] = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];

/**
 * Изменение размера кадра за угол: противоположный угол стоит на месте, кадр
 * остаётся квадратным и сохраняет поворот. p — положение курсора на снимке.
 */
export function resizeCrop(start: Crop, corner: number, p: Pt, limits: { min: number; max: number }): Crop {
  const { x: sx, y: sy } = CORNERS[corner];
  const half = start.size / 2;
  const opp = rot({ x: -sx * half, y: -sy * half }, start.angle);
  const fixed = { x: start.cx + opp.x, y: start.cy + opp.y };
  const d = rot({ x: p.x - fixed.x, y: p.y - fixed.y }, -start.angle);
  const size = Math.min(limits.max, Math.max(limits.min, sx * d.x, sy * d.y));
  const c = rot({ x: (sx * size) / 2, y: (sy * size) / 2 }, start.angle);
  return { ...start, size, cx: fixed.x + c.x, cy: fixed.y + c.y };
}

/** Поворот кадра вокруг его центра. */
export function rotateCrop(crop: Crop, angle: number): Crop {
  return { ...crop, angle };
}

/** Горизонтальное центрирование лица без изменения масштаба и высоты. */
export function centerFace(crop: Crop, lm: Landmarks, n: number): Crop {
  const m = toOutput(eyeMid(lm), crop, n);
  const c = toOutput(lm.chin, crop, n);
  const dx = n / 2 - (m.x + c.x) / 2;
  return panCrop(crop, dx, 0, n);
}
