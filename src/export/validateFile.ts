import { formatBytes, type Check } from '../checks/checks';
import { DV, minBytesForSize } from '../checks/requirements';
import { sniffImageType } from '../photo/fileType';
import { parseJpeg, type JpegInfo } from './jpegInfo';

export interface PixelFacts {
  /** Удалось ли браузеру заново декодировать файл. */
  decoded: boolean;
  /** Есть ли в изображении цвет (не только оттенки серого). */
  hasColor?: boolean;
}

export interface FileReport {
  info: JpegInfo | null;
  bytes: number;
  checks: Check[];
}

/**
 * Проверяет готовый файл по его байтам: формат определяется по содержимому,
 * размеры и глубина цвета — по заголовку кадра JPEG.
 */
export function validateExportFile(bytes: Uint8Array, pixels?: PixelFacts): FileReport {
  const checks: Check[] = [];
  const kind = sniffImageType(bytes);
  let info: JpegInfo | null = null;
  let parseError: string | null = null;
  if (kind === 'jpeg') {
    try {
      info = parseJpeg(bytes);
    } catch (e) {
      parseError = (e as Error).message;
    }
  }

  checks.push(
    info
      ? {
          id: 'file-format', title: 'Формат JPEG', status: 'pass',
          message: 'Файл действительно закодирован в JPEG.',
          details: `Сигнатура FFD8, способ кодирования: ${info.process}${info.jfif ? ', JFIF' : ''}${info.hasEOI ? '' : ', нет маркера EOI'}`,
        }
      : {
          id: 'file-format', title: 'Формат JPEG', status: 'fail',
          message: kind ? `Содержимое файла — ${kind.toUpperCase()}, а не JPEG.` : `Файл не является корректным JPEG${parseError ? `: ${parseError}` : ''}.`,
          advice: 'Сохраните фото заново через кнопку «Сохранить JPEG».',
        },
  );
  if (!info) return { info, bytes: bytes.length, checks };

  if (!info.hasEOI) {
    checks.push({
      id: 'file-integrity', title: 'Целостность файла', status: 'fail',
      message: 'Файл, похоже, обрезан: нет маркера конца изображения.',
      advice: 'Сохраните файл заново.',
    });
  }

  const { width: w, height: h } = info;
  checks.push(
    w === h
      ? { id: 'file-square', title: 'Квадратная форма', status: 'pass', message: `Ширина равна высоте: ${w} × ${h} пикселей.` }
      : { id: 'file-square', title: 'Квадратная форма', status: 'fail', message: `Изображение не квадратное: ${w} × ${h}.`, advice: 'Высота должна быть равна ширине.' },
  );

  if (w === h && w === DV.exportSize) {
    checks.push({ id: 'file-size-px', title: 'Размер в пикселях', status: 'pass', message: `${w} × ${h} — ровно столько, сколько указано для DV.` });
  } else if (w === h && w >= DV.minSize && w <= DV.maxSize) {
    checks.push({
      id: 'file-size-px', title: 'Размер в пикселях', status: 'warn',
      message: `${w} × ${h} входит в общий диапазон 600–1200, но для DV официально указано 600 × 600.`,
      advice: 'Надёжнее использовать 600 × 600 — приложение сохраняет именно такой размер.',
    });
  } else {
    checks.push({
      id: 'file-size-px', title: 'Размер в пикселях', status: 'fail',
      message: `${w} × ${h} вне допустимого диапазона 600 × 600 – 1200 × 1200.`,
      advice: 'Сохраните фото через приложение — оно делает 600 × 600.',
    });
  }

  const color24 = info.components === 3 && info.precision === 8;
  checks.push(
    color24
      ? { id: 'file-depth', title: 'Цвет 24 бита на пиксель', status: 'pass', message: '3 цветовых канала по 8 бит.' }
      : {
          id: 'file-depth', title: 'Цвет 24 бита на пиксель', status: 'fail',
          message: info.components === 1
            ? 'Изображение в оттенках серого — нужно цветное.'
            : info.components === 4
              ? 'Изображение в CMYK — нужно RGB (sRGB).'
              : `Неподдерживаемая структура: ${info.components} канала(ов) по ${info.precision} бит.`,
          advice: 'Используйте цветную фотографию и сохраните её через приложение.',
        },
  );

  if (pixels?.hasColor === false) {
    checks.push({
      id: 'file-color', title: 'Цветная фотография', status: 'fail',
      message: 'Файл формально цветной, но содержимое чёрно-белое.',
      advice: 'Нужна цветная фотография. Загрузите цветной снимок.',
    });
  } else if (pixels?.hasColor) {
    checks.push({ id: 'file-color', title: 'Цветная фотография', status: 'pass', message: 'В изображении есть цветовая информация.' });
  }

  if (!info.icc) {
    checks.push({
      id: 'file-srgb', title: 'Цветовое пространство sRGB', status: 'pass',
      message: 'Профиль не встроен — по стандарту такой JPEG трактуется как sRGB. Браузер формирует изображение в sRGB.',
    });
  } else if (/srgb|iec61966/i.test(info.icc.description ?? '')) {
    checks.push({ id: 'file-srgb', title: 'Цветовое пространство sRGB', status: 'pass', message: `Встроен профиль «${info.icc.description}».` });
  } else {
    checks.push({
      id: 'file-srgb', title: 'Цветовое пространство sRGB', status: 'fail',
      message: `Встроен профиль «${info.icc.description ?? info.icc.colorSpace}», а не sRGB.`,
      advice: 'Сохраните фото через приложение — оно записывает sRGB без постороннего профиля.',
    });
  }

  const n = bytes.length;
  checks.push(
    n <= DV.maxBytes
      ? { id: 'file-bytes', title: 'Размер файла не больше 240 кБ', status: 'pass', message: `Размер файла: ${formatBytes(n)}.` }
      : {
          id: 'file-bytes', title: 'Размер файла не больше 240 кБ', status: 'fail',
          message: `Размер файла ${formatBytes(n)} — больше 240 кБ.`,
          advice: 'Сохраните заново: приложение подберёт качество сжатия.',
        },
  );

  if (w === h) {
    const ratio = (w * h * 3) / n;
    const minB = minBytesForSize(w);
    checks.push(
      ratio <= DV.maxCompressionRatio
        ? {
            id: 'file-compression', title: 'Степень сжатия не выше 20:1', status: 'pass',
            message: `Степень сжатия ${ratio.toFixed(1).replace('.', ',')}:1.`,
          }
        : {
            id: 'file-compression', title: 'Степень сжатия не выше 20:1', status: 'warn',
            message: `Сжатие ${ratio.toFixed(1).replace('.', ',')}:1 — сильнее рекомендованного 20:1 (файл меньше ${formatBytes(minB)}).`,
            advice: 'Обычно это значит, что качество JPEG занижено или снимок очень однородный. Попробуйте сохранить с более высоким качеством.',
          },
    );
  }

  if (pixels) {
    checks.push(
      pixels.decoded
        ? { id: 'file-decode', title: 'Файл открывается', status: 'pass', message: 'Сохранённый файл успешно декодирован заново.' }
        : { id: 'file-decode', title: 'Файл открывается', status: 'fail', message: 'Сохранённый файл не удалось открыть.', advice: 'Сохраните файл заново.' },
    );
  }

  if (info.exif) {
    checks.push({
      id: 'file-exif', title: 'Метаданные', status: 'warn',
      message: 'В файле есть метаданные EXIF.',
      details: 'Требованиями это не запрещено, но приложение обычно сохраняет файл без них.',
    });
  }

  return { info, bytes: n, checks };
}
