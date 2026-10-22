/* Builds the case file behind a police report: the facts the LLM is allowed
   to use. Also provides the offline template brief used when no LLM is
   configured, with the same shape as the LLM output. */
import { linkSales, estimateLoss } from '../ai/linking';
import { CAUSES } from '../ai/anomaly';
import { formatMyt, mytParts } from '../ai/time';
import { ASSET_TYPES, SOURCES, ALERT_STATUS, formatRM } from '../data/reference';

const pad = (n) => String(n).padStart(2, '0');
const mytDate = (t) => { const p = mytParts(t); return `${p.year}${pad(p.month)}${pad(p.day)}`; };
const sentence = (s) => s.replace(/[.\s]+$/, '');

export const EVENT_TYPES = {
  intrusion:                 { label: 'Intrusion near asset',        labelMs: 'pencerobohan berhampiran aset' },
  cable_cut:                 { label: 'Cable cut',                   labelMs: 'kabel dipotong' },
  panel_opened:              { label: 'Panel opened at night',       labelMs: 'panel dibuka pada waktu malam' },
  pole_struck:               { label: 'Pole struck',                 labelMs: 'tiang dilanggar' },
  abnormal_draw:             { label: 'Abnormal current draw',       labelMs: 'arus elektrik luar biasa' },
  cable_theft:               { label: 'Cable theft',                 labelMs: 'kecurian kabel' },
  streetlight_wiring_theft:  { label: 'Streetlight wiring theft',    labelMs: 'kecurian pendawaian lampu jalan' },
  distribution_box_break_in: { label: 'Distribution box break-in',   labelMs: 'pecah masuk kotak agihan' },
  switchboard_vandalism:     { label: 'Main switchboard vandalism',  labelMs: 'vandalisme papan suis utama' },
};

/* ─── Events (alerts and historical incidents) ────────────── */
export function eventFromAlert(alert, assets) {
  const asset = assets.find((a) => a.id === alert.assetId);
  // CCTV events happened when the footage was captured, not when it was analysed.
  const time = Date.parse((alert.source === 'cctv' && alert.evidence?.capturedAt) || alert.createdAt);
  return {
    kind: 'alert', id: alert.id, type: alert.type, title: alert.title, source: alert.source, level: alert.level,
    status: alert.status, time, asset, zone: alert.zone, lat: alert.lat, lng: alert.lng,
    alert, note: alert.note,
  };
}

export function eventFromIncident(inc, assets) {
  const asset = assets.find((a) => a.id === inc.assetIds[0]);
  return {
    kind: 'incident', id: inc.id, type: inc.type, title: inc.title, source: 'record', level: 'HIGH', status: 'confirmed_theft',
    time: Date.parse(inc.occurredAt), asset, assetIds: inc.assetIds, zone: inc.zone, lat: asset.lat, lng: asset.lng,
    incident: inc, recordedCostRM: inc.costRM,
  };
}

