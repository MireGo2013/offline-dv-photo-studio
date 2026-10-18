import { describe, expect, it } from 'vitest';
import { initHistory, previewStep, redoStep, setStep, settle, undoStep } from '../../src/ui/useHistory';

describe('история правок', () => {
  it('перетаскивание — один шаг истории', () => {
    let h = initHistory(0);
    h = previewStep(h, 1);
    h = previewStep(h, 2);
    h = previewStep(h, (v) => v + 1);
    expect(h.present).toBe(3);
    expect(h.past).toEqual([]);
    h = settle(h);
    expect(h.past).toEqual([0]);
    expect(h.start).toBeNull();
    expect(undoStep(h).present).toBe(0);
  });

  it('перетаскивание без изменений не создаёт шаг', () => {
    const h = settle(previewStep(initHistory(5), 5));
    expect(h.past).toEqual([]);
  });

  it('отмена посреди перетаскивания возвращает к состоянию до него, а поздняя фиксация ничего не портит', () => {
    let h = setStep(initHistory(0), 1);
    h = previewStep(h, 7); // например, колесо мыши: фиксация придёт через 300 мс
    h = undoStep(h);
    expect(h.present).toBe(1);
    expect(h.past).toEqual([0]);
    expect(h.future).toEqual([7]);
    h = settle(h); // отложенная фиксация
    expect(h.present).toBe(1);
    expect(h.past).toEqual([0]);
    expect(redoStep(h).present).toBe(7);
  });

  it('обычная правка посреди перетаскивания сохраняет оба шага', () => {
    let h = previewStep(initHistory(0), 4);
    h = setStep(h, 9);
    expect(h.past).toEqual([0, 4]);
    expect(h.present).toBe(9);
    expect(h.start).toBeNull();
  });
});
