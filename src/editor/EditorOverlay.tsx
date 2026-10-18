import { DV } from '../checks/requirements';
import { toOutput, type Landmarks, type Pt } from '../shared/geometry';
import type { EditState } from './state';
import type { Tool } from './useEditorDrag';

interface Props {
  n: number;
  state: EditState;
  showGuides: boolean;
  compare: boolean;
  /** Положение разделителя «до/после», доля ширины. */
  split: number;
  /** Мазок кисти, который рисуется прямо сейчас. */
  stroke: Pt[] | null;
  hover: Pt | null;
  tool: Tool;
  brush: number;
}

/** Разметка поверх кадра: зоны норм, линии «Макушка/Глаза/Подбородок», разделитель сравнения, кисть. */
export function EditorOverlay({ n, state, showGuides, compare, split, stroke, hover, tool, brush }: Props) {
  const out = state.landmarks ? outputMarks(state.landmarks, state, n) : null;
  return (
    <svg className="editor-overlay" viewBox={`0 0 ${n} ${n}`} aria-hidden>
      {showGuides && !compare && (
        <>
          <EyeZone n={n} />
          <line x1={n / 2} y1={0} x2={n / 2} y2={n} className="guide-center" />
          {out && (
            <>
              <HeadZone n={n} crownY={out.crown.y} />
              <Marker n={n} y={out.crown.y} label="Макушка" which="crown" cls={state.crownSource === 'estimate' ? 'mk-est' : 'mk-crown'} />
              <Marker n={n} y={out.eyeY} label="Глаза" which="eyes" cls="mk-eyes" />
              <Marker n={n} y={out.chin.y} label="Подбородок" which="chin" cls="mk-chin" />
              <circle cx={out.eyeL.x} cy={out.eyeL.y} r={4} className="eye-dot" />
              <circle cx={out.eyeR.x} cy={out.eyeR.y} r={4} className="eye-dot" />
            </>
          )}
        </>
      )}
      {compare && (
        <>
          <line x1={split * n} y1={0} x2={split * n} y2={n} className="split-line" />
          <text x={12} y={24} className="split-label">До</text>
          <text x={n - 12} y={24} className="split-label" textAnchor="end">После</text>
        </>
      )}
      {stroke && stroke.length > 0 && (
        <polyline
          points={stroke.map((q) => `${q.x},${q.y}`).join(' ')}
          className={tool === 'add' ? 'stroke-add' : 'stroke-remove'}
          strokeWidth={brush * 2}
        />
      )}
      {hover && tool !== 'move' && !compare && <circle cx={hover.x} cy={hover.y} r={brush} className="brush-cursor" />}
    </svg>
  );
}

function outputMarks(lm: Landmarks, st: EditState, n: number) {
  const crown = toOutput(lm.crown, st.crop, n);
  const chin = toOutput(lm.chin, st.crop, n);
  const eyeL = toOutput(lm.eyeL, st.crop, n);
  const eyeR = toOutput(lm.eyeR, st.crop, n);
  return { crown, chin, eyeL, eyeR, eyeY: (eyeL.y + eyeR.y) / 2 };
}

function EyeZone({ n }: { n: number }) {
  const y0 = (1 - DV.eyeMax) * n, y1 = (1 - DV.eyeMin) * n;
  return (
    <g className="eye-zone">
      <rect x={0} y={y0} width={10} height={y1 - y0} />
      <rect x={n - 10} y={y0} width={10} height={y1 - y0} />
      <line x1={0} y1={y0} x2={n} y2={y0} />
      <line x1={0} y1={y1} x2={n} y2={y1} />
    </g>
  );
}

/** Где должен оказаться подбородок при текущей макушке (50–69 % высоты). */
function HeadZone({ n, crownY }: { n: number; crownY: number }) {
  const y0 = crownY + DV.headMin * n, y1 = Math.min(n, crownY + DV.headMax * n);
  if (y0 >= n) return null;
  return <rect x={n - 22} y={y0} width={8} height={Math.max(0, y1 - y0)} className="head-zone" />;
}

function Marker({ n, y, label, which, cls }: { n: number; y: number; label: string; which: string; cls: string }) {
  const w = 104;
  return (
    <g className={`marker ${cls}`}>
      <line x1={0} y1={y} x2={n} y2={y} />
      <g data-handle={which} className="marker-handle" transform={`translate(${n - w - 28}, ${y - 13})`}>
        <rect width={w} height={26} rx={13} />
        <text x={w / 2} y={17.5} textAnchor="middle">{label}</text>
      </g>
      {/* Невидимая широкая полоса у правого края — за линию легче взяться, а перемещение фото не мешает. */}
      <line data-handle={which} x1={n - w - 40} y1={y} x2={n} y2={y} className="marker-hit" />
    </g>
  );
}