/* ─── Case file ───────────────────────────────────────────── */
export function buildCaseFile(event, { assets, zones, dealers, transactions, screening, forecast, incidents }) {
  const zone = zones.find((z) => z.id === event.zone);
  const a = event.asset;
  const linked = linkSales({ time: event.time, lat: event.lat, lng: event.lng }, transactions, screening, dealers).slice(0, 5);
  const loss = event.recordedCostRM
    ? estimateLoss({ recordedCostRM: event.recordedCostRM })
    : estimateLoss({ asset: a, assets, type: event.type });
  const zf = forecast?.find((f) => f.zone === event.zone);

  const evidence = [];
  const ev = event.alert?.evidence || {};
  if (event.alert?.source === 'cctv') {
    const det = ev.detections?.length
      ? ev.detections.map((d) => `${d.class} ${Math.round(d.score * 100)}%${d.near ? ' (near asset)' : ''}`).join(', ')
      : ev.observed?.objects?.length ? `${ev.observed.objects.join(', ')} (logged by the operator)` : '';
    const nightNote = ev.nightBasis === 'low light'
      ? ' Night-time was inferred from low light in the image, not from the capture time; confirm the time from the camera log.'
      : '';
    const sampleNote = ev.sample
      ? ` DEMONSTRATION ONLY: the footage is a sample clip from the public MEVA dataset (camera ${ev.sample.camera.replace('MEVA ', '')}, ${ev.sample.site}, recorded ${ev.sample.recorded}, ${ev.sample.license}), replayed at the same time of day; it was not recorded by a DBKU camera and is not evidence of this event.`
      : '';
    evidence.push({
      ref: 'E1', kind: ev.snapshot ? 'AI CCTV snapshot' : 'AI CCTV detection', hasImage: Boolean(ev.snapshot),
      summary: `Threat score ${event.alert.score}/100 (${event.level}). Camera ${ev.sample ? 'none (sample footage)' : ev.cameraId || 'not recorded'}, captured ${ev.capturedAt ? `${formatMyt(ev.capturedAt)} MYT` : 'not recorded'}. Detections: ${det || 'not recorded'}.${nightNote}${sampleNote}`,
      factors: (ev.factors || []).filter((f) => f.met).map((f) => `${f.label} (+${f.points})`),
    });
  }
  if (event.alert?.source === 'sensor' && ev.sensor) {
    const s = ev.sensor;
    evidence.push({
      ref: 'S1', kind: 'Tamper sensor reading',
      summary: `At ${ev.simulated ? 'simulated ' : ''}sensor time ${formatMyt(s.simTime)}: current ${s.current} A (expected ${s.expected} A, z = ${s.z}), door ${s.door === 1 ? 'OPEN' : s.door === 0 ? 'closed' : 'n/a'}, tilt ${s.tilt == null ? 'n/a' : `${s.tilt}°`}. Cause: ${(ev.causes || []).map((c) => CAUSES[c]?.label || c).join(', ')}.`,
    });
  }
  if (event.alert?.evidence?.mock) {
    evidence.push({ ref: 'P1', kind: 'Pilot log entry', summary: `${event.alert.message}. Outcome: ${event.alert.note || 'not recorded'}` });
  }
  if (event.incident) {
    evidence.push({ ref: 'R1', kind: 'DBKU incident record', summary: `${event.incident.detail} Reported by: ${event.incident.reportedBy}.` });
  }

  const prior = incidents
    .filter((i) => i.zone === event.zone && Date.parse(i.occurredAt) < event.time)
    .sort((x, y) => Date.parse(y.occurredAt) - Date.parse(x.occurredAt));

  return {
    reference: `GG/${event.zone}/${mytDate(event.time)}/${event.id}`,
    preparedAt: formatMyt(Date.now()),
    reportingUnit: 'Dewan Bandaraya Kuching Utara (DBKU), GuardGrid early-warning system',
    event: {
      id: event.id,
      type: EVENT_TYPES[event.type]?.label || event.type,
      title: event.title,
      detectedBy: event.kind === 'incident' ? 'DBKU incident record' : SOURCES[event.source]?.label,
      alertLevel: event.level,
      status: ALERT_STATUS[event.status]?.label || event.status,
      occurredAt: `${formatMyt(event.time)} MYT`,
      note: event.note || null,
    },
    location: {
      zone: zone?.name,
      road: a?.road,
      asset: a ? { id: a.id, type: ASSET_TYPES[a.type]?.label, name: a.name, cctv: a.cameraId || 'none' } : null,
      coordinates: `${event.lat.toFixed(5)}, ${event.lng.toFixed(5)}`,
      map: `https://www.openstreetmap.org/?mlat=${event.lat}&mlon=${event.lng}#map=18/${event.lat}/${event.lng}`,
    },
    evidence,
    linkedScrapSales: linked.map((l) => ({
      transactionId: l.transaction.id,
      date: `${formatMyt(l.transaction.date)} MYT`,
      dealer: l.dealer.name,
      dealerLicence: l.dealer.licenceNo,
      material: l.transaction.material,
      weightKg: l.transaction.weightKg,
      sellerIcMasked: l.transaction.sellerIcMasked,
      sellerRef: l.transaction.sellerId,
      daysAfterEvent: +l.days.toFixed(1),
      kmFromSite: +l.km.toFixed(1),
      screeningFlags: screening[l.transaction.id].flags.map((f) => f.detail),
    })),
    estimatedLoss: { totalRM: loss.totalRM, items: loss.items, basis: loss.basis },
    zoneContext: zf ? { riskBand7Day: zf.band, riskScore7Day: zf.risk, topReasons: zf.reasons.map((r) => r.text) } : null,
    history: {
      incidentsInZoneBefore: prior.length,
      recent: prior.slice(0, 3).map((i) => ({ date: formatMyt(i.occurredAt, 'date'), what: i.title, costRM: i.costRM })),
    },
  };
}

