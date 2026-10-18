import { Slider } from '../../shared/Slider';
import type { Tool } from '../Editor';
import type { EditState } from '../state';
import type { PanelProps } from './types';

export function BgPanel(p: PanelProps & {
  tool: Tool; setTool: (t: Tool) => void; brush: number; setBrush: (v: number) => void;
  showMask: boolean; setShowMask: (v: boolean) => void;
}) {
  const { st } = p;
  const bg = st.bg;
  const setBg = (patch: Partial<EditState['bg']>) => p.update((s) => ({ ...s, bg: { ...s.bg, ...patch } }));
  return (
    <div className="panel">
      <label className="toggle">
        <input type="checkbox" checked={bg.replace} onChange={(e) => setBg({ replace: e.target.checked })} data-testid="bg-replace" />
        Заменить фон
      </label>
      {bg.replace && (
        <>
          <div className="radio-row">
            <label><input type="radio" checked={bg.color === 'white'} onChange={() => setBg({ color: 'white' })} /> Белый</label>
            <label><input type="radio" checked={bg.color === 'offwhite'} onChange={() => setBg({ color: 'offwhite' })} /> Почти белый</label>
          </div>
          <Slider
            label="Граница маски" min={-1} max={1} step={0.05} value={bg.edge}
            onInput={(v) => p.preview((s) => ({ ...s, bg: { ...s.bg, edge: v } }))} onCommit={p.commit}
            decimals={2} note={bg.edge === 0 ? 'как есть' : bg.edge > 0 ? 'шире' : 'уже'} testId="edge"
          />
          <label className="toggle">
            <input type="checkbox" checked={bg.decontaminate} onChange={(e) => setBg({ decontaminate: e.target.checked })} />
            Убирать цветной ореол на волосах
          </label>
          <h4>Ручная правка маски</h4>
          <label className="toggle">
            <input type="checkbox" checked={p.showMask} onChange={(e) => p.setShowMask(e.target.checked)} data-testid="show-mask" />
            Подсветить красным то, что заменится фоном
          </label>
          <p className="muted">Если красным задеты плечи, волосы или уши — закрасьте их кистью «Вернуть человеку».</p>
          <div className="seg">
            <button className={p.tool === 'move' ? 'on' : ''} onClick={() => p.setTool('move')}>✋ Двигать фото</button>
            <button className={p.tool === 'add' ? 'on' : ''} onClick={() => p.setTool('add')} data-testid="brush-add">🖌 Вернуть человеку</button>
            <button className={p.tool === 'remove' ? 'on' : ''} onClick={() => p.setTool('remove')}>🧽 Убрать в фон</button>
          </div>
          {p.tool !== 'move' && (
            <Slider label="Размер кисти" min={3} max={60} step={1} value={p.brush} onInput={(v) => p.setBrush(Math.round(v))} onCommit={() => undefined} unit="px" />
          )}
          <div className="btn-row">
            <button className="btn" disabled={!st.strokes.length} onClick={() => p.update((s) => ({ ...s, strokes: s.strokes.slice(0, -1) }))}>Убрать последний мазок</button>
            <button className="btn" disabled={!st.strokes.length} onClick={() => p.update((s) => ({ ...s, strokes: [] }))}>Очистить мазки</button>
          </div>
          <p className="muted">
            Маску строит локальная модель MediaPipe (256×256), края уточняются по изображению. Тонкие пряди на сложном
            фоне могут обрабатываться неидеально — проверьте результат в режиме «Сравнить до/после». Если маска не
            удаётся, надёжнее всего переснять фото на светлой однотонной стене и выключить замену фона.
          </p>
        </>
      )}
      {!bg.replace && <p className="muted">Фон останется как на снимке. Подходит, если вы снимались на белой или почти белой стене.</p>}
    </div>
  );
}
