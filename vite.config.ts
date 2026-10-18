import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * В MediaPipe Tasks встроена отправка статистики использования на
 * odml.pa.googleapis.com. Заменяем адрес на about:blank: запрос завершается
 * ошибкой ещё до выхода в сеть, и библиотека сама прекращает попытки.
 * Дополнительно сеть закрыта политикой CSP (см. server.mjs).
 */
const TELEMETRY_URL = 'https://odml.pa.googleapis.com/v1/log';

function disableMediapipeTelemetry(): Plugin {
  return {
    name: 'disable-mediapipe-telemetry',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@mediapipe') || !code.includes(TELEMETRY_URL)) return null;
      return { code: code.split(TELEMETRY_URL).join('about:blank'), map: null };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [disableMediapipeTelemetry(), react()],
  // Не пре-бандлим MediaPipe, чтобы плагин выше применялся и в режиме разработки.
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  server: {
    host: '127.0.0.1',
    strictPort: false,
    headers: { 'Content-Security-Policy': "connect-src 'self' ws://127.0.0.1:* data: blob:" },
  },
  preview: { host: '127.0.0.1' },
  // Классический Worker: загрузчик MediaPipe внутри Worker вызывает importScripts.
  worker: { format: 'iife', plugins: () => [disableMediapipeTelemetry()] },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 2000 },
});
