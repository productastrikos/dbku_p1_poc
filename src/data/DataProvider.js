import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import meta from './mock/meta.json';
import zones from './mock/zones.json';
import assetsSeed from './mock/assets.json';
import cameras from './mock/cameras.json';
import dealers from './mock/dealers.json';
import incidents from './mock/incidents.json';
import outages from './mock/outages.json';
import transactionsSeed from './mock/transactions.json';
import pilotAlerts from './mock/alerts.json';
import { loadState, saveState, clearState } from '../services/storage';
import { getLlmStatus } from '../services/llm';
import { screenTransactions } from '../ai/scrapScreening';
import { buildContext, trainRiskModel, forecast as runForecast, patrolRoute } from '../ai/riskModel';
import { estimateLoss } from '../ai/linking';
import { CAUSES } from '../ai/anomaly';
import { sameMytDay, formatMyt, mytParts } from '../ai/time';
import { isActive, formatRM } from './reference';

/* App-wide store. Seed data comes from src/data/mock (see
   scripts/generate-mock-data.js); what operators create in the session
   (alerts, submissions, decisions) is kept in browser storage. */

const DataContext = createContext(null);

// Pilot alerts get the same loss estimate as live ones, so the drawer, the
// "RM loss avoided" KPI and police reports always agree.
const PILOT_ALERTS = pilotAlerts.map((a) => ({
  ...a,
  estimatedLossRM: estimateLoss({ asset: assetsSeed.find((x) => x.id === a.assetId), assets: assetsSeed, type: a.type }).totalRM,
}));

const zoneName = (id) => zones.find((z) => z.id === id)?.short || id;

function idFor(prefix, n) {
  const p = mytParts(Date.now());
  const day = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  return `${prefix}-${day}-${String(n).padStart(3, '0')}`;
}

