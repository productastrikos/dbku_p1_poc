/* AI CCTV threat scoring.

   Score 0–100 is the sum of four factors:
     object near asset zone   +30
     night (22:00–06:00 MYT)  +30
     dwell over 3 minutes     +25
     vehicle parked by asset  +15
   Score ≥ 70 is a HIGH alert. Boxes and zones use normalised image
   coordinates: { x, y, w, h } in 0–1. */

export const THREAT_RULES = {
  nearAsset: 30,
  night: 30,
  dwell: 25,
  vehicleParked: 15,
  dwellMinutes: 3,
  high: 70,
  medium: 40,
};

export const TARGET_CLASSES = ['person', 'car', 'motorcycle', 'truck'];
export const VEHICLE_CLASSES = ['car', 'motorcycle', 'truck'];
export const isVehicle = (cls) => VEHICLE_CLASSES.includes(cls);

export const LEVELS = {
  HIGH:   { label: 'HIGH',   labelMs: 'Tinggi',    tone: 'danger' },
  MEDIUM: { label: 'MEDIUM', labelMs: 'Sederhana', tone: 'warning' },
  LOW:    { label: 'LOW',    labelMs: 'Rendah',    tone: 'success' },
};

export function levelFor(score) {
  if (score >= THREAT_RULES.high) return 'HIGH';
  if (score >= THREAT_RULES.medium) return 'MEDIUM';
  return 'LOW';
}

/** Shortest gap between two rectangles (0 when they overlap). */
export function rectGap(a, b) {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

export const isNearZone = (box, zone, margin) => rectGap(box, zone) <= margin;

/** Detections of target classes within `margin` of the asset zone. */
export function nearZone(detections, zone, margin) {
  return detections.filter((d) => TARGET_CLASSES.includes(d.class) && isNearZone(d.box, zone, margin));
}

/**
 * Dwell and parked-vehicle evidence from sampled video frames.
 *   frames: [{ t (s), detections }], step: seconds between samples
 * Dwell is the longest run of samples with a person or vehicle near the zone
 * (one missed sample tolerated). A vehicle counts as parked when it stays near
 * the zone, moving less than 4% of the frame per sample, for 20 s or more.
 * keyIndex is the frame with the strongest near-zone evidence.
 */
export function videoMetrics(frames, zone, margin, step) {
  let dwellSec = 0;
  let runStart = null;
  let misses = 0;
  let parkedSec = 0;
  let still = 0;
  let prev = null;
  let keyIndex = 0;
  let keyScore = -1;
  frames.forEach((f, i) => {
    const near = nearZone(f.detections, zone, margin);
    if (near.length) {
      if (runStart === null) runStart = f.t;
      misses = 0;
      dwellSec = Math.max(dwellSec, f.t - runStart + step);
    } else if (runStart !== null && ++misses > 1) {
      runStart = null;
      misses = 0;
    }

    const centres = near.filter((d) => isVehicle(d.class)).map((d) => [d.box.x + d.box.w / 2, d.box.y + d.box.h / 2]);
    const stationary = prev && centres.some(([x, y]) => prev.some(([px, py]) => Math.hypot(x - px, y - py) < 0.04));
    still = stationary ? still + step : 0;
    parkedSec = Math.max(parkedSec, still);
    prev = centres.length ? centres : null;

    const s = near.length * 10 + near.reduce((a, d) => a + d.score, 0) + f.detections.length * 0.1;
    if (s > keyScore) { keyScore = s; keyIndex = i; }
  });
  return { dwellMinutes: dwellSec / 60, parked: parkedSec >= 20, parkedSeconds: parkedSec, keyIndex };
}

/**
 * Scores one observation.
 *   detections     [{ class, score, box }]
 *   zone, margin   asset zone rectangle and proximity margin (normalised)
 *   night          boolean
 *   dwellMinutes   observed dwell near the asset
 *   vehicleParked  optional override (video analysis decides "parked");
 *                  for a still frame any vehicle near the zone counts
 */
export function scoreThreat({ detections, zone, margin, night, dwellMinutes = 0, vehicleParked }) {
  const near = nearZone(detections, zone, margin);
  const nearVehicles = near.filter((d) => isVehicle(d.class));
  const parked = vehicleParked ?? nearVehicles.length > 0;
  return {
    ...scoreObservation({
      near: near.map((d) => d.class), night, dwellMinutes, vehicleParked: parked,
      vehicleDetail: nearVehicles.length ? nearVehicles.map((d) => d.class).join(', ') : 'Stationary vehicle in video',
    }),
    near,
  };
}

/**
 * Factors and score from what was observed, without detections: used for
 * operator-logged pilot alerts, and by scoreThreat for live footage.
 *   near           classes seen near the asset, e.g. ['person', 'car']
 */
export function scoreObservation({ near = [], night, dwellMinutes = 0, vehicleParked = false, vehicleDetail }) {
  const factors = [
    {
      key: 'near', label: 'Object near asset zone', labelMs: 'Objek berhampiran aset', points: THREAT_RULES.nearAsset,
      met: near.length > 0,
      detail: near.length ? `${near.length} detected: ${near.join(', ')}` : 'No person or vehicle near the asset zone',
    },
    {
      key: 'night', label: 'Night-time (22:00–06:00)', labelMs: 'Waktu malam', points: THREAT_RULES.night,
      met: Boolean(night),
      detail: night ? 'Inside the night window' : 'Daytime',
    },
    {
      key: 'dwell', label: `Dwell over ${THREAT_RULES.dwellMinutes} min`, labelMs: 'Berlegar lama', points: THREAT_RULES.dwell,
      met: dwellMinutes > THREAT_RULES.dwellMinutes,
      detail: `${(+dwellMinutes || 0).toFixed(1)} min observed`,
    },
    {
      key: 'vehicle', label: 'Vehicle parked beside asset', labelMs: 'Kenderaan diletak di sisi aset', points: THREAT_RULES.vehicleParked,
      met: Boolean(vehicleParked),
      detail: vehicleParked ? (vehicleDetail || near.filter(isVehicle).join(', ') || 'Stationary vehicle') : 'No vehicle beside the asset',
    },
  ];
  const score = Math.min(100, factors.reduce((s, f) => s + (f.met ? f.points : 0), 0));
  return { score, level: levelFor(score), factors };
}
