import { FILTER_WORK_TYPES, TYPE_LABELS, menuText } from './constants.js';

export function getMainKeyboard(isAdmin, lang = 'en') {
  const keyboard = [
    [{ text: menuText(lang, 'otr') }, { text: menuText(lang, 'local') }],
    [{ text: menuText(lang, 'custom') }, { text: menuText(lang, 'stats') }],
    [{ text: menuText(lang, 'settings') }, { text: menuText(lang, 'donate') }]
  ];

  if (isAdmin) {
    keyboard.push([{ text: menuText(lang, 'update') }, { text: menuText(lang, 'adminMenu') }]);
  }

  return { keyboard, resize_keyboard: true, persistent: true };
}

export function getCancelInlineKeyboard() {
  return {
    inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel_input' }]]
  };
}

export function getStatsTypeSelectionKeyboard(selected) {
  const button = (type) => ({
    text: `${selected[type] ? '✅' : '⬜'} ${TYPE_LABELS[type]}`,
    callback_data: `sf:toggle:${type}`
  });

  return {
    inline_keyboard: [
      [button(FILTER_WORK_TYPES[0]), button(FILTER_WORK_TYPES[1])],
      [button(FILTER_WORK_TYPES[2])],
      [{ text: '📊 Show stats', callback_data: 'sf:show' }],
      [{ text: '♻️ Select all', callback_data: 'sf:all' }, { text: '🧹 Clear all', callback_data: 'sf:none' }],
      [{ text: '❌ Cancel', callback_data: 'cancel_input' }]
    ]
  };
}
