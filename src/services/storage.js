/* Browser persistence for what operators create in the prototype (alerts,
   scrap submissions, review decisions, generated briefs). Seed data always
   comes from src/data/mock, so clearing this only removes session work. */

const KEY = 'guardgrid:v1';

export function loadState() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch (e) {
    return {};
  }
}

/** Saves; on a quota error drops snapshots from the oldest alerts and retries. */
export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    const alerts = [...(state.alerts || [])];
    for (let i = alerts.length - 1; i >= 0; i--) {
      if (!alerts[i].evidence?.snapshot) continue;
      alerts[i] = { ...alerts[i], evidence: { ...alerts[i].evidence, snapshot: null, snapshotDropped: true } };
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...state, alerts }));
        return true;
      } catch (err) { /* keep dropping */ }
    }
    return false;
  }
}

export function clearState() {
  try { localStorage.removeItem(KEY); } catch (e) { /* storage unavailable */ }
}
