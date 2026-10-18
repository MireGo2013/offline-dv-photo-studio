import { useState } from 'react';
import { formatBytes } from '../lib/checks';
import { ORIENTATION_LABEL } from '../lib/exif';
import { KIND_LABEL } from '../lib/fileType';
import type { LoadedImage } from '../lib/loadImage';
import { N } from '../lib/pipeline';
import { SOURCES } from '../lib/requirements';
import { SourceView } from './SourceView';

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

export function ImageInfo({ img }: { img: LoadedImage }) {
  return (
    <dl className="info" data-testid="image-info">
      <div><dt>Файл</dt><dd>{img.name}</dd></div>
      <div><dt>Формат</dt><dd>{KIND_LABEL[img.kind]} (по содержимому файла)</dd></div>
      <div><dt>Размер</dt><dd>{img.naturalWidth} × {img.naturalHeight} пикселей, {formatBytes(img.fileBytes)}</dd></div>
      <div><dt>Ориентация</dt><dd>{img.hadExif ? `EXIF: ${ORIENTATION_LABEL[img.orientation]}${img.orientation !== 1 ? ' — исправлено' : ''}` : 'без EXIF'}</dd></div>
      {img.downscale > 1 && <div><dt>Рабочая копия</dt><dd>{img.width} × {img.height} (уменьшена для скорости)</dd></div>}
    </dl>
  );
}

/** Снимок загружен: сведения о файле и выбор режима обработки. */
export function LoadedScreen({ img, onBegin }: { img: LoadedImage; onBegin: (mode: 'auto' | 'manual') => void }) {
  return (
    <main className="loaded">
      <div className="card preview-card">
        <SourceView src={img.canvas} n={N} />
        <ImageInfo img={img} />
      </div>
      <div className="card choose">
        <h2>Что делаем дальше?</h2>
        <button className="btn primary big" onClick={() => onBegin('auto')} data-testid="auto-btn">
          Автоматическая обработка
          <small>Найдёт лицо, подберёт кадр и заменит фон на белый</small>
        </button>
        <button className="btn big" onClick={() => onBegin('manual')} data-testid="manual-btn">
          Ручная настройка
          <small>Сами выставите кадр; лицо всё равно будет найдено для проверок</small>
        </button>
        <p className="muted">Исходный файл не изменяется — все правки делаются с копией.</p>
      </div>
    </main>
  );
}
