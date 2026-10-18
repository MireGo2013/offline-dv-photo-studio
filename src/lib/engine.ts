import { analyzeFace, type FaceAnalysis } from './analyze';
import { renderState, type Rendered } from './pipeline';
import type { EditState } from './state';

export type Job =
  | { type: 'render'; state: EditState; preview: boolean }
  | { type: 'analyze' };

export type WorkerRequest =
  | { type: 'init'; base: string; source: ImageBitmap }
  | { id: number; job: Job };

export type WorkerReply =
  | { id: number; result: Rendered | FaceAnalysis }
  | { id: number; error: string };

/** Обработка снимка: анализ лица и расчёт итогового изображения. */
export interface Engine {
  analyze(): Promise<FaceAnalysis>;
  render(state: EditState, preview: boolean): Promise<Rendered>;
  dispose(): void;
}

/** Снимок закрыт или заменён другим — результат больше не нужен. */
export class EngineCancelled extends Error {}
class WorkerFailed extends Error {}

/**
 * Считает в Web Worker, чтобы не замирал интерфейс: анализ лица и сегментация
 * занимают сотни миллисекунд. Если Worker не запустился или MediaPipe в нём не
 * работает, дальше всё считается в основном потоке — медленнее, но работает.
 */
export function createEngine(src: HTMLCanvasElement): Engine {
  let worker: Worker | null = null;
  let ready: Promise<void> | null = null;
  const waiting = new Map<number, { resolve: (r: never) => void; reject: (e: Error) => void }>();
  let nextId = 0;
  let disposed = false;

  const stop = (error: () => Error) => {
    worker?.terminate();
    worker = null;
    for (const w of waiting.values()) w.reject(error());
    waiting.clear();
  };
  const fallback = (reason: string) => {
    if (!worker) return;
    console.warn(`Расчёт в Worker недоступен (${reason}), считаю в основном потоке.`);
    stop(() => new WorkerFailed());
  };

  try {
    // Классический Worker: загрузчик MediaPipe использует importScripts, в модульном Worker он не работает.
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const r = e.data;
      const w = waiting.get(r.id);
      waiting.delete(r.id);
      if (!w) return;
      if ('result' in r) w.resolve(r.result as never);
      else fallback(r.error);
    };
    worker.onerror = (e) => { e.preventDefault(); fallback(e.message || 'ошибка загрузки'); };
    ready = createImageBitmap(src).then((bitmap) => {
      const msg: WorkerRequest = { type: 'init', base: document.baseURI, source: bitmap };
      worker?.postMessage(msg, [bitmap]);
    });
  } catch (e) {
    worker = null;
    console.warn('Не удалось создать Worker, считаю в основном потоке.', e);
  }

  async function run<T>(job: Job, local: () => Promise<T>): Promise<T> {
    if (disposed) throw new EngineCancelled();
    if (worker && ready) {
      try {
        await ready;
        return await new Promise<T>((resolve, reject) => {
          if (!worker) return reject(new WorkerFailed());
          const id = ++nextId;
          waiting.set(id, { resolve: resolve as (r: never) => void, reject });
          const msg: WorkerRequest = { id, job };
          worker.postMessage(msg);
        });
      } catch (e) {
        if (!(e instanceof WorkerFailed)) throw e;
      }
    }
    return local();
  }

  return {
    analyze: () => run({ type: 'analyze' }, () => analyzeFace(src)),
    render: (state, preview) => run({ type: 'render', state, preview }, () => renderState(src, state, preview)),
    dispose() {
      disposed = true;
      stop(() => new EngineCancelled());
    },
  };
}
