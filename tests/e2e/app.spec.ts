import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseJpeg } from '../../src/export/jpegInfo';
import { validateExportFile } from '../../src/export/validateFile';
import { decodeJpeg, exifSegment, insertSegments, makeJpeg } from '../helpers/images';

const PORTRAIT = 'tests/fixtures/portrait.jpg';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Все сетевые запросы страницы — чтобы убедиться, что ничего не уходит наружу. */
function trackRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}

/** Подмена системного диалога сохранения: файл «пишется» в память и читается обратно. */
async function stubSavePicker(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__saved = null;
    w.showSaveFilePicker = async (opts: { suggestedName: string }) => {
      let chunks: BlobPart[] = [];
      return {
        name: opts.suggestedName,
        createWritable: async () => ({
          write: async (d: BlobPart) => { chunks.push(d); },
          close: async () => {
            const blob = new Blob(chunks, { type: 'image/jpeg' });
            w.__saved = Array.from(new Uint8Array(await blob.arrayBuffer()));
            chunks = [];
          },
        }),
        getFile: async () => new File([new Uint8Array(w.__saved as number[])], opts.suggestedName, { type: 'image/jpeg' }),
      };
    };
  });
}

async function upload(page: Page, name: string, buffer: Buffer | Uint8Array, mimeType = 'image/jpeg') {
  await page.getByTestId('file-input').setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });
}

const statusOf = (page: Page, id: string) => page.locator(`[data-testid="composition-checks"] [data-check="${id}"]`).getAttribute('data-status');

