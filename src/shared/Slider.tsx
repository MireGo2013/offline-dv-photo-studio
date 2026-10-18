import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onInput: (v: number) => void;
  /** Вызывается по окончании перетаскивания или ввода — фиксирует шаг в истории. */
  onCommit: () => void;
  /** Во сколько раз число в поле больше значения ползунка (например, 100 для процентов). */
  factor?: number;
  /** Знаков после точки в поле ввода. */
  decimals?: number;
  unit?: string;
  /** Пояснение рядом с числом. */
  note?: string;
  testId?: string;
}

/** Разбирает число с точкой или запятой; null — если введено не число. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}

export function Slider(p: Props) {
  const factor = p.factor ?? 1;
  const decimals = p.decimals ?? 0;
  const shown = (p.value * factor).toFixed(decimals);
  // Пока поле в фокусе, показываем то, что набрано, а не округлённое значение.
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? null : parseNumber(draft);
  const clamp = (v: number) => Math.min(p.max, Math.max(p.min, v));

  // Нативное change приходит при отпускании ползунка, даже если курсор ушёл с него
  // (React вешает onChange на событие input, а pointerup за пределами ползунка не приходит).
  const range = useRef<HTMLInputElement>(null);
  const commit = useRef(p.onCommit);
  commit.current = p.onCommit;
  useEffect(() => {
    const el = range.current!;
    const done = () => commit.current();
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);

  const type = (text: string) => {
    setDraft(text);
    const v = parseNumber(text);
    if (v !== null) p.onInput(clamp(v / factor));
  };
  const finish = () => {
    setDraft(null);
    p.onCommit();
  };

  return (
    <div className="slider">
      <span className="slider-head">
        <label htmlFor={p.testId ? `${p.testId}-num` : undefined}>{p.label}</label>
        <span className="slider-value">
          {p.note && <span>{p.note}</span>}
          <input
            id={p.testId ? `${p.testId}-num` : undefined}
            className="slider-num"
            type="text"
            inputMode="decimal"
            value={draft ?? shown}
            aria-label={p.label}
            aria-invalid={draft !== null && parsed === null}
            data-testid={p.testId ? `${p.testId}-num` : undefined}
            onFocus={(e) => { setDraft(shown); e.currentTarget.select(); }}
            onChange={(e) => type(e.target.value)}
            onBlur={finish}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
          />
          {p.unit && <span>{p.unit}</span>}
        </span>
      </span>
      <input
        ref={range}
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        aria-label={p.label}
        data-testid={p.testId}
        onChange={(e) => p.onInput(Number(e.target.value))}
        onKeyUp={p.onCommit}
        onBlur={p.onCommit}
      />
    </div>
  );
}
