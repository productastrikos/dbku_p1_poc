/* Acceptance checks for the four AI cores, run with `npm test`. */
import zones from '../../data/mock/zones.json';
import assets from '../../data/mock/assets.json';
import incidents from '../../data/mock/incidents.json';
import outages from '../../data/mock/outages.json';
import dealers from '../../data/mock/dealers.json';
import transactions from '../../data/mock/transactions.json';
import meta from '../../data/mock/meta.json';
import { scoreThreat, scoreObservation, videoMetrics } from '../threatScore';
import { buildHistory, simulateReading, expectedCurrent, INTERVAL_MS } from '../sensorSim';
import { evaluateReading } from '../anomaly';
import { mulberry32 } from '../random';
import { buildContext, trainRiskModel, forecast, patrolRoute } from '../riskModel';
import { screenTransactions } from '../scrapScreening';
import { atMytHour, formatMyt, isNight } from '../time';
import alerts from '../../data/mock/alerts.json';
import tasks from '../../data/mock/tasks.json';
import { rebaseSeed, rebaseOffset } from '../../data/rebase';
import { eventFromAlert, buildCaseFile, offlineBrief } from '../../services/caseFile';
import { SAMPLE_FOOTAGE, replayTime, recordedLabel } from '../../data/footage';
import { buildNetwork, isCut, metres } from '../../data/network';
import cameras from '../../data/mock/cameras.json';
import fs from 'fs';
import path from 'path';

const AS_OF = Date.parse(`${meta.asOf}T12:00:00+08:00`);

describe('CCTV threat score', () => {
  const zone = { x: 0.45, y: 0.1, w: 0.1, h: 0.85 };
  const person = { class: 'person', score: 0.8, box: { x: 0.58, y: 0.4, w: 0.12, h: 0.5 } };

  test('person beside the asset at night with 4 min dwell is HIGH', () => {
    const r = scoreThreat({ detections: [person], zone, margin: 0.08, night: true, dwellMinutes: 4 });
    expect(r.score).toBe(85);
    expect(r.level).toBe('HIGH');
  });

  test('person + parked motorcycle at night is HIGH even without dwell', () => {
    const moto = { class: 'motorcycle', score: 0.7, box: { x: 0.3, y: 0.6, w: 0.14, h: 0.3 } };
    const r = scoreThreat({ detections: [person, moto], zone, margin: 0.08, night: true });
    expect(r.score).toBe(75);
    expect(r.level).toBe('HIGH');
  });

  test('a single still of a lone person at night scores 60 (MEDIUM)', () => {
    const r = scoreThreat({ detections: [person], zone, margin: 0.08, night: true });
    expect(r.score).toBe(60);
    expect(r.level).toBe('MEDIUM');
  });

  test('video: person loitering 4 min next to a parked car is HIGH', () => {
    const car = { class: 'car', score: 0.9, box: { x: 0.25, y: 0.55, w: 0.18, h: 0.25 } };
    const frames = Array.from({ length: 240 }, (_, t) => ({ t, detections: t % 37 === 5 ? [car] : [person, car] }));
    const m = videoMetrics(frames, zone, 0.08, 1);
    expect(m.dwellMinutes).toBeGreaterThan(3);
    expect(m.parked).toBe(true);
    const r = scoreThreat({ detections: frames[m.keyIndex].detections, zone, margin: 0.08, night: true, dwellMinutes: m.dwellMinutes, vehicleParked: m.parked });
    expect(r.score).toBe(100);
  });

  test('video: a car driving past is not parked', () => {
    const frames = Array.from({ length: 60 }, (_, t) => ({ t, detections: [{ class: 'car', score: 0.9, box: { x: (t * 0.08) % 0.85, y: 0.6, w: 0.15, h: 0.2 } }] }));
    expect(videoMetrics(frames, zone, 0.3, 1).parked).toBe(false);
  });

  test('far-away person in daytime is LOW', () => {
    const far = { ...person, box: { x: 0.9, y: 0.4, w: 0.08, h: 0.3 } };
    expect(scoreThreat({ detections: [far], zone, margin: 0.08, night: false }).score).toBe(0);
  });
});

