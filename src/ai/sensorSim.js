/* Simulated per-asset sensor stream: one reading every 5 minutes with
     current  amps on the asset's supply
     door     0 closed / 1 open (pole hatch, pillar or switchboard door); null for cables
     tilt     degrees from vertical; null for cables
   Streetlights switch on 19:00–07:00 MYT; pillars, switchboards and feeders
   carry a load all day with a gentle daily curve. Noise is bounded, so a
   healthy asset never crosses the 3σ line on its own. */
import { mulberry32, gaussian, hashString } from './random';
import { mytParts, MINUTE } from './time';

export const INTERVAL_MIN = 5;
export const INTERVAL_MS = INTERVAL_MIN * MINUTE;
export const HISTORY_POINTS = 288; // 24 h

// Per-type electrical profile. `noise` is the sensor's 1σ noise (amps).
export const PROFILES = {
  streetlight:      { on: 1.1, off: 0.08, noiseOn: 0.02, noiseOff: 0.003, scheduled: true },
  distribution_box: { base: 18, swing: 0.22, peakHour: 20, noise: 0.3 },
  switchboard:      { base: 62, swing: 0.18, peakHour: 20, noise: 0.9 },
  cable:            { base: 24, swing: 0.22, peakHour: 20, noise: 0.4 },
};
const NOISE_CLIP = 1.8; // σ

export const FAULTS = {
  cable_cut:   { label: 'Cut cable (current → 0 A)', labelMs: 'Potong kabel' },
  panel_open:  { label: 'Open panel door',           labelMs: 'Buka pintu panel' },
  pole_struck: { label: 'Strike pole (tilt 22°)',    labelMs: 'Langgar tiang' },
  tapping:     { label: 'Illegal tapping (+60% load)', labelMs: 'Sambungan haram' },
};

/** Whether the asset is expected to draw its working current at time t. */
export function expectedState(asset, t) {
  if (asset.type !== 'streetlight') return 'on';
  const h = mytParts(t).hour;
  return h >= 19 || h < 7 ? 'on' : 'off';
}

// Small per-asset differences (lamp wattage, circuit length) from the id.
const scaleFor = (asset) => 0.9 + (hashString(asset.id) % 1000) / 5000;

/** The asset's learned daily load profile: expected amps at time t. */
export function expectedCurrent(asset, t) {
  const p = PROFILES[asset.type];
  const k = scaleFor(asset);
  if (p.scheduled) return (expectedState(asset, t) === 'on' ? p.on : p.off) * k;
  const { hour, minute } = mytParts(t);
  const h = hour + minute / 60;
  return p.base * k * (1 + p.swing * Math.cos(((h - p.peakHour) / 24) * 2 * Math.PI));
}

/** Sensor noise level (1σ) for the asset in a given state. */
export function noiseLevel(asset, state) {
  const p = PROFILES[asset.type];
  if (p.scheduled) return (state === 'on' ? p.noiseOn : p.noiseOff) * scaleFor(asset);
  return p.noise;
}

const baseTilt = (asset) => (asset.type === 'cable' ? null : 0.3 + (hashString(`${asset.id}:tilt`) % 200) / 100);

/** One reading for an asset at time t, with any injected fault applied. */
export function simulateReading(asset, t, rand, fault) {
  const state = expectedState(asset, t);
  let current = expectedCurrent(asset, t) + gaussian(rand, NOISE_CLIP) * noiseLevel(asset, state);
  let door = asset.type === 'cable' ? null : 0;
  let tilt = baseTilt(asset);
  if (tilt != null) tilt = Math.max(0, tilt + gaussian(rand, NOISE_CLIP) * 0.15);

  switch (fault?.type) {
    case 'cable_cut': current = 0; break;
    case 'panel_open': if (door != null) door = 1; break;
    case 'pole_struck': if (tilt != null) tilt = (asset.type === 'streetlight' ? 22 : 35) + gaussian(rand, 1) * 0.8; break;
    case 'tapping': current *= 1.6; break;
    default: break;
  }
  return { t, state, current: +Math.max(0, current).toFixed(3), door, tilt: tilt == null ? null : +tilt.toFixed(2) };
}

/** 24 h of normal history per online asset, ending just before `endTime`. */
export function buildHistory(assets, endTime, seed = 7) {
  const rand = mulberry32(seed);
  const start = Math.floor(endTime / INTERVAL_MS) * INTERVAL_MS - HISTORY_POINTS * INTERVAL_MS;
  const history = {};
  for (const a of assets) {
    if (a.sensor === 'offline') continue;
    history[a.id] = Array.from({ length: HISTORY_POINTS }, (_, i) => simulateReading(a, start + i * INTERVAL_MS, rand, null));
  }
  return { history, lastTime: start + (HISTORY_POINTS - 1) * INTERVAL_MS, rand };
}
