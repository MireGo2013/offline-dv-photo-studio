export type Status = 'pass' | 'fail' | 'warn' | 'unknown';

export const STATUS_LABEL: Record<Status, string> = {
  pass: 'Соответствует',
  fail: 'Не соответствует',
  warn: 'Требует внимания',
  unknown: 'Не удалось проверить автоматически',
};

export interface Check {
  id: string;
  title: string;
  status: Status;
  /** Понятное объяснение результата. */
  message: string;
  /** Что можно сделать. */
  advice?: string;
  /** Технические подробности для расширенного блока. */
  details?: string;
}

export function worstStatus(checks: Check[]): Status {
  const order: Status[] = ['fail', 'unknown', 'warn', 'pass'];
  for (const s of order) if (checks.some((c) => c.status === s)) return s;
  return 'pass';
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits).replace('.', ',')} %`;
}

export function formatBytes(n: number): string {
  if (n < 1000) return `${n} Б`;
  return `${(n / 1000).toFixed(1).replace('.', ',')} кБ (${n.toLocaleString('ru-RU')} байт)`;
}
