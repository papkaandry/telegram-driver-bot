export const ADMIN_ID = process.env.ADMIN_ID;
export const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
export const TIMEZONE = 'America/Vancouver';

export const WORK_TYPES = ['otr', 'otr_gross', 'local', 'boise', 'boise_custom'];
export const FILTER_WORK_TYPES = ['otr', 'local', 'boise_custom'];
export const TYPE_LABELS = {
  otr: 'OTR (miles)',
  otr_gross: 'OTR (% from gross)',
  local: 'Local',
  boise: 'Custom price',
  boise_custom: 'Custom price'
};

export const MAIN_MENU_TEXTS = {
  en: {
    otr: '🚛 OTR',
    local: '🏙 Local',
    custom: '💵 Custom price',
    stats: '📊 Stats',
    settings: '⚙️ Settings',
    donate: '❤️ Support development',
    adminContact: '💬 Contact admin',
    update: '✅ Update',
    adminMenu: '🛠 Admin Menu'
  },
  uk: {
    otr: '🚛 OTR',
    local: '🏙 Local',
    custom: '💵 Custom price',
    stats: '📊 Stats',
    settings: '⚙️ Settings',
    donate: '❤️ Support development',
    adminContact: '💬 Contact admin',
    update: '✅ Update',
    adminMenu: '🛠 Admin Menu'
  }
};

const EN = {
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
  reportNameAsk: 'Enter display name for Excel:',
  reportNameUpdated: (name) => `✅ Excel display name updated: ${name}`,
  languageUpdated: (lang) => `✅ Language updated: ${lang.toUpperCase()}`,
  paymentIntro: '💳 Payment period\nUsed to track how much the company still owes you.',
  paymentSaved: (from, to, paid) => `✅ Payment saved: ${from} — ${to}\nPaid: $${paid.toFixed(2)}`,
  debtAfterPayment: (from, to, total) => `💰 Debt after payment (${from} — ${to}): $${total.toFixed(2)}`,
  adminMenu: '🛠 Admin menu:',
  driversEmpty: 'No drivers yet.',
  askBroadcast: 'Enter a message to send to all approved drivers:',
  broadcastDone: (ok, fail) => `✅ Broadcast complete. Sent: ${ok}, Failed: ${fail}`,
  todayExcelDone: '✅ Today report was sent to group.',
  todayExcelNoGroup: '❌ GROUP_CHAT_ID is not set, cannot send report to group.',
  todayExcelNoData: 'ℹ️ No data for today report.',
  deleteConfirm: (name, id) => `⚠️ Delete driver ${name} (${id}) and all their data?`,
  deleteDone: (id) => `✅ Driver ${id} deleted with all data.`,
  updateBroadcastDone: '✅ Sent to all: bot updated.',
  adminMissing: '⚠️ ADMIN_ID is not set. Admin contact unavailable.',
  clearWorkConfirm: '⚠️ Delete ALL your work and payment history?',
  clearWorkDone: '✅ All your work and payment records were deleted.',
  onboardingDone: '✅ Rates saved. You can now use the bot.',
  onboardingLocalUseAsk: 'Do you work Local?',
  onboardingOtrUseAsk: 'Do you work OTR?',
  onboardingOtrModeAsk: 'How are you paid in OTR?',
  onboardingOtrModeMiles: 'Per mile',
  onboardingOtrModePercent: 'Percent from gross',
  onboardingLocalRateAsk: 'How much do you get paid per hour for Local? (example: 30)',
  onboardingOtrMileRateAsk: 'How much do you get paid per mile for OTR? (example: 0.7)',
  onboardingOtrPercentAsk: 'What percent from gross do you get paid? (example: 20)',
  notEnabledLocal: 'Your Local mode is disabled. Contact admin in Settings.',
  notEnabledOtr: 'Your OTR mode is disabled. Contact admin in Settings.',
  wrongOtrModeForMiles: 'You are configured for % from gross. Choose "% from gross" under OTR.',
  wrongOtrModeForGross: 'You are configured for per-mile OTR. Choose "Miles" under OTR.'
};

export const I18N = { en: EN, uk: EN };

export function menuText(lang, key) {
  return (MAIN_MENU_TEXTS[lang] || MAIN_MENU_TEXTS.en)[key] || MAIN_MENU_TEXTS.en[key] || key;
}

export function t(lang, key, ...args) {
  const dict = I18N[lang] || I18N.en;
  const value = dict[key] ?? I18N.en[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}
