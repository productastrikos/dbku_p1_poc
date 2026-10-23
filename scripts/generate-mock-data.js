/* ═══════════════════════════════════════════════════════════════════════
   DBKU Command Centre mock-data generator.

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

// Zone outline: convex hull of the zone's assets and cable routes, pushed out by 45 m.
function hull(points) {
  const p = points.map(([lat, lng]) => [lng, lat]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; const upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map(([lng, lat]) => [lat, lng]);
}
for (const z of ZONES) {
  const k = Math.cos(toRad(z.center[0]));
  // A 45 m ring around every hull corner, hulled again, gives rounded corners.
  const ring = ([lat, lng]) => Array.from({ length: 12 }, (_, i) => {
    const t = (i / 12) * 2 * Math.PI;
    return [lat + (45 * Math.cos(t)) / 111320, lng + (45 * Math.sin(t)) / (111320 * k)];
  });
  const core = hull(assets.filter((a) => a.zone === z.id).flatMap((a) => a.path || [[a.lat, a.lng]]));
  z.boundary = hull(core.flatMap(ring)).map(([lat, lng]) => [round(lat), round(lng)]);
}

/* ─── CCTV: existing solar units (low-res, no analytics) ──── */
// Each unit is fixed to the asset it is mounted on and has one or two fixed
// 2MP heads (dual-lens pole units), aimed at the assets it was installed to
// watch. What it covers is then worked out from geometry: within CAM.rangeM
// and inside a head's horizontal field of view.
const CAM = { fovDeg: 90, rangeM: 150, mountHeightM: 6 };
const CAMERA_PLAN = {
  SEM: [['SL-SEM-04', ['SL-SEM-03', 'SL-SEM-05', 'DB-SEM-01', 'CB-SEM-01']], ['MSB-SEM-01', ['DB-SEM-04', 'SL-SEM-05', 'CB-SEM-02']]],
  KUL: [['SL-KUL-02', ['SL-KUL-01', 'SL-KUL-03', 'DB-KUL-01', 'CB-KUL-01']], ['MSB-KUL-01', ['SL-KUL-04', 'SL-KUL-10', 'SL-KUL-11', 'DB-KUL-01']]],
  BIN: [['SL-BIN-02', ['SL-BIN-01', 'SL-BIN-03', 'SL-BIN-04', 'DB-BIN-01', 'CB-BIN-02']], ['MSB-BIN-01', ['SL-BIN-06', 'SL-BIN-07', 'SL-BIN-08']]],
};
function bearing([lat1, lng1], [lat2, lng2]) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const angleGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
// Nearest point of an asset (a cable's nearest route point) as { d metres, b bearing }.
const sightOf = (o, a) => (a.path || [[a.lat, a.lng]]).map((p) => ({ d: haversine(o, p), b: bearing(o, p) })).sort((x, y) => x.d - y.d);
const inView = (o, a, heads) => sightOf(o, a).some((s) => s.d <= CAM.rangeM && heads.some((h) => angleGap(s.b, h) <= CAM.fovDeg / 2));
// One head if a single field of view takes in every target, else the best pair.
function aimHeads(bearings) {
  const fits = (heads) => bearings.filter((b) => heads.some((h) => angleGap(b, h) <= CAM.fovDeg / 2)).length;
  const spread = (heads) => bearings.reduce((s, b) => s + Math.min(...heads.map((h) => angleGap(b, h))), 0);
  let best = null;
  for (let h = 0; h < 360; h += 2) {
    const c = { heads: [h], n: fits([h]), s: spread([h]) };
    if (!best || c.n > best.n || (c.n === best.n && c.s < best.s)) best = c;
  }
  if (best.n === bearings.length) return best.heads;
  for (let h1 = 0; h1 < 360; h1 += 2) {
    for (let h2 = h1 + CAM.fovDeg; h2 < 360; h2 += 2) {
      const c = { heads: [h1, h2], n: fits([h1, h2]), s: spread([h1, h2]) };
      if (c.n > best.n || (c.n === best.n && c.s < best.s)) best = c;
    }
  }
  return best.heads;
}
const cameras = [];
for (const z of ZONES) {
  CAMERA_PLAN[z.id].forEach(([mountId, targets], i) => {
    const m = assets.find((a) => a.id === mountId);
    const o = [m.lat, m.lng];
    const tb = targets.map((id) => {
      const s = sightOf(o, assets.find((a) => a.id === id))[0];
      if (s.d > CAM.rangeM) throw new Error(`${id} is ${Math.round(s.d)} m from ${mountId}, beyond camera range`);
      return s.b;
    });
    const heads = aimHeads(tb);
    const covers = [m, ...assets.filter((a) => a.zone === z.id && a.id !== m.id && inView(o, a, heads))
      .sort((a, b) => sightOf(o, a)[0].d - sightOf(o, b)[0].d)].map((a) => a.id);
    targets.forEach((id) => { if (!covers.includes(id)) throw new Error(`${mountId} camera does not see its target ${id}`); });
    cameras.push({
      id: `CAM-${z.id}-${i + 1}`, zone: z.id, lat: m.lat, lng: m.lng, mountedOn: mountId,
      heads: heads.map((h) => ({ heading: h, fovDeg: CAM.fovDeg, rangeM: CAM.rangeM })),
      mountHeightM: CAM.mountHeightM, covers,
      model: `Solar CCTV 2MP, ${heads.length === 2 ? 'dual-lens' : 'single-lens'} (existing, no analytics)`,
    });
  });
}
// An asset seen by two units is assigned to the nearer one.
for (const a of assets) {
  const seen = cameras.filter((c) => c.covers.includes(a.id)).sort((x, y) => sightOf([x.lat, x.lng], a)[0].d - sightOf([y.lat, y.lng], a)[0].d);
  a.cameraId = seen[0]?.id || null;
}

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
  ['2022-04-16', '02:30', 'SEM', 'cable_theft', 'Roundabout ring circuit cable stolen', 'About 410 m of 4-core cable taken from the roundabout ring circuit.', ['DB-SEM-04', 'SL-SEM-05'], 112400, 9, 4],
  ['2022-10-07', '23:55', 'KUL', 'streetlight_wiring_theft', 'Interchange lights stripped', 'Hatches forced on 4 poles at the Satok–Kulas interchange.', ['SL-KUL-10', 'SL-KUL-11'], 27600, 4, 2],
  ['2022-02-19', '03:30', 'BIN', 'switchboard_vandalism', 'Main switchboard broken into near the bridge', 'Busbars and incoming cable removed from the Jalan Kulas east switchboard.', ['MSB-BIN-01'], 118600, 10, 2],
  ['2022-05-06', '01:05', 'SEM', 'distribution_box_break_in', 'Feeder pillar forced, JTARY eastbound', 'Pillar forced open; outgoing cables cut.', ['DB-SEM-02'], 46200, 6, 3],
  ['2023-08-26', '02:40', 'KUL', 'switchboard_vandalism', 'Interchange switchboard stripped', 'Main switchboard at the Satok–Kulas interchange stripped of copper.', ['MSB-KUL-01'], 161200, 11, 3],
  ['2023-12-02', '02:50', 'SEM', 'cable_theft', 'Feeder removed between poles 01–04', 'About 350 m of feeder cable removed between streetlights 01 and 04.', ['CB-SEM-01', 'SL-SEM-03'], 98700, 7, 5],
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
// The three pilot-period incidents were raised by the command centre itself (see the pilot alerts below).
const PILOT_SOURCE = { 'Hatches forced on 4 poles, Jalan Semariang': 'AL-P003', 'Feeder pillar broken into, Jalan Kulas': 'AL-P004', 'Cable cut at roundabout approach': 'AL-P006' };
incidents.forEach((x) => { if (PILOT_SOURCE[x.title]) { x.reportedBy = `DBKU tamper sensor (${PILOT_SOURCE[x.title]})`; x.alertId = PILOT_SOURCE[x.title]; } });
const incByTitle = (title) => incidents.find((x) => x.title === title);

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

