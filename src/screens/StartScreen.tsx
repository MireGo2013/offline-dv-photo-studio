import { useState } from 'react';
import { SOURCES } from '../checks/requirements';

export function DropZone({ loading, onPick, onFile }: { loading: boolean; onPick: () => void; onFile: (f: File | undefined) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0]); }}
    >
      <div className="drop-icon" aria-hidden>📷</div>
      <h2>Загрузите свою фотографию</h2>
      <p>JPEG, PNG или WebP. Можно перетащить файл сюда.</p>
      <button className="btn primary big" onClick={onPick} disabled={loading} data-testid="upload-btn">
        {loading ? 'Открываю…' : 'Выбрать фото'}
      </button>
      <p className="muted">Фото обрабатывается только на этом компьютере и никуда не отправляется.</p>
    </div>
  );
}

export function Requirements() {
  return (
    <div className="card reqs">
      <h2>Что проверяет приложение</h2>
      <ul>
        <li>JPEG, квадрат <b>600 × 600</b> пикселей (так указано для DV), файл не больше <b>240 кБ</b>.</li>
        <li>Цвет 24 бита, sRGB, сжатие не сильнее 20:1.</li>
        <li>Голова от макушки до подбородка — <b>50–69 %</b> высоты кадра.</li>
        <li>Глаза — на высоте <b>56–69 %</b> от нижнего края.</li>
        <li>Белый или почти белый фон, лицо прямо, нейтральное выражение, глаза открыты, без очков.</li>
      </ul>
      <p className="muted">
        Общие требования к цифровым фото виз допускают размер от 600 × 600 до 1200 × 1200, но в разделе про DV указано
        именно 600 × 600 — поэтому приложение сохраняет 600 × 600.
      </p>
      <p className="muted">
        Источники (проверено 18.10.2026):{' '}
        {SOURCES.map((s, i) => (
          <span key={s.url}>{i > 0 && ', '}<a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a></span>
        ))}.
      </p>
    </div>
  );
}
