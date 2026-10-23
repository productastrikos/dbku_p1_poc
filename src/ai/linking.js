/* Disrupting the resale channel: links a theft event to suspicious scrap
   sales that followed it, and estimates the loss in RM. */
import { distanceKm } from './geo';
import { DAY } from './time';

export const LINK_RULES = { days: 14, km: 15 };
const COPPER = ['Copper cable', 'Copper (other)', 'Mixed metal', 'Brass'];

/**
 * Flagged sales within 14 days after the event at dealers within 15 km,
 * strongest leads first.
 *   event: { time (ms), lat, lng }
 */
export function linkSales(event, transactions, screening, dealers) {
  const dealerById = Object.fromEntries(dealers.map((d) => [d.id, d]));
  return transactions
    .map((t) => {
      const s = screening[t.id];
      if (!s?.suspicious) return null;
      const dt = (Date.parse(t.date) - event.time) / DAY;
      if (dt < 0 || dt > LINK_RULES.days) return null;
      const dealer = dealerById[t.dealerId];
      const km = distanceKm([event.lat, event.lng], [dealer.lat, dealer.lng]);
      if (km > LINK_RULES.km) return null;
      const rules = s.flags.map((f) => f.rule);
      const score = 2 * (1 - dt / LINK_RULES.days) + (1 - km / LINK_RULES.km)
        + (COPPER.includes(t.material) ? 1 : 0) + (rules.includes('cable_photo') ? 1.5 : 0) + (rules.includes('copper_cable_weight') ? 1 : 0);
      return {
        transaction: t, dealer, days: dt, km, score,
        reasons: [`${dt < 1 ? `${Math.round(dt * 24)} h` : `${dt.toFixed(1)} days`} after the event`, `${dealer.name}, ${km.toFixed(1)} km from the site`, ...s.flags.map((f) => f.detail)],
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

const CALL_OUT_RM = 1500; // emergency make-safe and call-out

// Event types where thieves usually strip the feeder cable as well as the asset.
const CABLE_AT_RISK = ['intrusion', 'cable_cut', 'cable_theft', 'streetlight_wiring_theft'];

/**
 * Loss estimate for an event at an asset. Recorded incident costs win when
 * present; otherwise replacement cost (+ a feeder section for cable-type
 * events at streetlights) + call-out.
 */
export function estimateLoss({ asset, assets = [], recordedCostRM, type }) {
  if (recordedCostRM) return { totalRM: recordedCostRM, items: [{ item: 'Recorded repair and replacement cost', rm: recordedCostRM }], basis: 'DBKU incident record' };
  const items = [];
  if (asset) items.push({ item: `Replace ${asset.name} (${asset.id})`, rm: asset.replacementCostRM });
  if (asset?.type === 'streetlight' && (!type || CABLE_AT_RISK.includes(type))) {
    const feeder = assets.find((a) => a.zone === asset.zone && a.type === 'cable');
    if (feeder) items.push({ item: `Feeder cable section (≈ ${Math.round(feeder.lengthM / 3)} m)`, rm: Math.round(feeder.replacementCostRM / 3 / 100) * 100 });
  }
  items.push({ item: 'Emergency make-safe and call-out', rm: CALL_OUT_RM });
  return { totalRM: items.reduce((s, x) => s + x.rm, 0), items, basis: 'DBKU replacement-cost table (indicative)' };
}