export function DataProvider({ children }) {
  const saved = useRef(loadState()).current;
  const [liveAlerts, setLiveAlerts] = useState(saved.alerts || []);
  const [alertPatches, setAlertPatches] = useState(saved.alertPatches || {});
  const [readIds, setReadIds] = useState(saved.readIds || []);
  const [submitted, setSubmitted] = useState(saved.transactions || []);
  const [reviews, setReviews] = useState(saved.reviews || {});
  const [briefs, setBriefs] = useState(saved.briefs || {});
  const [actionLog, setActionLog] = useState(saved.actionLog || []);
  const [llm, setLlm] = useState({ enabled: false, checking: true });
  const [model, setModel] = useState(null);

  useEffect(() => {
    saveState({ alerts: liveAlerts, alertPatches, readIds, transactions: submitted, reviews, briefs, actionLog });
  }, [liveAlerts, alertPatches, readIds, submitted, reviews, briefs, actionLog]);

  useEffect(() => { getLlmStatus().then(setLlm); }, []);

  /* ─── Alerts ─────────────────────────────────────────────── */
  const alerts = useMemo(() => [
    ...liveAlerts,
    ...PILOT_ALERTS.map((a) => ({ ...a, ...alertPatches[a.id] })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [liveAlerts, alertPatches]);

  const log = useCallback((entry) => {
    setActionLog((l) => [{ at: new Date().toISOString(), ...entry }, ...l].slice(0, 200));
  }, []);

  // Ids are issued synchronously so callers get them back immediately.
  const liveRef = useRef(liveAlerts);
  liveRef.current = liveAlerts;
  const issued = useRef(new Set());
  const issueId = useCallback(() => {
    for (let n = 1; ; n++) {
      const id = idFor('AL', n);
      if (!issued.current.has(id) && !liveRef.current.some((a) => a.id === id)) {
        issued.current.add(id);
        return id;
      }
    }
  }, []);

  /** Adds an alert and returns its id. */
  const addAlert = useCallback((alert) => {
    const id = alert.id || issueId();
    setLiveAlerts((list) => [{ status: 'open', createdAt: new Date().toISOString(), ...alert, id }, ...list]);
    return id;
  }, [issueId]);

  const updateAlert = useCallback((id, patch) => {
    if (liveRef.current.some((a) => a.id === id)) {
      setLiveAlerts((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    } else {
      setAlertPatches((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
    }
  }, []);

  const setAlertStatus = useCallback((id, status, note) => {
    updateAlert(id, { status, ...(note ? { note } : {}), updatedAt: new Date().toISOString() });
    log({ kind: 'alert', id, status, note });
  }, [updateAlert, log]);

  /** Called by the sensor simulation; one active alert per asset and cause. */
  const raiseSensorAlert = useCallback(({ asset, reading, evaluation, cause }) => {
    if (liveRef.current.some((a) => a.assetId === asset.id && a.type === cause && isActive(a))) return;
    const id = issueId();
    setLiveAlerts((list) => {
      if (list.some((a) => a.assetId === asset.id && a.type === cause && isActive(a))) return list;
      const info = CAUSES[cause];
      const loss = estimateLoss({ asset, assets: assetsSeed, type: cause });
      const detail = {
        cable_cut: `Current fell to ${reading.current} A (expected ${evaluation.expected} A)`,
        panel_opened: 'Door contact opened during the night window',
        pole_struck: `Tilt sensor reads ${reading.tilt}°`,
        abnormal_draw: `Current ${reading.current} A, z = ${evaluation.z} (expected ${evaluation.expected} A)`,
      }[cause];
      const alert = {
        id, source: 'sensor', level: info.level, type: cause,
        title: `${info.label} · ${asset.id}`, message: detail,
        assetId: asset.id, zone: asset.zone, lat: asset.lat, lng: asset.lng,
        createdAt: new Date().toISOString(), status: 'open', score: null,
        estimatedLossRM: loss.totalRM,
        evidence: { sensor: { simTime: reading.t, current: reading.current, expected: evaluation.expected, z: evaluation.z, door: reading.door, tilt: reading.tilt }, causes: evaluation.causes },
      };
      return [alert, ...list];
    });
  }, [issueId]);

  /* ─── Assets with live status ───────────────────────────── */
  const assets = useMemo(() => {
    const active = alerts.filter(isActive);
    return assetsSeed.map((a) => {
      const own = active.filter((x) => x.assetId === a.id);
      const cut = own.some((x) => x.type === 'cable_cut');
      const lighting = a.type === 'streetlight' && cut ? 'out' : a.lighting;
      let status = 'normal';
      if (own.some((x) => x.level === 'HIGH')) status = 'alert';
      else if (own.length) status = 'watch';
      else if (a.sensor === 'offline') status = 'offline';
      else if (lighting === 'out') status = 'watch';
      return { ...a, lighting, status, openAlerts: own };
    });
  }, [alerts]);

  /* ─── Scrap registry ────────────────────────────────────── */
  const transactions = useMemo(
    () => [...transactionsSeed, ...submitted].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
    [submitted],
  );
  const screening = useMemo(() => screenTransactions(transactions), [transactions]);
  const reviewOf = useCallback((id) => reviews[id] || { status: 'pending' }, [reviews]);

  const submitTransaction = useCallback((tx) => {
    setSubmitted((list) => [...list, tx]);
    log({ kind: 'scrap', id: tx.id, status: 'submitted' });
  }, [log]);

  const setReview = useCallback((id, status, note) => {
    setReviews((r) => ({ ...r, [id]: { status, note, at: new Date().toISOString() } }));
    log({ kind: 'review', id, status, note });
  }, [log]);

  /* ─── Risk model (trained in the browser after first paint) ─ */
  const ctx = useMemo(() => buildContext({ zones, assets: assetsSeed, incidents, outages, dealers }), []);
  useEffect(() => {
    const id = setTimeout(() => setModel(trainRiskModel(ctx, Date.now())), 30);
    return () => clearTimeout(id);
  }, [ctx]);

  const liveKey = useMemo(() => {
    const lightsOut = {};
    const darkIds = {};
    const extraIncidents = {};
    zones.forEach((z) => {
      const sl = assets.filter((a) => a.zone === z.id && a.type === 'streetlight');
      darkIds[z.id] = sl.filter((a) => a.lighting === 'out').map((a) => a.id);
      lightsOut[z.id] = darkIds[z.id].length / sl.length;
      // Live HIGH alerts count as recent incidents (pilot alerts are already in the incident history).
      extraIncidents[z.id] = liveAlerts.filter((a) => a.zone === z.id && a.level === 'HIGH' && a.status !== 'false_alarm').map((a) => Date.parse(a.createdAt));
    });
    return JSON.stringify({ lightsOut, darkIds, extraIncidents });
  }, [assets, liveAlerts]);

  const risk = useMemo(() => {
    if (!model) return { ready: false };
    const live = JSON.parse(liveKey);
    const forecast = runForecast(ctx, model, Date.now(), live);
    const route = patrolRoute(forecast, assets, meta.patrolBase);
    return { ready: true, model, forecast, route, live };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, liveKey, ctx]);

  /* ─── KPIs ──────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const now = Date.now();
    const today = alerts.filter((a) => sameMytDay(a.createdAt, now));
    const flagged = transactions.filter((t) => screening[t.id]?.suspicious);
    return {
      alertsToday: today.length,
      highToday: today.filter((a) => a.level === 'HIGH').length,
      activeAlerts: alerts.filter(isActive).length,
      assetsAtRisk: assets.filter((a) => a.status !== 'normal').length,
      lossAvoidedRM: alerts.filter((a) => a.status === 'intercepted').reduce((s, a) => s + (a.estimatedLossRM || 0), 0),
      intercepted: alerts.filter((a) => a.status === 'intercepted').length,
      flagged: flagged.length,
      flaggedPending: flagged.filter((t) => reviewOf(t.id).status === 'pending').length,
    };
  }, [alerts, assets, transactions, screening, reviewOf]);

  /* ─── Header notifications and AI insights ──────────────── */
  const notifications = useMemo(() => {
    const list = alerts.filter(isActive).map((a) => ({
      id: a.id, tone: a.level === 'HIGH' ? 'danger' : 'warning', title: a.title,
      message: `${a.message} (${zoneName(a.zone)})`, createdAt: a.createdAt, read: readIds.includes(a.id),
    }));
    if (kpis.flaggedPending) {
      list.push({
        id: `scrap-${kpis.flaggedPending}`, tone: 'info', title: `${kpis.flaggedPending} suspicious scrap sales awaiting PDRM review`,
        message: 'Open the Scrap Registry review queue.', createdAt: new Date().toISOString(), read: readIds.includes(`scrap-${kpis.flaggedPending}`),
      });
    }
    return list;
  }, [alerts, readIds, kpis.flaggedPending]);

  const markRead = useCallback((id) => setReadIds((r) => (r.includes(id) ? r : [...r, id])), []);

  const insights = useMemo(() => {
    const out = [];
    const top = risk.ready ? risk.forecast[0] : null;
    if (top) {
      const stops = risk.route.stops.filter((s) => s.zone === top.zone);
      out.push({
        id: `INS-RISK-${top.zone}`, kind: 'risk', priority: top.band === 'High' ? 'high' : 'medium', category: 'Hotspot forecast',
        title: `${zoneName(top.zone)} is ${top.band} risk this week (${top.risk.toFixed(2)}): patrol before ${String(top.peak.hour).padStart(2, '0')}:00`,
        causes: top.reasons.map((r) => [r.label, r.text]),
        evidence: risk.forecast.map((f) => `${zoneName(f.zone)}: ${f.risk.toFixed(2)} (${f.band})`),
        recommendations: [
          `Patrol stops: ${stops.map((s) => s.asset.id).join(', ')}`,
          risk.route.revisit ? `Second pass at ${zoneName(risk.route.revisit.zone)} around ${String(risk.route.revisit.hour).padStart(2, '0')}:00` : 'Single pass is enough this week',
          'Restore dark streetlights first; dark stretches drive the score',
        ],
        impact: `Covers the zone with the highest predicted risk across ${risk.route.km} km of patrol`,
        actions: ['dispatch', 'task'],
      });
    }
    alerts.filter((a) => isActive(a) && a.level === 'HIGH').slice(0, 3).forEach((a) => {
      out.push({
        id: `INS-AL-${a.id}`, kind: 'alert', alertId: a.id, priority: 'critical', category: 'Live alert',
        title: `${a.title}: respond now`,
        causes: [['Detected', `${a.message} at ${formatMyt(a.createdAt, 'short')}`], ['Zone', zones.find((z) => z.id === a.zone)?.name]],
        evidence: [`Source: ${a.source.toUpperCase()}`, a.score != null ? `Threat score ${a.score}/100` : `Estimated asset value ${formatRM(a.estimatedLossRM)}`],
        recommendations: ['Dispatch the nearest patrol', 'Notify PDRM if people are still on site', 'Generate a police report once the site is secured'],
        impact: `Up to ${formatRM(a.estimatedLossRM)} of loss avoided if intercepted`,
        actions: ['dispatch', 'notify'],
      });
    });
    if (kpis.flaggedPending) {
      out.push({
        id: 'INS-SCRAP', kind: 'scrap', priority: 'medium', category: 'Resale channel',
        title: `${kpis.flaggedPending} flagged scrap sales are waiting for PDRM review`,
        causes: [['Why', 'Copper cable over 50 kg, repeat sellers, weight outliers and cable photos were flagged automatically.']],
        evidence: transactions.filter((t) => screening[t.id]?.suspicious && reviewOf(t.id).status === 'pending').slice(-4).map((t) => `${t.id}: ${t.material} ${t.weightKg} kg`),
        recommendations: ['Review the queue in the Scrap Registry', 'Refer the sales linked to recent thefts to PDRM'],
        impact: 'Disrupts the resale channel for stolen copper',
        actions: ['notify'],
      });
    }
    return out;
  }, [risk, alerts, kpis.flaggedPending, transactions, screening, reviewOf]);

  const runAction = useCallback(async (insightId, action, values) => {
    const ins = insights.find((i) => i.id === insightId);
    if (ins?.alertId && action === 'dispatch') setAlertStatus(ins.alertId, 'dispatched', `${values.team}: ${values.notes || 'patrol dispatched'}`);
    log({ kind: 'action', id: insightId, status: action, note: Object.values(values).filter(Boolean).join(' · ') });
  }, [insights, setAlertStatus, log]);

  const saveBrief = useCallback((eventId, brief) => setBriefs((b) => ({ ...b, [eventId]: brief })), []);

  const resetDemo = useCallback(() => { clearState(); window.location.reload(); }, []);

  const value = useMemo(() => ({
    meta, zones, cameras, dealers, incidents, outages, assets,
    alerts, addAlert, updateAlert, setAlertStatus, raiseSensorAlert,
    transactions, screening, reviews, reviewOf, setReview, submitTransaction,
    risk, kpis, llm, briefs, saveBrief, actionLog,
    notifications, markRead, insights, runAction, resetDemo,
  }), [assets, alerts, addAlert, updateAlert, setAlertStatus, raiseSensorAlert, transactions, screening, reviews, reviewOf, setReview,
    submitTransaction, risk, kpis, llm, briefs, saveBrief, actionLog, notifications, markRead, insights, runAction, resetDemo]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);
export { zoneName };
