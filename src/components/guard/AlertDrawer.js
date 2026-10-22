import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Drawer, DetailGrid, Button, Badge, Icon } from '../ui';
import { LevelBadge, StatusBadge, Ms } from './common';
import { TaskList } from './Tasks';
import { useData } from '../../data/DataProvider';
import { ASSET_TYPES, SOURCES, ALERT_STATUS, PATROL_TEAMS, formatRM } from '../../data/reference';
import { CAUSES } from '../../ai/anomaly';
import { formatMyt } from '../../ai/time';

const ACTIONS = [
  { status: 'acknowledged', label: 'Acknowledge', labelMs: 'Akui', variant: 'secondary', icon: 'check' },
  { status: 'dispatched', label: 'Dispatch patrol', labelMs: 'Hantar rondaan', variant: 'primary', icon: 'truck' },
  { status: 'intercepted', label: 'Intercepted, no loss', labelMs: 'Dihalang', variant: 'soft', icon: 'shield' },
  { status: 'confirmed_theft', label: 'Theft confirmed', labelMs: 'Kecurian disahkan', variant: 'danger', icon: 'alert' },
  { status: 'false_alarm', label: 'False alarm', labelMs: 'Amaran palsu', variant: 'ghost', icon: 'close' },
  { status: 'resolved', label: 'Resolved, not theft', labelMs: 'Selesai', variant: 'ghost', icon: 'check' },
];

const LOG_TEXT = { raised: 'Alert raised' };