// Which streetlights are dark right now (from the open episodes), and why.
const semCut = incByTitle('Cable cut at roundabout approach');
const kulBreakIn = incByTitle('Feeder pillar broken into, Jalan Kulas');
const lampFail = (zone) => outages.find((o) => o.zone === zone && o.end === null && o.cause === 'lamp/driver failure');
const DARK_NOW = {
  'SL-SEM-01': semCut, 'SL-SEM-02': semCut, 'SL-SEM-03': semCut, 'SL-SEM-04': semCut,
  'SL-SEM-09': lampFail('SEM'), 'SL-KUL-08': kulBreakIn, 'SL-KUL-09': kulBreakIn, 'SL-BIN-08': lampFail('BIN'),
};
const causeOf = (src) => (src.id ? { since: src.occurredAt, cause: `Circuit cut in ${src.id}` } : { since: src.start, cause: 'Lamp/driver failure' });
for (const a of assets) {
  if (a.type !== 'streetlight') continue;
  a.lighting = DARK_NOW[a.id] ? 'out' : 'on';
  if (DARK_NOW[a.id]) { const c = causeOf(DARK_NOW[a.id]); a.lightingSince = c.since; a.lightingCause = c.cause; }
}
// Assets on circuits cut in the latest incidents have no sensor feed until repaired.
const OFFLINE = { 'SL-SEM-01': semCut, 'SL-SEM-02': semCut, 'SL-SEM-03': semCut, 'SL-SEM-04': semCut, 'CB-SEM-01': semCut, 'SL-KUL-08': kulBreakIn, 'SL-KUL-09': kulBreakIn };
assets.forEach((a) => {
  a.sensor = OFFLINE[a.id] ? 'offline' : 'online';
  if (OFFLINE[a.id]) { a.sensorSince = OFFLINE[a.id].occurredAt; a.sensorCause = `No feed since the circuit was cut in ${OFFLINE[a.id].id}`; }
});

