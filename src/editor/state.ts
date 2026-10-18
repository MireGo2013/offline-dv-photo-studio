import type { CrownSource } from '../face/analyze';
import { NO_ADJUSTMENTS, type Adjustments } from '../processing/adjust';
import type { BrushStroke } from '../processing/mask';
import type { Crop, Landmarks } from '../shared/geometry';

export type BgColor = 'white' | 'offwhite';

export const BG_RGB: Record<BgColor, [number, number, number]> = {
  white: [255, 255, 255],
  offwhite: [246, 246, 244],
};

export interface BackgroundSettings {
  replace: boolean;
  color: BgColor;
  /** Сдвиг границы маски −1…1. */
  edge: number;
  /** Подавление ореола (восстановление цвета прядей). */
  decontaminate: boolean;
}

export interface EditState {
  crop: Crop;
  landmarks: Landmarks | null;
  crownSource: CrownSource;
  chinManual: boolean;
  eyesManual: boolean;
  bg: BackgroundSettings;
  adj: Adjustments;
  strokes: BrushStroke[];
}

export const DEFAULT_BG: BackgroundSettings = { replace: false, color: 'white', edge: 0, decontaminate: true };

export function initialState(crop: Crop, landmarks: Landmarks | null, crownSource: CrownSource, replaceBg: boolean): EditState {
  return {
    crop,
    landmarks,
    crownSource,
    chinManual: false,
    eyesManual: false,
    bg: { ...DEFAULT_BG, replace: replaceBg },
    adj: NO_ADJUSTMENTS,
    strokes: [],
  };
}
