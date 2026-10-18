import { flattenOn, renderCrop, type Source } from '../processing/render';
import { eyeLineAngle, toOutput, toSource, type Crop, type Landmarks, type Pt } from '../shared/geometry';
import { detectFaces, segment, type DetectedFace } from './vision';

/** Индексы точек сетки лица MediaPipe (478 точек). */
export const LM = {
  chin: 152,
  foreheadTop: 10,
  irisA: 468,
  irisB: 473,
  cheekA: 234,
  cheekB: 454,
} as const;

export type CrownSource = 'mask' | 'estimate' | 'manual';

export interface FaceAnalysis {
  faceCount: number;
  /** Автоматически найденные ориентиры (исходные координаты). */
  landmarks: Landmarks | null;
  crownSource: CrownSource;
  /** Пояснение, как найдена макушка. */
  crownNote: string;
  /** Макушка упирается в верхний край исходного снимка. */
  crownAtImageEdge: boolean;
  pose: DetectedFace['pose'];
  blendshapes: Record<string, number>;
  /** Рамка лица по сетке точек (исходные координаты). */
  faceBox: DetectedFace['box'] | null;
  /** Ширина лица между скулами (для кисти, шаблонов). */
  faceWidth: number;
}

const HEAD_REGION_PX = 512;

export async function analyzeFace(src: Source): Promise<FaceAnalysis> {
  const faces = await detectFaces(src);
  if (!faces.length) {
    return {
      faceCount: 0, landmarks: null, crownSource: 'estimate', crownNote: '', crownAtImageEdge: false,
      pose: null, blendshapes: {}, faceBox: null, faceWidth: 0,
    };
  }
  // Если лиц несколько — берём самое крупное, но сообщаем об этом в проверках.
  const face = [...faces].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  const P = face.points;
  const [ia, ib] = [P[LM.irisA], P[LM.irisB]];
  const eyeL = ia.x <= ib.x ? ia : ib;
  const eyeR = ia.x <= ib.x ? ib : ia;
  const chin = P[LM.chin];
  const forehead = P[LM.foreheadTop];
  const faceWidth = Math.hypot(P[LM.cheekA].x - P[LM.cheekB].x, P[LM.cheekA].y - P[LM.cheekB].y);

  const partial: Landmarks = { crown: forehead, chin: pt(chin), eyeL: pt(eyeL), eyeR: pt(eyeR) };
  const crown = await findCrown(src, partial, forehead, faceWidth);

  return {
    faceCount: faces.length,
    landmarks: { ...partial, crown: crown.point },
    crownSource: crown.source,
    crownNote: crown.note,
    crownAtImageEdge: crown.point.y <= 2,
    pose: face.pose,
    blendshapes: face.blendshapes,
    faceBox: face.box,
    faceWidth,
  };
}

const pt = (p: Pt): Pt => ({ x: p.x, y: p.y });

/**
 * Ищет макушку (верх волос) по маске сегментации «волосы + лицо» в области
 * над лбом. Если маска ненадёжна — возвращает оценку и помечает её.
 */
async function findCrown(
  src: Source,
  lm: Landmarks,
  forehead: Pt,
  faceWidth: number,
): Promise<{ point: Pt; source: CrownSource; note: string }> {
  const angle = eyeLineAngle(lm);
  const faceH = Math.hypot(lm.chin.x - forehead.x, lm.chin.y - forehead.y);
  const fallback = (note: string) => {
    // Типичное расстояние от верхней точки сетки до макушки — около 35 % высоты «лоб–подбородок».
    const up = { x: Math.sin(angle), y: -Math.cos(angle) };
    return {
      point: { x: forehead.x + up.x * faceH * 0.35, y: forehead.y + up.y * faceH * 0.35 },
      source: 'estimate' as const,
      note,
    };
  };

  const side = faceH * 2.4;
  // Область с центром чуть выше лба, повёрнутая по линии глаз.
  const up = { x: Math.sin(angle), y: -Math.cos(angle) };
  const centre = { x: forehead.x + up.x * faceH * 0.3, y: forehead.y + up.y * faceH * 0.3 };
  const region: Crop = { cx: centre.x, cy: centre.y, size: side, angle };
  const n = HEAD_REGION_PX;
  let masks;
  try {
    const rgba = flattenOn(renderCrop(src, region, n), [255, 255, 255]);
    masks = await segment(new ImageData(new Uint8ClampedArray(rgba.data), n, n));
  } catch (e) {
    return fallback(`Сегментация не выполнена: ${(e as Error).message}`);
  }
  const { width: mw, height: mh, head } = masks;
  const sx = mw / n, sy = mh / n;
  const toRegion = (p: Pt) => toOutput(p, region, n);
  const fr = toRegion(forehead);
  const halfW = ((faceWidth / side) * n) / 2;
  const x0 = Math.max(0, Math.floor((fr.x - halfW * 0.6) * sx));
  const x1 = Math.min(mw - 1, Math.ceil((fr.x + halfW * 0.6) * sx));
  const yLimit = Math.min(mh - 1, Math.floor(fr.y * sy));

  let topRow = Infinity;
  let topCol = -1;
  for (let x = x0; x <= x1; x++) {
    let run = 0;
    for (let y = 0; y <= yLimit; y++) {
      if (head[y * mw + x] > 0.5) {
        run++;
        if (run >= 3) {
          const row = y - 2;
          if (row < topRow) { topRow = row; topCol = x; }
          break;
        }
      } else run = 0;
    }
  }
  if (!Number.isFinite(topRow)) return fallback('Модель не нашла волосы над лбом.');

  const crownRegion = { x: topCol / sx, y: topRow / sy };
  // Расстояние макушки над верхней точкой сетки — должно быть правдоподобным.
  const rise = (fr.y - crownRegion.y) / n * side;
  if (rise < faceH * 0.05 || rise > faceH * 1.0) {
    return fallback('Найденная граница волос выглядит неправдоподобно.');
  }
  if (topRow <= 1) {
    return { point: toSource(crownRegion, region, n), source: 'estimate', note: 'Волосы доходят до края области поиска — макушка может быть выше.' };
  }
  // Точку макушки ставим над центром лица, по высоте найденной границы.
  const centred = toSource({ x: fr.x, y: crownRegion.y }, region, n);
  return { point: centred, source: 'mask', note: 'Макушка найдена по маске волос.' };
}