/* ─── Electrical network ──────────────────────────────────── */
// Supply runs Sarawak Energy → main switchboard (MSB) → feeders to the
// pillars → street-lighting circuits. A monitored cable run carries the
// feeder or circuit it sits on. Each asset records what feeds it
// (`upstream`); pillars sit on a feeder, lights on a circuit. Circuits follow
// the geometry (nearest pillar, cable along the poles it serves) and the
// incident record (the latest cuts darkened exactly their circuit's lights).
// feeders: [label, cable or null, pillars]; circuits: [label, source, cable or null, streetlight numbers]
const NETWORK = {
  SEM: {
    feeders: [['F1', null, ['DB-SEM-01']], ['F2', null, ['DB-SEM-02']], ['F3', null, ['DB-SEM-03']], ['F4', null, ['DB-SEM-04']]],
    circuits: [['C1', 'DB-SEM-01', 'CB-SEM-01', [1, 2, 3, 4]], ['C2', 'DB-SEM-04', null, [5, 9]], ['C3', 'DB-SEM-02', null, [6, 7, 8]], ['C4', 'DB-SEM-03', 'CB-SEM-02', [10, 11, 12, 13]]],
  },
  KUL: {
    feeders: [['F1', null, ['DB-KUL-01']], ['F2', null, ['DB-KUL-02']], ['F3', 'CB-KUL-02', ['DB-KUL-03']], ['F4', null, ['DB-KUL-04']]],
    circuits: [['C1', 'DB-KUL-01', 'CB-KUL-01', [1, 2, 3]], ['C2', 'DB-KUL-01', null, [4, 10, 11]], ['C3', 'DB-KUL-02', null, [5, 6, 7]], ['C4', 'DB-KUL-03', null, [8, 9]], ['C5', 'DB-KUL-04', null, [12, 13]]],
  },
  BIN: {
    feeders: [['F1', 'CB-BIN-01', ['DB-BIN-01', 'DB-BIN-02']], ['F2', null, ['DB-BIN-03']], ['F3', null, ['DB-BIN-04']]],
    circuits: [['C1', 'DB-BIN-01', 'CB-BIN-02', [1, 2, 3]], ['C2', 'DB-BIN-02', null, [4]], ['C3', 'MSB-BIN-01', null, [5, 6, 7, 8]], ['C4', 'DB-BIN-03', null, [9, 10]], ['C5', 'DB-BIN-04', null, [11, 12, 13]]],
  },
};
const byId = (id) => {
  const a = assets.find((x) => x.id === id);
  if (!a) throw new Error(`Network: unknown asset ${id}`);
  return a;
};
for (const z of ZONES) {
  const msb = byId(`MSB-${z.id}-01`);
  msb.upstream = null;
  for (const [label, cable, pillars] of NETWORK[z.id].feeders) {
    if (cable) Object.assign(byId(cable), { upstream: msb.id, feeder: `${z.id}-${label}` });
    pillars.forEach((id) => Object.assign(byId(id), { upstream: cable || msb.id, feeder: `${z.id}-${label}` }));
  }
  for (const [label, source, cable, nums] of NETWORK[z.id].circuits) {
    const circuit = `${z.id}-${label}`;
    if (cable) Object.assign(byId(cable), { upstream: source, circuit });
    nums.forEach((n) => Object.assign(byId(`SL-${z.id}-${String(n).padStart(2, '0')}`), { upstream: cable || source, circuit }));
  }
}
assets.forEach((a) => {
  if (a.upstream === undefined) throw new Error(`Network: ${a.id} is not connected`);
  for (let p = a, hops = 0; p.upstream; p = byId(p.upstream)) { if (++hops > 5) throw new Error(`Network loop at ${a.id}`); }
  if (a.type === 'streetlight' && !a.circuit) throw new Error(`Network: ${a.id} has no circuit`);
  // A light darkened by a circuit cut sits downstream of what the incident cut.
  const cut = /^Circuit cut in (INC-\S+)/.exec(a.lightingCause || '');
  if (cut && !incidents.find((x) => x.id === cut[1]).assetIds.includes(a.upstream)) throw new Error(`${a.id} is dark from ${cut[1]} but is not fed by what was cut`);
});
['SEM', 'KUL', 'BIN'].forEach((z) => {
  const used = [...NETWORK[z].feeders.map((f) => f[1]), ...NETWORK[z].circuits.map((c) => c[2])].filter(Boolean);
  const cables = assets.filter((a) => a.zone === z && a.type === 'cable').map((a) => a.id);
  if (used.length !== new Set(used).size || cables.some((c) => !used.includes(c))) throw new Error(`Network: every cable in ${z} must carry exactly one feeder or circuit`);
});

