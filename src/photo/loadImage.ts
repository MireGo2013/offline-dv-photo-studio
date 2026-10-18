import { orientationTransform, stripOrientation, type Orientation } from './exif';
import { KIND_LABEL, MIME, sniffImageType, type ImageKind } from './fileType';

export const MAX_FILE_BYTES = 60 * 1024 * 1024;
/** Рабочая копия ограничивается по длинной стороне — этого с запасом хватает для 600×600. */
export const MAX_WORKING_SIDE = 4096;
export const MIN_SIDE = 200;

export interface LoadedImage {
  name: string;
  kind: ImageKind;
  fileBytes: number;
  orientation: Orientation;
  hadExif: boolean;
  /** Размеры исходного снимка с учётом ориентации. */
  naturalWidth: number;
  naturalHeight: number;
  /** Рабочая копия (правильно ориентированная, возможно уменьшенная). */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Во сколько раз рабочая копия меньше исходника. */
  downscale: number;
}

export class LoadError extends Error {
  constructor(message: string, readonly advice?: string) { super(message); }
}

/**
 * Читает файл, проверяет формат по содержимому, применяет ориентацию EXIF и
 * возвращает рабочую копию на canvas. Исходный File не изменяется.
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (file.size === 0) throw new LoadError('Файл пустой.', 'Выберите другой файл.');
  if (file.size > MAX_FILE_BYTES) {
    throw new LoadError('Файл слишком большой (больше 60 МБ).', 'Уменьшите снимок или выберите другой файл.');
  }
  const original = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImageType(original);
  if (!kind) {
    throw new LoadError(
      'Этот формат не поддерживается или файл повреждён.',
      'Подходят фотографии JPEG, PNG и WebP. HEIC с iPhone сначала сохраните как JPEG.',
    );
  }

  let stripped;
  try {
    // Работаем с копией байтов: исходный массив остаётся нетронутым.
    stripped = stripOrientation(original.slice(), kind);
  } catch {
    throw new LoadError(`Файл ${KIND_LABEL[kind]} повреждён: не удалось разобрать его структуру.`, 'Попробуйте другой файл.');
  }

  let bitmap: ImageBitmap;
  try {
    const blob = new Blob([stripped.bytes as BlobPart], { type: MIME[kind] });
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  } catch {
    throw new LoadError(`Не удалось декодировать изображение ${KIND_LABEL[kind]} — файл, вероятно, повреждён.`, 'Попробуйте другой файл.');
  }

  const t = orientationTransform(stripped.orientation, bitmap.width, bitmap.height);
  if (Math.min(t.width, t.height) < MIN_SIDE) {
    bitmap.close();
    throw new LoadError(
      `Снимок слишком маленький: ${t.width} × ${t.height} пикселей.`,
      'Нужна фотография, где голова занимает хотя бы 300 пикселей по высоте.',
    );
  }
  const downscale = Math.max(1, Math.max(t.width, t.height) / MAX_WORKING_SIDE);
  const width = Math.round(t.width / downscale);
  const height = Math.round(t.height / downscale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height); // прозрачный PNG — на белом
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const [a, b, c, d, e, f] = t.matrix.map((v) => v / downscale);
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(bitmap, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  bitmap.close();

  return {
    name: file.name,
    kind,
    fileBytes: file.size,
    orientation: stripped.orientation,
    hadExif: stripped.hadExif,
    naturalWidth: t.width,
    naturalHeight: t.height,
    canvas,
    width,
    height,
    downscale,
  };
}
