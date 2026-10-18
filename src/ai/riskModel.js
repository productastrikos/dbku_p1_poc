/* Hotspot risk prediction: logistic regression trained in the browser on the
   incident history.

   Features for a (zone, hour) slot:
     zone                    one-hot
     day of week             1 on Friday and Saturday nights (01:00 Sat counts as Friday night)
     hour                    sin/cos of the MYT hour
     lighting status         share of the zone's streetlights that are dark
     incidents, last 30 days count in the zone before the slot
     nearest scrap dealer    km to the closest dealer licensed at the time

   Training is case-control: every incident hour is a positive and two random
   hours per zone per day are negatives; positives are re-weighted so both
   classes carry equal weight. Scores are therefore relative risk on a 0–1
   scale, not literal probabilities. The 7-day risk is the average of each
   forecast night's peak-hour score (22:00–06:00). */
import { mulberry32 } from './random';
import { distanceKm, nearestNeighbourOrder, haversine } from './geo';
import { mytParts, mytDayStart, DAY, HOUR, DAYS_EN, isNightHour } from './time';

export const RISK_BANDS = { medium: 0.3, high: 0.6 };
export const BAND = {
  High:   { label: 'High',   labelMs: 'Tinggi',    tone: 'danger' },
  Medium: { label: 'Medium', labelMs: 'Sederhana', tone: 'warning' },
  Low:    { label: 'Low',    labelMs: 'Rendah',    tone: 'success' },
};
export const bandFor = (p) => (p > RISK_BANDS.high ? 'High' : p >= RISK_BANDS.medium ? 'Medium' : 'Low');

const TRAIN_START = Date.parse('2020-01-01T00:00:00+08:00');

/* ─── Context: everything needed to compute features ──────── */
export function buildContext({ zones, assets, incidents, outages, dealers }) {
  const lightsPerZone = {};
  zones.forEach((z) => { lightsPerZone[z.id] = assets.filter((a) => a.zone === z.id && a.type === 'streetlight').length || 1; });
  return {
    zones,
    zoneIds: zones.map((z) => z.id),
    lightsPerZone,
    incidentsByZone: Object.fromEntries(zones.map((z) => [z.id, incidents.filter((i) => i.zone === z.id).map((i) => Date.parse(i.occurredAt)).sort((a, b) => a - b)])),
    outagesByZone: Object.fromEntries(zones.map((z) => [z.id, outages.filter((o) => o.zone === z.id).map((o) => ({ ...o, s: Date.parse(o.start), e: o.end ? Date.parse(o.end) : Infinity }))])),
    dealerDist: Object.fromEntries(zones.map((z) => [z.id, dealers.map((d) => ({ id: d.id, name: d.name, since: Date.parse(`${d.licensedSince}T00:00:00+08:00`), km: distanceKm(z.center, [d.lat, d.lng]) })).sort((a, b) => a.km - b.km)])),
    incidents,
  };
}

/* ─── Feature extraction ──────────────────────────────────── */
export const FEATURE_NAMES = ['zone_SEM', 'zone_KUL', 'zone_BIN', 'fri_sat_night', 'hour_sin', 'hour_cos', 'lights_out', 'incidents_30d', 'dealer_km'];
export const GROUPS = {
  zone: { label: 'Zone history', labelMs: 'Sejarah zon', idx: [0, 1, 2] },
  day: { label: 'Day of week', labelMs: 'Hari', idx: [3] },
  hour: { label: 'Hour of night', labelMs: 'Waktu', idx: [4, 5] },
  lighting: { label: 'Lighting status', labelMs: 'Status lampu', idx: [6] },
  recent: { label: 'Incidents in last 30 days', labelMs: 'Insiden 30 hari', idx: [7] },
  dealer: { label: 'Distance to scrap dealer', labelMs: 'Jarak ke peniaga besi buruk', idx: [8] },
};

function lightsOutAt(ctx, zone, t) {
  let out = 0;
  for (const o of ctx.outagesByZone[zone]) if (o.s < t && t <= o.e) out += o.lightsOut;
  return Math.min(1, out / ctx.lightsPerZone[zone]);
}
function incidentsBefore(ctx, zone, t, extra = []) {
  const lo = t - 30 * DAY;
  return ctx.incidentsByZone[zone].filter((x) => x >= lo && x < t).length + extra.filter((x) => x >= lo && x < t).length;
}
function nearestDealer(ctx, zone, t) {
  return ctx.dealerDist[zone].find((d) => d.since <= t) || ctx.dealerDist[zone][ctx.dealerDist[zone].length - 1];
}

