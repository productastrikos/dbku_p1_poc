/* ═══════════════════════════════════════════════════════════════════════
   GuardGrid mock-data generator.

   Writes the JSON files in src/data/mock/. Output is deterministic (seeded),
   so re-running gives the same data for the same --asof date.

     npm run seed                     # as-of 2026-10-15
     npm run seed -- --asof=2026-12-01

   Recent incidents, pilot alerts and scrap transactions are placed relative
   to the as-of date so "last 30 days" features stay meaningful.

   Road geometry for asset placement comes from scripts/osm-roads.json,
   extracted from OpenStreetMap (© OpenStreetMap contributors, ODbL).
   Dealers, sellers, incidents and costs are fictional.
   ═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const ROADS = require('./osm-roads.json');

const AS_OF = (process.argv.find((a) => a.startsWith('--asof=')) || '--asof=2026-10-15').slice(7);
const OUT = path.join(__dirname, '..', 'src', 'data', 'mock');
const TZ = '+08:00'; // Malaysia Time (no DST)

/* ─── Helpers ─────────────────────────────────────────────── */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260415);
const uni = (a, b) => a + (b - a) * rand();
const int = (a, b) => Math.floor(uni(a, b + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const gauss = () => {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};
const round = (v, d = 5) => +v.toFixed(d);

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function haversine([lat1, lng1], [lat2, lng2]) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Point at fraction f (0–1) of a polyline's length, plus the local bearing vector.
function along(pts, f) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = haversine(pts[i - 1], pts[i]); seg.push(d); total += d; }
  let target = Math.min(Math.max(f, 0), 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? target / seg[i] : 0;
      const [a, b] = [pts[i], pts[i + 1]];
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [b[0] - a[0], b[1] - a[1]] };
    }
    target -= seg[i];
  }
  return { p: pts[pts.length - 1], dir: [0, 0] };
}
// Shift a point sideways from the road centreline by `m` metres.
function offset({ p, dir }, m) {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const nLat = -dir[1] / len;
  const nLng = dir[0] / len;
  return [round(p[0] + (nLat * m) / 111320), round(p[1] + (nLng * m) / (111320 * Math.cos(toRad(p[0]))))];
}
function subPath(pts, f0, f1, steps = 8) {
  return Array.from({ length: steps + 1 }, (_, i) => along(pts, f0 + ((f1 - f0) * i) / steps).p.map((v) => round(v)));
}
const pathLength = (pts) => pts.slice(1).reduce((s, p, i) => s + haversine(pts[i], p), 0);

const way = (zone, id) => {
  const w = ROADS[zone].find((r) => r.id === id);
  if (!w) throw new Error(`Missing way ${id} in ${zone}`);
  return w;
};

const DAY = 86400000;
const asOfMs = Date.parse(`${AS_OF}T00:00:00${TZ}`);
// ISO string in MYT for a timestamp in ms.
function isoMyt(ms) {
  const d = new Date(ms + 8 * 3600000);
  return `${d.toISOString().slice(0, 19)}${TZ}`;
}
const at = (date, time) => `${date}T${time}:00${TZ}`;
const daysBefore = (n, time) => isoMyt(asOfMs - n * DAY + (time ? (+time.slice(0, 2) * 60 + +time.slice(3)) * 60000 : 0));

/* ─── Zones (DBKU hotspots) ───────────────────────────────── */
const ZONES = [
  {
    id: 'SEM',
    name: 'Jalan Tun Abdul Rahman Yaakub / Bulatan Semariang',
    short: 'Bulatan Semariang',
    description: 'Dual carriageway approaches and the Semariang roundabout on Jalan Tun Abdul Rahman Ya\'kub, plus the start of Jalan Semariang.',
  },
  {
    id: 'KUL',
    name: 'Sarawak Crest / Jalan Kulas Bridge',
    short: 'Jalan Kulas Bridge',
    description: 'Jambatan Tun Abdul Rahman Ya\'kub approach, Jalan Kulas and the Satok–Kulas interchange.',
  },
  {
    id: 'BIN',
    name: 'Sungai Bintangor / Jambatan Amar Juma\'ani',
    short: 'Jambatan Amar Juma\'ani',
    description: 'Jambatan Datuk Amar Juma\'ani over Sungai Bintangor, the riverside cable route and Jalan Kulas east.',
  },
];

