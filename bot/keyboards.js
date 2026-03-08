import { TYPE_LABELS, WORK_TYPES } from './constants.js';

export function getMainKeyboard(isAdmin) {
  const keyboard = [
    [{ text: '🚛 OTR' }, { text: '🏙 Local' }],
    [{ text: '💵 Кастом прайс' }, { text: '📊 Stats' }],
    [{ text: '⚙️ Налаштування' }, { text: '💬 Звʼязок з адміном' }]
  ];

  if (isAdmin) {
    keyboard.push([{ text: '✅ Обнова' }, { text: '🛠 Admin Menu' }]);
  }

  return { keyboard, resize_keyboard: true, persistent: true };
}

export function getCancelInlineKeyboard() {
  return {
    inline_keyboard: [[{ text: '❌ Скасувати / Cancel', callback_data: 'cancel_input' }]]
  };
}

export function getStatsTypeSelectionKeyboard(selected) {
  const button = (type) => ({
    text: `${selected[type] ? '✅' : '⬜'} ${TYPE_LABELS[type]}`,
    callback_data: `sf:toggle:${type}`
  });

  return {
    inline_keyboard: [
      [button(WORK_TYPES[0]), button(WORK_TYPES[1])],
      [button(WORK_TYPES[2]), button(WORK_TYPES[3])],
      [{ text: '📊 Показати статистику', callback_data: 'sf:show' }],
      [{ text: '♻️ Вибрати все', callback_data: 'sf:all' }, { text: '🧹 Зняти все', callback_data: 'sf:none' }],
      [{ text: '❌ Скасувати', callback_data: 'cancel_input' }]
    ]
  };
}