test('полный сценарий: загрузка → автообработка → проверки → сохранение → повторная проверка', async ({ page }) => {
  const requests = trackRequests(page);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await stubSavePicker(page);
  const original = readFileSync(PORTRAIT);
  const hashBefore = sha(original);

  await page.goto('/');
  await upload(page, 'portrait.jpg', original);
  await expect(page.getByTestId('image-info')).toContainText('820 × 1024');
  await expect(page.getByTestId('image-info')).toContainText('JPEG');

  await page.getByTestId('auto-btn').click();
  await expect(page.getByTestId('metrics')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => statusOf(page, 'background')).toBe('pass');

  expect(await statusOf(page, 'face')).toBe('pass');
  expect(await statusOf(page, 'head')).toBe('pass');
  expect(await statusOf(page, 'eyes')).toBe('pass');
  expect(await statusOf(page, 'inside')).toBe('pass');
  expect(await statusOf(page, 'center')).toBe('pass');
  // На тестовом портрете широкая улыбка — приложение не должно считать выражение нейтральным.
  expect(await statusOf(page, 'expression')).not.toBe('pass');
  // Ручные пункты честно помечены как непроверяемые автоматически.
  await expect(page.locator('[data-check="m-glasses"]')).toHaveAttribute('data-status', 'unknown');

  await page.getByTestId('confirm-btn').click();
  const fileChecks = page.getByTestId('file-checks');
  await expect(fileChecks).toBeVisible();
  for (const id of ['file-format', 'file-square', 'file-size-px', 'file-depth', 'file-color', 'file-srgb', 'file-bytes', 'file-compression', 'file-decode']) {
    await expect(fileChecks.locator(`[data-check="${id}"]`)).toHaveAttribute('data-status', 'pass');
  }
  await expect(page.getByTestId('export-info')).toContainText('600 × 600');

  await page.getByTestId('save-btn').click();
  await expect(page.getByTestId('saved')).toContainText('совпадает с подготовленным байт в байт');
  await expect(page.getByTestId('saved-checks').locator('[data-status="fail"]')).toHaveCount(0);

  // Проверяем сохранённые байты независимо от приложения.
  const saved = new Uint8Array(await page.evaluate(() => (window as unknown as { __saved: number[] }).__saved));
  const info = parseJpeg(saved);
  expect(info).toMatchObject({ width: 600, height: 600, components: 3, precision: 8 });
  expect(saved.length).toBeLessThanOrEqual(240_000);
  expect(saved.length).toBeGreaterThanOrEqual(54_000);
  expect(validateExportFile(saved).checks.filter((c) => c.status === 'fail')).toEqual([]);
  const px = decodeJpeg(saved);
  // Верхние углы — белый фон.
  for (const [x, y] of [[5, 5], [594, 5], [300, 3]]) {
    const i = (y * 600 + x) * 4;
    expect(Math.min(px.data[i], px.data[i + 1], px.data[i + 2])).toBeGreaterThan(240);
  }

  // Исходный файл не изменился.
  expect(sha(readFileSync(PORTRAIT))).toBe(hashBefore);
  // Ни одного запроса за пределы локального сервера.
  const external = requests.filter((u) => !u.startsWith('http://127.0.0.1:') && !u.startsWith('blob:') && !u.startsWith('data:'));
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('сохранение через «Загрузки», если браузер не поддерживает выбор папки', async ({ page }) => {
  await page.addInitScript(() => { delete (window as unknown as Record<string, unknown>).showSaveFilePicker; });
  await page.goto('/');
  await upload(page, 'portrait.jpg', readFileSync(PORTRAIT));
  await page.getByTestId('auto-btn').click();
  await expect(page.getByTestId('metrics')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('confirm-btn').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-btn').click()]);
  expect(download.suggestedFilename()).toBe('portrait_dv_600x600.jpg');
  const bytes = new Uint8Array(readFileSync(await download.path()));
  expect(parseJpeg(bytes)).toMatchObject({ width: 600, height: 600 });
  expect(bytes.length).toBeLessThanOrEqual(240_000);
  await expect(page.getByTestId('saved')).toContainText('«Загрузки»');
});

test('ориентация EXIF применяется правильно', async ({ page }) => {
  // «Сырые» пиксели 300×200: левая половина красная, правая синяя; EXIF = 6 (повернуть на 90° по часовой).
  const raw = makeJpeg(300, 200, (x) => (x < 150 ? [220, 20, 20] : [20, 20, 220]), 95);
  const withExif = insertSegments(raw, exifSegment(6));
  await page.goto('/');
  await upload(page, 'rotated.jpg', withExif);
  const info = page.getByTestId('image-info');
  await expect(info).toContainText('200 × 300');
  await expect(info).toContainText('поворот на 90° по часовой — исправлено');
  // После поворота левая (красная) половина оказывается сверху.
  const [top, bottom] = await page.locator('canvas.source-view').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const at = (fx: number, fy: number) => Array.from(ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data);
    return [at(0.5, 0.2), at(0.5, 0.8)];
  });
  expect(top[0]).toBeGreaterThan(150); expect(top[2]).toBeLessThan(80);
  expect(bottom[2]).toBeGreaterThan(150); expect(bottom[0]).toBeLessThan(80);
});

test('ошибки: повреждённый и неподдерживаемый файл, затем успешная загрузка PNG и WebP', async ({ page }) => {
  await page.goto('/');
  const good = makeJpeg(400, 400, () => [200, 180, 160]);
  const corrupt = new Uint8Array(good.length);
  corrupt.set(good.subarray(0, 200));
  for (let i = 200; i < corrupt.length; i++) corrupt[i] = (i * 31) & 0xff;
  await upload(page, 'broken.jpg', corrupt);
  await expect(page.getByTestId('load-error')).toContainText('повреждён');

  await upload(page, 'notes.jpg', Buffer.from('это не картинка'));
  await expect(page.getByTestId('load-error')).toContainText('не поддерживается');

  await upload(page, 'tiny.jpg', makeJpeg(80, 80, () => [1, 2, 3]));
  await expect(page.getByTestId('load-error')).toContainText('слишком маленький');

  for (const type of ['image/png', 'image/webp']) {
    await page.goto('/');
    await page.evaluate(async (mime) => {
      const c = document.createElement('canvas');
      c.width = 500; c.height = 400;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#c08060'; ctx.fillRect(0, 0, 500, 400);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), mime));
      if (blob.type !== mime) throw new Error(`браузер не умеет ${mime}`);
      const input = document.querySelector('[data-testid="file-input"]') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(new File([blob], `photo.${mime.split('/')[1]}`, { type: mime }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, type);
    await expect(page.getByTestId('image-info')).toContainText(type === 'image/png' ? 'PNG' : 'WebP');
    await expect(page.getByTestId('image-info')).toContainText('500 × 400');
  }
});

test('ручная настройка: масштаб, отмена/повтор, сброс, фон, кисть, разметка, сравнение', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'portrait.jpg', readFileSync(PORTRAIT));
  await page.getByTestId('manual-btn').click();
  await expect(page.getByTestId('metrics')).toBeVisible({ timeout: 60_000 });

  // Без замены фона цветной фон честно не проходит проверку.
  await expect.poll(() => statusOf(page, 'background')).toBe('fail');
  // Голова на исходном кадре мелкая.
  expect(await statusOf(page, 'head')).toBe('fail');

  const headText = () => page.getByTestId('metrics').locator('.metric').first().locator('b').textContent();
  const initial = await headText();

  // Авто-кадр исправляет геометрию; отмена возвращает как было; повтор — снова.
  await page.getByTestId('autocrop').click();
  await expect.poll(() => statusOf(page, 'head')).toBe('pass');
  const afterAuto = await headText();
  await page.getByRole('button', { name: /Отменить/ }).click();
  await expect.poll(headText).toBe(initial);
  await page.keyboard.press('Control+y');
  await expect.poll(headText).toBe(afterAuto);

  // Масштаб колесом мыши.
  const editor = page.getByTestId('editor');
  const box = (await editor.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await expect.poll(headText).not.toBe(afterAuto);

  // Перетаскивание линии «Подбородок» меняет измерение и помечает разметку как ручную.
  await page.getByTestId('autocrop').click();
  await expect.poll(headText).toBe(afterAuto);
  const chin = editor.locator('[data-handle="chin"].marker-handle');
  const cb = (await chin.boundingBox())!;
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(headText).not.toBe(afterAuto);

  // Сброс возвращает исходное состояние ручного режима.
  await page.getByRole('button', { name: 'Сбросить' }).click();
  await expect.poll(headText).toBe(initial);

  // Замена фона и правка маски кистью.
  await page.getByTestId('autocrop').click();
  await page.getByTestId('tab-bg').click();
  await page.getByTestId('bg-replace').check();
  await expect.poll(() => statusOf(page, 'background')).toBe('pass');
  await page.getByTestId('brush-add').click();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Убрать последний мазок' })).toBeEnabled();
  await page.getByRole('button', { name: 'Убрать последний мазок' }).click();
  await expect(page.getByRole('button', { name: 'Убрать последний мазок' })).toBeDisabled();

  // Подсветка: то, что уходит в фон, закрашено красным; лицо по центру — нет.
  await page.getByTestId('show-mask').check();
  await expect.poll(async () => {
    const [bg, face] = await editor.locator('canvas').evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')!;
      return [Array.from(ctx.getImageData(10, 10, 1, 1).data), Array.from(ctx.getImageData(300, 260, 1, 1).data)];
    });
    return bg[0] - bg[2] > 60 && Math.abs((face[0] - face[2]) - 0) < 200;
  }).toBe(true);
  await page.getByTestId('show-mask').uncheck();

  // Сравнение до/после: левая часть кадра показывает исходный фон (не белый).
  await page.getByTestId('compare').check();
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  const corner = await editor.locator('canvas').evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(10, 300, 1, 1).data));
  expect(Math.min(corner[0], corner[1], corner[2])).toBeLessThan(200);
});

