import { estimateWhiteBalance, NO_ADJUSTMENTS } from '../../processing/adjust';
import type { Rendered } from '../../processing/pipeline';
import { Slider } from '../../shared/Slider';
import type { EditState } from '../state';
import type { PanelProps } from './types';

export function ColorPanel(p: PanelProps & { rendered: Rendered | null }) {
  const { st } = p;
  const a = st.adj;
  const set = (patch: Partial<EditState['adj']>) => p.preview((s) => ({ ...s, adj: { ...s.adj, ...patch } }));
  const autoWb = () => {
    if (!p.rendered) return;
    const g = estimateWhiteBalance(p.rendered.before, null);
    p.update((s) => ({ ...s, adj: { ...s.adj, wb: g } }));
  };
  return (
    <div className="panel">
      <Slider label="Яркость" min={-1} max={1} step={0.02} value={a.brightness} onInput={(v) => set({ brightness: v })} onCommit={p.commit} factor={100} decimals={1} testId="brightness" />
      <Slider label="Контраст" min={-1} max={1} step={0.02} value={a.contrast} onInput={(v) => set({ contrast: v })} onCommit={p.commit} factor={100} decimals={1} testId="contrast" />
      <Slider label="Тёплый / холодный" min={-1} max={1} step={0.02} value={a.warmth} onInput={(v) => set({ warmth: v })} onCommit={p.commit} factor={100} decimals={1} testId="warmth" />
      <div className="btn-row">
        <button className="btn" onClick={autoWb}>Авто баланс белого</button>
        <button className="btn" disabled={a === NO_ADJUSTMENTS} onClick={() => p.update((s) => ({ ...s, adj: NO_ADJUSTMENTS }))}>Сбросить цвет</button>
      </div>
      {a.wb && <p className="muted">Баланс белого: R×{a.wb[0].toFixed(2)}, G×{a.wb[1].toFixed(2)}, B×{a.wb[2].toFixed(2)}</p>}
      <p className="muted">Поправки ограничены умеренными значениями. Черты лица, выражение и взгляд не изменяются.</p>
    </div>
  );
}
