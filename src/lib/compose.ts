import { laplacianVariance, regionStats, type Rect } from './analysis';
import type { FaceAnalysis } from './analyze';
import { pct, type Check, type Status } from './checks';
import { measure, toOutput, type Metrics } from './geometry';
import type { RGBAImage } from './mask';
import { DV } from './requirements';
import type { EditState } from './state';

export interface PhotoContext {
  analysis: FaceAnalysis | null;
  state: EditState;
  imgW: number;
  imgH: number;
  /** Во сколько раз рабочая копия меньше оригинала (для оценки разрешения). */
  downscale: number;
  after: RGBAImage | null;
  alpha: Float32Array | null;
  n: number;
}

export interface Composition {
  metrics: Metrics | null;
  checks: Check[];
  manual: Check[];
}

const deg = (v: number) => `${v.toFixed(1).replace('.', ',')}°`;

function rangeCheck(id: string, title: string, v: number, min: number, max: number, what: string, adviceLow: string, adviceHigh: string, reliable: boolean): Check {
  const detail = `Измерено: ${pct(v)}. Допустимо: ${pct(min, 0)} – ${pct(max, 0)}.`;
  if (!reliable) {
    return {
      id, title, status: 'unknown',
      message: `${what}: примерно ${pct(v)}, но макушка определена лишь приблизительно.`,
      advice: 'Перетащите линию «Макушка» к самому верху волос — тогда проверка станет точной.',
      details: detail,
    };
  }
  if (v < min) return { id, title, status: 'fail', message: `${what} — ${pct(v)}, меньше ${pct(min, 0)}.`, advice: adviceLow, details: detail };
  if (v > max) return { id, title, status: 'fail', message: `${what} — ${pct(v)}, больше ${pct(max, 0)}.`, advice: adviceHigh, details: detail };
  const near = v - min < 0.01 || max - v < 0.01;
  return near
    ? { id, title, status: 'warn', message: `${what} — ${pct(v)}: в пределах нормы, но у самой границы.`, advice: 'Лучше нажать «Авто-кадр», чтобы получить значение ближе к середине диапазона.', details: detail }
    : { id, title, status: 'pass', message: `${what} — ${pct(v)}.`, details: detail };
}

