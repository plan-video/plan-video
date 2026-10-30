// `day` and `start` are a wall clock in the post's zone, or the account's. Must follow
// apps/web/src/components/calendar/utils.ts and lib/time-zone.ts, so a post goes out at the time it shows.

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY = 86_400_000;

const dateFromKey = (day) => new Date(`${day}T00:00:00Z`);
const dateKey = (date) => date.toISOString().slice(0, 10);
export const shiftDay = (day, offset) => dateKey(new Date(dateFromKey(day).getTime() + offset * DAY));
const daysBetween = (from, to) => Math.round((dateFromKey(to).getTime() - dateFromKey(from).getTime()) / DAY);
export const isDayKey = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dateFromKey(value).getTime());
const isClock = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function parseRecurrence(recurrence) {
  if (!recurrence) return null;
  if (recurrence === "weekday") return { unit: "weekday" };
  if (WEEKDAY_NAMES.includes(recurrence)) return { unit: "week", every: 1 };
  const match = /^every:(\d{1,2}):(day|week|month)$/.exec(recurrence);
  const every = Number(match?.[1]);
  return match && every >= 1 ? { unit: match[2], every } : null;
}

const monthIndex = (date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
const monthLength = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

/** Whether a post first on `first` falls on `day`. A monthly one on the 31st lands on the last day of shorter months. */
export function matchesRecurrence(recurrence, day, first) {
  const date = dateFromKey(day);
  const weekday = date.getUTCDay();
  if (WEEKDAY_NAMES.includes(recurrence)) return recurrence === WEEKDAY_NAMES[weekday];
  const cadence = parseRecurrence(recurrence);
  if (!cadence || day < first) return false;
  if (cadence.unit === "weekday") return weekday >= 1 && weekday <= 5;
  if (cadence.unit === "day") return daysBetween(first, day) % cadence.every === 0;
  if (cadence.unit === "week") return daysBetween(first, day) % (7 * cadence.every) === 0;
  const start = dateFromKey(first);
  if ((monthIndex(date) - monthIndex(start)) % cadence.every !== 0) return false;
  return date.getUTCDate() === Math.min(start.getUTCDate(), monthLength(date));
}

const formatters = new Map();

function partsIn(time, zone) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  const parts = {};
  for (const part of formatter.formatToParts(time)) parts[part.type] = part.value;
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
}

const offsetAt = (time, zone) => partsIn(time, zone) - Math.floor(time / 1000) * 1000;

export function zoneOrUtc(zone) {
  if (typeof zone !== "string" || !zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/** A time skipped by a daylight-saving change lands just after it. */
export function momentOf(day, time, zone) {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hours, minutes);
  const first = wall - offsetAt(wall, zone);
  return wall - offsetAt(first, zone);
}

export function dayAt(time, zone) {
  return new Date(partsIn(time, zone)).toISOString().slice(0, 10);
}

/** A one-off's run is `once`. All-day posts count from the start of their day, like the calendar. */
export function runsBetween(post, accountZone, from, to) {
  if (!post || !isDayKey(post.day) || from > to) return [];
  const zone = zoneOrUtc(post.timeZone ?? accountZone);
  const time = post.allDay ? "00:00" : isClock(post.start) ? post.start : null;
  if (!time) return [];

  if (!post.recurrence) {
    const dueAt = momentOf(post.day, time, zone);
    return dueAt > from && dueAt <= to ? [{ occurrence: "once", dueAt }] : [];
  }
  if (!parseRecurrence(post.recurrence)) return [];

  const skipped = new Set(Array.isArray(post.recurrenceExceptions) ? post.recurrenceExceptions : []);
  const end = isDayKey(post.recurrenceEnd) ? post.recurrenceEnd : null;
  // A day either side, since the zone's day can differ from UTC's.
  const last = dayAt(to, zone);
  const runs = [];
  const first = shiftDay(dayAt(from, zone), -1);
  for (let day = first < post.day ? post.day : first; day <= shiftDay(last, 1); day = shiftDay(day, 1)) {
    if ((end && day > end) || skipped.has(day)) continue;
    if (!matchesRecurrence(post.recurrence, day, post.day)) continue;
    const dueAt = momentOf(day, time, zone);
    if (dueAt > from && dueAt <= to) runs.push({ occurrence: day, dueAt });
  }
  return runs;
}

/** How far ahead nextRunAfter looks for a repeating post's next run: past any cadence it allows (every 99 months). */
const HORIZON_DAYS = 3700;

/** Null when it has no run to come. A series whose next run is past the horizon gives the horizon, to look again. */
export function nextRunAfter(post, accountZone, after) {
  if (!post || !isDayKey(post.day)) return null;
  const zone = zoneOrUtc(post.timeZone ?? accountZone);
  const time = post.allDay ? "00:00" : isClock(post.start) ? post.start : null;
  if (!time) return null;

  if (!post.recurrence) {
    const dueAt = momentOf(post.day, time, zone);
    return dueAt > after ? dueAt : null;
  }
  if (!parseRecurrence(post.recurrence)) return null;

  const skipped = new Set(Array.isArray(post.recurrenceExceptions) ? post.recurrenceExceptions : []);
  const end = isDayKey(post.recurrenceEnd) ? post.recurrenceEnd : null;
  // A day before, since the zone's day can differ from UTC's, and never from before its first day.
  const first = shiftDay(dayAt(after, zone), -1);
  let day = first < post.day ? post.day : first;
  for (let step = 0; step < HORIZON_DAYS; step++, day = shiftDay(day, 1)) {
    if (end && day > end) return null;
    if (skipped.has(day) || !matchesRecurrence(post.recurrence, day, post.day)) continue;
    const dueAt = momentOf(day, time, zone);
    if (dueAt > after) return dueAt;
  }
  return momentOf(day, time, zone);
}

export function dueAtOf(post, accountZone, occurrence) {
  if (!post || !isDayKey(post.day)) return null;
  const zone = zoneOrUtc(post.timeZone ?? accountZone);
  const time = post.allDay ? "00:00" : isClock(post.start) ? post.start : null;
  if (!time) return null;
  if (occurrence === "once") return post.recurrence ? null : momentOf(post.day, time, zone);
  if (!post.recurrence || !isDayKey(occurrence)) return null;
  const skipped = Array.isArray(post.recurrenceExceptions) && post.recurrenceExceptions.includes(occurrence);
  const ended = isDayKey(post.recurrenceEnd) && occurrence > post.recurrenceEnd;
  if (skipped || ended || occurrence < post.day || !matchesRecurrence(post.recurrence, occurrence, post.day)) return null;
  return momentOf(occurrence, time, zone);
}
