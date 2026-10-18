import { FaceLandmarker, FilesetResolver, ImageSegmenter, type ImageSource } from '@mediapipe/tasks-vision';
import type { Pt } from './geometry';

/**
 * Локальные модели MediaPipe. Файлы WebAssembly и моделей лежат в папке
 * приложения (public/), поэтому распознавание работает без интернета.
 */
let assetBase = typeof document === 'undefined' ? '' : document.baseURI;
/** В Worker нет document — адрес страницы передаёт основной поток. */
export const setAssetBase = (base: string) => { assetBase = base; };
const asset = (p: string) => new URL(p, assetBase).href;

let facePromise: Promise<FaceLandmarker> | null = null;
let segPromise: Promise<ImageSegmenter> | null = null;
let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;

function fileset() {
  filesetPromise ??= FilesetResolver.forVisionTasks(asset('mediapipe/wasm'));
  return filesetPromise;
}

export function faceLandmarker(): Promise<FaceLandmarker> {
  facePromise ??= fileset().then((fs) =>
    FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: asset('models/face_landmarker.task'), delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 4,
      minFaceDetectionConfidence: 0.5,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    }),
  );
  facePromise.catch(() => { facePromise = null; });
  return facePromise;
}

export function segmenter(): Promise<ImageSegmenter> {
  segPromise ??= fileset().then((fs) =>
    ImageSegmenter.createFromOptions(fs, {
      baseOptions: { modelAssetPath: asset('models/selfie_multiclass_256x256.tflite'), delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    }),
  );
  segPromise.catch(() => { segPromise = null; });
  return segPromise;
}

export interface DetectedFace {
  /** 478 точек в пикселях изображения (z — относительная глубина). */
  points: (Pt & { z: number })[];
  blendshapes: Record<string, number>;
  /** Поворот головы, градусы: yaw — влево/вправо, pitch — вверх/вниз, roll — наклон к плечу. */
  pose: { yaw: number; pitch: number; roll: number } | null;
  box: { x: number; y: number; w: number; h: number };
}

export async function detectFaces(img: ImageSource & { width: number; height: number }): Promise<DetectedFace[]> {
  const fl = await faceLandmarker();
  const res = fl.detect(img);
  const w = img.width, h = img.height;
  return res.faceLandmarks.map((lms, i) => {
    const points = lms.map((p) => ({ x: p.x * w, y: p.y * h, z: p.z * w }));
    const blend: Record<string, number> = {};
    for (const c of res.faceBlendshapes?.[i]?.categories ?? []) blend[c.categoryName] = c.score;
    const m = res.facialTransformationMatrixes?.[i];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return {
      points,
      blendshapes: blend,
      pose: m ? poseFromMatrix(m.data) : null,
      box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    };
  });
}

/** Углы Эйлера из матрицы 4×4 (хранится по столбцам). */
export function poseFromMatrix(d: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  // r(i,j) — строка i, столбец j.
  const r = (i: number, j: number) => d[j * 4 + i];
  const deg = 180 / Math.PI;
  const yaw = Math.asin(Math.max(-1, Math.min(1, -r(2, 0)))) * deg;
  const pitch = Math.atan2(r(2, 1), r(2, 2)) * deg;
  const roll = Math.atan2(r(1, 0), r(0, 0)) * deg;
  return { yaw, pitch, roll };
}

/** Классы модели selfie_multiclass_256x256: 0 фон, 1 волосы, 2 кожа тела, 3 кожа лица, 4 одежда, 5 прочее. */
export interface SegMasks {
  width: number;
  height: number;
  /** Вероятность «человек» = 1 − фон. */
  person: Float32Array;
  /** Вероятность «голова»: волосы + кожа лица + аксессуары. */
  head: Float32Array;
}

export async function segment(img: ImageSource): Promise<SegMasks> {
  const s = await segmenter();
  const res = s.segment(img);
  try {
    const masks = res.confidenceMasks;
    if (!masks || masks.length < 6) throw new Error('Модель сегментации вернула неожиданный результат');
    const width = masks[0].width, height = masks[0].height;
    const bg = masks[0].getAsFloat32Array();
    const hair = masks[1].getAsFloat32Array();
    const face = masks[3].getAsFloat32Array();
    const other = masks[5].getAsFloat32Array();
    const n = width * height;
    const person = new Float32Array(n);
    const head = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      person[i] = 1 - bg[i];
      head[i] = Math.min(1, hair[i] + face[i] + other[i]);
    }
    return { width, height, person, head };
  } finally {
    res.close?.();
  }
}