describe('Tamper anomaly detection', () => {
  const online = assets.filter((a) => a.sensor !== 'offline');

  function run(asset, faultAt, fault, hours = 6, start = AS_OF) {
    const { history } = buildHistory([asset], start, 3);
    const h = [...history[asset.id]];
    const rand = mulberry32(99);
    const events = [];
    let t = h[h.length - 1].t;
    for (let i = 0; i < (hours * 60) / 5; i++) {
      t += INTERVAL_MS;
      const r = simulateReading(asset, t, rand, t >= faultAt ? fault : null);
      const ev = evaluateReading(asset, h, r);
      if (ev?.tamper) events.push({ t, ...ev });
      h.push(r);
    }
    return events;
  }

  test('three days of normal readings raise no alerts on any asset', () => {
    const { history, lastTime } = buildHistory(online, AS_OF, 5);
    const rand = mulberry32(5);
    let alerts = 0;
    for (const a of online) {
      const h = [...history[a.id]];
      let t = lastTime;
      for (let i = 0; i < 864; i++) {
        t += INTERVAL_MS;
        const r = simulateReading(a, t, rand, null);
        if (evaluateReading(a, h, r).tamper) alerts += 1;
        h.push(r);
        if (h.length > 300) h.shift();
      }
    }
    expect(alerts).toBe(0);
  });

  test.each(online.map((a) => [a.id, a]))('current drop to 0 on %s is classified as cable cut', (id, a) => {
    const at = AS_OF + 2 * 3600000;
    const ev = run(a, at, { type: 'cable_cut' }, 3);
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0].cause).toBe('cable_cut');
  });

  test('door open at night is "panel opened"; in daytime it is not an alert', () => {
    const db = online.find((a) => a.type === 'distribution_box');
    const night = atMytHour(AS_OF, 23);
    expect(run(db, night, { type: 'panel_open' }, 2, night - 3600000)[0].cause).toBe('panel_opened');
    const day = atMytHour(AS_OF, 11);
    expect(run(db, day, { type: 'panel_open' }, 2, day - 3600000)).toHaveLength(0);
  });

  test('tilt above 10° is "pole struck"', () => {
    const sl = online.find((a) => a.type === 'streetlight');
    expect(run(sl, AS_OF + 3600000, { type: 'pole_struck' }, 2)[0].cause).toBe('pole_struck');
  });

  test('illegal tapping trips the |z| > 3 rule', () => {
    const msb = online.find((a) => a.type === 'switchboard');
    const ev = run(msb, AS_OF + 3600000, { type: 'tapping' }, 2);
    expect(ev[0].cause).toBe('abnormal_draw');
    expect(Math.abs(ev[0].z)).toBeGreaterThan(3);
  });
});

describe('Hotspot risk model', () => {
  const ctx = buildContext({ zones, assets, incidents, outages, dealers });
  const model = trainRiskModel(ctx, AS_OF);
  const lightsOut = Object.fromEntries(zones.map((z) => {
    const sl = assets.filter((a) => a.zone === z.id && a.type === 'streetlight');
    return [z.id, sl.filter((a) => a.lighting === 'out').length / sl.length];
  }));
  const result = forecast(ctx, model, AS_OF, { lightsOut });

  test('model separates incident hours from normal hours', () => {
    // eslint-disable-next-line no-console
    console.log('AUC', model.auc, 'rows', model.rows, 'weights', model.weights.map((w) => w.toFixed(2)).join(' '));
    expect(model.auc).toBeGreaterThan(0.85);
  });

  test('ranks all three hotspots with three plain-English reasons each', () => {
    // eslint-disable-next-line no-console
    console.log(result.map((r) => `${r.zone} ${r.risk} ${r.band} peak ${r.peak.p}@${r.peak.hour}h | ${r.reasons.map((x) => x.key).join(', ')}\n   ${r.reasons.map((x) => x.text).join('\n   ')}`).join('\n'));
    expect(result.map((r) => r.zone).sort()).toEqual(['BIN', 'KUL', 'SEM']);
    expect(result[0].zone).toBe('SEM');
    result.forEach((r) => {
      expect(r.reasons).toHaveLength(3);
      expect(r.heat).toHaveLength(7);
      expect(r.heat[0]).toHaveLength(24);
    });
  });

  test('patrol route starts with the highest-risk zone', () => {
    const route = patrolRoute(result, assets, meta.patrolBase);
    expect(route.stops[0].zone).toBe(result[0].zone);
    expect(route.stops.length).toBe(12);
  });
});

