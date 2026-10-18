import { useRef, useState } from 'react';
import type { EditState } from '../editor/state';
import type { Rendered } from '../processing/pipeline';
import { prepareJpeg, saveJpeg, SaveCancelled, verifyJpegBytes, type Prepared, type SaveResult } from './exportJpeg';
import type { FileReport } from './validateFile';

export interface Saved {
  result: SaveResult;
  report: FileReport | null;
  identical: boolean | null;
}

export type ExportApi = ReturnType<typeof useExport>;

/** Подготовка JPEG из текущего состояния, сохранение и повторная проверка файла с диска. */
export function useExport(renderFinal: (s: EditState) => Promise<Rendered>, fileName: string | undefined) {
  const [prepared, setPrepared] = useState<(Prepared & { state: EditState }) | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const confirm = async (st: EditState) => {
    setPreparing(true);
    setError(null);
    setSaved(null);
    try {
      // Рендерим заново из текущего состояния, чтобы файл точно совпадал с ним.
      const fresh = await renderFinal(st);
      const p = await prepareJpeg(fresh.after);
      setPrepared({ ...p, state: st });
      setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      setError(`Не удалось подготовить JPEG: ${(e as Error).message}`);
    } finally {
      setPreparing(false);
    }
  };

  const save = async () => {
    if (!prepared) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveJpeg(prepared.encode.bytes, suggestName(fileName));
      let report: FileReport | null = null;
      let identical: boolean | null = null;
      if (result.reread) {
        report = await verifyJpegBytes(result.reread);
        identical = equalBytes(result.reread, prepared.encode.bytes);
      }
      setSaved({ result, report, identical });
    } catch (e) {
      if (!(e instanceof SaveCancelled)) setError(`Не удалось сохранить файл: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return { prepared, preparing, error, saved, saving, ref, confirm, save };
}

function suggestName(name?: string): string {
  const base = (name ?? 'photo').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'photo';
  return `${base}_dv_600x600.jpg`;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
