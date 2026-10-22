import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from './DataProvider';
import { buildHistory, simulateReading, INTERVAL_MS } from '../ai/sensorSim';
import { evaluateReading } from '../ai/anomaly';
import { atMytHour, DAY, isNight } from '../ai/time';
import { hashString } from '../ai/random';

/* Runs the simulated sensor network for the whole app and feeds tamper
   detections to DataProvider. Kept in its own context so the frequent ticks
   only re-render pages that show live readings.

   Live mode (default): the sensor clock is the real clock. Each asset
   reports every 5 minutes on the 5-minute mark, and a sensor whose state
   changes (an injected fault) sends an event report straight away.
   Simulation mode: the clock runs fast (5 simulated minutes per tick) or
   jumps ahead, e.g. to 23:00 to show night-only rules. Alerts raised then
   are marked as simulated. "Return to live" re-syncs with the real clock. */

const SensorContext = createContext(null);
const MAX_HISTORY = 300;
export const SPEEDS = [
  { value: 1000, label: '5 min / 1 s' },
  { value: 2000, label: '5 min / 2 s' },
  { value: 5000, label: '5 min / 5 s' },
];
const nextSlot = (t) => Math.floor(t / INTERVAL_MS) * INTERVAL_MS + INTERVAL_MS;

function seedHistory(asset, end) {
  const h = buildHistory([asset], end, hashString(asset.id)).history[asset.id];
  h.forEach((r, i) => { r.z = evaluateReading(asset, h.slice(Math.max(0, i - 40), i), r).z; });
  return h;
}

function freshSim(online, now) {
  const { history, lastTime, rand } = buildHistory(online, now, 7);
  // Score the seeded history too, so charts show z for every reading.
  for (const a of online) {
    const h = history[a.id];
    h.forEach((r, i) => { r.z = evaluateReading(a, h.slice(Math.max(0, i - 40), i), r).z; });
  }
  return { history, time: lastTime, rand, faults: {}, evals: {}, events: [], profiles: {} };
}

