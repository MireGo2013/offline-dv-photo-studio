import { formatBytes } from '../checks/checks';
import { SourceView } from '../editor/SourceView';
import { ORIENTATION_LABEL } from '../photo/exif';
import { KIND_LABEL } from '../photo/fileType';
import type { LoadedImage } from '../photo/loadImage';
import { N } from '../processing/pipeline';

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

function ImageInfo({ img }: { img: LoadedImage }) {
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