/* ─── Assets: 20 per zone, placed on real road geometry ───── */
// [wayId, count, fromFraction, toFraction]
const LIGHT_PLAN = {
  SEM: [[129613865, 5, 0.55, 0.97], [129613867, 4, 0.72, 0.97], [129613948, 4, 0.04, 0.32]],
  KUL: [[113702300, 3, 0.1, 0.9], [1218703840, 3, 0.1, 0.9], [129145627, 3, 0.1, 0.9], [682028852, 2, 0.2, 0.8], [54244416, 2, 0.02, 0.14]],
  BIN: [[113702083, 3, 0.1, 0.9], [113702079, 1, 0.5, 0.5], [1212098939, 3, 0.5, 0.95], [113702081, 3, 0.1, 0.9], [113700288, 2, 0.2, 0.7], [113700286, 1, 0.5, 0.5]],
};
// type, wayId, fraction, offset metres, label
const FIXED_PLAN = {
  SEM: [
    ['switchboard', 129613869, 0.15, 30, 'Main switchboard, Bulatan Semariang'],
    ['distribution_box', 129613865, 0.82, 14, 'Feeder pillar, JTARY westbound'],
    ['distribution_box', 129613867, 0.86, 14, 'Feeder pillar, JTARY eastbound'],
    ['distribution_box', 129613948, 0.12, 12, 'Feeder pillar, Jalan Semariang'],
    ['distribution_box', 129613869, 0.6, 26, 'Distribution box, roundabout south'],
  ],
  KUL: [
    ['switchboard', 682028852, 0.5, 28, 'Main switchboard, Satok–Kulas interchange'],
    ['distribution_box', 113702300, 0.95, 14, 'Feeder pillar, bridge south abutment'],
    ['distribution_box', 1218703840, 0.6, 12, 'Feeder pillar, Jalan Kulas west'],
    ['distribution_box', 129145627, 0.7, 12, 'Distribution box, Jalan Kulas'],
    ['distribution_box', 54244416, 0.05, 16, 'Feeder pillar, bridge north abutment'],
  ],
  BIN: [
    ['switchboard', 1212098939, 0.88, 22, 'Main switchboard, Jalan Kulas east'],
    ['distribution_box', 113702083, 0.02, 14, 'Feeder pillar, bridge west abutment'],
    ['distribution_box', 113702079, 0.95, 14, 'Feeder pillar, bridge east abutment'],
    ['distribution_box', 113702081, 0.5, 12, 'Distribution box, Jalan Kulas east'],
    ['distribution_box', 113700288, 0.4, 10, 'Distribution box, Jalan Kulas Utara 1'],
  ],
};
// Cable runs: wayId, from, to, label
const CABLE_PLAN = {
  SEM: [[129613865, 0.62, 0.98, 'Underground feeder, JTARY west approach'], [129613948, 0.02, 0.3, 'Underground feeder, Jalan Semariang']],
  KUL: [[113702300, 0.0, 1.0, 'Bridge lighting cable tray'], [129145627, 0.0, 1.0, 'Underground feeder, Jalan Kulas']],
  BIN: [[113700293, 0.35, 0.75, 'Riverside cable, Sungai Bintangor'], [113702083, 0.0, 1.0, 'Bridge deck lighting cable']],
};

const COST = { streetlight: 6800, distribution_box: 28500, switchboard: 146000, cablePerM: 185 };
const PREFIX = { streetlight: 'SL', distribution_box: 'DB', switchboard: 'MSB', cable: 'CB' };

const assets = [];
for (const z of ZONES) {
  let n = 0;
  for (const [id, count, f0, f1] of LIGHT_PLAN[z.id]) {
    const w = way(z.id, id);
    for (let i = 0; i < count; i++) {
      const f = count === 1 ? f0 : f0 + ((f1 - f0) * i) / (count - 1);
      n += 1;
      const [lat, lng] = offset(along(w.pts, f), 7 * (n % 2 ? 1 : -1));
      assets.push({
        id: `SL-${z.id}-${String(n).padStart(2, '0')}`, type: 'streetlight', zone: z.id,
        name: `Streetlight ${String(n).padStart(2, '0')}`, road: w.name, lat, lng,
        installed: int(2012, 2021), replacementCostRM: COST.streetlight,
      });
    }
  }
  const counters = { switchboard: 0, distribution_box: 0 };
  for (const [type, id, f, m, label] of FIXED_PLAN[z.id]) {
    const w = way(z.id, id);
    counters[type] += 1;
    const [lat, lng] = offset(along(w.pts, f), m);
    assets.push({
      id: `${PREFIX[type]}-${z.id}-${String(counters[type]).padStart(2, '0')}`, type, zone: z.id,
      name: label, road: w.name.startsWith('Bulatan') ? 'Bulatan Semariang' : w.name, lat, lng,
      installed: int(2010, 2019), replacementCostRM: COST[type],
    });
  }
  CABLE_PLAN[z.id].forEach(([id, f0, f1, label], i) => {
    const w = way(z.id, id);
    const p = subPath(w.pts, f0, f1);
    const lengthM = Math.round(pathLength(p));
    const mid = along(p, 0.5).p;
    assets.push({
      id: `CB-${z.id}-${String(i + 1).padStart(2, '0')}`, type: 'cable', zone: z.id,
      name: label, road: w.name, lat: round(mid[0]), lng: round(mid[1]), path: p, lengthM,
      installed: int(2011, 2020), replacementCostRM: Math.round((lengthM * COST.cablePerM) / 100) * 100,
    });
  });
}