describe('Scrap transaction screening', () => {
  const screened = screenTransactions(transactions);
  const flagged = transactions.filter((t) => screened[t.id].suspicious);

  test('flags exactly the planted suspicious sales', () => {
    // eslint-disable-next-line no-console
    console.log(flagged.map((t) => `${t.id} ${t.dealerId} ${t.material} ${t.weightKg}kg: ${screened[t.id].flags.map((f) => f.rule).join(', ')}`).join('\n'));
    const plantedFlagged = transactions.filter((t) => t._plantedReason && !t._plantedReason.startsWith('Part of')).map((t) => t.id);
    expect(flagged.map((t) => t.id).sort()).toEqual(plantedFlagged.sort());
    expect(flagged).toHaveLength(8);
  });

  test('the repeat seller is caught across dealers', () => {
    const repeat = flagged.filter((t) => screened[t.id].flags.some((f) => f.rule === 'repeat_seller'));
    expect(repeat).toHaveLength(2);
    expect(new Set(repeat.map((t) => t.sellerId)).size).toBe(1);
  });
});

describe('Police report case file', () => {
  const screening = screenTransactions(transactions);
  const data = { assets, zones, dealers, transactions, screening, forecast: null, incidents };
  const cctvAlert = (nightBasis) => ({
    id: 'AL-T1', source: 'cctv', type: 'intrusion', level: 'HIGH', status: 'open', score: 75, title: 'Intrusion near asset',
    assetId: 'SL-SEM-06', zone: 'SEM', lat: 1.58, lng: 110.33, createdAt: '2026-10-15T14:35:00+08:00',
    evidence: { capturedAt: '2026-10-14T15:40:00.000Z', cameraId: 'CAM-SEM-2', detections: [], factors: [], nightBasis },
  });

  test('a CCTV event is dated by its capture time, not by when it was analysed', () => {
    const cf = buildCaseFile(eventFromAlert(cctvAlert('capture time'), assets), data);
    expect(cf.event.occurredAt).toBe(`${formatMyt(Date.parse('2026-10-14T23:40:00+08:00'))} MYT`);
    expect(cf.event.occurredAt).toMatch(/23:40/);
    expect(cf.evidence[0].summary).not.toMatch(/inferred from low light/);
  });

  test('night inferred from low light is disclosed in the evidence', () => {
    const cf = buildCaseFile(eventFromAlert(cctvAlert('low light'), assets), data);
    expect(cf.evidence[0].summary).toMatch(/inferred from low light.*confirm the time/);
  });

  test('an alert raised from sample footage is marked as a demonstration and names no DBKU camera', () => {
    const a = cctvAlert('capture time');
    a.evidence = { ...a.evidence, cameraId: null, sample: { id: 'service-bay-dusk', camera: 'MEVA G301', site: 'hospital building, rear service bay', recorded: '8 Mar 2018, 18:30 EST', license: 'CC BY 4.0' } };
    const { summary } = buildCaseFile(eventFromAlert(a, assets), data).evidence[0];
    expect(summary).toMatch(/Camera none \(sample footage\)/);
    expect(summary).toMatch(/DEMONSTRATION ONLY.*MEVA.*not recorded by a DBKU camera/);
    expect(summary).not.toMatch(/CAM-/);
  });

  test('the 4 Oct cable cut links the copper-cable sale and drafts a complete brief offline', () => {
    const event = eventFromAlert(alerts.find((a) => a.id === 'AL-P006'), assets);
    const cf = buildCaseFile(event, data);
    expect(cf.linkedScrapSales.map((s) => s.transactionId)).toContain('TX-0188');
    const brief = offlineBrief(cf, event);
    ['title', 'summary', 'what', 'where', 'when', 'sequenceOfEvents', 'evidence', 'linkedScrapSales', 'lossBasis',
      'requestedPoliceActions', 'dbkuActions', 'ringkasanBM'].forEach((k) => expect(brief[k]).toBeTruthy());
  });
});

