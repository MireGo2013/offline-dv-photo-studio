@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Фото для DV Lottery

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Не найден Node.js. Установите Node.js LTS с https://nodejs.org/ и запустите start.bat снова.
  echo.
  pause
  exit /b 1
)

rem Отдельный браузер для тестов не скачиваем: тесты используют установленный Chrome.
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

if not exist node_modules\@mediapipe\tasks-vision (
  echo  Первый запуск: устанавливаю зависимости. Нужен интернет, это делается один раз...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
)

if not exist public\models\selfie_multiclass_256x256.tflite goto :setup
if not exist public\models\face_landmarker.task goto :setup
if not exist public\mediapipe\wasm\vision_wasm_internal.wasm goto :setup
goto :build

:setup
echo  Подготавливаю локальные модели (однократно)...
call node scripts\setup-assets.mjs
if errorlevel 1 goto :fail
if exist dist rmdir /s /q dist

:build
rem Собираем при каждом запуске (пара секунд): иначе после правок исходников запустилась бы старая версия.
echo  Собираю приложение...
call npm run build >nul
if errorlevel 1 (
  rem Повторяем с выводом, чтобы были видны ошибки сборки.
  call npm run build
  goto :fail
)

node server.mjs
goto :eof

:fail
echo.
echo  Что-то пошло не так — смотрите сообщения выше.
pause
exit /b 1