/**
 * Raw feature values and the model vector for a zone at time t.
 * overrides: { lightsOut, extraIncidents: [ms] } for forecasting from live state.
 */
export function featuresFor(ctx, zone, t, overrides = {}) {
  const { hour, dow } = mytParts(t);
  const nightOf = hour < 6 ? (dow + 6) % 7 : dow; // 01:00 Saturday belongs to Friday night
  const lightsOut = overrides.lightsOut ?? lightsOutAt(ctx, zone, t);
  const recent = incidentsBefore(ctx, zone, t, overrides.extraIncidents);
  const dealer = nearestDealer(ctx, zone, t);
  const raw = { zone, hour, dow, nightOf, lightsOut, recent, dealerKm: dealer.km, dealer };
  const vec = [
    ...ctx.zoneIds.map((z) => (z === zone ? 1 : 0)),
    nightOf === 5 || nightOf === 6 ? 1 : 0,
    Math.sin((2 * Math.PI * hour) / 24), Math.cos((2 * Math.PI * hour) / 24),
    lightsOut, recent, dealer.km,
  ];
  return { raw, vec };
}

/* ─── Training ────────────────────────────────────────────── */
export function buildTrainingSet(ctx, { end, negativesPerDay = 2, seed = 11 }) {
  const rand = mulberry32(seed);
  const X = [];
  const y = [];
  const night = []; // negatives in the night window, for the explanation baseline
  for (const z of ctx.zoneIds) {
    for (const t of ctx.incidentsByZone[z]) {
      if (t >= end) continue;
      X.push(featuresFor(ctx, z, Math.floor(t / HOUR) * HOUR + 30 * 60000).vec);
      y.push(1);
    }
    const near = (t) => ctx.incidentsByZone[z].some((x) => Math.abs(x - t) < 3 * HOUR);
    for (let day = mytDayStart(TRAIN_START); day < end - DAY; day += DAY) {
      for (let k = 0; k < negativesPerDay; k++) {
        const h = Math.floor(rand() * 24);
        const t = day + h * HOUR + 30 * 60000;
        if (near(t)) continue;
        const { vec } = featuresFor(ctx, z, t);
        X.push(vec);
        y.push(0);
        if (isNightHour(h)) night.push(vec);
      }
    }
  }
  const nightBaseline = night[0].map((_, j) => night.reduce((s, r) => s + r[j], 0) / night.length);
  return { X, y, nightBaseline };
}

const sigmoid = (v) => 1 / (1 + Math.exp(-v));

/** Weighted, L2-regularised logistic regression (full-batch gradient descent with momentum). */
export function trainLogistic(X, y, { l2 = 0.02, lr = 0.3, epochs = 400 } = {}) {
  const n = X.length;
  const m = X[0].length;
  const mean = Array(m).fill(0);
  const std = Array(m).fill(0);
  X.forEach((r) => r.forEach((v, j) => { mean[j] += v / n; }));
  X.forEach((r) => r.forEach((v, j) => { std[j] += (v - mean[j]) ** 2 / n; }));
  for (let j = 0; j < m; j++) std[j] = Math.sqrt(std[j]) || 1;
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / std[j]));

  const pos = y.filter(Boolean).length;
  const wPos = (n - pos) / Math.max(pos, 1); // balance classes
  const sw = y.map((v) => (v ? wPos : 1));
  const swSum = sw.reduce((a, b) => a + b, 0);

  const w = Array(m).fill(0);
  let b = 0;
  const vw = Array(m).fill(0);
  let vb = 0;
  const losses = [];
  for (let e = 0; e < epochs; e++) {
    const gw = Array(m).fill(0);
    let gb = 0;
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const zi = Z[i];
      let s = b;
      for (let j = 0; j < m; j++) s += w[j] * zi[j];
      const p = sigmoid(s);
      const err = (p - y[i]) * sw[i];
      for (let j = 0; j < m; j++) gw[j] += err * zi[j];
      gb += err;
      if (e % 50 === 0 || e === epochs - 1) loss -= sw[i] * (y[i] ? Math.log(p + 1e-12) : Math.log(1 - p + 1e-12));
    }
    for (let j = 0; j < m; j++) {
      vw[j] = 0.9 * vw[j] + gw[j] / swSum + l2 * w[j];
      w[j] -= lr * vw[j];
    }
    vb = 0.9 * vb + gb / swSum;
    b -= lr * vb;
    if (e % 50 === 0 || e === epochs - 1) losses.push(+(loss / swSum).toFixed(4));
  }
  return { weights: w, bias: b, mean, std, losses, positives: pos, negatives: n - pos };
}

