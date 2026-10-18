export function Metric({ label, value, min, max, uncertain }: { label: string; value: number; min: number; max: number; uncertain?: boolean }) {
  const ok = value >= min && value <= max;
  return (
    <div className={`metric ${uncertain ? 'metric-unknown' : ok ? 'metric-ok' : 'metric-bad'}`}>
      <span>{label}</span>
      <b>{(value * 100).toFixed(1).replace('.', ',')} %</b>
      <small>норма {Math.round(min * 100)}–{Math.round(max * 100)} %{uncertain ? ' · уточните макушку' : ''}</small>
    </div>
  );
}