// Zone centre and radius from its assets.
for (const z of ZONES) {
  const za = assets.filter((a) => a.zone === z.id);
  const c = [za.reduce((s, a) => s + a.lat, 0) / za.length, za.reduce((s, a) => s + a.lng, 0) / za.length];
  z.center = [round(c[0]), round(c[1])];
  z.radiusM = Math.round(Math.max(...za.map((a) => haversine(c, [a.lat, a.lng]))) + 60);
}

/* ─── CCTV: existing solar units (low-res, no analytics) ──── */
const CAMERA_PLAN = {
  SEM: [['SL-SEM-04', ['SL-SEM-02', 'SL-SEM-03', 'SL-SEM-04', 'SL-SEM-05', 'DB-SEM-01', 'CB-SEM-01']], ['MSB-SEM-01', ['MSB-SEM-01', 'DB-SEM-04', 'SL-SEM-06', 'SL-SEM-07', 'SL-SEM-10']]],
  KUL: [['SL-KUL-02', ['SL-KUL-01', 'SL-KUL-02', 'SL-KUL-03', 'DB-KUL-01', 'CB-KUL-01']], ['MSB-KUL-01', ['MSB-KUL-01', 'SL-KUL-10', 'SL-KUL-11', 'DB-KUL-03']]],
  BIN: [['SL-BIN-02', ['SL-BIN-01', 'SL-BIN-02', 'SL-BIN-03', 'SL-BIN-04', 'DB-BIN-01', 'CB-BIN-02']], ['MSB-BIN-01', ['MSB-BIN-01', 'SL-BIN-07', 'DB-BIN-03', 'CB-BIN-01']]],
};
const cameras = [];
for (const z of ZONES) {
  CAMERA_PLAN[z.id].forEach(([mountId, covers], i) => {
    const m = assets.find((a) => a.id === mountId);
    const id = `CAM-${z.id}-${i + 1}`;
    cameras.push({ id, zone: z.id, lat: round(m.lat + 0.00008), lng: round(m.lng + 0.00008), mountedOn: mountId, covers, model: 'Solar CCTV 2MP (existing, no analytics)' });
    covers.forEach((aid) => { const a = assets.find((x) => x.id === aid); if (a && !a.cameraId) a.cameraId = id; });
  });
}
assets.forEach((a) => { if (!a.cameraId) a.cameraId = null; });

/* ─── Scrap dealers (fictional; real Kuching localities) ──── */
const dealers = [
  { id: 'D01', area: 'Jalan Bako, Petra Jaya',          lat: 1.57400, lng: 110.35800, since: '2014-05-02', avgKg: 70 },
  { id: 'D02', area: 'Kampung Kudei',                   lat: 1.55100, lng: 110.32170, since: '2011-08-15', avgKg: 55 },
  { id: 'D03', area: 'Jalan Satok',                     lat: 1.55120, lng: 110.33960, since: '2016-02-20', avgKg: 60 },
  { id: 'D04', area: 'Jalan Semariang',                 lat: 1.58450, lng: 110.32880, since: '2023-01-09', avgKg: 45 },
  { id: 'D05', area: 'Matang Jaya',                     lat: 1.58620, lng: 110.29720, since: '2012-11-05', avgKg: 85 },
  { id: 'D06', area: 'Pending Industrial Estate',       lat: 1.54620, lng: 110.37950, since: '2009-03-30', avgKg: 50 },
  { id: 'D07', area: 'Demak Laut Industrial Park',      lat: 1.62150, lng: 110.40450, since: '2015-07-18', avgKg: 110 },
  { id: 'D08', area: 'Sejingkat',                       lat: 1.58950, lng: 110.41950, since: '2013-09-09', avgKg: 95 },
  { id: 'D09', area: 'Batu Kawa',                       lat: 1.51350, lng: 110.30050, since: '2017-04-12', avgKg: 75 },
  { id: 'D10', area: 'Kota Sentosa (7th Mile)',         lat: 1.47350, lng: 110.33950, since: '2010-01-25', avgKg: 65 },
].map((d) => ({
  id: d.id,
  name: `Dealer ${d.id.slice(1)} · ${d.area.split(',')[0]}`,
  licenceNo: `MOCK-SHD-${d.id.slice(1)}${d.since.slice(2, 4)}`,
  area: d.area, lat: d.lat, lng: d.lng, licensedSince: d.since,
  profile: { avgKg: d.avgKg },
}));