/** Alert detail with evidence and the response workflow. */
export default function AlertDrawer({ alertId, onClose, onOpenAsset, onOpenTask }) {
  const navigate = useNavigate();
  const { alerts, assets, zones, tasks, actionLog, setAlertStatus } = useData();
  const [note, setNote] = useState('');
  const [team, setTeam] = useState(PATROL_TEAMS[0]);
  const [done, setDone] = useState(null);
  const alert = alerts.find((a) => a.id === alertId);
  if (!alert) return null;
  const asset = assets.find((a) => a.id === alert.assetId);
  const zone = zones.find((z) => z.id === alert.zone);
  const ev = alert.evidence || {};
  const linkedTasks = tasks.filter((t) => t.alertId === alert.id);
  const history = actionLog.filter((e) => e.kind === 'alert' && e.id === alert.id).slice().reverse();

  const act = (status) => {
    const existing = linkedTasks.find((t) => t.kind === 'patrol' && ['open', 'in_progress'].includes(t.status));
    const taskId = setAlertStatus(alert.id, status, note.trim() || undefined, { team });
    setNote('');
    if (taskId) setDone(`${ALERT_STATUS[status].label}: patrol ${taskId} created for ${team}`);
    else if (status === 'dispatched' && existing) setDone(`${ALERT_STATUS[status].label}: ${existing.id} (${existing.team}) is already on it`);
    else if (existing && !ALERT_STATUS[status].active) setDone(`Status set to ${ALERT_STATUS[status].label}; ${existing.id} marked done`);
    else setDone(`Status set to ${ALERT_STATUS[status].label}`);
  };

  return (
    <Drawer
      width={520}
      eyebrow={`${SOURCES[alert.source]?.label} · ${alert.id}`}
      title={alert.title}
      subtitle={`${formatMyt(alert.createdAt)} MYT`}
      headerExtra={<LevelBadge level={alert.level} withMs />}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto"><StatusBadge status={alert.status} /></span>
          {asset && onOpenAsset && <Button variant="secondary" icon="pin" onClick={() => onOpenAsset(asset.id)}>Asset twin</Button>}
          <Button variant="accent" icon="fileText" disabled={alert.status === 'false_alarm'} title={alert.status === 'false_alarm' ? 'Closed as a false alarm: no police report needed' : undefined}
            onClick={() => navigate(`/reports?event=${alert.id}`)}>Police report</Button>
        </>
      }
    >
      <div className="space-y-4">
        {ev.snapshot && (
          <figure>
            <img src={ev.snapshot} alt={`CCTV snapshot for ${alert.id}`} className="w-full rounded-lg border" />
            <figcaption className="text-[10px] text-fg-faint mt-1">
              Snapshot with detections and asset zone · {ev.sample ? `sample footage from ${ev.sample.camera} (${ev.sample.site}, recorded ${ev.sample.recorded}, ${ev.sample.license}), not a DBKU camera` : ev.cameraId || 'uploaded footage'}
            </figcaption>
          </figure>
        )}
        {ev.snapshotDropped && <p className="tile text-[11px] text-fg-faint">Snapshot removed to free browser storage.</p>}

        <p className="text-sm text-fg">{alert.message}</p>

        <DetailGrid items={[
          { label: 'Asset', value: asset ? <>{asset.id}<br /><span className="text-[11px] font-normal text-fg-faint">{ASSET_TYPES[asset.type].label} · {asset.road}</span></> : alert.assetId },
          { label: 'Zone', value: zone?.short },
          { label: alert.source === 'cctv' ? 'Threat score' : 'Detector', value: alert.score != null ? `${alert.score} / 100` : ev.causes?.length ? ev.causes.map((c) => CAUSES[c]?.label || c).join(', ') : '—' },
          { label: 'Estimated loss at stake', value: formatRM(alert.estimatedLossRM) },
        ]} />

        {ev.factors && (
          <div className="tile">
            <p className="label-caps mb-2">Threat factors {ev.cameraId && <Ms>· {ev.cameraId}</Ms>}</p>
            <ul className="space-y-1">
              {ev.factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0"><span className={f.met ? 'text-fg' : 'text-fg-faint line-through'}>{f.label}</span><span className="block text-[10px] text-fg-faint">{f.detail}</span></span>
                  <span className={f.met ? 'font-bold text-fg' : 'text-fg-faint'}>{f.met ? `+${f.points}` : '0'}</span>
                </li>
              ))}
            </ul>
            {ev.detections?.length > 0 && <p className="text-[11px] text-fg-faint mt-2">Detections: {ev.detections.map((d) => `${d.class} ${Math.round(d.score * 100)}%`).join(', ')}</p>}
          </div>
        )}

        {ev.sensor && (
          <div className="tile">
            <p className="label-caps mb-2">Sensor reading · {ev.simulated ? 'simulated clock' : 'sensor time'} {formatMyt(ev.sensor.simTime, 'short')}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <span className="text-fg-faint">Current</span><span className="text-fg font-semibold">{ev.sensor.current} A (expected {ev.sensor.expected} A)</span>
              <span className="text-fg-faint">Rolling z-score</span><span className="text-fg font-semibold">{ev.sensor.z}</span>
              <span className="text-fg-faint">Door</span><span className="text-fg font-semibold">{ev.sensor.door == null ? 'n/a' : ev.sensor.door ? 'OPEN' : 'closed'}</span>
              <span className="text-fg-faint">Tilt</span><span className="text-fg font-semibold">{ev.sensor.tilt == null ? 'n/a' : `${ev.sensor.tilt}°`}</span>
            </div>
          </div>
        )}

        {alert.pilot && <Badge tone="neutral">Pilot log entry (mock data)</Badge>}
        {ev.simulated && <Badge tone="warning">Raised in simulation mode</Badge>}
        {ev.sample && <Badge tone="warning">Raised from sample footage (MEVA dataset)</Badge>}
        {alert.note && <p className="tile text-xs"><span className="label-caps mr-2">Note</span>{alert.note}</p>}

        <div className="space-y-2">
          <p className="label-caps">Patrols and tasks <Ms>Tindakan susulan</Ms></p>
          <TaskList tasks={linkedTasks} onSelect={(id) => (onOpenTask ? onOpenTask(id) : navigate(`/operations?task=${id}`))} emptyText="None yet. Dispatching a patrol creates one." />
        </div>

        {history.length > 0 && (
          <div>
            <p className="label-caps mb-1.5">Log</p>
            <ul className="space-y-1">
              {history.map((h, i) => (
                <li key={i} className="text-[11px] text-fg-muted flex gap-2">
                  <span className="font-mono text-fg-faint shrink-0">{formatMyt(h.at, 'short')}</span>
                  <span>{LOG_TEXT[h.status] || ALERT_STATUS[h.status]?.label || h.status}{h.note ? `: ${h.note}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pt-3 border-t space-y-2">
          <p className="label-caps">Response <Ms>Tindakan</Ms></p>
          <textarea className="textarea" rows={2} placeholder="Note for the log (optional)…" value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="flex items-center gap-2 text-xs">
            <span className="label-caps shrink-0">Patrol team</span>
            <select className="select select-sm flex-1" value={team} onChange={(e) => setTeam(e.target.value)}>
              {PATROL_TEAMS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {ACTIONS.map((a) => (
              <Button key={a.status} variant={a.variant} icon={a.icon} disabled={alert.status === a.status}
                onClick={() => act(a.status)} className="justify-start" title={a.labelMs}>
                {a.label}
              </Button>
            ))}
          </div>
          {done && <p className="tile tone-success text-[11px] font-semibold">✓ {done}</p>}
          <p className="text-[10px] text-fg-faint flex items-center gap-1"><Icon name="info" size={12} />Marking an alert intercepted adds its value to “RM loss avoided”. Closing an alert completes its open patrol.</p>
        </div>
      </div>
    </Drawer>
  );
}
