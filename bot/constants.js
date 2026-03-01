export const ADMIN_ID = process.env.ADMIN_ID;
export const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
export const TIMEZONE = 'America/Vancouver';

export const WORK_TYPES = ['otr', 'local', 'boise', 'boise_custom'];
export const TYPE_LABELS = {
  otr: 'OTR',
  local: 'Local',
  boise: 'Boise',
  boise_custom: 'Boise Custom'
};

export const I18N = {
  ru: {
    welcome: 'Добро пожаловать!',
    adminPanel: '👑 Админ панель',
    waitingApproval: '⏳ Ожидайте одобрения админа.',
    blocked: '⛔ Доступ закрыт до одобрения админом.',
    selectAction: 'Выберите действие:',
    canceled: 'Действие отменено.',
    unknownCommand: 'Неизвестная команда.',
    invalidNumber: 'Введите положительное число.',
    invalidDateRange: 'Формат: YYYY-MM-DD YYYY-MM-DD',
    noDataPeriod: (from, to) => `📭 За период ${from} — ${to} у вас не было работы.`,
    statsTitle: (from, to) => `📊 Статистика за период ${from} — ${to}`,
    settingsTitle: '⚙️ Настройки:',
    reportNameAsk: 'Введите имя, которое использовать в Excel:',
    reportNameUpdated: (name) => `✅ Имя для Excel обновлено: ${name}`,
    languageUpdated: (lang) => `✅ Язык обновлён: ${lang.toUpperCase()}`,
    paymentIntro: '💳 Оплата за период\nЭто нужно, чтобы бот показывал, сколько компания ещё должна вам денег.',
    paymentSaved: (from, to, paid) => `✅ Оплата сохранена: ${from} — ${to}\nОплачено: $${paid.toFixed(2)}`,
    debtAfterPayment: (from, to, total) => `💰 Долг после оплаты (${from} — ${to}): $${total.toFixed(2)}`,
    adminMenu: '🛠 Админ меню:',
    driversEmpty: 'Водителей пока нет.',
    askBroadcast: 'Введите сообщение для рассылки всем водителям:',
    broadcastDone: (ok, fail) => `✅ Рассылка завершена. Успешно: ${ok}, Ошибок: ${fail}`,
    todayExcelDone: '✅ Отчёт за сегодня отправлен в группу.',
    todayExcelNoGroup: '❌ GROUP_CHAT_ID не задан. Невозможно отправить отчёт в группу.',
    todayExcelNoData: 'ℹ️ За сегодня нет данных для отчёта.',
    deleteConfirm: (name, id) => `⚠️ Удалить водителя ${name} (${id}) и все его данные?`,
    deleteDone: (id) => `✅ Водитель ${id} удалён вместе со всеми данными.`,
    updateBroadcastDone: '✅ Отправлено всем: бот обновлён.',
    adminMissing: '⚠️ ADMIN_ID не задан. Связь с админом недоступна.'
  },
  en: {
    welcome: 'Welcome!',
    adminPanel: '👑 Admin panel',
    waitingApproval: '⏳ Waiting for admin approval.',
    blocked: '⛔ Access denied until admin approval.',
    selectAction: 'Choose an action:',
    canceled: 'Action canceled.',
    unknownCommand: 'Unknown command.',
    invalidNumber: 'Enter a positive number.',
    invalidDateRange: 'Format: YYYY-MM-DD YYYY-MM-DD',
    noDataPeriod: (from, to) => `📭 No work data for ${from} — ${to}.`,
    statsTitle: (from, to) => `📊 Stats for ${from} — ${to}`,
    settingsTitle: '⚙️ Settings:',
    reportNameAsk: 'Enter report name for Excel:',
    reportNameUpdated: (name) => `✅ Excel report name updated: ${name}`,
    languageUpdated: (lang) => `✅ Language updated: ${lang.toUpperCase()}`,
    paymentIntro: '💳 Payment period\nNeeded so the bot can show how much company still owes you.',
    paymentSaved: (from, to, paid) => `✅ Payment saved: ${from} — ${to}\nPaid: $${paid.toFixed(2)}`,
    debtAfterPayment: (from, to, total) => `💰 Debt after payment (${from} — ${to}): $${total.toFixed(2)}`,
    adminMenu: '🛠 Admin menu:',
    driversEmpty: 'No drivers yet.',
    askBroadcast: 'Enter a message to send to all drivers:',
    broadcastDone: (ok, fail) => `✅ Broadcast done. Sent: ${ok}, Failed: ${fail}`,
    todayExcelDone: '✅ Today report was sent to group.',
    todayExcelNoGroup: '❌ GROUP_CHAT_ID is not set, cannot send report to group.',
    todayExcelNoData: 'ℹ️ No data for today report.',
    deleteConfirm: (name, id) => `⚠️ Delete driver ${name} (${id}) and all their data?`,
    deleteDone: (id) => `✅ Driver ${id} deleted with all data.`,
    updateBroadcastDone: '✅ Sent to all: bot updated.',
    adminMissing: '⚠️ ADMIN_ID is not set. Admin contact unavailable.'
  }
};

export function t(lang, key, ...args) {
  const dict = I18N[lang] || I18N.ru;
  const value = dict[key] ?? I18N.ru[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}
