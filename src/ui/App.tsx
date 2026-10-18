import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FaceAnalysis } from '../lib/analyze';
import { composeChecks } from '../lib/compose';
import type { Engine } from '../lib/engine';
import { autoCrop, defaultCrop, type Crop } from '../lib/geometry';
import { loadImageFile, LoadError, type LoadedImage } from '../lib/loadImage';
import { N } from '../lib/pipeline';
import { DV } from '../lib/requirements';
import { initialState, type EditState } from '../lib/state';
import { CheckList, Details, Summary } from './Checks';
import { Editor, type Tool } from './Editor';
import { ExportView } from './ExportView';
import { Metric } from './Metric';
import { BgPanel } from './panels/BgPanel';
import { ColorPanel } from './panels/ColorPanel';
import { CropPanel } from './panels/CropPanel';
import { SourceView } from './SourceView';
import { DropZone, ImageInfo, Requirements } from './StartScreen';
import { useEngine } from './useEngine';
import { useExport } from './useExport';
import { useHistory } from './useHistory';
import { useRenderer } from './useRenderer';

type Phase = 'empty' | 'loaded' | 'edit';
type Tab = 'crop' | 'bg' | 'color';

export function App() {
  const [phase, setPhase] = useState<Phase>('empty');
  const [img, setImg] = useState<LoadedImage | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; advice?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<FaceAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [startState, setStartState] = useState<EditState | null>(null);
  const history = useHistory<EditState | null>(null);
  const { state: st, previewing, set, preview, commit, undo, redo, reset } = history;
  const engine = useEngine(img);
  const { rendered, rendering, error: renderError, renderFinal } = useRenderer(engine, st, previewing);
  const exp = useExport(renderFinal, img?.name);
  const [tool, setTool] = useState<Tool>('move');
  const [brush, setBrush] = useState(14);
  const [showGuides, setShowGuides] = useState(true);
  const [compare, setCompare] = useState(false);
  const [showMask, setShowMask] = useState(false);
  const [tab, setTab] = useState<Tab>('crop');
  const fileInput = useRef<HTMLInputElement>(null);

  // ---------- Загрузка ----------
  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await loadImageFile(file);
      setImg(loaded);
      setPhase('loaded');
      setAnalysis(null);
      setAnalysisError(null);
      exp.reset();
      setCompare(false);
      setTool('move');
      setStartState(null);
      reset(null);
    } catch (e) {
      const err = e instanceof LoadError ? e : new LoadError('Не удалось открыть файл.', String((e as Error).message ?? e));
      setLoadError({ message: err.message, advice: err.advice });
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }, [reset, exp.reset]);

  const resetAll = () => {
    setImg(null);
    setPhase('empty');
    setAnalysis(null);
    exp.reset();
    setLoadError(null);
    setStartState(null);
    reset(null);
  };

  // ---------- Анализ ----------
  const analyze = useCallback(async (eng: Engine) => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const a = await eng.analyze();
      setAnalysis(a);
      return a;
    } catch (e) {
      setAnalysisError(`Автоматический анализ не удался: ${(e as Error).message}. Можно продолжить вручную.`);
      setAnalysis(null);
      return null;
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const begin = useCallback(async (mode: 'auto' | 'manual') => {
    if (!img || !engine) return;
    setPhase('edit');
    exp.reset();
    const a = analysis ?? (await analyze(engine));
    const lm = a?.landmarks ?? null;
    const s = mode === 'auto' && lm
      ? initialState(autoCrop(lm, img.width, img.height, { bgReplaced: true }), lm, a!.crownSource, true)
      : initialState(defaultCrop(img.width, img.height), lm, a?.crownSource ?? 'estimate', false);
    setStartState(s);
    reset(s);
    setTab('crop');
  }, [img, engine, analysis, analyze, reset, exp.reset]);

  // ---------- Проверки ----------
  const composition = useMemo(() => {
    if (!img || !st) return null;
    return composeChecks({
      analysis, state: st, imgW: img.width, imgH: img.height, downscale: img.downscale,
      after: rendered?.after ?? null, alpha: rendered?.alpha ?? null, n: N,
    });
  }, [img, st, analysis, rendered]);

  // ---------- Горячие клавиши ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'edit' || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((k === 'z' && e.shiftKey) || k === 'y' || k === 'я' || k === 'н') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, undo, redo]);

  const update = (fn: (s: EditState) => EditState) => set((s) => (s ? fn(s) : s));
  const previewUpd = (fn: (s: EditState) => EditState) => preview((s) => (s ? fn(s) : s));
  const setCrop = (fn: (c: Crop) => Crop) => update((s) => ({ ...s, crop: fn(s.crop) }));

  // ---------- Разметка ----------
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>Фото для DV Lottery</h1>
          <span className="offline">Работает офлайн · фото не покидает компьютер</span>
        </div>
        {img && (
          <div className="top-actions">
            <button className="btn ghost" onClick={() => fileInput.current?.click()}>Загрузить другое фото</button>
            <button className="btn ghost" onClick={resetAll}>Закрыть</button>
          </div>
        )}
      </header>

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        hidden
        data-testid="file-input"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {loadError && (
        <div className="alert alert-fail" role="alert" data-testid="load-error">
          <strong>{loadError.message}</strong>
          {loadError.advice && <div>{loadError.advice}</div>}
        </div>
      )}

      {phase === 'empty' && (
        <main className="start">
          <DropZone loading={loading} onPick={() => fileInput.current?.click()} onFile={onFile} />
          <Requirements />
        </main>
      )}

      {phase === 'loaded' && img && (
        <main className="loaded">
          <div className="card preview-card">
            <SourceView src={img.canvas} n={N} />
            <ImageInfo img={img} />
          </div>
          <div className="card choose">
            <h2>Что делаем дальше?</h2>
            <button className="btn primary big" onClick={() => begin('auto')} data-testid="auto-btn">
              Автоматическая обработка
              <small>Найдёт лицо, подберёт кадр и заменит фон на белый</small>
            </button>
            <button className="btn big" onClick={() => begin('manual')} data-testid="manual-btn">
              Ручная настройка
              <small>Сами выставите кадр; лицо всё равно будет найдено для проверок</small>
            </button>
            <p className="muted">Исходный файл не изменяется — все правки делаются с копией.</p>
          </div>
        </main>
      )}

      {phase === 'edit' && img && (
        <main className="workspace">
          <section className="stage">
            <div className="toolbar">
              <button className="btn" onClick={undo} disabled={!history.canUndo} title="Ctrl+Z">↶ Отменить</button>
              <button className="btn" onClick={redo} disabled={!history.canRedo} title="Ctrl+Y">↷ Повторить</button>
              <button className="btn" onClick={() => startState && set(startState)} disabled={!startState || st === startState}>Сбросить</button>
              <span className="spacer" />
              <label className="toggle">
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} data-testid="compare" />
                Сравнить до/после
              </label>
            </div>
            {analyzing && <div className="alert">Анализ фотографии… Модели работают локально в браузере.</div>}
            {analysisError && <div className="alert alert-warn">{analysisError}</div>}
            {renderError && <div className="alert alert-fail">{renderError}</div>}
            {st ? (
              <Editor
                n={N}
                state={st}
                before={rendered?.before ?? null}
                after={rendered?.after ?? null}
                alpha={rendered?.alpha ?? null}
                showMask={showMask && tab === 'bg'}
                tool={tool}
                brush={brush}
                showGuides={showGuides}
                compare={compare}
                busy={rendering && !rendered}
                onPreview={previewUpd}
                onCommit={commit}
                onSet={update}
              />
            ) : (
              <div className="editor placeholder">Подготовка…</div>
            )}
            {composition?.metrics && (
              <div className="metrics" data-testid="metrics">
                <Metric label="Голова" value={composition.metrics.headRatio} min={DV.headMin} max={DV.headMax} uncertain={st?.crownSource === 'estimate'} />
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
              {st && (
                <SourceView
                  src={img.canvas}
                  crop={st.crop}
                  n={N}
                  onPreview={(fn) => previewUpd((s) => ({ ...s, crop: fn(s.crop) }))}
                  onCommit={commit}
                />
              )}
              <p className="muted">Тяните рамку, чтобы сдвинуть кадр, а за углы — чтобы изменить его размер.</p>
            </div>

            <div className="card">
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'crop'} onClick={() => setTab('crop')}>Кадр</button>
                <button role="tab" aria-selected={tab === 'bg'} onClick={() => setTab('bg')} data-testid="tab-bg">Фон</button>
                <button role="tab" aria-selected={tab === 'color'} onClick={() => setTab('color')}>Цвет</button>
              </div>
              {st && tab === 'crop' && (
                <CropPanel
                  st={st} img={img} analysis={analysis} showGuides={showGuides} setShowGuides={setShowGuides}
                  setCrop={setCrop} preview={previewUpd} commit={commit} update={update}
                />
              )}
              {st && tab === 'bg' && (
                <BgPanel st={st} update={update} preview={previewUpd} commit={commit} tool={tool} setTool={setTool} brush={brush} setBrush={setBrush} showMask={showMask} setShowMask={setShowMask} />
              )}
              {st && tab === 'color' && (
                <ColorPanel st={st} update={update} preview={previewUpd} commit={commit} rendered={rendered} />
              )}
            </div>
          </aside>

          <section className="card checks-card" data-testid="checks">
            <h2>Проверка требований</h2>
            {composition && (
              <>
                <Summary checks={composition.checks} />
                <CheckList checks={composition.checks} testId="composition-checks" />
                <h3>Проверьте сами</h3>
                <p className="muted">Эти требования приложение не может надёжно проверить по фото.</p>
                <CheckList checks={composition.manual} />
                <Details checks={composition.checks} />
              </>
            )}
            <div className="confirm-row">
              <button className="btn primary big" onClick={() => st && exp.confirm(st)} disabled={!rendered || exp.preparing || rendering} data-testid="confirm-btn">
                {exp.preparing ? 'Подготовка JPEG…' : 'Подтвердить результат'}
              </button>
            </div>
          </section>

          <section className="card export-card" ref={exp.ref} data-testid="export">
            <h2>Сохранение</h2>
            {exp.error && <div className="alert alert-fail">{exp.error}</div>}
            {!exp.prepared && <p className="muted">Нажмите «Подтвердить результат», чтобы подготовить JPEG и проверить файл.</p>}
            {exp.prepared && (
              <ExportView prepared={exp.prepared} stale={exp.prepared.state !== st} saving={exp.saving} onSave={exp.save} saved={exp.saved} />
            )}
          </section>
        </main>
      )}

      <footer className="foot">
        Приложение помогает подготовить фото и проверяет технические параметры, но не гарантирует, что фото будет принято:
        решение принимает Государственный департамент США.
      </footer>
    </div>
  );
}