/* ─── Offline template brief (no LLM configured) ──────────── */
export function offlineBrief(cf, event) {
  const typeMs = EVENT_TYPES[event.type]?.labelMs || event.type;
  const asset = cf.location.asset;
  const sales = cf.linkedScrapSales;
  return {
    title: `${cf.event.type}: ${asset?.name || 'asset'}, ${cf.location.zone}`,
    summary: `${cf.event.type} at ${asset?.id} (${asset?.type}) on ${cf.location.road}, ${cf.location.zone}, ${cf.event.occurredAt}. `
      + `Estimated loss ${formatRM(cf.estimatedLoss.totalRM)}. `
      + (sales.length ? `${sales.length} suspicious scrap sale${sales.length > 1 ? 's' : ''} in the following 14 days are listed as investigative leads.` : 'No suspicious scrap sales were found in the following 14 days.'),
    what: `${cf.event.type} detected by ${cf.event.detectedBy}. ${cf.event.title}.${cf.event.note ? ` Outcome: ${cf.event.note}` : ''}`,
    where: `${asset?.name} (${asset?.id}), ${cf.location.road}, ${cf.location.zone}. Coordinates ${cf.location.coordinates}.`,
    when: cf.event.occurredAt,
    sequenceOfEvents: [
      { time: cf.event.occurredAt, event: `${cf.event.detectedBy}: ${cf.event.title}.` },
      ...sales.map((s) => ({ time: s.date, event: `${s.material}, ${s.weightKg} kg sold to ${s.dealer} (${s.transactionId}).` })),
    ],
    evidence: cf.evidence.map((e) => ({ ref: e.ref, description: `${e.kind}: ${e.summary}${e.factors?.length ? ` Factors: ${e.factors.join('; ')}.` : ''}` })),
    linkedScrapSales: sales.map((s) => ({
      transactionId: s.transactionId,
      relevance: `${s.daysAfterEvent} days after the event, ${s.kmFromSite} km from the site. ${s.screeningFlags.map(sentence).join('; ')}. Investigative lead only, not proof.`,
    })),
    lossBasis: `${cf.estimatedLoss.basis}: ${cf.estimatedLoss.items.map((i) => `${i.item} ${formatRM(i.rm)}`).join('; ')}.`,
    requestedPoliceActions: [
      ...(sales.length ? [`Inspect the registers of ${[...new Set(sales.map((s) => s.dealer))].join(', ')} under the Second-Hand Dealers Act 1946 and identify the sellers of the listed transactions.`] : []),
      'Record a police report reference for this incident and share it with DBKU Enforcement.',
      'Request any private CCTV footage near the site for the incident window.',
    ],
    dbkuActions: [
      'Make the site safe and restore lighting.',
      'Add the site to tonight\'s patrol route and keep GuardGrid monitoring active.',
      'Notify Sarawak Energy and the Ministry of Utility and Telecommunication.',
    ],
    ringkasanBM: `Pada ${cf.event.occurredAt}, ${typeMs} dikesan di ${asset?.id} (${cf.location.road}, ${cf.location.zone}). `
      + `Anggaran kerugian ${formatRM(cf.estimatedLoss.totalRM)}. `
      + (sales.length ? `${sales.length} jualan besi buruk yang mencurigakan disenaraikan untuk siasatan lanjut.` : 'Tiada jualan besi buruk mencurigakan ditemui dalam tempoh 14 hari berikutnya.'),
    model: 'offline template',
  };
}
