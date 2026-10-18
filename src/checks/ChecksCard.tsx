import { CheckList, Details, Summary } from './CheckList';
import type { Composition } from './compose';

interface Props {
  composition: Composition;
  preparing: boolean;
  canConfirm: boolean;
  onConfirm: () => void;
}

/** Результаты проверок кадра и кнопка «Подтвердить результат». */
export function ChecksCard({ composition, preparing, canConfirm, onConfirm }: Props) {
  return (
    <section className="card checks-card" data-testid="checks">
      <h2>Проверка требований</h2>
      <Summary checks={composition.checks} />
      <CheckList checks={composition.checks} testId="composition-checks" />
      <h3>Проверьте сами</h3>
      <p className="muted">Эти требования приложение не может надёжно проверить по фото.</p>
      <CheckList checks={composition.manual} />
      <Details checks={composition.checks} />
      <div className="confirm-row">
        <button className="btn primary big" onClick={onConfirm} disabled={!canConfirm} data-testid="confirm-btn">
          {preparing ? 'Подготовка JPEG…' : 'Подтвердить результат'}
        </button>
      </div>
    </section>
  );
}
