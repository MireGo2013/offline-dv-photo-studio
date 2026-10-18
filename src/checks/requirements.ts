/**
 * Требования Государственного департамента США к цифровой фотографии для
 * Diversity Visa Program. Проверено 18.10.2026 по официальным страницам:
 *
 *  - https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos.html
 *    раздел «Additional Requirements for the Diversity Visa (DV) Program»:
 *    JPEG, ≤ 240 kB, квадрат, «600x600 pixels in dimension».
 *  - https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos/digital-image-requirements.html
 *    общие требования к цифровому изображению: квадрат, от 600×600 до 1200×1200,
 *    цвет 24 бита на пиксель в sRGB, JPEG, ≤ 240 kB, степень сжатия ≤ 20:1.
 *  - https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos/photo-composition-template.html
 *    голова (от макушки с волосами до низа подбородка) — 50–69 % высоты кадра,
 *    глаза — 56–69 % высоты кадра от нижнего края.
 */
export const DV = {
  /** Размер, который прямо указан для DV. Экспортируем всегда его. */
  exportSize: 600,
  /** Общий допустимый диапазон для цифровых фото виз. */
  minSize: 600,
  maxSize: 1200,
  /** «240 kB». Берём 240 000 байт — более строгое из двух толкований (1000 или 1024). */
  maxBytes: 240_000,
  /** Степень сжатия не более 20:1 относительно несжатых 24-битных данных. */
  maxCompressionRatio: 20,
  headMin: 0.5,
  headMax: 0.69,
  eyeMin: 0.56,
  eyeMax: 0.69,
  /** Цели для автокадрирования — середины допустимых диапазонов. */
  headTarget: 0.6,
  eyeTarget: 0.625,
} as const;

/** Минимальный размер файла, при котором сжатие не превышает 20:1. */
export function minBytesForSize(size: number): number {
  return Math.ceil((size * size * 3) / DV.maxCompressionRatio);
}

export const SOURCES = [
  {
    title: 'Photo Requirements (раздел Diversity Visa)',
    url: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos.html',
  },
  {
    title: 'Digital Image Requirements',
    url: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos/digital-image-requirements.html',
  },
  {
    title: 'Photo Composition Template',
    url: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos/photo-composition-template.html',
  },
];
