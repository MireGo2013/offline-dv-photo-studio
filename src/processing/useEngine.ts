import { useEffect, useState } from 'react';
import type { LoadedImage } from '../photo/loadImage';
import { createEngine, type Engine } from './engine';

/** Движок обработки для текущего снимка; при смене снимка старый останавливается. */
export function useEngine(img: LoadedImage | null): Engine | null {
  const [engine, setEngine] = useState<Engine | null>(null);
  useEffect(() => {
    if (!img) return setEngine(null);
    const e = createEngine(img.canvas);
    setEngine(e);
    return () => e.dispose();
  }, [img]);
  return engine;
}
