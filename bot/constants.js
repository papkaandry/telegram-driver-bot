export const ADMIN_ID = process.env.ADMIN_ID;
export const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
export const TIMEZONE = 'America/Vancouver';

export const WORK_TYPES = ['otr', 'local', 'boise', 'boise_custom'];
export const FILTER_WORK_TYPES = ['otr', 'local', 'boise_custom'];
export const TYPE_LABELS = {
  otr: 'OTR',
  local: 'Local',
  boise: 'Кастом прайс',
  boise_custom: 'Кастом прайс'
};

export const MAIN_MENU_TEXTS = {
  uk: {
    otr: '🚛 OTR',
    local: '🏙 Local',
    custom: '💵 Кастом прайс',
    stats: '📊 Stats',
    settings: '⚙️ Налаштування',
    adminContact: '💬 Звʼязок з адміном',
    update: '✅ Обнова',
    adminMenu: '🛠 Admin Menu'
  },
  en: {
    otr: '🚛 OTR',
    local: '🏙 Local',
    custom: '💵 Custom price',
    stats: '📊 Stats',
    settings: '⚙️ Settings',
    adminContact: '💬 Contact admin',
    update: '✅ Update',
    adminMenu: '🛠 Admin Menu'
  }
};

export const I18N = {
  uk: {
    welcome: 'Ласкаво просимо!',
    adminPanel: '👑 Адмін панель',
    waitingApproval: '⏳ Очікуйте підтвердження від адміна.',
    blocked: '⛔ Доступ закрито до підтвердження адміном.',
    selectAction: 'Оберіть дію:',
    canceled: 'Дію скасовано.',
    unknownCommand: 'Невідома команда.',
    invalidNumber: 'Введіть додатне число.',
    invalidDateRange: 'Формат: YYYY-MM-DD YYYY-MM-DD',
    noDataPeriod: (from, to) => `📭 За період ${from} — ${to} у вас не було роботи.`,
    statsTitle: (from, to) => `📊 Статистика за період ${from} — ${to}`,
    settingsTitle: '⚙️ Налаштування:',
    reportNameAsk: 'Введіть імʼя для Excel:',
    reportNameUpdated: (name) => `✅ Імʼя для Excel оновлено: ${name}`,
    languageUpdated: (lang) => `✅ Мову оновлено: ${lang.toUpperCase()}`,
    paymentIntro: '💳 Оплата за період\nЦе потрібно, щоб бот показував, скільки компанія ще вам винна.',
    paymentSaved: (from, to, paid) => `✅ Оплату збережено: ${from} — ${to}\nОплачено: $${paid.toFixed(2)}`,
    debtAfterPayment: (from, to, total) => `💰 Борг після оплати (${from} — ${to}): $${total.toFixed(2)}`,
    adminMenu: '🛠 Адмін меню:',
    driversEmpty: 'Водіїв поки немає.',
    askBroadcast: 'Введіть повідомлення для розсилки всім водіям:',
    broadcastDone: (ok, fail) => `✅ Розсилку завершено. Успішно: ${ok}, Помилок: ${fail}`,
    todayExcelDone: '✅ Звіт за сьогодні відправлено в групу.',
    todayExcelNoGroup: '❌ GROUP_CHAT_ID не задано. Неможливо відправити звіт у групу.',
    todayExcelNoData: 'ℹ️ За сьогодні немає даних для звіту.',
    deleteConfirm: (name, id) => `⚠️ Видалити водія ${name} (${id}) та всі його дані?`,
    deleteDone: (id) => `✅ Водія ${id} видалено разом із усіма даними.`,
    updateBroadcastDone: '✅ Усім відправлено: бот оновлено.',
    adminMissing: '⚠️ ADMIN_ID не задано. Звʼязок з адміном недоступний.',
    clearWorkConfirm: '⚠️ Видалити ВСЮ вашу роботу та історію оплат?',
    clearWorkDone: '✅ Усі ваші записи роботи та оплати видалено.',
    onboardingOtrAsk: 'Вас підтверджено ✅\nВкажіть вашу ставку за милю (OTR), наприклад: 0.7',
    onboardingLocalAsk: 'Тепер вкажіть вашу погодинну ставку за Local, наприклад: 30',
    onboardingDone: '✅ Ставки збережено. Можете працювати з ботом.'
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
    adminMissing: '⚠️ ADMIN_ID is not set. Admin contact unavailable.',
    clearWorkConfirm: '⚠️ Delete ALL your work and payment history?',
    clearWorkDone: '✅ All your work and payment records were deleted.',
    onboardingOtrAsk: 'You are approved ✅\nEnter your OTR per-mile rate, for example: 0.7',
    onboardingLocalAsk: 'Now enter your Local hourly rate, for example: 30',
    onboardingDone: '✅ Rates saved. You can now use the bot.'
  }
};

export function menuText(lang, key) {
  return (MAIN_MENU_TEXTS[lang] || MAIN_MENU_TEXTS.uk)[key] || MAIN_MENU_TEXTS.uk[key] || key;
}

export function t(lang, key, ...args) {
  const dict = I18N[lang] || I18N.uk;
  const value = dict[key] ?? I18N.uk[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}