describe('Data consistency (what every screen shows)', () => {
  const seed = { meta, assets, incidents, outages, transactions, alerts, tasks };
  const asOf = Date.parse(`${meta.asOf}T00:00:00+08:00`);

  test('recent records move to today by whole days; dated history keeps its dates', () => {
    const now = Date.parse('2026-10-19T13:00:00+08:00');
    const r = rebaseSeed(seed, now);
    expect(r.offsetDays).toBe(4);
    expect(r.alerts.find((a) => a.id === 'AL-P009').createdAt).toBe('2026-10-19T01:14:00+08:00');
    expect(r.incidents[0].occurredAt).toBe(incidents[0].occurredAt);
    const latest = Math.max(...r.alerts.map((a) => Date.parse(a.createdAt)), ...r.transactions.map((t) => Date.parse(t.date)));
    expect(latest).toBeLessThanOrEqual(now);
    // Gaps between linked records are unchanged (sale TX-0188 is still the day after the cable theft).
    const gap = (set) => Date.parse(set.transactions.find((t) => t.id === 'TX-0188').date) - Date.parse(set.alerts.find((a) => a.id === 'AL-P006').createdAt);
    expect(gap(r)).toBe(gap(seed));
  });

  test('nothing seeded is ever in the future, even just after midnight', () => {
    const now = Date.parse('2026-10-20T00:30:00+08:00'); // before the latest pilot alert's 01:14
    const r = rebaseSeed(seed, now);
    expect(r.offsetDays).toBe(4);
    [...r.alerts.map((a) => a.createdAt), ...r.transactions.map((t) => t.date), ...r.tasks.map((t) => t.updatedAt)]
      .forEach((d) => expect(Date.parse(d)).toBeLessThanOrEqual(now));
    expect(rebaseOffset(meta, asOf + 3600000, asOf + 7200000)).toBe(0);
  });

  test('pilot CCTV alerts come from a camera that covers the asset, and their level follows the score', () => {
    alerts.filter((a) => a.source === 'cctv').forEach((a) => {
      const asset = assets.find((x) => x.id === a.assetId);
      expect(asset.cameraId).toBe(a.evidence.cameraId);
      const o = a.evidence.observed;
      const { level } = scoreObservation({ near: o.objects, night: isNight(a.createdAt), dwellMinutes: o.dwellMinutes, vehicleParked: o.vehicleParked });
      expect(level).toBe(a.level);
    });
  });

  test('incidents raised by the command centre match their pilot alert', () => {
    const raised = incidents.filter((i) => i.alertId);
    expect(raised).toHaveLength(3);
    raised.forEach((i) => {
      const a = alerts.find((x) => x.id === i.alertId);
      expect(a.createdAt).toBe(i.occurredAt);
      expect(a.status).toBe('confirmed_theft');
      expect(i.reportedBy).toContain(a.id);
    });
  });

  test('every dark streetlight and offline sensor has a recorded cause and an open work order', () => {
    const open = tasks.filter((t) => t.kind === 'work_order' && ['open', 'in_progress'].includes(t.status));
    assets.filter((a) => a.lighting === 'out' || a.sensor === 'offline').forEach((a) => {
      if (a.lighting === 'out') { expect(a.lightingCause).toBeTruthy(); expect(a.lightingSince).toBeTruthy(); }
      if (a.sensor === 'offline') { expect(a.sensorCause).toBeTruthy(); expect(a.sensorSince).toBeTruthy(); }
      expect(open.some((t) => t.assetIds.includes(a.id))).toBe(true);
    });
  });

  test('seeded tasks point at real assets and alerts', () => {
    tasks.forEach((t) => {
      t.assetIds.forEach((id) => expect(assets.some((a) => a.id === id)).toBe(true));
      if (t.alertId) expect(alerts.some((a) => a.id === t.alertId)).toBe(true);
      expect(t.history[t.history.length - 1].status).toBe(t.status);
    });
  });

  test('a lamp logged as dark draws standby current at night and raises no alert', () => {
    const dark = assets.find((a) => a.id === 'SL-SEM-09');
    const night = atMytHour(AS_OF, 23);
    expect(expectedCurrent(dark, night)).toBeLessThan(0.1);
    const { history } = buildHistory([dark], night, 4);
    const r = simulateReading(dark, night, mulberry32(4), null);
    expect(evaluateReading(dark, history[dark.id], r).tamper).toBe(false);
  });
});

