import type { FaceAnalysis } from '../../face/analyze';
import type { LoadedImage } from '../../photo/loadImage';
import { N } from '../../processing/pipeline';
import { Slider } from '../../shared/Slider';
import { autoCrop, centerFace, cropSizeLimits, eyeLineAngle, rotateCrop, zoomCrop, type Crop } from '../../shared/geometry';
import type { EditState } from '../state';
import type { PanelProps } from './types';

export function CropPanel(p: PanelProps & {
  img: LoadedImage; analysis: FaceAnalysis | null; showGuides: boolean; setShowGuides: (v: boolean) => void;
}) {
  const { st, img } = p;
  const setCrop = (fn: (c: Crop) => Crop) => p.update((s) => ({ ...s, crop: fn(s.crop) }));
  const lm = st.landmarks;
  const { min: minSize, max: maxSize } = cropSizeLimits(img.width, img.height);
  const zoomVal = (Math.log(maxSize / st.crop.size) / Math.log(maxSize / minSize)) * 100;
  const setZoom = (v: number) => {
    const size = maxSize * Math.pow(minSize / maxSize, v / 100);
    p.preview((s) => ({ ...s, crop: zoomCrop(s.crop, s.crop.size / size, N) }));
  };
  const angleDeg = (st.crop.angle * 180) / Math.PI;
  return (
    <div className="panel">
      <Slider label="Масштаб" min={0} max={100} step={0.1} value={zoomVal} onInput={setZoom} onCommit={p.commit} decimals={1} testId="zoom" />
      <Slider
        label="Поворот" min={-15} max={15} step={0.1} value={angleDeg}
        onInput={(v) => p.preview((s) => ({ ...s, crop: rotateCrop(s.crop, (v * Math.PI) / 180) }))}
        onCommit={p.commit} decimals={2} unit="°" testId="angle"
      />
      <div className="btn-row">
        <button className="btn" disabled={!lm} onClick={() => lm && setCrop(() => autoCrop(lm, img.width, img.height, { bgReplaced: st.bg.replace }))} data-testid="autocrop">Авто-кадр</button>
        <button className="btn" disabled={!lm} onClick={() => lm && setCrop((c) => centerFace(c, lm, N))}>Центрировать лицо</button>
        <button className="btn" disabled={!lm} onClick={() => lm && setCrop((c) => rotateCrop(c, eyeLineAngle(lm)))}>Выровнять по глазам</button>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={p.showGuides} onChange={(e) => p.setShowGuides(e.target.checked)} />
        Показывать разметку
      </label>
      {!lm && (
        <div className="alert alert-warn">
          Лицо не найдено автоматически, поэтому линии разметки недоступны.
          <button className="btn small" onClick={() => p.update((s) => ({ ...s, ...manualLandmarks(s.crop), crownSource: 'manual', chinManual: true, eyesManual: true }))}>
            Разметить вручную
          </button>
        </div>
      )}
      {lm && st.crownSource === 'estimate' && (
        <div className="alert alert-warn" data-testid="crown-estimate">
          Макушка определена приблизительно{p.analysis?.crownNote ? ` (${p.analysis.crownNote.replace(/\.$/, '')})` : ''}.
          Перетащите линию «Макушка» к самому верху волос.
        </div>
      )}
    </div>
  );
}

/** Стартовая разметка «по шаблону», которую пользователь затем двигает сам. */
function manualLandmarks(crop: Crop): Pick<EditState, 'landmarks'> {
  const at = (fx: number, fy: number) => {
    const c = Math.cos(crop.angle), s = Math.sin(crop.angle);
    const x = (fx - 0.5) * crop.size, y = (fy - 0.5) * crop.size;
    return { x: crop.cx + c * x - s * y, y: crop.cy + s * x + c * y };
  };
  return { landmarks: { crown: at(0.5, 0.1), chin: at(0.5, 0.7), eyeL: at(0.43, 0.375), eyeR: at(0.57, 0.375) } };
}