/* ─── Historical incidents (22, 2020–2026, ≈ RM 2.12M) ────── */
// The last three are placed relative to the as-of date.
// [date|offsetDays, time, zone, type, title, detail, assetIds, rawCostRM, lightsCut, darkBefore]
const INCIDENTS = [
  ['2020-03-14', '02:10', 'SEM', 'cable_theft', 'Feeder cable stolen from JTARY median', 'About 280 m of underground feeder cut at two pits and pulled out; 8 streetlights dark.', ['CB-SEM-01', 'SL-SEM-02', 'SL-SEM-03'], 74600, 8, 0],
  ['2020-07-25', '02:00', 'KUL', 'cable_theft', 'Cable tray under bridge approach cut', 'About 180 m removed from the cable tray beneath the Jambatan Tun Abdul Rahman Ya\'kub approach.', ['CB-KUL-01'], 64800, 3, 1],
  ['2024-06-19', '01:40', 'SEM', 'streetlight_wiring_theft', 'Pole hatches forced along Jalan Semariang', 'Base hatches forced on 5 poles; internal wiring stripped.', ['SL-SEM-10', 'SL-SEM-11', 'SL-SEM-12'], 22300, 5, 2],
  ['2020-12-12', '02:25', 'BIN', 'cable_theft', 'Riverside cable removed at Sungai Bintangor', 'About 260 m of riverside cable along Sungai Bintangor removed overnight.', ['CB-BIN-01'], 82900, 4, 1],
  ['2021-03-24', '00:45', 'KUL', 'distribution_box_break_in', 'Feeder pillar broken into on Jalan Kulas', 'Door lever cut; outgoing cables and fuse links removed.', ['DB-KUL-02'], 41900, 3, 0],
  ['2023-12-27', '03:15', 'SEM', 'switchboard_vandalism', 'Main switchboard stripped at Bulatan Semariang', 'Enclosure forced; incoming copper cable and busbars removed. Whole roundabout dark.', ['MSB-SEM-01'], 168900, 13, 3],
  ['2021-12-18', '03:10', 'KUL', 'cable_theft', 'About 300 m stolen along Jalan Kulas', 'Feeder cable cut at both ends and dragged out through the pits.', ['CB-KUL-02'], 96500, 6, 2],
  ['2022-01-27', '01:55', 'BIN', 'streetlight_wiring_theft', 'Bridge deck lights stripped', 'Wiring stripped from 6 poles on Jambatan Datuk Amar Juma\'ani.', ['SL-BIN-01', 'SL-BIN-02', 'SL-BIN-03'], 33700, 6, 1],
  ['2022-04-16', '02:30', 'SEM', 'cable_theft', 'Roundabout ring circuit cable stolen', 'About 410 m of 4-core cable taken from the roundabout ring circuit.', ['DB-SEM-04', 'SL-SEM-06'], 112400, 9, 4],
  ['2022-10-07', '23:55', 'KUL', 'streetlight_wiring_theft', 'Interchange lights stripped', 'Hatches forced on 4 poles at the Satok–Kulas interchange.', ['SL-KUL-10', 'SL-KUL-11'], 27600, 4, 2],
  ['2022-02-19', '03:30', 'BIN', 'switchboard_vandalism', 'Main switchboard broken into near the bridge', 'Busbars and incoming cable removed from the Jalan Kulas east switchboard.', ['MSB-BIN-01'], 118600, 10, 2],
  ['2022-05-06', '01:05', 'SEM', 'distribution_box_break_in', 'Feeder pillar forced, JTARY eastbound', 'Pillar forced open; outgoing cables cut.', ['DB-SEM-02'], 46200, 6, 3],
  ['2023-08-26', '02:40', 'KUL', 'switchboard_vandalism', 'Interchange switchboard stripped', 'Main switchboard at the Satok–Kulas interchange stripped of copper.', ['MSB-KUL-01'], 161200, 11, 3],
  ['2023-12-02', '02:50', 'SEM', 'cable_theft', 'Feeder removed between poles 03–09', 'About 350 m feeder cable removed between streetlights 03 and 09.', ['CB-SEM-01', 'SL-SEM-03'], 98700, 7, 5],
  ['2023-09-16', '01:20', 'KUL', 'cable_theft', 'Bridge approach cable stolen again', 'About 260 m removed from the rebuilt cable tray.', ['CB-KUL-01'], 88300, 5, 2],
  ['2025-01-18', '03:35', 'SEM', 'switchboard_vandalism', 'Second break-in at Semariang switchboard', 'Replacement copper busbars taken.', ['MSB-SEM-01'], 154300, 13, 4],
  ['2024-11-24', '02:05', 'BIN', 'cable_theft', 'Bridge deck cable stolen', 'About 280 m of bridge deck lighting cable removed.', ['CB-BIN-02'], 91200, 4, 2],
  ['2025-03-22', '03:00', 'KUL', 'cable_theft', 'Bridge lighting cable cut', 'About 220 m of bridge lighting cable cut and removed.', ['CB-KUL-01', 'SL-KUL-02'], 79400, 3, 1],
  ['2025-08-30', '22:40', 'BIN', 'distribution_box_break_in', 'Distribution box vandalised on Jalan Kulas Utara', 'Box door torn off; cables cut.', ['DB-BIN-04'], 44300, 2, 0],
  [-25, '02:20', 'SEM', 'streetlight_wiring_theft', 'Hatches forced on 4 poles, Jalan Semariang', 'Pole hatches forced; wiring stripped from streetlights 10–13.', ['SL-SEM-10', 'SL-SEM-11', 'SL-SEM-12', 'SL-SEM-13'], 19800, 4, 2],
  [-19, '02:35', 'KUL', 'distribution_box_break_in', 'Feeder pillar broken into, Jalan Kulas', 'Pillar forced; outgoing cables cut. Two streetlights dark.', ['DB-KUL-03'], 52600, 2, 0],
  [-11, '01:50', 'SEM', 'cable_theft', 'Cable cut at roundabout approach', 'About 240 m of cable cut at the roundabout approach; streetlights 01–04 dark.', ['CB-SEM-01', 'SL-SEM-01', 'SL-SEM-02', 'SL-SEM-03', 'SL-SEM-04'], 71500, 4, 4],
];
const TYPE_LABEL = {
  cable_theft: 'Cable theft',
  streetlight_wiring_theft: 'Streetlight wiring theft',
  distribution_box_break_in: 'Distribution box break-in',
  switchboard_vandalism: 'Main switchboard vandalism',
};
const TARGET_TOTAL = 2120000;
const rawTotal = INCIDENTS.reduce((s, r) => s + r[7], 0);
const incidents = INCIDENTS.map((r, i) => {
  const [date, time, zone, type, title, detail, assetIds, raw, lightsCut, darkBefore] = r;
  const occurredAt = typeof date === 'number' ? daysBefore(-date, time) : at(date, time);
  return {
    id: `INC-${occurredAt.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`,
    occurredAt, zone, type, typeLabel: TYPE_LABEL[type], title, detail, assetIds,
    costRM: Math.round((raw * TARGET_TOTAL) / rawTotal / 10) * 10,
    lightsCut, lightsDarkBefore: darkBefore,
    reportedBy: pick(['Public complaint', 'DBKU night inspection', 'Sarawak Energy fault report', 'Public complaint']),
  };
});
// Absorb rounding so the total is exactly RM 2.12M.
incidents[5].costRM += TARGET_TOTAL - incidents.reduce((s, x) => s + x.costRM, 0);
incidents.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
incidents.forEach((x, i) => { x.id = `INC-${x.occurredAt.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`; });