export function SensorProvider({ children }) {
  const { assets, raiseSensorAlert } = useData();
  const online = useMemo(() => assets.filter((a) => a.sensor !== 'offline'), [assets]);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const raiseRef = useRef(raiseSensorAlert);
  raiseRef.current = raiseSensorAlert;

  const sim = useRef(null);
  if (!sim.current) sim.current = freshSim(online, Date.now());
  const [version, setVersion] = useState(0);
  const [mode, setMode] = useState('live');          // 'live' | 'sim'
  const [running, setRunning] = useState(true);       // simulation mode only
  const [speedMs, setSpeedMs] = useState(2000);
  const [randomEvents, setRandomEvents] = useState(false);
  const randomRef = useRef(randomEvents);
  randomRef.current = randomEvents;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /** Takes one reading from every online asset at time t. */
  const readAt = useCallback((t) => {
    const s = sim.current;
    s.time = t;
    const assetsNow = onlineRef.current;
    const simulated = modeRef.current === 'sim';

    // Optional demo mode: occasional random tampering, mostly at night.
    if (randomRef.current && s.rand() < (isNight(t) ? 0.03 : 0.006)) {
      const a = assetsNow[Math.floor(s.rand() * assetsNow.length)];
      const types = a.type === 'cable' ? ['cable_cut', 'tapping'] : ['cable_cut', 'panel_open', 'pole_struck', 'tapping'];
      s.faults[a.id] = { type: types[Math.floor(s.rand() * types.length)], since: t, until: t + 6 * INTERVAL_MS, random: true };
    }

    for (const a of assetsNow) {
      const fault = s.faults[a.id];
      if (fault?.until && t > fault.until) delete s.faults[a.id];
      // An asset whose feed was just restored, or whose dark lamp was repaired,
      // starts again from a day of readings on its new load profile.
      const profile = a.lightingSince ? 'logged-dark' : 'normal';
      if (!s.history[a.id] || (s.profiles[a.id] && s.profiles[a.id] !== profile)) s.history[a.id] = seedHistory(a, t);
      s.profiles[a.id] = profile;
      const h = s.history[a.id];
      const reading = simulateReading(a, t, s.rand, s.faults[a.id]);
      const evaluation = evaluateReading(a, h, reading);
      reading.z = evaluation.z;
      h.push(reading);
      if (h.length > MAX_HISTORY) h.shift();
      s.evals[a.id] = { ...evaluation, reading };
      if (evaluation.tamper) {
        evaluation.causes.forEach((cause) => raiseRef.current({ asset: a, reading, evaluation, cause, simulated }));
        s.events.unshift({ t, assetId: a.id, causes: evaluation.causes, z: evaluation.z, simulated });
      } else if (evaluation.doorOpenDaytime) {
        s.events.unshift({ t, assetId: a.id, causes: ['door_open_daytime'], z: evaluation.z, simulated });
      }
    }
    s.events = s.events.slice(0, 80);
  }, []);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Live: catch up with the real clock on every 5-minute mark.
  useEffect(() => {
    if (mode !== 'live') return undefined;
    const catchUp = () => {
      let changed = false;
      while (nextSlot(sim.current.time) <= Date.now()) { readAt(nextSlot(sim.current.time)); changed = true; }
      if (changed) bump();
    };
    catchUp();
    const id = setInterval(catchUp, 1000);
    return () => clearInterval(id);
  }, [mode, readAt, bump]);

  // Simulation: 5 simulated minutes per tick.
  useEffect(() => {
    if (mode !== 'sim' || !running) return undefined;
    const id = setInterval(() => { readAt(nextSlot(sim.current.time)); bump(); }, speedMs);
    return () => clearInterval(id);
  }, [mode, running, speedMs, readAt, bump]);

  /** Injects a fault. The sensor reports the change at once (live) or on the next simulated reading. */
  const injectFault = useCallback((assetId, type) => {
    const s = sim.current;
    const t = modeRef.current === 'live' ? Math.max(Date.now(), s.time + 1000) : nextSlot(s.time);
    s.faults[assetId] = { type, since: t };
    readAt(t);
    bump();
  }, [readAt, bump]);

  const clearFault = useCallback((assetId) => {
    delete sim.current.faults[assetId];
    bump();
  }, [bump]);

  const clearAllFaults = useCallback(() => {
    sim.current.faults = {};
    bump();
  }, [bump]);

  /** Switches to simulation and fast-forwards to the next occurrence of an MYT hour. */
  const jumpTo = useCallback((hour) => {
    setMode('sim');
    modeRef.current = 'sim';
    const s = sim.current;
    let target = atMytHour(s.time, hour);
    if (target <= s.time) target += DAY;
    while (nextSlot(s.time) <= target) readAt(nextSlot(s.time));
    bump();
  }, [readAt, bump]);

  const startSimulation = useCallback(() => { setMode('sim'); setRunning(true); }, []);

  /** Back to the real clock: fresh history up to now; injected faults stay in place. */
  const goLive = useCallback(() => {
    const faults = sim.current.faults;
    sim.current = { ...freshSim(onlineRef.current, Date.now()), faults };
    setMode('live');
    setRunning(true);
    bump();
  }, [bump]);

  const value = useMemo(() => ({
    version,
    time: sim.current.time,
    history: sim.current.history,
    evals: sim.current.evals,
    faults: sim.current.faults,
    events: sim.current.events,
    online,
    mode, live: mode === 'live',
    running, setRunning, speedMs, setSpeedMs, randomEvents, setRandomEvents,
    injectFault, clearFault, clearAllFaults, jumpTo, startSimulation, goLive,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [version, online, mode, running, speedMs, randomEvents, injectFault, clearFault, clearAllFaults, jumpTo, startSimulation, goLive]);

  return <SensorContext.Provider value={value}>{children}</SensorContext.Provider>;
}

export const useSensors = () => useContext(SensorContext);
