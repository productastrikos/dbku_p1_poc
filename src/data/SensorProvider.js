import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from './DataProvider';
import { buildHistory, simulateReading, INTERVAL_MS } from '../ai/sensorSim';
import { evaluateReading } from '../ai/anomaly';
import { atMytHour, DAY, isNight } from '../ai/time';

/* Runs the simulated sensor network for the whole app (a reading per asset
   every 5 simulated minutes) and feeds tamper detections to DataProvider.
   Kept in its own context so the frequent ticks only re-render pages that
   show live readings. The simulation clock runs faster than real time;
   alerts carry the real time they were raised plus the sensor time. */

const SensorContext = createContext(null);
const MAX_HISTORY = 300;
export const SPEEDS = [
  { value: 1000, label: '5 min / 1 s' },
  { value: 2000, label: '5 min / 2 s' },
  { value: 5000, label: '5 min / 5 s' },
];

export function SensorProvider({ children }) {
  const { assets, raiseSensorAlert } = useData();
  const online = useMemo(() => assets.filter((a) => a.sensor !== 'offline'), [assets]);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const raiseRef = useRef(raiseSensorAlert);
  raiseRef.current = raiseSensorAlert;

  const sim = useRef(null);
  if (!sim.current) {
    const { history, lastTime, rand } = buildHistory(online, Date.now(), 7);
    // Score the seeded history too, so charts show z for every reading.
    for (const a of online) {
      const h = history[a.id];
      h.forEach((r, i) => { r.z = evaluateReading(a, h.slice(Math.max(0, i - 40), i), r).z; });
    }
    sim.current = { history, time: lastTime, rand, faults: {}, evals: {}, events: [] };
  }
  const [version, setVersion] = useState(0);
  const [running, setRunning] = useState(true);
  const [speedMs, setSpeedMs] = useState(2000);
  const [randomEvents, setRandomEvents] = useState(false);
  const randomRef = useRef(randomEvents);
  randomRef.current = randomEvents;

  const step = useCallback(() => {
    const s = sim.current;
    s.time += INTERVAL_MS;
    const assetsNow = onlineRef.current;

    // Optional demo mode: occasional random tampering, mostly at night.
    if (randomRef.current && s.rand() < (isNight(s.time) ? 0.03 : 0.006)) {
      const a = assetsNow[Math.floor(s.rand() * assetsNow.length)];
      const types = a.type === 'cable' ? ['cable_cut', 'tapping'] : ['cable_cut', 'panel_open', 'pole_struck', 'tapping'];
      s.faults[a.id] = { type: types[Math.floor(s.rand() * types.length)], since: s.time, until: s.time + 6 * INTERVAL_MS, random: true };
    }

    for (const a of assetsNow) {
      const fault = s.faults[a.id];
      if (fault?.until && s.time > fault.until) delete s.faults[a.id];
      const h = s.history[a.id] || (s.history[a.id] = []);
      const reading = simulateReading(a, s.time, s.rand, s.faults[a.id]);
      const evaluation = evaluateReading(a, h, reading);
      reading.z = evaluation.z;
      h.push(reading);
      if (h.length > MAX_HISTORY) h.shift();
      s.evals[a.id] = { ...evaluation, reading };
      if (evaluation.tamper) {
        evaluation.causes.forEach((cause) => raiseRef.current({ asset: a, reading, evaluation, cause }));
        s.events.unshift({ t: s.time, assetId: a.id, causes: evaluation.causes, z: evaluation.z });
      } else if (evaluation.doorOpenDaytime) {
        s.events.unshift({ t: s.time, assetId: a.id, causes: ['door_open_daytime'], z: evaluation.z });
      }
    }
    s.events = s.events.slice(0, 80);
  }, []);

  const tick = useCallback(() => { step(); setVersion((v) => v + 1); }, [step]);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(tick, speedMs);
    return () => clearInterval(id);
  }, [running, speedMs, tick]);

  /** Injects a fault; the next reading (taken immediately) carries it. */
  const injectFault = useCallback((assetId, type) => {
    sim.current.faults[assetId] = { type, since: sim.current.time + INTERVAL_MS };
    tick();
  }, [tick]);

  const clearFault = useCallback((assetId) => {
    delete sim.current.faults[assetId];
    setVersion((v) => v + 1);
  }, []);

  const clearAllFaults = useCallback(() => {
    sim.current.faults = {};
    setVersion((v) => v + 1);
  }, []);

  /** Fast-forwards the simulation to the next occurrence of an MYT hour. */
  const jumpTo = useCallback((hour) => {
    const s = sim.current;
    let target = atMytHour(s.time, hour);
    if (target <= s.time) target += DAY;
    while (s.time + INTERVAL_MS <= target) step();
    setVersion((v) => v + 1);
  }, [step]);

  const value = useMemo(() => ({
    version,
    time: sim.current.time,
    history: sim.current.history,
    evals: sim.current.evals,
    faults: sim.current.faults,
    events: sim.current.events,
    online,
    running, setRunning, speedMs, setSpeedMs, randomEvents, setRandomEvents,
    tick, injectFault, clearFault, clearAllFaults, jumpTo,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [version, online, running, speedMs, randomEvents, tick, injectFault, clearFault, clearAllFaults, jumpTo]);

  return <SensorContext.Provider value={value}>{children}</SensorContext.Provider>;
}

export const useSensors = () => useContext(SensorContext);
