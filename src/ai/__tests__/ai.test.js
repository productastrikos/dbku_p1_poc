/* Acceptance checks for the four AI cores, run with `npm test`. */
import zones from '../../data/mock/zones.json';
import assets from '../../data/mock/assets.json';
import incidents from '../../data/mock/incidents.json';
import outages from '../../data/mock/outages.json';
import dealers from '../../data/mock/dealers.json';
import transactions from '../../data/mock/transactions.json';
import meta from '../../data/mock/meta.json';
import { scoreThreat, videoMetrics } from '../threatScore';
import { buildHistory, simulateReading, INTERVAL_MS } from '../sensorSim';
import { evaluateReading } from '../anomaly';
import { mulberry32 } from '../random';
import { buildContext, trainRiskModel, forecast, patrolRoute } from '../riskModel';
import { screenTransactions } from '../scrapScreening';
import { atMytHour, formatMyt } from '../time';
import alerts from '../../data/mock/alerts.json';
import { eventFromAlert, buildCaseFile, offlineBrief } from '../../services/caseFile';

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

  test('the 4 Oct cable cut links the copper-cable sale and drafts a complete brief offline', () => {
    const event = eventFromAlert(alerts.find((a) => a.id === 'AL-P006'), assets);
    const cf = buildCaseFile(event, data);
    expect(cf.linkedScrapSales.map((s) => s.transactionId)).toContain('TX-0188');
    const brief = offlineBrief(cf, event);
    ['title', 'summary', 'what', 'where', 'when', 'sequenceOfEvents', 'evidence', 'linkedScrapSales', 'lossBasis',
      'requestedPoliceActions', 'dbkuActions', 'ringkasanBM'].forEach((k) => expect(brief[k]).toBeTruthy());
  });
});