test('снимок обрезан под подбородком: плечи доходят до низа кадра, нормы соблюдены', async ({ page }) => {
  // Оставляем от портрета только верхние 440 строк — снимок кончается чуть ниже подбородка.
  const full = decodeJpeg(readFileSync(PORTRAIT));
  const rows = 440;
  const cut = makeJpeg(full.width, rows, (x, y) => {
    const i = (y * full.width + x) * 4;
    return [full.data[i], full.data[i + 1], full.data[i + 2]];
  }, 92);
  await stubSavePicker(page);
  await page.goto('/');
  await upload(page, 'closeup.jpg', cut);
  await page.getByTestId('auto-btn').click();
  await expect(page.getByTestId('metrics')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => statusOf(page, 'background')).toBe('pass');
  expect(await statusOf(page, 'head')).not.toBe('fail');
  expect(await statusOf(page, 'eyes')).not.toBe('fail');

  await page.getByTestId('confirm-btn').click();
  await page.getByTestId('save-btn').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  const saved = new Uint8Array(await page.evaluate(() => (window as unknown as { __saved: number[] }).__saved));
  const px = decodeJpeg(saved);
  // На уровне 5 px от низа по краям кадра — тёмный костюм, а не белая заливка.
  for (const x of [60, 540]) {
    const i = ((600 - 5) * 600 + x) * 4;
    expect(Math.max(px.data[i], px.data[i + 1], px.data[i + 2])).toBeLessThan(120);
  }
});