export function composeChecks(ctx: PhotoContext): Composition {
  const checks: Check[] = [];
  const { analysis, state: st, n } = ctx;
  const lm = st.landmarks;

  if (!analysis) {
    checks.push({
      id: 'face', title: 'Лицо на фото', status: 'unknown',
      message: 'Автоматический анализ ещё не выполнялся или не удался.',
      advice: 'Нажмите «Автоматическая обработка» или расставьте линии разметки вручную.',
    });
  } else if (analysis.faceCount === 0) {
    checks.push({
      id: 'face', title: 'Лицо на фото', status: lm ? 'unknown' : 'fail',
      message: 'Лицо не найдено автоматически.',
      advice: 'Проверьте, что лицо хорошо освещено и смотрит в камеру. Можно расставить разметку вручную.',
    });
  } else if (analysis.faceCount > 1) {
    checks.push({
      id: 'face', title: 'Лицо на фото', status: 'fail',
      message: `На снимке найдено лиц: ${analysis.faceCount}. На фото должен быть только один человек.`,
      advice: 'Используйте снимок, где в кадре только вы.',
    });
  } else {
    checks.push({ id: 'face', title: 'Лицо на фото', status: 'pass', message: 'Найдено одно лицо.' });
  }

  let metrics: Metrics | null = null;
  if (lm) {
    metrics = measure(st.crop, lm, ctx.imgW, ctx.imgH, n);
    const reliable = st.crownSource !== 'estimate';
    checks.push(rangeCheck(
      'head', 'Высота головы 50–69 %', metrics.headRatio, DV.headMin, DV.headMax, 'Голова от макушки до подбородка занимает',
      'Голова слишком мелкая — увеличьте масштаб.', 'Голова слишком крупная — уменьшите масштаб.', reliable,
    ));
    checks.push(rangeCheck(
      'eyes', 'Глаза на 56–69 % от низа', metrics.eyeRatio, DV.eyeMin, DV.eyeMax, 'Линия глаз находится на высоте',
      'Глаза слишком низко — сдвиньте фото вверх.', 'Глаза слишком высоко — сдвиньте фото вниз.', true,
    ));
    // В DV-шаблоне голова целиком в кадре.
    if (metrics.topMargin < 0 || metrics.bottomMargin < 0) {
      checks.push({
        id: 'inside', title: 'Голова целиком в кадре', status: 'fail',
        message: metrics.topMargin < 0 ? 'Макушка обрезана верхним краем кадра.' : 'Подбородок обрезан нижним краем кадра.',
        advice: 'Уменьшите масштаб или сдвиньте фото.',
      });
    } else if (analysis?.crownAtImageEdge && st.crownSource !== 'manual') {
      checks.push({
        id: 'inside', title: 'Голова целиком в кадре', status: 'warn',
        message: 'На исходном снимке волосы доходят до верхнего края — макушка, возможно, обрезана ещё при съёмке.',
        advice: 'Если верх головы не виден на исходном фото, лучше переснять с запасом сверху.',
      });
    } else {
      checks.push({ id: 'inside', title: 'Голова целиком в кадре', status: 'pass', message: `Отступ сверху ${pct(metrics.topMargin)}.` });
    }

    const off = Math.abs(metrics.centerX - 0.5);
    checks.push({
      id: 'center', title: 'Голова по центру',
      status: off <= 0.04 ? 'pass' : off <= 0.08 ? 'warn' : 'fail',
      message: off <= 0.04 ? 'Лицо расположено по центру.' : `Лицо смещено от центра на ${pct(off)} ширины.`,
      advice: off > 0.04 ? 'Нажмите «Центрировать лицо».' : undefined,
    });

    const roll = Math.abs(metrics.rollDeg);
    checks.push({
      id: 'roll', title: 'Голова не наклонена к плечу',
      status: roll <= 2 ? 'pass' : roll <= 5 ? 'warn' : 'fail',
      message: roll <= 2 ? `Линия глаз горизонтальна (${deg(metrics.rollDeg)}).` : `Линия глаз наклонена на ${deg(metrics.rollDeg)}.`,
      advice: roll > 2 ? 'Нажмите «Выровнять по глазам».' : undefined,
    });
    const corr = Math.abs((st.crop.angle * 180) / Math.PI);
    if (corr > 6) {
      checks.push({
        id: 'roll-fix', title: 'Исправление наклона', status: 'warn',
        message: `Чтобы выровнять голову, снимок повёрнут на ${deg(corr)}. Это заметный наклон.`,
        advice: 'Поворот снимка допустим, но если голова наклонена относительно плеч, лучше переснять, держа голову прямо.',
      });
    }

    // Разрешение: сколько пикселей оригинала приходится на пиксель результата.
    const scale = metrics.sourceScale * ctx.downscale;
    checks.push({
      id: 'resolution', title: 'Достаточное разрешение',
      status: scale >= 1 ? 'pass' : scale >= 0.7 ? 'warn' : 'fail',
      message: scale >= 1
        ? 'Деталей исходника хватает для 600 × 600 без увеличения.'
        : `Фрагмент снимка растягивается в ${(1 / scale).toFixed(1).replace('.', ',')} раза — фото может выглядеть размытым.`,
      advice: scale < 1 ? 'Лучше использовать снимок с более высоким разрешением или где лицо крупнее.' : undefined,
      details: `Исходный фрагмент: ${Math.round(st.crop.size * ctx.downscale)} px по стороне.`,
    });

    if (metrics.outsideBottom > 0.002) {
      checks.push({
        id: 'outside', title: 'Плечи в кадре', status: 'warn',
        message: `Исходное фото заканчивается слишком близко к подбородку: нижние ${pct(metrics.outsideBottom)} кадра залиты ${st.bg.replace ? 'фоном' : 'белым'}, поэтому плечи обрываются ровной линией.`,
        advice: 'Дорисовывать плечи приложение не будет. Лучше переснять так, чтобы в кадр попали плечи и верх груди.',
      });
    } else if (metrics.outsideFraction > 0.002) {
      checks.push({
        id: 'outside', title: 'Кадр в пределах снимка', status: st.bg.replace ? 'pass' : 'warn',
        message: st.bg.replace
          ? `${pct(metrics.outsideFraction)} кадра сверху или по бокам выходит за край фото — там просто белый фон, как и вокруг.`
          : `${pct(metrics.outsideFraction)} кадра выходит за край исходного фото и залито белым, а остальной фон — исходный.`,
        advice: st.bg.replace ? undefined : 'Включите замену фона или сдвиньте кадр, чтобы фон был однородным.',
      });
    }
  } else {
    checks.push({
      id: 'head', title: 'Высота головы 50–69 %', status: 'unknown',
      message: 'Нет разметки макушки и подбородка.',
      advice: 'Запустите автоматический анализ или включите разметку вручную.',
    });
    checks.push({ id: 'eyes', title: 'Глаза на 56–69 % от низа', status: 'unknown', message: 'Положение глаз не определено.' });
  }

  if (analysis?.pose) {
    const { yaw, pitch } = analysis.pose;
    const y = Math.abs(yaw), p = Math.abs(pitch);
    const st1: Status = y <= 8 ? 'pass' : y <= 14 ? 'warn' : 'fail';
    checks.push({
      id: 'yaw', title: 'Лицо смотрит прямо в камеру', status: st1,
      message: st1 === 'pass' ? 'Голова не повёрнута в сторону.' : `Голова повёрнута в сторону примерно на ${deg(y)}.`,
      advice: st1 !== 'pass' ? 'Это нельзя исправить кадрированием. Лучше переснять, глядя прямо в объектив.' : undefined,
      details: `Оценка позы: поворот ${deg(yaw)}, наклон вверх/вниз ${deg(pitch)}.`,
    });
    const st2: Status = p <= 12 ? 'pass' : p <= 20 ? 'warn' : 'fail';
    if (st2 !== 'pass') {
      checks.push({
        id: 'pitch', title: 'Голова не запрокинута и не опущена', status: st2,
        message: `Голова наклонена вверх или вниз примерно на ${deg(p)}.`,
        advice: 'Это нельзя исправить кадрированием. Лучше переснять, держа камеру на уровне глаз.',
      });
    }
  }

  const bs = analysis?.blendshapes ?? {};
  if (analysis && analysis.faceCount > 0 && Object.keys(bs).length) {
    const blink = Math.max(bs.eyeBlinkLeft ?? 0, bs.eyeBlinkRight ?? 0);
    checks.push({
      id: 'eyes-open', title: 'Оба глаза открыты',
      status: blink < 0.45 ? 'pass' : blink < 0.65 ? 'warn' : 'fail',
      message: blink < 0.45 ? 'Глаза открыты.' : 'Похоже, глаза прищурены или закрыты.',
      advice: blink >= 0.45 ? 'Нужен снимок с открытыми глазами — это исправить нельзя, только переснять.' : undefined,
      details: `Оценка моргания: ${blink.toFixed(2)}`,
    });
    const smile = ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2;
    const jaw = bs.jawOpen ?? 0;
    const exprStatus: Status = smile < 0.35 && jaw < 0.25 ? 'pass' : smile < 0.6 && jaw < 0.4 ? 'warn' : 'fail';
    checks.push({
      id: 'expression', title: 'Нейтральное выражение лица', status: exprStatus,
      message: exprStatus === 'pass' ? 'Выражение лица нейтральное.' : jaw >= 0.25 ? 'Рот приоткрыт.' : 'Похоже, на фото улыбка.',
      advice: exprStatus !== 'pass' ? 'Требуется нейтральное выражение с закрытым ртом. Выражение лица менять нельзя — лучше переснять.' : undefined,
      details: `Улыбка ${smile.toFixed(2)}, открытый рот ${jaw.toFixed(2)}`,
    });
  }

  if (ctx.after && lm && analysis?.faceBox) {
    checks.push(...imageQualityChecks(ctx));
  }

  checks.push(backgroundCheck(ctx));

  return { metrics, checks, manual: manualChecks() };
}