/* ─── Streetlight outage episodes (lighting-status history) ── */
const outages = [];
const ms = (iso) => Date.parse(iso);
for (const inc of incidents) {
  const t = ms(inc.occurredAt);
  if (inc.lightsDarkBefore > 0) {
    outages.push({ zone: inc.zone, start: isoMyt(t - int(6, 30) * DAY), end: inc.occurredAt, lightsOut: inc.lightsDarkBefore, cause: 'lamp/driver failures awaiting repair' });
  }
  const repairDays = int(14, 45);
  const end = t + repairDays * DAY;
  outages.push({ zone: inc.zone, start: inc.occurredAt, end: end > asOfMs ? null : isoMyt(end), lightsOut: inc.lightsCut, cause: `repair after ${inc.id}` });
}
// Background lamp failures (not theft-related).
const firstDay = Date.parse(`2020-01-01T00:00:00${TZ}`);
for (const z of ZONES) {
  let t = firstDay + int(10, 60) * DAY;
  while (t < asOfMs - 40 * DAY) {
    outages.push({ zone: z.id, start: isoMyt(t), end: isoMyt(t + int(5, 25) * DAY), lightsOut: int(1, 2), cause: 'lamp/driver failure' });
    t += int(45, 110) * DAY;
  }
}
// Current open lamp failures.
outages.push({ zone: 'SEM', start: daysBefore(6, '20:00'), end: null, lightsOut: 1, cause: 'lamp/driver failure' });
outages.push({ zone: 'BIN', start: daysBefore(9, '20:00'), end: null, lightsOut: 1, cause: 'lamp/driver failure' });
// Recent repairs finished before as-of for the -25 day incident.
outages.forEach((o) => { if (o.cause.includes('repair after') && o.end === null && ms(o.start) < asOfMs - 20 * DAY) o.end = daysBefore(12, '16:00'); });
outages.sort((a, b) => a.start.localeCompare(b.start));

