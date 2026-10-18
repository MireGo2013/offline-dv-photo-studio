import { useEffect, useMemo } from 'react';
import { formatBytes } from '../lib/checks';
import type { Prepared } from '../lib/exportJpeg';
import type { EditState } from '../lib/state';
import { CheckList, Details, StatusBadge } from './Checks';
import type { ExportApi, Saved } from './useExport';

/** Блок «Сохранение»: готовый JPEG, его проверка и кнопка записи на диск. */
export function ExportCard({ exp, current }: { exp: ExportApi; current: EditState }) {
  return (
    <section className="card export-card" ref={exp.ref} data-testid="export">
      <h2>Сохранение</h2>
      {exp.error && <div className="alert alert-fail">{exp.error}</div>}
      {exp.prepared ? (
        <ExportView prepared={exp.prepared} stale={exp.prepared.state !== current} saving={exp.saving} onSave={exp.save} saved={exp.saved} />
      ) : (
        <p className="muted">Нажмите «Подтвердить результат», чтобы подготовить JPEG и проверить файл.</p>
      )}
    </section>
  );
}

function ExportView({ prepared, stale, saving, onSave, saved }: {
  prepared: Prepared & { state: EditState }; stale: boolean; saving: boolean; onSave: () => void; saved: Saved | null;
}) {
  const url = useMemo(() => URL.createObjectURL(new Blob([prepared.encode.bytes as BlobPart], { type: 'image/jpeg' })), [prepared]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const info = prepared.report.info;
  const e = prepared.encode;
  return (
    <div className="export">
      {stale && <div className="alert alert-warn">После подтверждения были изменения. Нажмите «Подтвердить результат» ещё раз, чтобы сохранить актуальную версию.</div>}
      <div className="export-grid">
        <img src={url} width={300} height={300} alt="Готовая фотография 600×600" className="export-img" />
        <div>
          <dl className="info" data-testid="export-info">
            <div><dt>Размеры</dt><dd>{info ? `${info.width} × ${info.height} пикселей` : '—'}</dd></div>
            <div><dt>Формат</dt><dd>{info ? `JPEG (${info.process}), ${info.components * info.precision} бит на пиксель` : 'не JPEG'}</dd></div>
            <div><dt>Размер файла</dt><dd data-testid="export-bytes">{formatBytes(prepared.report.bytes)}</dd></div>
            <div><dt>Качество JPEG</dt><dd>{Math.round(e.quality * 100)} %{e.reduced ? ' (снижено, чтобы уложиться в 240 кБ)' : ''}</dd></div>
          </dl>
          {e.lowQuality && <div className="alert alert-warn">Чтобы уложиться в 240 кБ, пришлось заметно снизить качество. Проверьте чёткость на просмотре.</div>}
          <button className="btn primary big" onClick={onSave} disabled={saving || stale} data-testid="save-btn">
            {saving ? 'Сохранение…' : 'Сохранить JPEG'}
          </button>
          <p className="muted">В Chrome и Edge откроется окно выбора папки; в других браузерах файл попадёт в «Загрузки».</p>
        </div>
      </div>
      <h3>Проверка файла перед сохранением</h3>
      <CheckList checks={prepared.report.checks} testId="file-checks" />
      <Details checks={prepared.report.checks} />
      {saved && (
        <div className="saved" data-testid="saved">
          <h3>Файл сохранён: {saved.result.fileName}</h3>
          {saved.report ? (
            <>
              <p>
                Файл прочитан с диска и проверен повторно.{' '}
                {saved.identical ? 'Содержимое совпадает с подготовленным байт в байт.' : 'Внимание: содержимое на диске отличается от подготовленного!'}
              </p>
              <CheckList checks={saved.report.checks} testId="saved-checks" />
            </>
          ) : (
            <p>
              <StatusBadge status="unknown" /> Браузер сохранил файл через «Загрузки» — прочитать его с диска для повторной
              проверки нельзя. Проверка выше относится к точно тем же байтам, которые были сохранены.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
