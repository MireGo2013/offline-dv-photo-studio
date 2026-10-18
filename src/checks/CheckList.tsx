import { STATUS_LABEL, worstStatus, type Check, type Status } from './checks';

const ICON: Record<Status, string> = { pass: '✓', fail: '✕', warn: '!', unknown: '?' };

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-icon" aria-hidden>{ICON[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CheckList({ checks, testId }: { checks: Check[]; testId?: string }) {
  return (
    <ul className="checks" data-testid={testId}>
      {checks.map((c) => (
        <li key={c.id} className={`check check-${c.status}`} data-check={c.id} data-status={c.status}>
          <span className={`check-icon icon-${c.status}`} title={STATUS_LABEL[c.status]} aria-label={STATUS_LABEL[c.status]}>
            {ICON[c.status]}
          </span>
          <div className="check-body">
            <div className="check-title">{c.title}</div>
            <div className="check-msg">{c.message}</div>
            {c.advice && c.status !== 'pass' && <div className="check-advice">{c.advice}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Summary({ checks }: { checks: Check[] }) {
  const s = worstStatus(checks);
  const counts = (['pass', 'warn', 'fail', 'unknown'] as Status[]).map((st) => [st, checks.filter((c) => c.status === st).length] as const);
  const text: Record<Status, string> = {
    pass: 'Все автоматические проверки пройдены.',
    warn: 'Есть замечания — посмотрите пункты, отмеченные «Требует внимания».',
    fail: 'Есть несоответствия — их нужно исправить или переснять фото.',
    unknown: 'Часть параметров не удалось проверить автоматически.',
  };
  return (
    <div className={`summary summary-${s}`} data-testid="summary" data-status={s}>
      <div>{text[s]}</div>
      <div className="summary-counts">
        {counts.filter(([, k]) => k > 0).map(([st, k]) => (
          <span key={st} className={`count count-${st}`}>{STATUS_LABEL[st]}: {k}</span>
        ))}
      </div>
    </div>
  );
}

export function Details({ checks }: { checks: Check[] }) {
  const withDetails = checks.filter((c) => c.details);
  if (!withDetails.length) return null;
  return (
    <details className="tech">
      <summary>Технические подробности</summary>
      <dl>
        {withDetails.map((c) => (
          <div key={c.id}>
            <dt>{c.title}</dt>
            <dd>{c.details}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