/* ─── Specifications and sensor nodes ─────────────────────── */
// A separate seeded stream, so adding fields never changes the data above or below.
const devRand = mulberry32(20261022);
const ROAD_CLASS = (a) => (a.road.startsWith('Jambatan') ? 'bridge' : /Tun Abdul Rahman|Satok-Kulas/.test(a.road) ? 'arterial' : 'local');
const COPPER_KG_PER_MM2_M = 0.00896; // 8,960 kg/m³
const NODE = {
  streetlight: 'Pole node: supply current, base-hatch contact, tilt',
  distribution_box: 'Cabinet node: incoming current, door contact, tilt',
  switchboard: 'Cabinet node: incoming current, door contact, tilt',
  cable: 'Current clamp at the feed end',
};
const nodeCount = {};
for (const a of assets) {
  // Outgoing ways: the distinct feeders and circuits leaving this asset.
  const outgoing = [...new Set(assets.filter((x) => x.upstream === a.id).map((x) => x.feeder || x.circuit))];
  if (a.type === 'streetlight') {
    a.spec = { poleHeightM: { bridge: 10, arterial: 12, local: 9 }[ROAD_CLASS(a)], lamp: 'HPS 250 W (SON-T)', luminaire: 'Full cut-off road lantern', pole: 'Galvanised steel, bolted base hatch' };
  } else if (a.type === 'distribution_box') {
    a.spec = { enclosure: a.name.startsWith('Feeder pillar') ? 'Feeder pillar, stainless steel' : 'Distribution box, GRP', ratingA: 100, ways: 4, waysUsed: outgoing.length, lock: 'Padlock and numbered seal' };
  } else if (a.type === 'switchboard') {
    a.spec = { supply: 'Sarawak Energy, 415 V three-phase', ratingA: 400, outgoing: outgoing.length, metering: 'Sarawak Energy kWh meter', enclosure: 'Steel kiosk, double door' };
  } else {
    const feederCable = Boolean(a.feeder);
    const mm2 = feederCable ? 35 : 16;
    a.spec = {
      role: feederCable ? 'feeder' : 'circuit',
      conductor: `4-core ${mm2} mm² copper, XLPE/SWA/PVC`, cores: 4, mm2,
      laid: /tray|deck/i.test(a.name) ? 'Cable tray on the bridge' : /Riverside/.test(a.name) ? 'Buried along the riverbank' : 'Underground ducts, 0.6 m deep',
      copperKg: Math.round(a.lengthM * 4 * mm2 * COPPER_KG_PER_MM2_M),
    };
  }
  nodeCount[a.zone] = (nodeCount[a.zone] || 0) + 1;
  a.node = {
    id: `SN-${a.zone}-${String(nodeCount[a.zone]).padStart(3, '0')}`, kind: NODE[a.type],
    link: 'LoRaWAN, AS923', rssiDbm: -(84 + Math.floor(devRand() * 29)), firmware: '2.3.1', intervalMin: 5,
  };
}

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