describe('Sample CCTV footage', () => {
  const dir = path.join(__dirname, '../../../public/footage');

  test('every sample file and poster is bundled, and its asset and zone are valid', () => {
    SAMPLE_FOOTAGE.forEach((s) => {
      [s.file, s.poster].forEach((f) => expect(fs.existsSync(path.join(dir, f))).toBe(true));
      expect(assets.some((a) => a.id === s.assetId)).toBe(true);
      const { x, y, w, h } = s.zone;
      [x, y, w, h].forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
      expect(x + w).toBeLessThanOrEqual(1);
      expect(y + h).toBeLessThanOrEqual(1);
      expect(s.source).toMatch(/\.r13\.avi$/);
    });
    expect(new Set(SAMPLE_FOOTAGE.map((s) => s.id)).size).toBe(SAMPLE_FOOTAGE.length);
  });

  test('a clip replays at its recorded time of day, within the last 24 hours', () => {
    const now = Date.parse('2026-10-19T14:00:00+08:00');
    SAMPLE_FOOTAGE.forEach((s) => {
      const t = replayTime(s, now);
      expect(t).toBeLessThanOrEqual(now);
      expect(now - t).toBeLessThan(24 * 3600e3);
      expect(new Date(t + 8 * 3600e3).toISOString().slice(11, 16)).toBe(s.replayAt);
      expect(s.recordedAt.slice(11, 16)).toBe(s.replayAt);
    });
    const night = SAMPLE_FOOTAGE.find((s) => s.id === 'pole-night-quiet');
    expect(isNight(replayTime(night, now))).toBe(true);
    expect(recordedLabel(night)).toBe('11 Mar 2018, 23:57 EDT');
  });
});

describe('Digital twin network and CCTV geometry', () => {
  const net = buildNetwork(assets);
  const toRad = (d) => (d * Math.PI) / 180;
  const bearing = ([lat1, lng1], [lat2, lng2]) => {
    const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  };
  const gap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  test('every asset traces back to its own zone switchboard, and every light is on one circuit', () => {
    assets.forEach((a) => {
      const chain = net.chain(a.id);
      expect(chain[chain.length - 1].type).toBe('switchboard');
      expect(chain.every((x) => x.zone === a.zone)).toBe(true);
      if (a.type === 'streetlight') expect(a.circuit).toMatch(new RegExp(`^${a.zone}-C[0-9]$`));
    });
    const lights = net.circuits.flatMap((c) => c.lights.map((l) => l.id));
    expect(lights.length).toBe(assets.filter((a) => a.type === 'streetlight').length);
    expect(new Set(lights).size).toBe(lights.length);
  });

  test('the lights without supply are exactly the ones recorded as dark from a circuit cut, and repairs restore them', () => {
    const dead = assets.filter((a) => a.type === 'streetlight' && !net.energised(a.id)).map((a) => a.id).sort();
    const cut = assets.filter((a) => /^Circuit cut/.test(a.lightingCause || '')).map((a) => a.id).sort();
    expect(dead).toEqual(cut);
    expect(dead.length).toBeGreaterThan(0);
    // A lamp failure is dark but still has supply.
    expect(net.energised('SL-SEM-09')).toBe(true);
    const repaired = assets.map((a) => (isCut(a) ? { ...a, lighting: 'on', lightingCause: undefined, sensor: 'online', sensorCause: undefined } : a));
    expect(buildNetwork(repaired).circuits.every((c) => c.dead === 0)).toBe(true);
  });

  test('circuits stay local: no light is more than 360 m from the pillar or switchboard that feeds it', () => {
    net.circuits.forEach((c) => c.lights.forEach((l) => {
      expect(metres([c.source.lat, c.source.lng], [l.lat, l.lng])).toBeLessThan(360);
    }));
  });

  test('cameras sit on their mount and only cover what is in range and inside a head\'s field of view', () => {
    cameras.forEach((c) => {
      const mount = assets.find((a) => a.id === c.mountedOn);
      expect([c.lat, c.lng]).toEqual([mount.lat, mount.lng]);
      c.covers.filter((id) => id !== mount.id).forEach((id) => {
        const a = assets.find((x) => x.id === id);
        const seen = (a.path || [[a.lat, a.lng]]).some((p) => metres([c.lat, c.lng], p) <= c.heads[0].rangeM
          && c.heads.some((h) => gap(bearing([c.lat, c.lng], p), h.heading) <= h.fovDeg / 2 + 0.5));
        expect(seen).toBe(true);
      });
    });
    assets.filter((a) => a.cameraId).forEach((a) => expect(cameras.find((c) => c.id === a.cameraId).covers).toContain(a.id));
  });

  test('cable copper follows the conductor: 4 cores × cross-section × length × 8.96 g/cm³', () => {
    assets.filter((a) => a.type === 'cable').forEach((a) => {
      expect(Math.abs(a.spec.copperKg - a.lengthM * 4 * a.spec.mm2 * 0.00896)).toBeLessThanOrEqual(0.5);
    });
  });
});
