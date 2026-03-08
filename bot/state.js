const userState = new Map();

export function setState(telegramId, value) {
  userState.set(telegramId, value);
}

export function getState(telegramId) {
  return userState.get(telegramId);
}

export function clearState(telegramId) {
  userState.delete(telegramId);
}