// Which streetlights are dark right now (from the open episodes).
const DARK_NOW = { SEM: ['SL-SEM-01', 'SL-SEM-02', 'SL-SEM-03', 'SL-SEM-04', 'SL-SEM-09'], KUL: ['SL-KUL-12', 'SL-KUL-13'], BIN: ['SL-BIN-08'] };
for (const a of assets) {
  if (a.type !== 'streetlight') continue;
  a.lighting = DARK_NOW[a.zone].includes(a.id) ? 'out' : 'on';
}
// Assets on circuits cut in the latest incidents have no sensor feed until repaired.
const OFFLINE = ['SL-SEM-01', 'SL-SEM-02', 'SL-SEM-03', 'SL-SEM-04', 'CB-SEM-01', 'SL-KUL-12', 'SL-KUL-13'];
assets.forEach((a) => { a.sensor = OFFLINE.includes(a.id) ? 'offline' : 'online'; });

/* ─── Scrap transactions (200, ≈ 8 planted suspicious) ────── */
const MATERIALS = [
  ['Aluminium', 0.30, 'aluminium'],
  ['Iron/steel', 0.24, 'iron/steel'],
  ['Copper (other)', 0.15, 'copper scrap (pipe/fittings/household wire)'],
  ['Mixed metal', 0.12, 'mixed / other'],
  ['Brass', 0.08, 'brass'],
  ['Copper cable', 0.07, 'copper scrap (pipe/fittings/household wire)'],
  ['E-waste', 0.04, 'household appliance / e-waste'],
];
function pickMaterial() {
  let r = rand();
  for (const m of MATERIALS) { if ((r -= m[1]) <= 0) return m; }
  return MATERIALS[0];
}
const PHOTO_DESC = {
  aluminium: 'Crushed drink cans and window-frame offcuts in a sack.',
  'iron/steel': 'Rusty steel sections, rebar and a bicycle frame.',
  'copper scrap (pipe/fittings/household wire)': 'Short lengths of household copper pipe and thin stripped wire.',
  'mixed / other': 'Mixed scrap: tin sheets, small motor housing, assorted fittings.',
  brass: 'Brass taps and valve bodies.',
  'household appliance / e-waste': 'Old rice cooker, fan motor and a printer.',
  'cable/electrical part': 'Thick black armoured power cable, cut ends visible, multi-core copper conductors.',
};
const KG_SHARE = { 'Copper cable': 0.35, 'Copper (other)': 0.3, Brass: 0.35, 'E-waste': 0.6 };
const PRICE = { Aluminium: 5.2, 'Iron/steel': 1.1, 'Copper (other)': 30, 'Mixed metal': 2.4, Brass: 18, 'Copper cable': 32, 'E-waste': 1.6 };

function maskIc(n) { return `XXXXXX-XX-${String(n).padStart(4, '0')}`; }
const sellers = Array.from({ length: 74 }, (_, i) => ({ id: `S-${String(1001 + i)}`, last4: int(1000, 9999) }));
const sellerUse = new Map(); // id -> [ms]
function sellerFor(t) {
  for (let tries = 0; tries < 50; tries++) {
    const s = pick(sellers);
    const uses = sellerUse.get(s.id) || [];
    if (uses.length >= 3) continue;
    if (uses.some((u) => Math.abs(u - t) < 9 * DAY)) continue; // keep normal sellers well under the 7-day rule
    uses.push(t); sellerUse.set(s.id, uses);
    return s;
  }
  throw new Error('Seller pool exhausted');
}

const DEALER_WEIGHTS = [1.1, 1.3, 1.2, 0.9, 0.9, 1.0, 0.8, 0.8, 0.9, 0.9];
const totalW = DEALER_WEIGHTS.reduce((a, b) => a + b, 0);
function pickDealer() {
  let r = rand() * totalW;
  for (let i = 0; i < dealers.length; i++) { if ((r -= DEALER_WEIGHTS[i]) <= 0) return dealers[i]; }
  return dealers[0];
}

const txs = [];
const WINDOW_DAYS = 120;
for (let i = 0; i < 189; i++) { // + 11 planted below = 200
  // Purchases happen during business hours (08:00–17:59 MYT).
  const t = asOfMs - int(1, WINDOW_DAYS) * DAY + int(8, 17) * 3600000 + int(0, 59) * 60000;
  const d = pickDealer();
  const [material, , photoLabel] = pickMaterial();
  const base = d.profile.avgKg * (KG_SHARE[material] || 1);
  // Bounded spread keeps normal sales well inside 3σ of the dealer average.
  let kg = base * (1 + Math.max(-0.75, Math.min(0.75, gauss() * 0.3)));
  if (material === 'Copper cable') kg = Math.min(kg, 28);
  kg = Math.max(2, round(kg, 1));
  const s = sellerFor(t);
  txs.push({ t, dealerId: d.id, seller: s, material, kg, photoLabel });
}

