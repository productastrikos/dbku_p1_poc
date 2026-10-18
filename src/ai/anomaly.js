/* Asset tamper anomaly detection.

   Current draw: rolling z-score per asset. Each reading is compared with
   the asset's daily load profile, then the residual is scored against the
   last 12 readings (1 hour) taken in the same operating state:
       z = (residual − mean(window)) / max(sd(window), sensor noise)
   Tamper alert when
     |z| > 3 on current draw, OR door open at night, OR tilt > 10°.
   Cause:
     cable cut      current drops to ~0 while it should be flowing
     panel opened   door contact open during 22:00–06:00
     pole struck    tilt above 10°
     abnormal draw  |z| > 3 without the above (e.g. illegal tapping) */
import { expectedCurrent, noiseLevel } from './sensorSim';
import { isNight } from './time';

export const TAMPER_RULES = { z: 3, window: 12, tiltDeg: 10, cutFraction: 0.05 };

export const CAUSES = {
  cable_cut:     { label: 'Cable cut',            labelMs: 'Kabel dipotong',          level: 'HIGH' },
  panel_opened:  { label: 'Panel opened',         labelMs: 'Panel dibuka',            level: 'HIGH' },
  pole_struck:   { label: 'Pole struck',          labelMs: 'Tiang dilanggar',         level: 'HIGH' },
  abnormal_draw: { label: 'Abnormal current draw', labelMs: 'Arus luar biasa',        level: 'MEDIUM' },
};

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs, m) => Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));

/**
 * Scores the newest reading against the asset's previous readings.
 * `history` must not include `reading`. Returns null until a window exists.
 */
export function evaluateReading(asset, history, reading) {
  const sameState = [];
  for (let i = history.length - 1; i >= 0 && sameState.length < TAMPER_RULES.window; i--) {
    if (history[i].state === reading.state) sameState.push(history[i]);
  }
  const expected = expectedCurrent(asset, reading.t);
  const residual = reading.current - expected;
  let z = 0;
  let windowMean = 0;
  let windowSd = 0;
  if (sameState.length >= 4) {
    const res = sameState.map((r) => r.current - expectedCurrent(asset, r.t));
    windowMean = mean(res);
    windowSd = sd(res, windowMean);
    z = (residual - windowMean) / Math.max(windowSd, noiseLevel(asset, reading.state));
  }

  const night = isNight(reading.t);
  const causes = [];
  if (expected > 0.05 && reading.current < expected * TAMPER_RULES.cutFraction) causes.push('cable_cut');
  if (reading.door === 1 && night) causes.push('panel_opened');
  if (reading.tilt != null && reading.tilt > TAMPER_RULES.tiltDeg) causes.push('pole_struck');
  if (Math.abs(z) > TAMPER_RULES.z && !causes.includes('cable_cut')) causes.push('abnormal_draw');

  return {
    z: +z.toFixed(2),
    expected: +expected.toFixed(3),
    band: [expected + windowMean - 3 * Math.max(windowSd, noiseLevel(asset, reading.state)), expected + windowMean + 3 * Math.max(windowSd, noiseLevel(asset, reading.state))],
    night,
    doorOpenDaytime: reading.door === 1 && !night,
    causes,
    cause: causes[0] || null,
    tamper: causes.length > 0,
  };
}
