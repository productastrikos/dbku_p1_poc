/* Time helpers. Everything the command centre reasons about (night windows, hour of
   day, day of week) is in Malaysia Time (UTC+8, no DST), whatever the
   browser's own time zone is. */

export const TIME_ZONE = 'Asia/Kuching';
const OFFSET_MS = 8 * 3600000;
export const MINUTE = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;

export const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Calendar parts of a timestamp in Malaysia Time. */
export function mytParts(value) {
  const d = new Date(new Date(value).getTime() + OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

/** Night window used by every detector: 22:00–06:00 MYT. */
export const NIGHT = { start: 22, end: 6 };
export const isNightHour = (h) => h >= NIGHT.start || h < NIGHT.end;
export const isNight = (value) => isNightHour(mytParts(value).hour);

/** Start of the MYT calendar day containing `value`, as ms. */
export function mytDayStart(value) {
  const t = new Date(value).getTime();
  return Math.floor((t + OFFSET_MS) / DAY) * DAY - OFFSET_MS;
}

/** Timestamp for a given MYT hour on the MYT day containing `value`. */
export const atMytHour = (value, hour, minute = 0) => mytDayStart(value) + hour * HOUR + minute * MINUTE;

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DDTHH:mm' in MYT, for <input type="datetime-local">. */
export function toMytInput(value) {
  const p = mytParts(value);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
/** Parse a datetime-local value as MYT. */
export const fromMytInput = (str) => new Date(`${str}:00+08:00`);

/** ISO 8601 with the +08:00 offset, e.g. '2026-10-15T01:14:00+08:00'. */
export const toMytIso = (value) => `${new Date(new Date(value).getTime() + OFFSET_MS).toISOString().slice(0, 19)}+08:00`;

/** Formats in MYT. kind: 'datetime' | 'date' | 'time' | 'short' */
export function formatMyt(value, kind = 'datetime') {
  if (value == null) return '—';
  const opts = {
    datetime: { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false },
    date: { day: '2-digit', month: 'short', year: 'numeric' },
    time: { hour: '2-digit', minute: '2-digit', hour12: false },
    short: { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false },
  }[kind];
  return new Intl.DateTimeFormat('en-MY', { ...opts, timeZone: TIME_ZONE }).format(new Date(value));
}

/** True when two timestamps fall on the same MYT calendar day. */
export const sameMytDay = (a, b) => mytDayStart(a) === mytDayStart(b);
