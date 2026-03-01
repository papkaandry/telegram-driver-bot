import { TIMEZONE } from './constants.js';

export function toTZParts(date = new Date(), timeZone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day)
  };
}

export function makeIsoDate(year, month, day) {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function parseDateRangeInput(input) {
  const chunks = String(input || '').trim().split(/\s+/);
  if (chunks.length !== 2) return null;
  const from = parseISODate(chunks[0]);
  const to = parseISODate(chunks[1]);
  if (!from || !to || from > to) return null;
  return { from, to };
}

export function getTodayISOinTZ() {
  const { year, month, day } = toTZParts(new Date(), TIMEZONE);
  return makeIsoDate(year, month, day);
}

export function getMonthRange() {
  const { year, month } = toTZParts(new Date(), TIMEZONE);
  const from = makeIsoDate(year, month, 1);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = makeIsoDate(year, month, lastDay);
  return { from, to };
}

export function getWeekRange() {
  const { year, month, day } = toTZParts(new Date(), TIMEZONE);
  const localDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = localDate.getUTCDay();
  const diffToMonday = (weekday + 6) % 7;
  const monday = new Date(localDate);
  monday.setUTCDate(localDate.getUTCDate() - diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10)
  };
}

export function formatDatePretty(isoDate, lang = 'ru') {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}
