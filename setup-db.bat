@echo off
chcp 65001 >nul
echo.
echo  ====================================
echo   Настройка базы данных PostgreSQL
echo  ====================================
echo.

echo  [1/3] Остановка сервера на порту 3000...
npx kill-port 3000 >nul 2>&1
timeout /t 1 /nobreak >nul

echo  [2/3] Генерация Prisma Client...
npx prisma generate
if %ERRORLEVEL% neq 0 (
  echo.
  echo  [ОШИБКА] prisma generate завершился с ошибкой.
  pause
  exit /b 1
)

echo.
echo  [3/3] Применение схемы к PostgreSQL...
npx prisma db push
if %ERRORLEVEL% neq 0 (
  echo.
  echo  [ОШИБКА] prisma db push завершился с ошибкой.
  echo  Проверьте DATABASE_URL в файле .env
  pause
  exit /b 1
)

echo.
echo  ====================================
echo   Готово! Схема применена успешно.
echo   Запустите сервер: npm start
echo  ====================================
echo.
pause