// Planted suspicious transactions (each `_plantedReason` is documentation only;
// the screening engine recomputes flags from the data).
const inc = (title) => incidents.find((x) => x.title === title);
const latestSem = ms(inc('Cable cut at roundabout approach').occurredAt);
const latestKul = ms(inc('Feeder pillar broken into, Jalan Kulas').occurredAt);
const semPoles = ms(inc('Hatches forced on 4 poles, Jalan Semariang').occurredAt);
const repeat = { id: 'S-1999', last4: 4417 };
const planted = [
  { t: latestSem + 1 * DAY + 8.6 * 3600000, dealerId: 'D04', seller: { id: 'S-1990', last4: 8826 }, material: 'Copper cable', kg: 68.5, photoLabel: 'cable/electrical part', _plantedReason: 'Copper cable > 50 kg; photo shows armoured cable; 1 day after SEM cable theft' },
  { t: latestKul + 0.5 * DAY + 3 * 3600000, dealerId: 'D02', seller: { id: 'S-1991', last4: 3051 }, material: 'Copper cable', kg: 112, photoLabel: 'cable/electrical part', _plantedReason: 'Copper cable > 50 kg and > 3σ for dealer; day after KUL break-in' },
  { t: asOfMs - 37 * DAY + 10 * 3600000, dealerId: 'D03', seller: { id: 'S-1992', last4: 6620 }, material: 'Copper cable', kg: 57.2, photoLabel: 'copper scrap (pipe/fittings/household wire)', _plantedReason: 'Copper cable > 50 kg' },
  { t: asOfMs - 63 * DAY + 14 * 3600000, dealerId: 'D06', seller: { id: 'S-1993', last4: 1209 }, material: 'Aluminium', kg: 405, photoLabel: 'aluminium', _plantedReason: 'Weight > 3σ above dealer average' },
  { t: semPoles + 0.8 * DAY + 15 * 3600000, dealerId: 'D05', seller: { id: 'S-1995', last4: 5532 }, material: 'Copper cable', kg: 74, photoLabel: 'cable/electrical part', _plantedReason: 'Copper cable > 50 kg; photo shows streetlight cable; day after SEM hatch incident' },
  { t: semPoles + 2 * DAY + 11 * 3600000, dealerId: 'D01', seller: { id: 'S-1994', last4: 7754 }, material: 'Mixed metal', kg: 31.5, photoLabel: 'cable/electrical part', _plantedReason: 'Declared mixed metal; photo shows streetlight cable' },
];
// One seller, five sales across three dealers in six days (4th and 5th breach the rule).
const semDay = semPoles - ((semPoles + 8 * 3600000) % DAY); // MYT midnight
[1, 2, 3, 5, 6].forEach((dd, k) => {
  planted.push({
    t: semDay + dd * DAY + (10 + k) * 3600000,
    dealerId: ['D04', 'D01', 'D04', 'D02', 'D01'][k], seller: repeat,
    material: 'Copper (other)', kg: [11.5, 9.0, 13.5, 12.0, 10.5][k],
    photoLabel: 'copper scrap (pipe/fittings/household wire)',
    _plantedReason: k >= 3 ? 'Same seller > 3 sales in 7 days' : 'Part of repeat-seller pattern (not flagged on its own)',
  });
});
const all = [...txs, ...planted].sort((a, b) => a.t - b.t);
const transactions = all.map((x, i) => ({
  id: `TX-${String(i + 1).padStart(4, '0')}`,
  dealerId: x.dealerId,
  date: isoMyt(x.t),
  sellerId: x.seller.id,
  sellerIcMasked: maskIc(x.seller.last4),
  material: x.material,
  weightKg: x.kg,
  pricePerKgRM: round(PRICE[x.material] * uni(0.92, 1.08), 2),
  photo: { label: x.photoLabel, description: PHOTO_DESC[x.photoLabel], source: 'mock (pre-classified)' },
  ...(x._plantedReason ? { _plantedReason: x._plantedReason } : {}),
}));