test('ползунок отпущен за его пределами: предпросмотр сменяется полным расчётом, плечи не срезаны', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'portrait.jpg', readFileSync(PORTRAIT));
  await page.getByTestId('auto-btn').click();
  await expect(page.getByTestId('metrics')).toBeVisible();
  await page.waitForTimeout(1500);
  // Уменьшаем масштаб и отпускаем кнопку мыши далеко от ползунка.
  const s = (await page.getByTestId('zoom').boundingBox())!;
  await page.mouse.move(s.x + s.width * 0.37, s.y + s.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(s.x + s.width * (0.37 - 0.012 * i), s.y + s.height / 2 + 12 * i);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /Отменить/ })).toBeEnabled();
  // В предпросмотре низ кадра за пределами прежней маски был бы белым; после полного расчёта там пиджак.
  await expect.poll(() => page.locator('canvas.editor-canvas').evaluate((c: HTMLCanvasElement) => {
    const [r, g, b] = c.getContext('2d')!.getImageData(300, 580, 1, 1).data;
    return r + g + b;
  }), { timeout: 10_000 }).toBeLessThan(300);
});

test('рамку на исходном фото можно двигать и тянуть за угол', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'portrait.jpg', readFileSync(PORTRAIT));
  await page.getByTestId('auto-btn').click();
  await expect(page.getByTestId('metrics')).toBeVisible();
  const view = page.getByTestId('source-view');
  const zoom = page.getByTestId('zoom-num');
  const corner = async (i: number) => {
    const box = (await view.boundingBox())!;
    const [w] = await view.evaluate((c: HTMLCanvasElement) => [c.width]);
    const [x, y] = (await view.getAttribute('data-corners'))!.split(' ')[i].split(',').map(Number);
    return { x: box.x + (x * box.width) / w, y: box.y + (y * box.width) / w };
  };
  const zoomBefore = Number(await zoom.inputValue());

  // Тянем правый нижний угол наружу — кадр больше, масштаб меньше; левый верхний угол на месте.
  const tl = await corner(0);
  const br = await corner(2);
  await page.mouse.move(br.x, br.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(br.x + 3 * i, br.y + 3 * i);
  await page.mouse.up();
  await expect.poll(async () => Number(await zoom.inputValue())).toBeLessThan(zoomBefore - 1);
  const tl2 = await corner(0);
  expect(Math.abs(tl2.x - tl.x)).toBeLessThan(1.5);
  expect(Math.abs(tl2.y - tl.y)).toBeLessThan(1.5);

  // Отмена возвращает прежний размер одним шагом.
  await page.getByRole('button', { name: /Отменить/ }).click();
  await expect.poll(async () => Number(await zoom.inputValue())).toBeCloseTo(zoomBefore, 0);

  // Перетаскивание за середину рамки сдвигает кадр, размер не меняется.
  const a = await corner(0), c = await corner(2);
  const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 10, mid.y + 5, { steps: 5 });
  await page.mouse.up();
  const moved = await corner(0);
  expect(moved.x - a.x).toBeCloseTo(10, 0);
  expect(Number(await zoom.inputValue())).toBeCloseTo(zoomBefore, 0);
  // Верхний левый угол выходит за верх снимка, но лежит на поле вокруг него — его тоже можно схватить.
  const top = await corner(0);
  const zoomNow = Number(await zoom.inputValue());
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.mouse.move(top.x + 12, top.y + 12, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(zoomNow + 1);
});

test('горячие клавиши в русской раскладке и чистый редактор для нового фото', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'portrait.jpg', readFileSync(PORTRAIT));
  await page.getByTestId('auto-btn').click();
  await expect(page.getByTestId('metrics')).toBeVisible();
  const zoom = page.getByTestId('zoom-num');
  const before = await zoom.inputValue();
  await zoom.fill('40'); await zoom.press('Enter');
  await expect(zoom).toHaveValue('40.0');

  // Ctrl+Я в русской раскладке — та же клавиша, что Ctrl+Z: отмена, а не повтор.
  const press = (key: string, code: string) => page.evaluate(([k, c]) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: c, ctrlKey: true, bubbles: true }));
  }, [key, code]);
  await press('я', 'KeyZ');
  await expect(zoom).toHaveValue(before);
  await press('н', 'KeyY');
  await expect(zoom).toHaveValue('40.0');

  // Новое фото — редактор с чистого листа: нет истории и включённого сравнения.
  await page.getByTestId('compare').check();
  await page.getByTestId('file-input').setInputFiles(PORTRAIT);
  await page.getByTestId('auto-btn').click();
  await expect(page.getByTestId('metrics')).toBeVisible();
  await expect(page.getByTestId('compare')).not.toBeChecked();
  await expect(page.getByRole('button', { name: /Отменить/ })).toBeDisabled();
  await expect(zoom).toHaveValue(before);
});
