// Локальный сервер приложения. Слушает только 127.0.0.1, раздаёт собранные
// файлы из dist/ и запрещает странице любые сетевые обращения, кроме самого
// себя (Content-Security-Policy). Остановка — Ctrl+C или закрытие окна.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const HOST = '127.0.0.1';
const START_PORT = Number(process.env.PORT) || 5178;
const OPEN = !process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('Не найдена сборка приложения (папка dist). Выполните: npm run build');
  process.exit(1);
}
for (const f of ['models/face_landmarker.task', 'models/selfie_multiclass_256x256.tflite', 'mediapipe/wasm/vision_wasm_internal.wasm']) {
  if (!existsSync(join(ROOT, f))) {
    console.error(`В сборке нет файла ${f}. Выполните: npm run setup && npm run build`);
    process.exit(1);
  }
}

const server = createServer((req, res) => {
  // Защита от DNS rebinding: принимаем только локальные имена.
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = normalize(join(ROOT, pathname));
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  let st;
  try {
    st = statSync(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Не найдено');
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
});

function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(`Не удалось запустить сервер: ${err.message}`);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/`;
    console.log('');
    console.log('  Приложение «Фото для DV Lottery» запущено.');
    console.log(`  Адрес: ${url}`);
    console.log('  Доступно только с этого компьютера. Фотографии никуда не отправляются.');
    console.log('  Чтобы остановить, нажмите Ctrl+C или закройте это окно.');
    console.log('');
    if (OPEN) openBrowser(url);
  });
}

function openBrowser(url) {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.log(`  Откройте адрес в браузере вручную: ${url}`);
  });
}

process.on('SIGINT', () => {
  console.log('\n  Приложение остановлено.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});

listen(START_PORT, 20);