/* ─── Pilot alerts (early-warning pilot since 1 Sep) ─────── */
const A = (id) => assets.find((x) => x.id === id);
// `observed` records what the operator log says was seen. The app derives the
// CCTV threat factors (and score) and the sensor reading from it, so the
// numbers always follow the same rules as live alerts.
const alertSeed = [
  [40, '02:12', 'sensor', 'HIGH', 'panel_opened', 'DB-SEM-02', 'Door contact opened at night', 'intercepted', 'Patrol arrived 02:29. Two men left on a motorcycle; panel intact.', { door: 1 }],
  [33, '23:48', 'cctv', 'HIGH', 'intrusion', 'SL-KUL-02', 'Person and parked van beside bridge lighting cable', 'intercepted', 'Patrol and PDRM MPV attended 00:05. Cable intact; vehicle details passed to PDRM.', { objects: ['person', 'car'], dwellMinutes: 2.5, vehicleParked: true }],
  [25, '02:20', 'sensor', 'HIGH', 'cable_cut', 'SL-SEM-10', 'Current dropped to 0 A on streetlight circuit', 'confirmed_theft', 'Theft confirmed at 02:50. Linked to the Jalan Semariang hatch incident.', { current: 0 }],
  [19, '02:35', 'sensor', 'HIGH', 'panel_opened', 'DB-KUL-03', 'Door contact opened at night', 'confirmed_theft', 'Patrol arrived after the cables were cut.', { door: 1 }],
  [14, '01:30', 'cctv', 'MEDIUM', 'intrusion', 'SL-BIN-02', 'Person near bridge lighting for 2 min', 'false_alarm', 'Angler on the bridge; no tampering.', { objects: ['person'], dwellMinutes: 2, vehicleParked: false }],
  [11, '01:50', 'sensor', 'HIGH', 'cable_cut', 'CB-SEM-01', 'Current dropped to 0 A on feeder', 'confirmed_theft', 'About 240 m of cable stolen before patrol arrival.', { current: 0 }],
  [6, '03:05', 'cctv', 'HIGH', 'intrusion', 'MSB-SEM-01', 'Two people beside the main switchboard for 4 min', 'intercepted', 'Patrol arrived 03:16; suspects fled on foot. Switchboard secured.', { objects: ['person', 'person'], dwellMinutes: 4, vehicleParked: false }],
  [3, '00:40', 'sensor', 'HIGH', 'pole_struck', 'SL-BIN-05', 'Tilt sensor read 17° after impact', 'resolved', 'Vehicle collision (accident). Referred to JKR for pole replacement.', { tilt: 17 }],
  [0, '01:14', 'cctv', 'MEDIUM', 'intrusion', 'DB-KUL-01', 'Person beside feeder pillar at night', 'acknowledged', 'Monitoring. Added to tonight\'s patrol route for a site check.', { objects: ['person'], dwellMinutes: 1, vehicleParked: false }],
];
const TYPE_TITLE = { panel_opened: 'Panel opened', cable_cut: 'Cable cut', pole_struck: 'Pole struck', intrusion: 'Intrusion near asset' };
const alerts = alertSeed.map(([days, time, source, level, type, assetId, message, status, note, observed], i) => {
  const a = A(assetId);
  if (!a) throw new Error(`Unknown asset ${assetId}`);
  if (source === 'cctv' && !a.cameraId) throw new Error(`CCTV alert on ${assetId}, which no camera covers`);
  return {
    id: `AL-P${String(i + 1).padStart(3, '0')}`,
    source, level, type, title: `${TYPE_TITLE[type]} · ${assetId}`, message,
    assetId, zone: a.zone, lat: a.lat, lng: a.lng,
    createdAt: daysBefore(days, time), status, note,
    evidence: { snapshot: null, mock: true, observed, ...(source === 'cctv' ? { cameraId: a.cameraId } : {}) },
    pilot: true,
  };
});

