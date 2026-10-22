import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import metaSeed from './mock/meta.json';
import zones from './mock/zones.json';
import assetsJson from './mock/assets.json';
import cameras from './mock/cameras.json';
import dealers from './mock/dealers.json';
import incidentsJson from './mock/incidents.json';
import outagesJson from './mock/outages.json';
import transactionsJson from './mock/transactions.json';
import alertsJson from './mock/alerts.json';
import tasksJson from './mock/tasks.json';
import { rebaseSeed } from './rebase';
import { buildNetwork } from './network';
import { loadState, saveState, clearState } from '../services/storage';
import { getLlmStatus } from '../services/llm';
import { screenTransactions } from '../ai/scrapScreening';
import { buildContext, trainRiskModel, forecast as runForecast, patrolRoute } from '../ai/riskModel';
import { estimateLoss } from '../ai/linking';
import { CAUSES } from '../ai/anomaly';
import { scoreObservation } from '../ai/threatScore';
import { expectedCurrent, expectedState, noiseLevel, baseTilt } from '../ai/sensorSim';
import { sameMytDay, formatMyt, mytParts, mytDayStart, isNight } from '../ai/time';
import { isActive, formatRM, ALERT_STATUS, TASK_KINDS } from './reference';

/* App-wide store. Seed data comes from src/data/mock (see
   scripts/generate-mock-data.js), moved to today's date by rebase.js; what
   operators create in the session (alerts, tasks, submissions, decisions) is
   kept in browser storage. */

const DataContext = createContext(null);

const SEED = rebaseSeed({
  meta: metaSeed, assets: assetsJson, incidents: incidentsJson, outages: outagesJson,
  transactions: transactionsJson, alerts: alertsJson, tasks: tasksJson,
});
const { meta, incidents, outages } = SEED;
const assetsSeed = SEED.assets;
const transactionsSeed = SEED.transactions;

/* Pilot alerts carry what the operator log recorded (`evidence.observed`).
   The threat factors, score, sensor reading and loss estimate are derived
   with the same rules as live alerts, so every screen and report agrees. */
function enrichPilotAlert(a) {
  const asset = assetsSeed.find((x) => x.id === a.assetId);
  const estimatedLossRM = estimateLoss({ asset, assets: assetsSeed, type: a.type }).totalRM;
  const obs = a.evidence?.observed || {};
  if (a.source === 'cctv') {
    const r = scoreObservation({ near: obs.objects, night: isNight(a.createdAt), dwellMinutes: obs.dwellMinutes, vehicleParked: obs.vehicleParked });
    return {
      ...a, level: r.level, score: r.score, estimatedLossRM,
      evidence: { ...a.evidence, factors: r.factors, capturedAt: a.createdAt, nightBasis: isNight(a.createdAt) ? 'capture time' : null },
    };
  }
  const t = Date.parse(a.createdAt);
  const expected = expectedCurrent(asset, t);
  const current = obs.current ?? expected;
  const z = (current - expected) / noiseLevel(asset, expectedState(asset, t));
  return {
    ...a, score: null, estimatedLossRM,
    evidence: {
      ...a.evidence,
      causes: [a.type],
      sensor: {
        simTime: a.createdAt, current: +current.toFixed(3), expected: +expected.toFixed(3), z: +z.toFixed(2),
        door: asset.type === 'cable' ? null : obs.door ?? 0,
        tilt: asset.type === 'cable' ? null : obs.tilt ?? baseTilt(asset),
      },
    },
  };
}
const PILOT_ALERTS = SEED.alerts.map(enrichPilotAlert);

const zoneName = (id) => zones.find((z) => z.id === id)?.short || id;

