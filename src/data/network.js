/* Electrical network of the twin.

   Supply runs Sarawak Energy → main switchboard → feeders → feeder pillars →
   street-lighting circuits (assets.json: `upstream`, `feeder`, `circuit`).
   An asset is energised when nothing between it and the switchboard has been
   cut. A cut is what the live data records: a streetlight dark because its
   circuit was cut, or a cable whose feed was cut. Repairs (a work order marked
   done) clear those fields, so the network re-energises with them. */
import { mytParts } from '../ai/time';

export const isCut = (a) => (a.type === 'streetlight' && a.lighting === 'out' && /^Circuit cut/.test(a.lightingCause || ''))
  || (a.type === 'cable' && a.sensor === 'offline' && /circuit was cut/.test(a.sensorCause || ''));

/** Street lamps are switched on 19:00–07:00 MYT. */
export const lampsOnAt = (t) => { const h = mytParts(t).hour; return h >= 19 || h < 7; };

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
export function metres([lat1, lng1], [lat2, lng2]) {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
// Where a link meets an asset: the nearest point of a cable's route, else the asset itself.
const anchor = (a, toward) => (a.path ? a.path.reduce((best, p) => (metres(p, toward) < metres(best, toward) ? p : best), a.path[0]) : [a.lat, a.lng]);

/** Builds the network view of a set of (live) assets. */
export function buildNetwork(assets) {
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  const kids = {};
  assets.forEach((a) => { if (a.upstream) (kids[a.upstream] = kids[a.upstream] || []).push(a); });
  const memo = {};
  const energised = (id) => {
    if (memo[id] != null) return memo[id];
    const a = byId[id];
    memo[id] = Boolean(a) && !isCut(a) && (!a.upstream || energised(a.upstream));
    return memo[id];
  };
  const chain = (id) => {
    const out = [];
    for (let a = byId[id]; a; a = byId[a.upstream]) out.push(a);
    return out;
  };
  const downstream = (id) => (kids[id] || []).flatMap((k) => [k, ...downstream(k.id)]);
  // Where supply stops on the way down: the first cut asset in the chain.
  const breakFor = (id) => chain(id).reverse().find((a) => isCut(a)) || null;

  const circuits = Object.values(assets.reduce((acc, a) => {
    if (!a.circuit) return acc;
    const c = acc[a.circuit] || (acc[a.circuit] = { id: a.circuit, zone: a.zone, lights: [], cable: null });
    if (a.type === 'cable') c.cable = a; else c.lights.push(a);
    return acc;
  }, {})).map((c) => {
    const source = byId[(c.cable || c.lights[0]).upstream];
    const live = c.lights.filter((l) => energised(l.id));
    return { ...c, source, energised: live.length, total: c.lights.length, dead: c.lights.length - live.length };
  }).sort((a, b) => a.id.localeCompare(b.id));

  // Map links, parent → child, coloured by whether the child is energised.
  const links = assets.filter((a) => a.upstream && byId[a.upstream]).map((a) => {
    const p = byId[a.upstream];
    const childPoint = a.path ? anchor(a, [p.lat, p.lng]) : [a.lat, a.lng];
    return {
      id: `${p.id}>${a.id}`, parentId: p.id, childId: a.id,
      kind: a.feeder ? 'feeder' : 'circuit',
      positions: [anchor(p, childPoint), childPoint],
      energised: energised(a.id),
    };
  });

  return {
    byId, energised, chain, downstream, breakFor, circuits, links,
    children: (id) => kids[id] || [],
  };
}