/* ─── Operations already under way (work orders, patrols, PDRM) ─ */
// [daysBefore, time, kind, title, team, priority, status, assetIds, alertId, details, history [[days, time, status, note]]]
const taskSeed = [
  [11, '06:30', 'work_order', 'Replace stolen feeder and restore SL-SEM-01 to 04', 'DBKU Electrical', 'Critical', 'in_progress', ['CB-SEM-01', 'SL-SEM-01', 'SL-SEM-02', 'SL-SEM-03', 'SL-SEM-04'], 'AL-P006',
    `About 240 m of feeder cable stolen (${semCut.id}). Lay new armoured cable, reconnect the four streetlights and the tamper sensors.`,
    [[11, '06:30', 'open', 'Raised after the theft was confirmed'], [8, '09:00', 'in_progress', 'Cable ordered; trenching started at the roundabout approach']]],
  [19, '08:00', 'work_order', 'Repair feeder pillar DB-KUL-03 and restore SL-KUL-08, 09', 'DBKU Electrical', 'High', 'in_progress', ['DB-KUL-03', 'SL-KUL-08', 'SL-KUL-09'], 'AL-P004',
    `Pillar forced and outgoing cables cut (${kulBreakIn.id}). Replace the door lock and cables, then restore the two streetlights.`,
    [[19, '08:00', 'open', 'Raised after the break-in'], [12, '10:30', 'in_progress', 'Door replaced; waiting for replacement cable']]],
  [6, '09:15', 'work_order', 'Replace lamp driver, SL-SEM-09', 'DBKU Electrical', 'Normal', 'open', ['SL-SEM-09'], null,
    'Lamp/driver failure reported by the night inspection. Not theft-related.', [[6, '09:15', 'open', 'Logged from the night inspection']]],
  [9, '09:40', 'work_order', 'Replace lamp driver, SL-BIN-08', 'DBKU Electrical', 'Normal', 'open', ['SL-BIN-08'], null,
    'Lamp/driver failure. Not theft-related.', [[9, '09:40', 'open', 'Logged from the night inspection']]],
  [3, '08:20', 'work_order', 'Replace pole SL-BIN-05 after vehicle impact', 'JKR Sarawak', 'High', 'open', ['SL-BIN-05'], 'AL-P008',
    'Tilt sensor read 17° after a vehicle collision. Pole made safe; full replacement referred to JKR.', [[3, '08:20', 'open', 'Referred to JKR']]],
  [11, '03:10', 'pdrm', 'Police report for the cable theft at the roundabout approach', 'IPD Kuching', 'Immediate', 'done', ['CB-SEM-01'], 'AL-P006',
    'Report lodged with photos of the cut pits; scrap dealers near Jalan Semariang to be checked.', [[11, '03:10', 'open', 'Phone report to the duty officer'], [10, '11:00', 'done', 'Police report reference received']]],
  [33, '00:20', 'pdrm', 'Vehicle details from the bridge intrusion', 'Balai Polis Satok', 'Immediate', 'done', ['SL-KUL-02'], 'AL-P002',
    'Van seen parked beside the bridge lighting cable; registration and description passed to PDRM.', [[33, '00:20', 'open', 'Passed at the scene'], [33, '09:00', 'done', 'Acknowledged by Balai Polis Satok']]],
  [0, '01:20', 'patrol', 'Site check at feeder pillar DB-KUL-01', 'DBKU Enforcement Unit B', 'Tonight', 'open', ['DB-KUL-01'], 'AL-P009',
    'Person seen beside the pillar at 01:14. Check the door, lock and seal on tonight\'s round.', [[0, '01:20', 'open', 'Added to tonight\'s route']]],
];
const KIND_PREFIX = { work_order: 'WO', patrol: 'PT', pdrm: 'PD' };
const tasks = taskSeed.map(([days, time, kind, title, team, priority, status, assetIds, alertId, details, history], i) => ({
  id: `${KIND_PREFIX[kind]}-P${String(i + 1).padStart(3, '0')}`,
  kind, title, team, priority, status, details, assetIds, alertId,
  zone: A(assetIds[0]).zone,
  createdAt: daysBefore(days, time),
  updatedAt: daysBefore(history[history.length - 1][0], history[history.length - 1][1]),
  history: history.map(([d, t, s, n]) => ({ at: daysBefore(d, t), status: s, note: n })),
  source: alertId ? `Alert ${alertId}` : 'Night inspection',
  pilot: true,
}));

