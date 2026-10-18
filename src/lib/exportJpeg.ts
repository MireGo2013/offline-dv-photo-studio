import { hasColor } from './analysis';
import { encodeWithinLimits, type EncodeResult } from './encode';
import type { RGBAImage } from './mask';
import { toCanvas } from './render';
import { validateExportFile, type FileReport } from './validateFile';

export function encodeCanvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Браузер не смог закодировать JPEG'));
        if (blob.type !== 'image/jpeg') return reject(new Error(`Браузер вернул ${blob.type} вместо JPEG`));
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      },
      'image/jpeg',
      quality,
    );
  });
}

export interface Prepared {
  encode: EncodeResult;
  report: FileReport;
}

export async function prepareJpeg(img: RGBAImage): Promise<Prepared> {
  const canvas = toCanvas(img);
  const encode = await encodeWithinLimits((q) => encodeCanvasJpeg(canvas, q), img.width);
  const report = await verifyJpegBytes(encode.bytes);
  return { encode, report };
}

/** Повторная проверка готового файла: разбор маркеров + повторное декодирование. */
export async function verifyJpegBytes(bytes: Uint8Array): Promise<FileReport> {
  let decoded = false;
  let colorful: boolean | undefined;
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const data = ctx.getImageData(0, 0, c.width, c.height);
    colorful = hasColor({ data: data.data, width: c.width, height: c.height });
    decoded = true;
  } catch {
    decoded = false;
  }
  return validateExportFile(bytes, { decoded, hasColor: colorful });
}

export interface SaveResult {
  method: 'picker' | 'download';
  fileName: string;
  /** Байты, прочитанные обратно с диска (только при сохранении через диалог). */
  reread: Uint8Array | null;
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<{
    name: string;
    createWritable: () => Promise<{ write: (d: BlobPart) => Promise<void>; close: () => Promise<void> }>;
    getFile: () => Promise<File>;
  }>;
}

export class SaveCancelled extends Error {}

/**
 * Сохраняет файл на компьютер. В Chrome/Edge открывается системный диалог
 * выбора папки, после записи файл читается обратно для проверки. В других
 * браузерах используется обычное скачивание.
 */
export async function saveJpeg(bytes: Uint8Array, suggestedName: string): Promise<SaveResult> {
  const w = window as unknown as SaveFilePickerWindow;
  if (w.showSaveFilePicker) {
    let handle;
    try {
      handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Фото JPEG', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }],
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new SaveCancelled('Сохранение отменено');
      throw e;
    }
    const writable = await handle.createWritable();
    await writable.write(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
    await writable.close();
    const file = await handle.getFile();
    return { method: 'picker', fileName: handle.name, reread: new Uint8Array(await file.arrayBuffer()) };
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { method: 'download', fileName: suggestedName, reread: null };
}
