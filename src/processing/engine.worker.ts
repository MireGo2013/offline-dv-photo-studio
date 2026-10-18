import { analyzeFace, type FaceAnalysis } from '../face/analyze';
import { faceLandmarker, segmenter, setAssetBase } from '../face/vision';
import type { Job, WorkerReply, WorkerRequest } from './engine';
import { renderState, type Rendered } from './pipeline';

/** Поток обработки снимка: анализ лица и расчёт итогового изображения (см. engine.ts). */
// Типы webworker конфликтуют с DOM в одном tsconfig, поэтому описываем только нужное.
const scope = self as unknown as {
  onmessage: (e: MessageEvent<WorkerRequest>) => void;
  postMessage(msg: WorkerReply, transfer: Transferable[]): void;
};
let source: ImageBitmap | null = null;
// Задания выполняются строго по одному: у конвейера общий кэш маски и рабочий холст.
let queue: Promise<void> = Promise.resolve();

async function perform(job: Job): Promise<{ result: Rendered | FaceAnalysis; transfer: Transferable[] }> {
  if (!source) throw new Error('Снимок ещё не передан в Worker');
  if (job.type === 'analyze') return { result: await analyzeFace(source), transfer: [] };
  const r = await renderState(source, job.state, job.preview);
  const transfer: Transferable[] = [r.before.data.buffer, r.after.data.buffer];
  if (r.alpha) transfer.push(r.alpha.buffer);
  return { result: r, transfer };
}

scope.onmessage = (e) => {
  const msg = e.data;
  if ('type' in msg) {
    setAssetBase(msg.base);
    source?.close();
    source = msg.source;
    // Модели грузятся заранее, пока человек выбирает режим обработки.
    faceLandmarker().catch(() => undefined);
    segmenter().catch(() => undefined);
    return;
  }
  queue = queue.then(async () => {
    try {
      const { result, transfer } = await perform(msg.job);
      scope.postMessage({ id: msg.id, result }, transfer);
    } catch (err) {
      scope.postMessage({ id: msg.id, error: (err as Error).message ?? String(err) }, []);
    }
  });
};
