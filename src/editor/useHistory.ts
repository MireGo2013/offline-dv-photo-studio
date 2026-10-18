import { useCallback, useState } from 'react';

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Состояние до начала перетаскивания; null — перетаскивания нет. */
  start: { value: T } | null;
}

type Update<T> = T | ((prev: T) => T);

const LIMIT = 100;
const apply = <T,>(next: Update<T>, prev: T): T => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next);

export const initHistory = <T,>(value: T): History<T> => ({ past: [], present: value, future: [], start: null });

/** Закрывает незавершённое перетаскивание одним шагом истории. */
export function settle<T>(h: History<T>): History<T> {
  if (!h.start) return h;
  if (Object.is(h.start.value, h.present)) return { ...h, start: null };
  return { past: [...h.past, h.start.value].slice(-LIMIT), present: h.present, future: [], start: null };
}

/** Временное изменение без записи в историю (перетаскивание). */
export function previewStep<T>(h: History<T>, next: Update<T>): History<T> {
  return { ...h, present: apply(next, h.present), start: h.start ?? { value: h.present } };
}

export function setStep<T>(prev: History<T>, next: Update<T>): History<T> {
  const h = settle(prev);
  const value = apply(next, h.present);
  if (Object.is(value, h.present)) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: value, future: [], start: null };
}

export function undoStep<T>(prev: History<T>): History<T> {
  const h = settle(prev);
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], start: null };
}

export function redoStep<T>(prev: History<T>): History<T> {
  const h = settle(prev);
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), start: null };
}

/**
 * История изменений с отменой/повтором. Во время перетаскивания состояние
 * меняется «временно» (preview), а в историю попадает один шаг (commit).
 * Отмена, повтор и обычная правка посреди перетаскивания сначала закрывают его.
 */
export function useHistory<T>(initial: T) {
  const [h, setH] = useState(() => initHistory(initial));
  const set = useCallback((next: Update<T>) => setH((cur) => setStep(cur, next)), []);
  const preview = useCallback((next: Update<T>) => setH((cur) => previewStep(cur, next)), []);
  const commit = useCallback(() => setH(settle), []);
  const undo = useCallback(() => setH(undoStep), []);
  const redo = useCallback(() => setH(redoStep), []);
  const reset = useCallback((value: T) => setH(initHistory(value)), []);
  const settled = settle(h);

  return {
    state: h.present,
    set,
    preview,
    commit,
    undo,
    redo,
    reset,
    previewing: h.start !== null,
    canUndo: settled.past.length > 0,
    canRedo: settled.future.length > 0,
  };
}
