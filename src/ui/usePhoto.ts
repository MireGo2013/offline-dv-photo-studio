import { useCallback, useState } from 'react';
import type { FaceAnalysis } from '../lib/analyze';
import { loadImageFile, LoadError, type LoadedImage } from '../lib/loadImage';
import { useEngine } from './useEngine';

/** Загруженный снимок, его анализ и движок обработки. */
export function usePhoto() {
  const [img, setImg] = useState<LoadedImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<{ message: string; advice?: string } | null>(null);
  const [analysis, setAnalysis] = useState<FaceAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const engine = useEngine(img);

  /** Открывает файл; при ошибке прежний снимок остаётся. Возвращает true, если файл открыт. */
  const open = useCallback(async (file: File): Promise<boolean> => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await loadImageFile(file);
      setImg(loaded);
      setAnalysis(null);
      setAnalysisError(null);
      return true;
    } catch (e) {
      const err = e instanceof LoadError ? e : new LoadError('Не удалось открыть файл.', String((e as Error).message ?? e));
      setLoadError({ message: err.message, advice: err.advice });
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback(() => {
    setImg(null);
    setAnalysis(null);
    setAnalysisError(null);
    setLoadError(null);
  }, []);

  /** Анализ лица; повторно не выполняется. null — если не удался (можно продолжить вручную). */
  const analyze = useCallback(async (): Promise<FaceAnalysis | null> => {
    if (analysis) return analysis;
    if (!engine) return null;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const a = await engine.analyze();
      setAnalysis(a);
      return a;
    } catch (e) {
      setAnalysisError(`Автоматический анализ не удался: ${(e as Error).message}. Можно продолжить вручную.`);
      return null;
    } finally {
      setAnalyzing(false);
    }
  }, [engine, analysis]);

  return { img, loading, loadError, analysis, analyzing, analysisError, engine, open, close, analyze };
}
