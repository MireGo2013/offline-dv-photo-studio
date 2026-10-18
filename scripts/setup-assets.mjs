// Однократная подготовка локальных ресурсов:
//  1) копирует WebAssembly-файлы MediaPipe из node_modules в public/mediapipe/wasm;
//  2) скачивает две модели в public/models (только если их ещё нет) и проверяет SHA-256.
// После этого приложение работает без интернета. Фотографии здесь не участвуют.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WASM_SRC = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const WASM_DST = join(ROOT, 'public', 'mediapipe', 'wasm');
const MODELS_DST = join(ROOT, 'public', 'models');

const MODELS = [
  {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
  {
    file: 'selfie_multiclass_256x256.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
    sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0',
  },
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function copyWasm() {
  if (!existsSync(WASM_SRC)) {
    throw new Error('Не найден пакет @mediapipe/tasks-vision. Сначала выполните: npm install');
  }
  mkdirSync(WASM_DST, { recursive: true });
  for (const f of readdirSync(WASM_SRC)) copyFileSync(join(WASM_SRC, f), join(WASM_DST, f));
  console.log(`✓ WebAssembly MediaPipe скопирован в ${WASM_DST}`);
}

async function ensureModel(m) {
  const dst = join(MODELS_DST, m.file);
  if (existsSync(dst)) {
    if (sha(readFileSync(dst)) === m.sha256) {
      console.log(`✓ Модель ${m.file} уже на месте`);
      return;
    }
    console.log(`! Модель ${m.file} повреждена — скачиваю заново`);
  }
  console.log(`↓ Скачиваю модель ${m.file} (однократно)…`);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`Не удалось скачать ${m.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha(buf);
  if (got !== m.sha256) throw new Error(`Контрольная сумма ${m.file} не совпала (${got}). Файл не сохранён.`);
  mkdirSync(MODELS_DST, { recursive: true });
  const tmp = `${dst}.part`;
  writeFileSync(tmp, buf);
  rmSync(dst, { force: true });
  renameSync(tmp, dst);
  console.log(`✓ Модель ${m.file} сохранена (${(buf.length / 1e6).toFixed(1)} МБ)`);
}

try {
  copyWasm();
  for (const m of MODELS) await ensureModel(m);
  console.log('Готово: все ресурсы лежат локально.');
} catch (e) {
  console.error(`Ошибка подготовки: ${e.message}`);
  process.exit(1);
}
