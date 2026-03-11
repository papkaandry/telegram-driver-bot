# Admin Panel (Mini App + Browser)

## Запуск
- Панель стартує автоматично разом із ботом через `index.js`.
- URL: `/admin` на `ADMIN_PORT` (за замовчуванням `3001`).

## Обов'язкові ENV
- `ADMIN_TELEGRAM_ID` (або `ADMIN_ID`)
- `ADMIN_LOGIN`
- `ADMIN_PASSWORD`
- `ADMIN_WEBAPP_URL` (для кнопки **Админ панель** у Telegram, обязательно публичный `https://.../admin`)

## Аутентифікація
- В Telegram WebApp: перевіряється Telegram ID.
- У браузері: логін + пароль + Telegram ID.
- Сесія закінчується через 1 годину неактивності.

## Розділи
1. Dashboard
2. Drivers
3. Reports
4. Payments
5. Documents
6. Broadcast
7. Activity Log
8. Settings

## Надійність
- Для відсутніх таблиць/полів використані graceful fallback/empty state.
- Документи працюють через `file_id` якщо поле існує; інакше повертається порожній стан.