export function predict(model, vec) {
  let s = model.bias;
  for (let j = 0; j < vec.length; j++) s += model.weights[j] * ((vec[j] - model.mean[j]) / model.std[j]);
  return sigmoid(s);
}

/**
 * Per-group contribution to the log-odds, relative to an average night-time
 * slot across the network. Every zone is riskier at night, so measuring from
 * a night baseline shows what makes this zone stand out tonight.
 */
export function contributions(model, vec) {
  return Object.fromEntries(Object.entries(GROUPS).map(([key, g]) => [
    key,
    g.idx.reduce((s, j) => s + model.weights[j] * ((vec[j] - model.nightBaseline[j]) / model.std[j]), 0),
  ]));
}

/** Area under the ROC curve on the training data (sanity check shown in the UI). */
export function auc(model, X, y) {
  const scored = X.map((x, i) => [predict(model, x), y[i]]).sort((a, b) => a[0] - b[0]);
  let rank = 0;
  let sumPos = 0;
  let pos = 0;
  scored.forEach(([, label], i) => { rank = i + 1; if (label) { sumPos += rank; pos += 1; } });
  const neg = scored.length - pos;
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg || 1);
}

export function trainRiskModel(ctx, end) {
  const { X, y, nightBaseline } = buildTrainingSet(ctx, { end });
  const model = trainLogistic(X, y);
  return { ...model, nightBaseline, auc: +auc(model, X, y).toFixed(3), trainedAt: end, rows: X.length };
}

/* ─── Explanations ────────────────────────────────────────── */
function historyStats(ctx) {
  const inc = ctx.incidents;
  const small = inc.filter((i) => { const h = mytParts(i.occurredAt).hour; return h >= 0 && h < 4; }).length;
  // Friday/Saturday nights: Fri 22:00 → Sun 06:00 MYT.
  const weekend = inc.filter((i) => {
    const { dow, hour } = mytParts(i.occurredAt);
    return (dow === 5 && hour >= 22) || (dow === 6) || (dow === 0 && hour < 6);
  }).length;
  return { total: inc.length, smallHours: small, weekendNights: weekend };
}

function reasonText(key, raw, ctx, extra) {
  const stats = historyStats(ctx);
  const zoneTotal = ctx.incidentsByZone[raw.zone].length;
  switch (key) {
    case 'zone': return `Historically hit ${zoneTotal} times since 2020 (${zoneTotal} of ${stats.total} incidents).`;
    case 'day': return `Peak falls on ${DAYS_EN[raw.nightOf]} night; ${stats.weekendNights} of ${stats.total} past incidents were on Friday or Saturday nights.`;
    case 'hour': return `Peak risk around ${String(raw.hour).padStart(2, '0')}:00; ${stats.smallHours} of ${stats.total} incidents happened between 00:00 and 04:00.`;
    case 'lighting': {
      const lights = ctx.lightsPerZone[raw.zone];
      const dark = Math.round(raw.lightsOut * lights);
      return `${dark} of ${lights} streetlights are dark${extra.darkIds?.length ? ` (${extra.darkIds.join(', ')})` : ''}, giving thieves cover.`;
    }
    case 'recent': return `${raw.recent} incident${raw.recent === 1 ? '' : 's'} in the last 30 days; thieves often return to finish stripping a cable run.`;
    case 'dealer': return `A licensed scrap dealer is ${raw.dealerKm.toFixed(2)} km away (${raw.dealer.name}), a short haul for stolen copper.`;
    default: return '';
  }
}

/* ─── 7-day forecast ──────────────────────────────────────── */
/**
 * live: { lightsOut: { [zone]: 0–1 }, darkIds: { [zone]: [...] }, extraIncidents: { [zone]: [ms] } }
 * Returns zones sorted by risk with the 7×24 heat grid, nightly peaks and top-3 reasons.
 */