/* ─── Pilot alerts (GuardGrid pilot since 1 Sep) ──────────── */
const A = (id) => assets.find((x) => x.id === id);
const alertSeed = [
  [40, '02:12', 'sensor', 'HIGH', 'panel_opened', 'DB-SEM-02', 'Door contact opened at night', 'intercepted', 'Patrol arrived 02:29. Two men left on a motorcycle; panel intact.'],
  [33, '23:48', 'cctv', 'HIGH', 'intrusion', 'SL-KUL-02', 'Person and parked van beside bridge lighting cable', 'intercepted', 'Patrol and PDRM MPV attended 00:05. Cable intact; vehicle details passed to PDRM.'],
  [25, '02:20', 'sensor', 'HIGH', 'cable_cut', 'SL-SEM-10', 'Current dropped to 0 A on streetlight circuit', 'confirmed_theft', 'Theft confirmed at 02:50. Linked to the Jalan Semariang hatch incident.'],
  [19, '02:35', 'sensor', 'HIGH', 'panel_opened', 'DB-KUL-03', 'Door contact opened at night', 'confirmed_theft', 'Patrol arrived after the cables were cut.'],
  [14, '01:30', 'cctv', 'MEDIUM', 'intrusion', 'SL-BIN-02', 'Person near bridge lighting for 2 min', 'false_alarm', 'Angler on the bridge; no tampering.'],
  [11, '01:50', 'sensor', 'HIGH', 'cable_cut', 'CB-SEM-01', 'Current dropped to 0 A on feeder', 'confirmed_theft', 'About 240 m of cable stolen before patrol arrival.'],
  [6, '03:05', 'cctv', 'HIGH', 'intrusion', 'MSB-SEM-01', 'Two people beside the main switchboard for 4 min', 'intercepted', 'Patrol arrived 03:16; suspects fled on foot. Switchboard secured.'],
  [3, '00:40', 'sensor', 'HIGH', 'pole_struck', 'SL-BIN-05', 'Tilt sensor read 17° after impact', 'resolved', 'Vehicle collision (accident). Referred to JKR for pole replacement.'],
  [0, '01:14', 'cctv', 'MEDIUM', 'intrusion', 'DB-KUL-02', 'Person beside feeder pillar at night', 'acknowledged', 'Monitoring. Patrol passing at 02:00.'],
];
const TYPE_TITLE = { panel_opened: 'Panel opened', cable_cut: 'Cable cut', pole_struck: 'Pole struck', intrusion: 'Intrusion near asset' };
const alerts = alertSeed.map(([days, time, source, level, type, assetId, message, status, note], i) => {
  const a = A(assetId);
  if (!a) throw new Error(`Unknown asset ${assetId}`);
  return {
    id: `AL-P${String(i + 1).padStart(3, '0')}`,
    source, level, type, title: `${TYPE_TITLE[type]} · ${assetId}`, message,
    assetId, zone: a.zone, lat: a.lat, lng: a.lng,
    createdAt: daysBefore(days, time), status, note,
    score: source === 'cctv' ? (level === 'HIGH' ? (type === 'intrusion' && assetId.startsWith('MSB') ? 85 : 100) : 60) : null,
    evidence: { snapshot: null, mock: true },
    pilot: true,
  };
});

/* ─── Write ───────────────────────────────────────────────── */
const meta = {
  asOf: AS_OF,
  timeZone: 'Asia/Kuching',
  programme: { incidents: incidents.length, since: 2020, years: 7, totalCostRM: incidents.reduce((s, x) => s + x.costRM, 0), residentsAffected: 179693 },
  patrolBase: { name: 'DBKU, Bukit Siol (approx.)', lat: 1.5762, lng: 110.3488 },
  notes: 'Mock data for the GuardGrid prototype. Road geometry © OpenStreetMap contributors (ODbL). Dealers, sellers, incidents and costs are fictional.',
};
fs.mkdirSync(OUT, { recursive: true });
const files = { meta, zones: ZONES, assets, cameras, dealers, incidents, outages, transactions, alerts };
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(data, null, 1)}\n`);
}

// Summary
const byZone = (list) => ZONES.map((z) => `${z.id}:${list.filter((x) => x.zone === z.id).length}`).join(' ');
console.log(`as-of ${AS_OF}`);
console.log(`assets ${assets.length} (${byZone(assets)})  cameras ${cameras.length}`);
console.log(`incidents ${incidents.length} (${byZone(incidents)})  total RM ${meta.programme.totalCostRM.toLocaleString()}`);
console.log(`outages ${outages.length}  transactions ${transactions.length} (planted ${planted.length})  alerts ${alerts.length}`);
for (const z of ZONES) {
  const near = dealers.map((d) => ({ d: d.id, km: haversine(z.center, [d.lat, d.lng]) / 1000 })).sort((a, b) => a.km - b.km).slice(0, 2);
  console.log(`zone ${z.id} centre ${z.center} r=${z.radiusM}m nearest dealers ${near.map((n) => `${n.d} ${n.km.toFixed(2)}km`).join(', ')}`);
}
