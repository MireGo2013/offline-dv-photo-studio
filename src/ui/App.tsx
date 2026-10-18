import { useRef, useState } from 'react';
import { autoCrop, defaultCrop } from '../lib/geometry';
import { initialState, type EditState } from '../lib/state';
import { DropZone, LoadedScreen, Requirements } from './StartScreen';
import { usePhoto } from './usePhoto';
import { Workspace } from './Workspace';

/** Сеанс редактирования: id меняется при каждом запуске, и редактор монтируется заново с чистым состоянием. */
interface Session { id: number; start: EditState | null }

export function App() {
  const photo = usePhoto();
  const { img } = photo;
  const [session, setSession] = useState<Session | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastSession = useRef(0);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (await photo.open(file)) setSession(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const close = () => {
    photo.close();
    setSession(null);
  };

  const begin = async (mode: 'auto' | 'manual') => {
    if (!img) return;
    const id = ++lastSession.current;
    setSession({ id, start: null });
    const a = await photo.analyze();
    const lm = a?.landmarks ?? null;
    const start = mode === 'auto' && lm
      ? initialState(autoCrop(lm, img.width, img.height, { bgReplaced: true }), lm, a!.crownSource, true)
      : initialState(defaultCrop(img.width, img.height), lm, a?.crownSource ?? 'estimate', false);
    // Пока шёл анализ, могли открыть другой снимок или закрыть этот.
    setSession((s) => (s?.id === id ? { id, start } : s));
  };

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
            <button className="btn ghost" onClick={close}>Закрыть</button>
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

      {photo.loadError && (
        <div className="alert alert-fail" role="alert" data-testid="load-error">
          <strong>{photo.loadError.message}</strong>
          {photo.loadError.advice && <div>{photo.loadError.advice}</div>}
        </div>
      )}

      {!img && (
        <main className="start">
          <DropZone loading={photo.loading} onPick={() => fileInput.current?.click()} onFile={onFile} />
          <Requirements />
        </main>
      )}

      {img && !session && <LoadedScreen img={img} onBegin={begin} />}

      {img && session && (
        session.start && photo.engine ? (
          <Workspace
            key={session.id}
            img={img}
            engine={photo.engine}
            analysis={photo.analysis}
            analysisError={photo.analysisError}
            start={session.start}
          />
        ) : (
          <main className="workspace">
            <section className="stage">
              {photo.analyzing && <div className="alert">Анализ фотографии… Модели работают локально в браузере.</div>}
              <div className="editor placeholder">Подготовка…</div>
            </section>
          </main>
        )
      )}

      <footer className="foot">
        Приложение помогает подготовить фото и проверяет технические параметры, но не гарантирует, что фото будет принято:
        решение принимает Государственный департамент США.
      </footer>
    </div>
  );
}