export function forecast(ctx, model, start, live = {}) {
  const day0 = mytDayStart(start);
  const results = ctx.zoneIds.map((zone) => {
    const overrides = { lightsOut: live.lightsOut?.[zone], extraIncidents: live.extraIncidents?.[zone] || [] };
    const heat = [];
    const nightly = [];
    let peak = { p: -1 };
    for (let d = 0; d < 7; d++) {
      const row = [];
      for (let h = 0; h < 24; h++) {
        const t = day0 + d * DAY + h * HOUR + 30 * 60000;
        const f = featuresFor(ctx, zone, t, overrides);
        const p = predict(model, f.vec);
        row.push(+p.toFixed(3));
        if (p > peak.p) peak = { p, t, f };
      }
      heat.push(row);
    }
    // Night d runs 22:00 on day d to 06:00 on day d+1.
    for (let d = 0; d < 7; d++) {
      const hours = [22, 23].map((h) => ({ d, h })).concat([0, 1, 2, 3, 4, 5].map((h) => ({ d: d + 1, h })));
      let best = { p: -1 };
      for (const { d: dd, h } of hours) {
        const p = dd < 7 ? heat[dd][h] : predict(model, featuresFor(ctx, zone, day0 + dd * DAY + h * HOUR + 30 * 60000, overrides).vec);
        if (p > best.p) best = { p, hour: h, date: day0 + d * DAY };
      }
      nightly.push({ date: best.date, peakHour: best.hour, p: +best.p.toFixed(3) });
    }
    const risk = nightly.reduce((s, n) => s + n.p, 0) / nightly.length;
    const contrib = contributions(model, peak.f.vec);
    const reasons = Object.entries(contrib)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, value]) => ({
        key, value: +value.toFixed(2), label: GROUPS[key].label, labelMs: GROUPS[key].labelMs,
        text: reasonText(key, peak.f.raw, ctx, { darkIds: live.darkIds?.[zone] }),
      }));
    return {
      zone, risk: +risk.toFixed(3), band: bandFor(risk), heat, nightly, reasons, contributions: contrib,
      peak: { p: +peak.p.toFixed(3), t: peak.t, hour: peak.f.raw.hour },
      features: peak.f.raw,
    };
  });
  return results.sort((a, b) => b.risk - a.risk);
}

/* ─── Night patrol route ──────────────────────────────────── */
const ASSET_WEIGHT = { switchboard: 1.4, cable: 1.25, distribution_box: 1.15, streetlight: 1 };

/**
 * Orders zones by risk; inside each zone visits the priority assets
 * (dark lights, switchboards, recent incident sites, no CCTV cover).
 */
export function patrolRoute(forecasts, assets, base, { stopsPerZone = 4, depart = '22:30', kmh = 30, minutesPerStop = 8 } = {}) {
  const recentIds = new Set();
  const stops = [];
  let cur = { lat: base.lat, lng: base.lng };
  for (const f of forecasts) {
    const za = assets.filter((a) => a.zone === f.zone);
    const scored = za.map((a) => {
      let s = ASSET_WEIGHT[a.type] || 1;
      const why = [];
      if (a.lighting === 'out') { s += 0.5; why.push('light dark'); }
      if (a.sensor === 'offline') { s += 0.3; why.push('sensor offline'); }
      if (!a.cameraId) { s += 0.25; why.push('no CCTV cover'); }
      if (a.type === 'switchboard') why.push('high-value switchboard');
      if (recentIds.has(a.id)) s += 0.3;
      return { asset: a, s: s * f.risk, why };
    }).sort((x, y) => y.s - x.s);
    // Spread the stops: skip assets within 150 m of one already chosen.
    const chosen = [];
    for (const x of scored) {
      if (chosen.length === stopsPerZone) break;
      if (chosen.every((c) => haversine([c.asset.lat, c.asset.lng], [x.asset.lat, x.asset.lng]) > 150)) chosen.push(x);
    }
    const ordered = nearestNeighbourOrder(cur, chosen.map((x) => ({ ...x, lat: x.asset.lat, lng: x.asset.lng })));
    ordered.forEach((x) => stops.push({ zone: f.zone, band: f.band, risk: f.risk, asset: x.asset, why: x.why }));
    cur = ordered[ordered.length - 1] || cur;
  }
  // ETAs
  const [hh, mm] = depart.split(':').map(Number);
  let minutes = hh * 60 + mm;
  let prev = base;
  let km = 0;
  stops.forEach((s) => {
    const d = haversine([prev.lat, prev.lng], [s.asset.lat, s.asset.lng]) / 1000 * 1.35; // road factor
    km += d;
    minutes += (d / kmh) * 60 + minutesPerStop;
    const m = Math.round(minutes);
    s.eta = `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    prev = s.asset;
  });
  const top = forecasts[0];
  return {
    stops,
    km: +km.toFixed(1),
    revisit: top && top.band !== 'Low' ? { zone: top.zone, hour: isNightHour(top.peak.hour) ? top.peak.hour : 2 } : null,
  };
}