function faceRectOutput(ctx: PhotoContext): Rect {
  const b = ctx.analysis!.faceBox!;
  const corners = [
    toOutput({ x: b.x, y: b.y }, ctx.state.crop, ctx.n),
    toOutput({ x: b.x + b.w, y: b.y }, ctx.state.crop, ctx.n),
    toOutput({ x: b.x, y: b.y + b.h }, ctx.state.crop, ctx.n),
    toOutput({ x: b.x + b.w, y: b.y + b.h }, ctx.state.crop, ctx.n),
  ];
  const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
  // Внутренняя часть лица — без волос и фона.
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  return { x: x0 + w * 0.2, y: y0 + h * 0.15, w: w * 0.6, h: h * 0.75 };
}

function imageQualityChecks(ctx: PhotoContext): Check[] {
  const img = ctx.after!;
  const r = faceRectOutput(ctx);
  const s = regionStats(img, r);
  const out: Check[] = [];
  let status: Status = 'pass';
  let message = 'Лицо освещено нормально.';
  let advice: string | undefined;
  if (s.meanLuma < 70) { status = 'warn'; message = 'Лицо выглядит тёмным.'; advice = 'Попробуйте немного увеличить яркость или переснимите при лучшем свете.'; }
  else if (s.meanLuma > 215 || s.clippedHigh > 0.05) { status = 'warn'; message = 'Лицо пересвечено — часть деталей потеряна.'; advice = 'Уменьшите яркость; если детали пропали, нужен новый снимок без вспышки в упор.'; }
  out.push({ id: 'exposure', title: 'Экспозиция лица', status, message, advice, details: `Средняя яркость лица ${s.meanLuma.toFixed(0)} из 255, пересвет ${pct(s.clippedHigh)}` });

  const left = regionStats(img, { x: r.x, y: r.y, w: r.w / 2, h: r.h });
  const right = regionStats(img, { x: r.x + r.w / 2, y: r.y, w: r.w / 2, h: r.h });
  const diff = Math.abs(left.meanLuma - right.meanLuma) / Math.max(1, Math.max(left.meanLuma, right.meanLuma));
  out.push({
    id: 'shadows', title: 'Равномерное освещение', status: diff < 0.18 ? 'pass' : 'warn',
    message: diff < 0.18 ? 'Заметных теней на лице не обнаружено.' : 'Одна половина лица заметно темнее другой — возможна тень.',
    advice: diff >= 0.18 ? 'Требуются фото без теней на лице. Переснимите лицом к окну или с равномерным светом.' : undefined,
    details: `Разница яркости половин лица ${pct(diff)}`,
  });

  const sharp = laplacianVariance(img, r);
  out.push({
    id: 'sharpness', title: 'Резкость', status: sharp >= 20 ? 'pass' : 'warn',
    message: sharp >= 20 ? 'Изображение лица достаточно чёткое.' : 'Лицо выглядит размытым.',
    advice: sharp < 20 ? 'Проверьте фото в полном размере. Если оно нечёткое, переснимите при хорошем освещении.' : undefined,
    details: `Дисперсия лапласиана ${sharp.toFixed(1)} (эвристика, порог 20)`,
  });
  return out;
}

