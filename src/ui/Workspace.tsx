import { useEffect, useMemo, useState } from 'react';
import type { FaceAnalysis } from '../lib/analyze';
import { composeChecks } from '../lib/compose';
import type { Engine } from '../lib/engine';
import type { LoadedImage } from '../lib/loadImage';
import { N } from '../lib/pipeline';
import { DV } from '../lib/requirements';
import type { EditState } from '../lib/state';
import { ChecksCard } from './ChecksCard';
import { Editor, type Tool } from './Editor';
import { ExportCard } from './ExportView';
import { Metric } from './Metric';
import { BgPanel } from './panels/BgPanel';
import { ColorPanel } from './panels/ColorPanel';
import { CropPanel } from './panels/CropPanel';
import type { PanelProps } from './panels/types';
import { SourceView } from './SourceView';
import { useExport } from './useExport';
import { useHistory } from './useHistory';
import { useRenderer } from './useRenderer';

type Tab = 'crop' | 'bg' | 'color';

interface Props {
  img: LoadedImage;
  engine: Engine;
  analysis: FaceAnalysis | null;
  analysisError: string | null;
  /** Начальное состояние; к нему возвращает «Сбросить». */
  start: EditState;
}

/** Экран редактора. Монтируется заново для каждого сеанса, поэтому всё его состояние начинается с чистого листа. */
export function Workspace({ img, engine, analysis, analysisError, start }: Props) {
  const { state: st, previewing, set, preview, commit, undo, redo, canUndo, canRedo } = useHistory(start);
  const { rendered, rendering, error: renderError, renderFinal } = useRenderer(engine, st, previewing);
  const exp = useExport(renderFinal, img.name);
  const [tab, setTab] = useState<Tab>('crop');
  const [tool, setTool] = useState<Tool>('move');
  const [brush, setBrush] = useState(14);
  const [showGuides, setShowGuides] = useState(true);
  const [compare, setCompare] = useState(false);
  const [showMask, setShowMask] = useState(false);
  useUndoKeys(undo, redo);

  const composition = useMemo(() => composeChecks({
    analysis, state: st, imgW: img.width, imgH: img.height, downscale: img.downscale,
    after: rendered?.after ?? null, alpha: rendered?.alpha ?? null, n: N,
  }), [img, st, analysis, rendered]);
  const edit: PanelProps = { st, update: set, preview, commit };

  return (
    <main className="workspace">
      <section className="stage">
        <div className="toolbar">
          <button className="btn" onClick={undo} disabled={!canUndo} title="Ctrl+Z">↶ Отменить</button>
          <button className="btn" onClick={redo} disabled={!canRedo} title="Ctrl+Y">↷ Повторить</button>
          <button className="btn" onClick={() => set(start)} disabled={st === start}>Сбросить</button>
          <span className="spacer" />
          <label className="toggle">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} data-testid="compare" />
            Сравнить до/после
          </label>
        </div>
        {analysisError && <div className="alert alert-warn">{analysisError}</div>}
        {renderError && <div className="alert alert-fail">{renderError}</div>}
        <Editor
          n={N} state={st} rendered={rendered} busy={rendering && !rendered}
          showMask={showMask && tab === 'bg'} tool={tool} brush={brush} showGuides={showGuides} compare={compare}
          onPreview={preview} onCommit={commit} onSet={set}
        />
        {composition.metrics && (
          <div className="metrics" data-testid="metrics">
            <Metric label="Голова" value={composition.metrics.headRatio} min={DV.headMin} max={DV.headMax} uncertain={st.crownSource === 'estimate'} />
            <Metric label="Глаза от низа" value={composition.metrics.eyeRatio} min={DV.eyeMin} max={DV.eyeMax} />
          </div>
        )}
        <p className="hint">
          Перетаскивайте фото мышью, колесо — масштаб. Линии «Макушка», «Глаза», «Подбородок» можно тянуть за ярлычки справа.
          Зелёные полосы по краям — допустимая высота глаз, синяя метка справа — где должен быть подбородок.
        </p>
      </section>

      <aside className="side">
        <div className="card">
          <h3>Исходная фотография</h3>
          <SourceView src={img.canvas} crop={st.crop} n={N} onPreview={(fn) => preview((s) => ({ ...s, crop: fn(s.crop) }))} onCommit={commit} />
          <p className="muted">Тяните рамку, чтобы сдвинуть кадр, а за углы — чтобы изменить его размер.</p>
        </div>
        <div className="card">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'crop'} onClick={() => setTab('crop')}>Кадр</button>
            <button role="tab" aria-selected={tab === 'bg'} onClick={() => setTab('bg')} data-testid="tab-bg">Фон</button>
            <button role="tab" aria-selected={tab === 'color'} onClick={() => setTab('color')}>Цвет</button>
          </div>
          {tab === 'crop' && <CropPanel {...edit} img={img} analysis={analysis} showGuides={showGuides} setShowGuides={setShowGuides} />}
          {tab === 'bg' && (
            <BgPanel {...edit} tool={tool} setTool={setTool} brush={brush} setBrush={setBrush} showMask={showMask} setShowMask={setShowMask} />
          )}
          {tab === 'color' && <ColorPanel {...edit} rendered={rendered} />}
        </div>
      </aside>

      <ChecksCard
        composition={composition}
        preparing={exp.preparing}
        canConfirm={!!rendered && !rendering && !exp.preparing}
        onConfirm={() => exp.confirm(st)}
      />
      <ExportCard exp={exp} current={st} />
    </main>
  );
}

/**
 * Ctrl+Z — отмена; Ctrl+Y и Ctrl+Shift+Z — повтор. Смотрим на физическую клавишу
 * (e.code), а не на букву: в русской раскладке те же клавиши дают «я» и «н».
 */
function useUndoKeys(undo: () => void, redo: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
}
