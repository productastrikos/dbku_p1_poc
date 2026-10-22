/* Keeps the mock data current.

   The seed is generated for a fixed as-of date (meta.asOf). Recent records
   (everything on or after meta.liveSince: pilot alerts, scrap sales, the
   three pilot-period incidents, their outages and the open work orders) are
   moved forward by whole days so the as-of day becomes today in Malaysia
   Time. "Alerts today", "last 30 days" and the 7-day forecast then mean what
   they say whenever the prototype is opened. Older history (2020–2025) keeps
   its real dates, so the weekday pattern the risk model learns is unchanged. */
import { DAY, mytDayStart, toMytIso } from '../ai/time';

/**
 * Whole-day offset (ms) that moves meta.asOf to today, stepped back a day if
 * that would put a seeded record in the future (e.g. opening the app at 00:30
 * when the latest pilot alert was logged at 01:14).
 */
export function rebaseOffset(meta, latestMs, now = Date.now()) {
  const asOf = Date.parse(`${meta.asOf}T00:00:00+08:00`);
  let days = Math.round((mytDayStart(now) - asOf) / DAY);
  while (latestMs + days * DAY > now) days -= 1;
  return days * DAY;
}

/** Returns copies of the seed collections with recent timestamps moved to today. */
export function rebaseSeed(seed, now = Date.now()) {
  const since = Date.parse(seed.meta.liveSince);
  const recent = (v) => v != null && Date.parse(v) >= since;
  const latest = Math.max(
    ...seed.alerts.map((a) => Date.parse(a.createdAt)),
    ...seed.transactions.map((t) => Date.parse(t.date)),
    ...seed.tasks.flatMap((t) => [t.createdAt, t.updatedAt, ...t.history.map((h) => h.at)].map(Date.parse)),
  );
  const offset = rebaseOffset(seed.meta, latest, now);
  const shift = (v) => (recent(v) ? toMytIso(Date.parse(v) + offset) : v);

  return {
    offsetDays: offset / DAY,
    meta: { ...seed.meta, pilotStart: shift(seed.meta.pilotStart), today: toMytIso(Date.parse(`${seed.meta.asOf}T00:00:00+08:00`) + offset) },
    assets: seed.assets.map((a) => ({
      ...a,
      ...(a.lightingSince ? { lightingSince: shift(a.lightingSince) } : {}),
      ...(a.sensorSince ? { sensorSince: shift(a.sensorSince) } : {}),
    })),
    incidents: seed.incidents.map((i) => ({ ...i, occurredAt: shift(i.occurredAt) })),
    outages: seed.outages.map((o) => ({ ...o, start: shift(o.start), end: shift(o.end) })),
    transactions: seed.transactions.map((t) => ({ ...t, date: shift(t.date) })),
    alerts: seed.alerts.map((a) => ({ ...a, createdAt: shift(a.createdAt) })),
    tasks: seed.tasks.map((t) => ({
      ...t, createdAt: shift(t.createdAt), updatedAt: shift(t.updatedAt),
      history: t.history.map((h) => ({ ...h, at: shift(h.at) })),
    })),
  };
}
