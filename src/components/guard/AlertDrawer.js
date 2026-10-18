import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Drawer, DetailGrid, Button, Badge, Icon } from '../ui';
import { LevelBadge, StatusBadge, Ms } from './common';
import { useData } from '../../data/DataProvider';
import { ASSET_TYPES, SOURCES, formatRM } from '../../data/reference';
import { formatMyt } from '../../ai/time';

const ACTIONS = [
  { status: 'acknowledged', label: 'Acknowledge', labelMs: 'Akui', variant: 'secondary', icon: 'check' },
  { status: 'dispatched', label: 'Dispatch patrol', labelMs: 'Hantar rondaan', variant: 'primary', icon: 'truck' },
  { status: 'intercepted', label: 'Intercepted, no loss', labelMs: 'Dihalang', variant: 'soft', icon: 'shield' },
  { status: 'confirmed_theft', label: 'Theft confirmed', labelMs: 'Kecurian disahkan', variant: 'danger', icon: 'alert' },
  { status: 'false_alarm', label: 'False alarm', labelMs: 'Amaran palsu', variant: 'ghost', icon: 'close' },
];

/** Alert detail with evidence and the response workflow. */
export default function AlertDrawer({ alertId, onClose }) {
  const navigate = useNavigate();
  const { alerts, assets, zones, setAlertStatus } = useData();
  const [note, setNote] = useState('');
  const alert = alerts.find((a) => a.id === alertId);
  if (!alert) return null;
  const asset = assets.find((a) => a.id === alert.assetId);
  const zone = zones.find((z) => z.id === alert.zone);
  const ev = alert.evidence || {};

  const act = (status) => { setAlertStatus(alert.id, status, note || undefined); setNote(''); };

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
          <Button variant="accent" icon="fileText" onClick={() => navigate(`/reports?event=${alert.id}`)}>Police report</Button>
        </>
      }
    >
      <div className="space-y-4">
        {ev.snapshot && (
          <figure>
            <img src={ev.snapshot} alt={`CCTV snapshot for ${alert.id}`} className="w-full rounded-lg border" />
            <figcaption className="text-[10px] text-fg-faint mt-1">Snapshot with detections and asset zone · {ev.cameraId || 'uploaded footage'}</figcaption>
          </figure>
        )}
        {ev.snapshotDropped && <p className="tile text-[11px] text-fg-faint">Snapshot removed to free browser storage.</p>}

        <p className="text-sm text-fg">{alert.message}</p>

        <DetailGrid items={[
          { label: 'Asset', value: asset ? <>{asset.id}<br /><span className="text-[11px] font-normal text-fg-faint">{ASSET_TYPES[asset.type].label} · {asset.road}</span></> : alert.assetId },
          { label: 'Zone', value: zone?.short },
          { label: alert.source === 'cctv' ? 'Threat score' : 'Detector', value: alert.score != null ? `${alert.score} / 100` : ev.sensor ? `z = ${ev.sensor.z}` : '—' },
          { label: 'Estimated loss at stake', value: formatRM(alert.estimatedLossRM) },
        ]} />

        {ev.factors && (
          <div className="tile">
            <p className="label-caps mb-2">Threat factors</p>
            <ul className="space-y-1">
              {ev.factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between text-xs">
                  <span className={f.met ? 'text-fg' : 'text-fg-faint line-through'}>{f.label}</span>
                  <span className={f.met ? 'font-bold text-fg' : 'text-fg-faint'}>{f.met ? `+${f.points}` : '0'}</span>
                </li>
              ))}
            </ul>
            {ev.detections?.length > 0 && <p className="text-[11px] text-fg-faint mt-2">Detections: {ev.detections.map((d) => `${d.class} ${Math.round(d.score * 100)}%`).join(', ')}</p>}
          </div>
        )}

        {ev.sensor && (
          <div className="tile">
            <p className="label-caps mb-2">Sensor reading (sensor time {formatMyt(ev.sensor.simTime, 'short')})</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <span className="text-fg-faint">Current</span><span className="text-fg font-semibold">{ev.sensor.current} A (expected {ev.sensor.expected} A)</span>
              <span className="text-fg-faint">Rolling z-score</span><span className="text-fg font-semibold">{ev.sensor.z}</span>
              <span className="text-fg-faint">Door</span><span className="text-fg font-semibold">{ev.sensor.door == null ? 'n/a' : ev.sensor.door ? 'OPEN' : 'closed'}</span>
              <span className="text-fg-faint">Tilt</span><span className="text-fg font-semibold">{ev.sensor.tilt == null ? 'n/a' : `${ev.sensor.tilt}°`}</span>
            </div>
          </div>
        )}

        {alert.pilot && <Badge tone="neutral">Pilot log entry (mock data)</Badge>}
        {alert.note && <p className="tile text-xs"><span className="label-caps mr-2">Note</span>{alert.note}</p>}

        <div className="pt-3 border-t space-y-2">
          <p className="label-caps">Response <Ms>Tindakan</Ms></p>
          <textarea className="textarea" rows={2} placeholder="Note for the log (optional)…" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            {ACTIONS.map((a) => (
              <Button key={a.status} variant={a.variant} icon={a.icon} disabled={alert.status === a.status}
                onClick={() => act(a.status)} className="justify-start" title={a.labelMs}>
                {a.label}
              </Button>
            ))}
          </div>
          <p className="text-[10px] text-fg-faint flex items-center gap-1"><Icon name="info" size={12} />Marking an alert intercepted adds its value to “RM loss avoided”.</p>
        </div>
      </div>
    </Drawer>
  );
}