/* ─── Write ───────────────────────────────────────────────── */
const meta = {
  asOf: AS_OF,
  // Records on or after liveSince are placed relative to asOf; the app moves
  // them to the current date when it loads (src/data/rebase.js).
  liveSince: isoMyt(asOfMs - 180 * DAY),
  timeZone: 'Asia/Kuching',
  pilotStart: isoMyt(asOfMs - 44 * DAY),
  programme: { incidents: incidents.length, since: 2020, totalCostRM: incidents.reduce((s, x) => s + x.costRM, 0), residentsAffected: 179693 },
  patrolBase: { name: 'DBKU, Bukit Siol (approx.)', lat: 1.5762, lng: 110.3488 },
  notes: 'Mock data for the DBKU Command Centre prototype. Road geometry © OpenStreetMap contributors (ODbL). Dealers, sellers, incidents and costs are fictional.',
};
// Dated history must stay before liveSince (it keeps its real dates); relative records must fall after it.
if (INCIDENTS.some((r) => typeof r[0] === 'string' && Date.parse(at(r[0], r[1])) >= Date.parse(meta.liveSince))) throw new Error('A dated incident falls after liveSince');
if ([...transactions.map((t) => t.date), ...alerts.map((a) => a.createdAt)].some((d) => Date.parse(d) < Date.parse(meta.liveSince))) throw new Error('A relative record falls before liveSince');
fs.mkdirSync(OUT, { recursive: true });
const files = { meta, zones: ZONES, assets, cameras, dealers, incidents, outages, transactions, alerts, tasks };
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(data, null, 1)}\n`);
}

// Summary
const byZone = (list) => ZONES.map((z) => `${z.id}:${list.filter((x) => x.zone === z.id).length}`).join(' ');
console.log(`as-of ${AS_OF}`);
console.log(`assets ${assets.length} (${byZone(assets)})  cameras ${cameras.length}`);
console.log(`incidents ${incidents.length} (${byZone(incidents)})  total RM ${meta.programme.totalCostRM.toLocaleString()}`);
console.log(`outages ${outages.length}  transactions ${transactions.length} (planted ${planted.length})  alerts ${alerts.length}  tasks ${tasks.length}`);
for (const z of ZONES) {
  const near = dealers.map((d) => ({ d: d.id, km: haversine(z.center, [d.lat, d.lng]) / 1000 })).sort((a, b) => a.km - b.km).slice(0, 2);
  console.log(`zone ${z.id} centre ${z.center} r=${z.radiusM}m nearest dealers ${near.map((n) => `${n.d} ${n.km.toFixed(2)}km`).join(', ')}`);
}