function backgroundCheck(ctx: PhotoContext): Check {
  const img = ctx.after;
  if (!img) return { id: 'background', title: 'Белый фон', status: 'unknown', message: 'Изображение ещё не построено.' };
  const n = img.width;
  let filter: ((p: number) => boolean) | undefined;
  let rects: Rect[];
  if (ctx.alpha) {
    // Смотрим на итоговые пиксели всей области, которую маска считает фоном,
    // включая полупрозрачную зону: туда может просвечивать старый фон.
    const a = ctx.alpha;
    filter = (p) => a[p] < 0.2;
    rects = [{ x: 0, y: 0, w: n, h: n }];
  } else {
    // Без маски смотрим на верхние углы и полосу над головой.
    rects = [
      { x: 0, y: 0, w: n * 0.2, h: n * 0.45 },
      { x: n * 0.8, y: 0, w: n * 0.2, h: n * 0.45 },
      { x: 0, y: 0, w: n, h: n * 0.04 },
    ];
  }
  const all = rects.map((r) => regionStats(img, r, filter));
  const count = all.reduce((s, x) => s + x.count, 0);
  if (count < 100) {
    return { id: 'background', title: 'Белый фон', status: 'unknown', message: 'Фон почти не виден — проверить не удалось.' };
  }
  const mean = all.reduce((s, x) => s + x.meanLuma * x.count, 0) / count;
  const std = Math.max(...all.map((x) => x.stdLuma));
  const chroma = all.reduce((s, x) => s + x.meanChroma * x.count, 0) / count;
  const details = `Яркость фона ${mean.toFixed(0)} из 255, неоднородность ${std.toFixed(1)}, окраска ${chroma.toFixed(1)}`;
  if (mean >= 235 && std <= 10 && chroma <= 10) {
    return { id: 'background', title: 'Белый фон', status: 'pass', message: 'Фон белый и однородный.', details };
  }
  if (mean >= 205 && std <= 20 && chroma <= 20) {
    return {
      id: 'background', title: 'Белый фон', status: 'warn', message: 'Фон светлый, но не совсем белый или неоднородный.',
      advice: ctx.state.bg.replace ? 'Проверьте края маски на вкладке «Фон».' : 'Включите замену фона на вкладке «Фон».', details,
    };
  }
  return {
    id: 'background', title: 'Белый фон', status: 'fail', message: 'Фон не белый.',
    advice: ctx.state.bg.replace ? 'Проверьте маску: возможно, часть старого фона осталась. Подправьте её кистью.' : 'Включите замену фона на вкладке «Фон».',
    details,
  };
}

function manualChecks(): Check[] {
  const m = (id: string, title: string, message: string): Check => ({ id, title, status: 'unknown', message });
  return [
    m('m-glasses', 'Без очков', 'Очки на фото для визы не допускаются (кроме редких медицинских случаев).'),
    m('m-hat', 'Без головного убора', 'Допускается только религиозный убор, который носится ежедневно и не закрывает лицо.'),
    m('m-recent', 'Снимок не старше 6 месяцев', 'Фото должно отражать вашу нынешнюю внешность.'),
    m('m-gaze', 'Взгляд в камеру', 'Глаза смотрят прямо в объектив, волосы не закрывают глаза.'),
    m('m-items', 'Без наушников и гарнитур', 'Наушники и беспроводные гарнитуры не допускаются.'),
    m('m-edit', 'Без ретуши и фильтров', 'Фото не должно быть изменено так, чтобы менялась внешность. Приложение не меняет черты лица.'),
    m('m-clothes', 'Обычная одежда', 'Форменная одежда не допускается, кроме религиозной, которую носят ежедневно.'),
  ];
}