function dayStamp() {
  const p = mytParts(Date.now());
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

// Alert states that end the response (any linked patrol is then complete).
const CLOSED = Object.entries(ALERT_STATUS).filter(([, s]) => !s.active).map(([k]) => k);

export function DataProvider({ children }) {
  const saved = useRef(loadState()).current;
  const [liveAlerts, setLiveAlerts] = useState(saved.alerts || []);
  const [alertPatches, setAlertPatches] = useState(saved.alertPatches || {});
  const [liveTasks, setLiveTasks] = useState(saved.tasks || []);
  const [taskPatches, setTaskPatches] = useState(saved.taskPatches || {});
  const [readIds, setReadIds] = useState(saved.readIds || []);
  const [submitted, setSubmitted] = useState(saved.transactions || []);
  const [reviews, setReviews] = useState(saved.reviews || {});
  const [briefs, setBriefs] = useState(saved.briefs || {});
  const [actionLog, setActionLog] = useState(saved.actionLog || []);
  const [llm, setLlm] = useState({ enabled: false, checking: true });
  const [model, setModel] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    saveState({ alerts: liveAlerts, alertPatches, tasks: liveTasks, taskPatches, readIds, transactions: submitted, reviews, briefs, actionLog });
  }, [liveAlerts, alertPatches, liveTasks, taskPatches, readIds, submitted, reviews, briefs, actionLog]);

  useEffect(() => { getLlmStatus().then(setLlm); }, []);

  // "Today" figures and relative times refresh every minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  const today = mytDayStart(now);

  const log = useCallback((entry) => {
    setActionLog((l) => [{ at: new Date().toISOString(), ...entry }, ...l].slice(0, 300));
  }, []);

  /* ─── Ids ─────────────────────────────────────────────────── */
  // Issued synchronously so callers get them back immediately.
  const issued = useRef(new Set());
  const issueId = useCallback((prefix, taken) => {
    for (let n = 1; ; n++) {
      const id = `${prefix}-${dayStamp()}-${String(n).padStart(3, '0')}`;
      if (!issued.current.has(id) && !taken(id)) {
        issued.current.add(id);
        return id;
      }
    }
  }, []);

  /* ─── Tasks: patrols, PDRM notifications, work orders ───── */
  const liveTasksRef = useRef(liveTasks);
  liveTasksRef.current = liveTasks;
  const tasks = useMemo(() => [
    ...liveTasks,
    ...SEED.tasks.map((t) => ({ ...t, ...taskPatches[t.id] })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [liveTasks, taskPatches]);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  /** Creates a task and returns its id. */
  const createTask = useCallback((task) => {
    const prefix = TASK_KINDS[task.kind]?.prefix || 'TK';
    const id = issueId(prefix, (x) => liveTasksRef.current.some((t) => t.id === x));
    const at = new Date().toISOString();
    const status = task.status || 'open';
    const record = {
      priority: 'Normal', assetIds: [], alertId: null, details: '', ...task,
      id, status, createdAt: at, updatedAt: at,
      history: [{ at, status, note: task.historyNote || `Created from ${task.source || 'the command centre'}` }],
    };
    delete record.historyNote;
    setLiveTasks((list) => [record, ...list]);
    log({ kind: 'task', id, status, note: `${TASK_KINDS[task.kind]?.label}: ${task.title}` });
    return id;
  }, [issueId, log]);

  const updateTask = useCallback((id, status, note) => {
    const cur = tasksRef.current.find((t) => t.id === id);
    if (!cur || (cur.status === status && !note)) return;
    const at = new Date().toISOString();
    const patch = { status, updatedAt: at, history: [...cur.history, { at, status, note: note || null }] };
    if (liveTasksRef.current.some((t) => t.id === id)) {
      setLiveTasks((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    } else {
      setTaskPatches((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
    }
    log({ kind: 'task', id, status, note });
  }, [log]);

  /* ─── Alerts ─────────────────────────────────────────────── */
  const alerts = useMemo(() => [
    ...liveAlerts,
    ...PILOT_ALERTS.map((a) => ({ ...a, ...alertPatches[a.id] })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [liveAlerts, alertPatches]);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const liveRef = useRef(liveAlerts);
  liveRef.current = liveAlerts;
  const newAlertId = useCallback(() => issueId('AL', (x) => liveRef.current.some((a) => a.id === x)), [issueId]);

  /** Adds an alert and returns its id. */
  const addAlert = useCallback((alert) => {
    const id = alert.id || newAlertId();
    setLiveAlerts((list) => [{ status: 'open', createdAt: new Date().toISOString(), ...alert, id }, ...list]);
    log({ kind: 'alert', id, status: 'raised', note: alert.title });
    return id;
  }, [newAlertId, log]);

  const updateAlert = useCallback((id, patch) => {
    if (liveRef.current.some((a) => a.id === id)) {
      setLiveAlerts((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    } else {
      setAlertPatches((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
    }
  }, []);

  /**
   * Moves an alert through the response workflow. Dispatching creates a patrol
   * task; closing the alert completes any patrol still open for it.
   *   options: { team, priority } for a dispatch
   */
  const setAlertStatus = useCallback((id, status, note, options = {}) => {
    const alert = alertsRef.current.find((a) => a.id === id);
    if (!alert) return null;
    updateAlert(id, { status, ...(note ? { note } : {}), updatedAt: new Date().toISOString() });
    log({ kind: 'alert', id, status, note });
    const open = tasksRef.current.filter((t) => t.alertId === id && t.kind === 'patrol' && ['open', 'in_progress'].includes(t.status));
    let taskId = null;
    if (status === 'dispatched' && !open.length) {
      taskId = createTask({
        kind: 'patrol', title: `Respond to ${alert.title}`, team: options.team || 'DBKU Enforcement Unit A', priority: options.priority || 'Immediate',
        details: `${alert.message}.${note ? ` ${note}` : ''}`, assetIds: [alert.assetId], alertId: id, zone: alert.zone, source: `Alert ${id}`,
      });
    }
    if (CLOSED.includes(status)) open.forEach((t) => updateTask(t.id, 'done', `Alert closed: ${ALERT_STATUS[status].label}`));
    return taskId;
  }, [updateAlert, log, createTask, updateTask]);

  /** Called by the sensor simulation; one active alert per asset and cause. */
  const raiseSensorAlert = useCallback(({ asset, reading, evaluation, cause, simulated }) => {
    if (liveRef.current.some((a) => a.assetId === asset.id && a.type === cause && isActive(a))) return;
    const id = newAlertId();
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
        evidence: { simulated: Boolean(simulated), sensor: { simTime: reading.t, current: reading.current, expected: evaluation.expected, z: evaluation.z, door: reading.door, tilt: reading.tilt }, causes: evaluation.causes },
      };
      return [alert, ...list];
    });
    log({ kind: 'alert', id, status: 'raised', note: `${CAUSES[cause].label} · ${asset.id}` });
  }, [newAlertId, log]);

  /* ─── Assets with live status ───────────────────────────── */
  // A completed work order repairs its assets: lights back on, sensor feed restored.
  const repairedBy = useMemo(() => {
    const map = {};
    tasks.filter((t) => t.kind === 'work_order' && t.status === 'done').forEach((t) => t.assetIds.forEach((id) => { map[id] = t; }));
    return map;
  }, [tasks]);

  const assets = useMemo(() => {
    const active = alerts.filter(isActive);
    return assetsSeed.map((seed) => {
      const fix = repairedBy[seed.id];
      const a = fix && (seed.lighting === 'out' || seed.sensor === 'offline')
        ? { ...seed, lighting: seed.type === 'streetlight' ? 'on' : seed.lighting, sensor: 'online', lightingSince: undefined, lightingCause: undefined, sensorSince: undefined, sensorCause: undefined, repairedBy: fix.id, repairedAt: fix.updatedAt }
        : seed;
      const own = active.filter((x) => x.assetId === a.id);
      const cut = own.some((x) => x.type === 'cable_cut');
      const lighting = a.type === 'streetlight' && cut ? 'out' : a.lighting;
      let status = 'normal';
      let statusReason = 'Operating normally';
      const high = own.find((x) => x.level === 'HIGH');
      if (high) { status = 'alert'; statusReason = `${high.title} (${ALERT_STATUS[high.status].label.toLowerCase()})`; }
      else if (own.length) { status = 'watch'; statusReason = `${own[0].title} (${ALERT_STATUS[own[0].status].label.toLowerCase()})`; }
      else if (a.sensor === 'offline') { status = 'offline'; statusReason = a.sensorCause || 'No sensor feed'; }
      else if (lighting === 'out') { status = 'watch'; statusReason = `Streetlight dark: ${(a.lightingCause || 'cause not recorded').toLowerCase()}`; }
      if (status === 'normal' && a.repairedBy) statusReason = `Restored by ${a.repairedBy}`;
      return { ...a, lighting, status, statusReason, openAlerts: own };
    });
  }, [alerts, repairedBy]);

  /* ─── Scrap registry ────────────────────────────────────── */
  const transactions = useMemo(
    () => [...transactionsSeed, ...submitted].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
    [submitted],
  );
  const screening = useMemo(() => screenTransactions(transactions), [transactions]);
  const reviewOf = useCallback((id) => reviews[id] || { status: 'pending' }, [reviews]);

  const submitTransaction = useCallback((tx) => {
    setSubmitted((list) => [...list, tx]);
    log({ kind: 'scrap', id: tx.id, status: 'submitted', note: `${tx.material}, ${tx.weightKg} kg` });
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
    const at = Math.max(Date.now(), today);
    const forecast = runForecast(ctx, model, at, live);
    const route = patrolRoute(forecast, assets, meta.patrolBase);
    return { ready: true, model, forecast, route, live, start: mytDayStart(at), computedAt: at };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, liveKey, ctx, today]);

  /* ─── KPIs ──────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const todays = alerts.filter((a) => sameMytDay(a.createdAt, now));
    const flagged = transactions.filter((t) => screening[t.id]?.suspicious);
    const intercepted = alerts.filter((a) => a.status === 'intercepted');
    return {
      alertsToday: todays.length,
      highToday: todays.filter((a) => a.level === 'HIGH').length,
      activeAlerts: alerts.filter(isActive).length,
      assetsAtRisk: assets.filter((a) => a.status !== 'normal').length,
      byStatus: Object.fromEntries(['alert', 'watch', 'offline', 'normal'].map((s) => [s, assets.filter((a) => a.status === s).length])),
      darkLights: assets.filter((a) => a.lighting === 'out').length,
      sensorsOffline: assets.filter((a) => a.sensor === 'offline').length,
      lossAvoidedRM: intercepted.reduce((s, a) => s + (a.estimatedLossRM || 0), 0),
      intercepted: intercepted.length,
      flagged: flagged.length,
      flaggedPending: flagged.filter((t) => reviewOf(t.id).status === 'pending').length,
      openTasks: tasks.filter((t) => ['open', 'in_progress'].includes(t.status)).length,
    };
  }, [alerts, assets, transactions, screening, reviewOf, tasks, now]);

  /* ─── Header notifications and AI insights ──────────────── */
  const notifications = useMemo(() => {
    const list = alerts.filter(isActive).map((a) => ({
      id: a.id, tone: a.level === 'HIGH' ? 'danger' : 'warning', title: a.title,
      message: `${a.message} (${zoneName(a.zone)})`, createdAt: a.createdAt, read: readIds.includes(a.id),
      link: `/?alert=${a.id}`,
    }));
    const pending = transactions.filter((t) => screening[t.id]?.suspicious && reviewOf(t.id).status === 'pending');
    if (pending.length) {
      // The id changes with the count, so a new flagged sale shows the notice again.
      const id = `scrap-${pending.length}`;
      list.push({
        id, tone: 'info', title: `${pending.length} suspicious scrap sale${pending.length > 1 ? 's' : ''} awaiting PDRM review`,
        message: `Latest: ${pending[pending.length - 1].id}, ${pending[pending.length - 1].material} ${pending[pending.length - 1].weightKg} kg. Open the review queue.`,
        createdAt: pending[pending.length - 1].date, read: readIds.includes(id), link: '/scrap?view=queue',
      });
    }
    return list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [alerts, readIds, transactions, screening, reviewOf]);

  const markRead = useCallback((id) => setReadIds((r) => (r.includes(id) ? r : [...r, id])), []);
  const markAllRead = useCallback((ids) => setReadIds((r) => [...new Set([...r, ...ids])]), []);

  const insights = useMemo(() => {
    const out = [];
    const top = risk.ready ? risk.forecast[0] : null;
    if (top) {
      const stops = risk.route.stops.filter((s) => s.zone === top.zone);
      out.push({
        id: `INS-RISK-${top.zone}`, kind: 'risk', zone: top.zone, priority: top.band === 'High' ? 'high' : 'medium', category: 'Hotspot forecast',
        title: `${zoneName(top.zone)} is ${top.band} risk this week (${top.risk.toFixed(2)}): patrol before ${String(top.peak.hour).padStart(2, '0')}:00`,
        causes: top.reasons.map((r) => [r.label, r.text]),
        evidence: risk.forecast.map((f) => `${zoneName(f.zone)}: ${f.risk.toFixed(2)} (${f.band})`),
        recommendations: [
          `Patrol stops: ${stops.map((s) => `${s.asset.id} (ETA ${s.eta})`).join(', ')}`,
          risk.route.revisit ? `Second pass at ${zoneName(risk.route.revisit.zone)} around ${String(risk.route.revisit.hour).padStart(2, '0')}:00` : 'Single pass is enough this week',
          'Restore dark streetlights first; dark stretches drive the score',
        ],
        impact: `Covers the zone with the highest predicted risk on a ${risk.route.km} km night route`,
        actions: ['dispatch', 'task'],
        defaults: {
          dispatch: { notes: `Stops: ${stops.map((s) => `${s.asset.id} ${s.eta}`).join(', ')}` },
          task: { title: `Restore dark streetlights in ${zoneName(top.zone)}`, priority: 'High', details: `Dark: ${(risk.live.darkIds[top.zone] || []).join(', ') || 'none'}` },
        },
        assetIds: stops.map((s) => s.asset.id),
      });
    }
    alerts.filter((a) => isActive(a) && a.level === 'HIGH').slice(0, 3).forEach((a) => {
      out.push({
        id: `INS-AL-${a.id}`, kind: 'alert', alertId: a.id, zone: a.zone, priority: 'critical', category: 'Live alert',
        title: `${a.title}: respond now`,
        causes: [['Detected', `${a.message} at ${formatMyt(a.createdAt, 'short')}`], ['Zone', zones.find((z) => z.id === a.zone)?.name]],
        evidence: [`Source: ${a.source.toUpperCase()}`, a.score != null ? `Threat score ${a.score}/100` : `Estimated asset value ${formatRM(a.estimatedLossRM)}`],
        recommendations: ['Dispatch the nearest patrol', 'Notify PDRM if people are still on site', 'Generate a police report once the site is secured'],
        impact: `Up to ${formatRM(a.estimatedLossRM)} of loss avoided if intercepted`,
        actions: ['dispatch', 'notify'],
        defaults: { notify: { message: `${a.title}: ${a.message}. ${zones.find((z) => z.id === a.zone)?.name}.` } },
        assetIds: [a.assetId],
      });
    });
    if (kpis.flaggedPending) {
      const pending = transactions.filter((t) => screening[t.id]?.suspicious && reviewOf(t.id).status === 'pending');
      out.push({
        id: 'INS-SCRAP', kind: 'scrap', priority: 'medium', category: 'Resale channel',
        title: `${kpis.flaggedPending} flagged scrap sale${kpis.flaggedPending > 1 ? 's are' : ' is'} waiting for PDRM review`,
        causes: [['Why', 'Copper cable over 50 kg, repeat sellers, weight outliers and cable photos were flagged automatically.']],
        evidence: pending.slice(-4).map((t) => `${t.id}: ${t.material} ${t.weightKg} kg (${formatMyt(t.date, 'short')})`),
        recommendations: ['Review the queue in the Scrap Registry', 'Refer the sales linked to recent thefts to PDRM'],
        impact: 'Disrupts the resale channel for stolen copper',
        actions: ['notify'],
        defaults: { notify: { message: `${pending.length} flagged scrap sales for review: ${pending.map((t) => t.id).join(', ')}.` } },
        assetIds: [],
      });
    }
    // Tasks already raised from each insight.
    return out.map((ins) => ({ ...ins, actioned: tasks.filter((t) => t.insightId === ins.id || (ins.alertId && t.alertId === ins.alertId)) }));
  }, [risk, alerts, kpis.flaggedPending, transactions, screening, reviewOf, tasks]);

  /** Runs an AI-insight action; returns the id of the task it created. */
  const runAction = useCallback(async (insightId, action, values) => {
    const ins = insights.find((i) => i.id === insightId);
    if (!ins) return null;
    let id;
    if (action === 'dispatch' && ins.alertId) {
      id = setAlertStatus(ins.alertId, 'dispatched', values.notes || undefined, { team: values.team, priority: values.priority });
      if (!id) id = tasksRef.current.find((t) => t.alertId === ins.alertId && t.kind === 'patrol' && ['open', 'in_progress'].includes(t.status))?.id;
    } else if (action === 'dispatch') {
      id = createTask({
        kind: 'patrol', title: `Night patrol: ${zoneName(ins.zone)} hotspot`, team: values.team, priority: values.priority,
        details: values.notes, assetIds: ins.assetIds, zone: ins.zone, insightId, source: 'AI insight',
      });
    } else if (action === 'notify') {
      id = createTask({
        kind: 'pdrm', title: ins.kind === 'scrap' ? 'Flagged scrap sales for PDRM review' : `PDRM notification: ${ins.title.replace(/: respond now$/, '')}`,
        team: values.station, priority: 'Immediate', details: [values.channel, values.message].filter(Boolean).join(' · '),
        assetIds: ins.assetIds, alertId: ins.alertId || null, zone: ins.zone, insightId, source: 'AI insight',
      });
    } else {
      id = createTask({
        kind: 'work_order', title: values.title || ins.title, team: values.team, priority: values.priority, details: values.details,
        assetIds: ins.assetIds, zone: ins.zone, insightId, source: 'AI insight',
      });
    }
    return id;
  }, [insights, setAlertStatus, createTask]);

  const saveBrief = useCallback((eventId, brief) => {
    setBriefs((b) => ({ ...b, [eventId]: brief }));
    log({ kind: 'report', id: eventId, status: 'drafted', note: brief.brief?.model });
  }, [log]);

  const resetDemo = useCallback(() => { clearState(); window.location.reload(); }, []);

  const network = useMemo(() => buildNetwork(assets), [assets]);

  const value = useMemo(() => ({
    meta, zones, cameras, dealers, incidents, outages, assets, network, rebasedDays: SEED.offsetDays,
    alerts, addAlert, updateAlert, setAlertStatus, raiseSensorAlert,
    tasks, createTask, updateTask,
    transactions, screening, reviews, reviewOf, setReview, submitTransaction,
    risk, kpis, llm, briefs, saveBrief, actionLog, log, now,
    notifications, markRead, markAllRead, insights, runAction, resetDemo,
  }), [assets, network, alerts, addAlert, updateAlert, setAlertStatus, raiseSensorAlert, tasks, createTask, updateTask, transactions, screening, reviews,
    reviewOf, setReview, submitTransaction, risk, kpis, llm, briefs, saveBrief, actionLog, log, now, notifications, markRead, markAllRead,
    insights, runAction, resetDemo]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);
export { zoneName };
