import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineCancelled, type Engine } from '../lib/engine';
import type { Rendered } from '../lib/pipeline';
import type { EditState } from '../lib/state';

interface Job { engine: Engine; st: EditState; preview: boolean }

/** Через столько миллисекунд без изменений предпросмотр заменяется полным расчётом. */
const IDLE_FULL_MS = 300;

/**
 * Пересчитывает изображение при каждом изменении состояния. Расчёты идут по
 * одному: пока считается текущий, копится только последний запрос.
 * Пока тянут мышью (previewing) — быстрый предпросмотр. Полный расчёт — после
 * отпускания или когда кадр замер: сигнал об отпускании может потеряться
 * (ползунок отпустили за его пределами, число ввели и не нажали Enter).
 */
export function useRenderer(engine: Engine | null, st: EditState | null, previewing: boolean) {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const pending = useRef<Job | null>(null);
  const current = useRef<Engine | null>(null);
  /** Последний полный расчёт — чтобы не повторять его после отпускания мыши. */
  const lastFull = useRef<{ engine: Engine; st: EditState } | null>(null);

  const enqueue = useCallback((job: Job) => {
    if (!job.preview && lastFull.current?.engine === job.engine && lastFull.current.st === job.st) return;
    pending.current = job;
    if (busy.current) return;
    busy.current = true;
    setRendering(true);
    void (async () => {
      try {
        while (pending.current) {
          const j = pending.current;
          pending.current = null;
          try {
            const r = await j.engine.render(j.st, j.preview);
            if (j.engine !== current.current) continue;
            setRendered(r);
            setError(null);
            if (!j.preview) lastFull.current = { engine: j.engine, st: j.st };
          } catch (e) {
            if (!(e instanceof EngineCancelled)) setError(`Не удалось построить изображение: ${(e as Error).message}`);
          }
        }
      } finally {
        busy.current = false;
        setRendering(false);
      }
    })();
  }, []);

  useEffect(() => {
    current.current = engine;
    lastFull.current = null;
    setRendered(null);
    setError(null);
  }, [engine]);

  useEffect(() => {
    if (!engine || !st) return;
    enqueue({ engine, st, preview: previewing });
    if (!previewing) return;
    const t = window.setTimeout(() => enqueue({ engine, st, preview: false }), IDLE_FULL_MS);
    return () => window.clearTimeout(t);
  }, [engine, st, previewing, enqueue]);

  /** Полный расчёт вне очереди — для сохранения, чтобы файл точно совпадал с состоянием. */
  const renderFinal = useCallback((s: EditState) => {
    if (!engine) return Promise.reject(new Error('Снимок не загружен'));
    return engine.render(s, false);
  }, [engine]);

  return { rendered, rendering, error, renderFinal };
}
