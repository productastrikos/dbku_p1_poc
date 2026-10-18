/* Scrap dealer transaction screening (Second-Hand Dealers Act 1946 records).

   A sale is flagged for PDRM review when any rule fires:
     1. Copper cable over 50 kg in one sale
     2. The same seller (hashed IC) more than 3 times in 7 days, across all dealers
     3. Weight more than 3 standard deviations above that dealer's average
        (leave-one-out: the sale is compared with the dealer's other sales)
     4. Photo classified as "cable/electrical part" */
import { DAY } from './time';

export const SCRAP_RULES = { copperCableKg: 50, repeatMax: 3, repeatDays: 7, sigma: 3, minDealerSales: 5 };

export const MATERIALS = ['Copper cable', 'Copper (other)', 'Aluminium', 'Brass', 'Iron/steel', 'Mixed metal', 'E-waste'];
export const MATERIALS_MS = {
  'Copper cable': 'Kabel tembaga', 'Copper (other)': 'Tembaga (lain-lain)', Aluminium: 'Aluminium', Brass: 'Loyang',
  'Iron/steel': 'Besi/keluli', 'Mixed metal': 'Logam campuran', 'E-waste': 'E-sisa',
};

export const PHOTO_LABELS = [
  'cable/electrical part',
  'copper scrap (pipe/fittings/household wire)',
  'aluminium',
  'iron/steel',
  'brass',
  'household appliance / e-waste',
  'mixed / other',
];
export const CABLE_LABEL = PHOTO_LABELS[0];

export const RULE_INFO = {
  copper_cable_weight: { label: 'Copper cable > 50 kg',          labelMs: 'Kabel tembaga > 50 kg' },
  repeat_seller:       { label: 'Same seller > 3× in 7 days',    labelMs: 'Penjual sama > 3 kali dalam 7 hari' },
  weight_outlier:      { label: 'Weight > 3σ above dealer avg',  labelMs: 'Berat luar biasa' },
  cable_photo:         { label: 'Photo shows cable/electrical part', labelMs: 'Foto: kabel/komponen elektrik' },
};

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs, m) => Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));

/**
 * Screens every transaction. Returns { [id]: { flags: [...], suspicious, related: [ids] } }.
 */
export function screenTransactions(transactions) {
  const byDealer = {};
  const bySeller = {};
  transactions.forEach((t) => {
    (byDealer[t.dealerId] ||= []).push(t);
    (bySeller[t.sellerId] ||= []).push(t);
  });
  Object.values(bySeller).forEach((list) => list.sort((a, b) => Date.parse(a.date) - Date.parse(b.date)));

  const out = {};
  for (const t of transactions) {
    const flags = [];
    const related = [];

    if (t.material === 'Copper cable' && t.weightKg > SCRAP_RULES.copperCableKg) {
      flags.push({ rule: 'copper_cable_weight', detail: `${t.weightKg} kg of copper cable in one sale (limit ${SCRAP_RULES.copperCableKg} kg)` });
    }

    const tt = Date.parse(t.date);
    const windowSales = bySeller[t.sellerId].filter((x) => {
      const xt = Date.parse(x.date);
      return xt > tt - SCRAP_RULES.repeatDays * DAY && xt <= tt;
    });
    if (windowSales.length > SCRAP_RULES.repeatMax) {
      const dealersUsed = new Set(windowSales.map((x) => x.dealerId)).size;
      flags.push({ rule: 'repeat_seller', detail: `Sale ${windowSales.length} by this seller in 7 days, across ${dealersUsed} dealer${dealersUsed > 1 ? 's' : ''}` });
      related.push(...windowSales.filter((x) => x.id !== t.id).map((x) => x.id));
    }

    const others = byDealer[t.dealerId].filter((x) => x.id !== t.id).map((x) => x.weightKg);
    if (others.length >= SCRAP_RULES.minDealerSales) {
      const m = mean(others);
      const s = sd(others, m);
      const z = s > 0 ? (t.weightKg - m) / s : 0;
      if (z > SCRAP_RULES.sigma) {
        flags.push({ rule: 'weight_outlier', detail: `${t.weightKg} kg is ${z.toFixed(1)}σ above this dealer's average of ${m.toFixed(1)} kg` });
      }
    }

    if (t.photo?.label === CABLE_LABEL) {
      flags.push({ rule: 'cable_photo', detail: `Photo: ${t.photo.description || 'classified as cable/electrical part'}` });
    }

    out[t.id] = { flags, suspicious: flags.length > 0, related };
  }
  return out;
}

/** SHA-256 of a normalised IC number, so sellers can be matched without storing the IC. */
export async function hashIc(ic) {
  const norm = ic.replace(/\D/g, '');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`guardgrid:${norm}`));
  return `S-${Array.from(new Uint8Array(buf)).slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export const maskIc = (ic) => `XXXXXX-XX-${ic.replace(/\D/g, '').slice(-4).padStart(4, '0')}`;
