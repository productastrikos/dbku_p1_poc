import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, StatGrid, StatCard, Card, Button, Badge, DataTable, Icon, Drawer, Tabs } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import AlertFeed from '../components/guard/AlertFeed';
import EntityDrawer from '../components/guard/EntityDrawer';
import { Title, Ms, Toggle } from '../components/guard/common';
import { useData, zoneName } from '../data/DataProvider';
import { useSensors, SPEEDS } from '../data/SensorProvider';
import { FAULTS, expectedCurrent, noiseLevel } from '../ai/sensorSim';
import { CAUSES, TAMPER_RULES } from '../ai/anomaly';
import { formatMyt, isNight } from '../ai/time';
import { ASSET_TYPES } from '../data/reference';

const WINDOW = 72; // readings shown (6 h)
const CAUSE_LABEL = { ...CAUSES, door_open_daytime: { label: 'Door open (daytime, no alert)', labelMs: 'Pintu dibuka (siang)' } };

function CauseBadges({ causes }) {
  if (!causes?.length) return <Badge tone="success" plain>NORMAL</Badge>;
  return causes.map((c) => <Badge key={c} tone={CAUSES[c]?.level === 'HIGH' ? 'danger' : 'warning'}>{CAUSE_LABEL[c]?.label || c}</Badge>);
}

export default function Sensors() {
  const { zones, alerts, assets } = useData();
  const offlineAssets = assets.filter((a) => a.sensor === 'offline');
  const offline = offlineAssets.length;
  const s = useSensors();
  const [params] = useSearchParams();
  const requested = params.get('asset');
  const [assetId, setAssetId] = useState(requested || 'SL-SEM-06');
  const [detail, setDetail] = useState(null);
  const [panel, setPanel] = useState(null);
  useEffect(() => { if (requested) setAssetId(requested); }, [requested]);
  const asset = s.online.find((a) => a.id === assetId) || s.online[0];
  const requestedOffline = requested && requested === assetId && !s.online.some((a) => a.id === requested);
  const hist = (s.history[asset.id] || []).slice(-WINDOW);
  const ev = s.evals[asset.id];
  const fault = s.faults[asset.id];
  const sensorAlerts = alerts.filter((a) => a.source === 'sensor' && ['open', 'acknowledged', 'dispatched'].includes(a.status));

  const labels = hist.map((r) => formatMyt(r.t, 'time'));
  const expected = hist.map((r) => +expectedCurrent(asset, r.t).toFixed(3));
  const sigma = hist.map((r) => TAMPER_RULES.z * noiseLevel(asset, r.state));
  const rows = s.online.map((a) => {
    const e = s.evals[a.id];
    const r = e?.reading || s.history[a.id]?.[s.history[a.id].length - 1];
    return { ...a, r, e, fault: s.faults[a.id] };
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={<Title en="Asset Sensors" ms="Sensor Aset" />}
        subtitle="Tamper sensors (simulated) report current, door contact and tilt every 5 minutes, and at once when a sensor changes state. A rolling z-score flags tampering."
        actions={
          <>
            <Tabs size="sm" value={s.mode} onChange={(m) => (m === 'live' ? s.goLive() : s.startSimulation())}
              tabs={[{ value: 'live', label: 'Live' }, { value: 'sim', label: 'Simulation' }]} />
            <span className="tile !py-1.5 text-xs flex items-center gap-2">
              <Icon name="clock" size={14} />
              <span className="font-mono font-semibold text-fg">{formatMyt(s.time, 'short')}</span>
              <span className="text-fg-faint">{s.live ? 'last reading' : 'simulated clock'}</span>
              {isNight(s.time) && <Badge tone="info">NIGHT</Badge>}
            </span>
            {!s.live && (
              <>
                <Button variant={s.running ? 'secondary' : 'primary'} icon={s.running ? 'pause' : 'play'} onClick={() => s.setRunning(!s.running)}>{s.running ? 'Pause' : 'Run'}</Button>
                <select className="select select-sm" value={s.speedMs} onChange={(e) => s.setSpeedMs(+e.target.value)} aria-label="Simulation speed">
                  {SPEEDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </>
            )}
            <Button variant="ghost" icon="moon" onClick={() => s.jumpTo(23)} title="Switches to simulation and fast-forwards the sensor clock">Jump to 23:00</Button>
          </>
        }
      />

      {!s.live && (
        <div className="tile tone-warning text-xs flex items-center justify-between gap-3 flex-wrap">
          <span><b>Simulation mode.</b> The sensor clock reads {formatMyt(s.time, 'short')} and {s.running ? `advances 5 minutes every ${s.speedMs / 1000} s` : 'is paused'}. Alerts raised now are marked as simulated.</span>
          <Button size="sm" icon="refresh" onClick={s.goLive}>Return to live</Button>
        </div>
      )}
      {requestedOffline && (
        <p className="tile tone-neutral text-xs">{requested} has no sensor feed ({assets.find((a) => a.id === requested)?.sensorCause || 'offline'}). Showing {asset.id} instead.</p>
      )}

      <StatGrid>
        <StatCard label="Sensors online" value={s.online.length} unit={`/ ${assets.length}`} icon="signal" onDetails={() => setDetail('offline')}
          subValues={[{ label: 'Offline (cut circuits)', value: offline }]} status={offline ? 'warning' : 'normal'} />
        <StatCard label="Active tamper alerts" value={sensorAlerts.length} icon="alert" onDetails={() => setDetail('alerts')}
          status={sensorAlerts.some((a) => a.level === 'HIGH') ? 'critical' : sensorAlerts.length ? 'warning' : 'normal'}
          subValues={[{ label: 'High', value: sensorAlerts.filter((a) => a.level === 'HIGH').length }]} />
        <StatCard label="Injected faults" value={Object.keys(s.faults).length} icon="wrench" status={Object.keys(s.faults).length ? 'warning' : 'normal'} onDetails={() => setDetail('faults')} />
        <StatCard label="Detection rule" value={`|z| > ${TAMPER_RULES.z}`} icon="gauge" onDetails={() => setDetail('rules')}
          subValues={[{ label: 'Window', value: `${TAMPER_RULES.window} readings` }, { label: 'Tilt', value: `> ${TAMPER_RULES.tiltDeg}°` }]} />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title={<span>Simulate tampering <Ms>Simulasi gangguan</Ms></span>} subtitle={s.live ? 'The sensor reports the change at once' : 'The next simulated reading carries the fault'} bodyClassName="space-y-3">
          <label className="block">
            <span className="label-caps field-label">Asset</span>
            <select className="select" value={asset.id} onChange={(e) => setAssetId(e.target.value)}>
              {zones.map((z) => (
                <optgroup key={z.id} label={z.short}>
                  {s.online.filter((a) => a.zone === z.id).map((a) => <option key={a.id} value={a.id}>{a.id} · {ASSET_TYPES[a.type].label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-2">
            {Object.entries(FAULTS).map(([type, f]) => {
              const na = asset.type === 'cable' && (type === 'panel_open' || type === 'pole_struck');
              return (
                <Button key={type} variant={type === 'cable_cut' ? 'danger' : 'secondary'} className="justify-between" disabled={na || fault?.type === type}
                  onClick={() => s.injectFault(asset.id, type)}>
                  <span>{f.label}</span><span className="ms-label">{f.labelMs}</span>
                </Button>
              );
            })}
            <Button variant="ghost" icon="refresh" disabled={!fault} onClick={() => s.clearFault(asset.id)}>Restore asset</Button>
          </div>
          {Object.keys(s.faults).length > 0 && (
            <div className="pt-2 border-t space-y-1">
              <p className="label-caps">Active faults</p>
              {Object.entries(s.faults).map(([id, f]) => (
                <div key={id} className="flex items-center justify-between text-xs">
                  <span className="text-fg">{id} · {FAULTS[f.type].label}{f.random ? ' (random)' : ''}</span>
                  <button type="button" className="link-btn" onClick={() => s.clearFault(id)}>RESTORE</button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={s.clearAllFaults}>Restore all</Button>
            </div>
          )}
          <div className="pt-2 border-t">
            <Toggle on={s.randomEvents} onChange={() => s.setRandomEvents(!s.randomEvents)} label="Random tamper events"
              hint="Occasional faults on random assets, mostly at night" />
          </div>
        </Card>

        <div className="xl:col-span-2 space-y-4">
          <ChartCard
            title={`${asset.id} current draw (A)`}
            subtitle={`${ASSET_TYPES[asset.type].label} · ${asset.road}. Shaded band: expected load ± ${TAMPER_RULES.z}σ`}
            legend
            height={230}
            actions={<span className="flex gap-1 flex-wrap justify-end items-center">{ev && <CauseBadges causes={ev.causes} />}<Button size="sm" variant="ghost" icon="pin" onClick={() => setPanel({ kind: 'asset', id: asset.id })}>Twin</Button></span>}
            data={{
              labels,
              datasets: [
                { label: 'Current', data: hist.map((r) => r.current), color: ev?.tamper ? 'danger' : 'primary', fill: false, borderWidth: 2.5, pointRadius: hist.map((_, i) => (i === hist.length - 1 ? 3 : 0)) },
                { label: 'Expected', data: expected, color: 'neutral', fill: false, borderDash: [5, 4], borderWidth: 1.5 },
                { label: 'Upper 3σ', data: expected.map((v, i) => +(v + sigma[i]).toFixed(3)), color: 'chart-8', fill: false, borderWidth: 0.5, pointRadius: 0 },
                { label: 'Lower 3σ', data: expected.map((v, i) => +Math.max(0, v - sigma[i]).toFixed(3)), color: 'chart-8', fill: '-1', borderWidth: 0.5, pointRadius: 0 },
              ],
            }}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ChartCard
              className="md:col-span-2"
              title="Rolling z-score (clipped at ±10)"
              type="bar"
              height={150}
              data={{
                labels,
                datasets: [{
                  label: 'z',
                  data: hist.map((r) => Math.max(-10, Math.min(10, r.z || 0))),
                  color: hist.map((r) => (Math.abs(r.z || 0) > TAMPER_RULES.z ? 'danger' : 'primary')),
                }],
              }}
              thresholds={[
                { value: TAMPER_RULES.z, tone: 'danger', label: `|z| > ${TAMPER_RULES.z}`, description: 'tamper alert' },
                { value: -TAMPER_RULES.z, tone: 'danger' },
              ]}
            />
            <Card title="Contacts">
              <div className="space-y-2 text-xs">
                <div className="tile flex items-center justify-between"><span className="flex items-center gap-2"><Icon name="door" size={14} />Door</span>
                  <b className={ev?.reading?.door === 1 ? 'text-danger' : 'text-fg'}>{ev?.reading?.door == null ? 'n/a' : ev.reading.door ? 'OPEN' : 'Closed'}</b></div>
                <div className="tile flex items-center justify-between"><span className="flex items-center gap-2"><Icon name="tilt" size={14} />Tilt</span>
                  <b className={ev?.reading?.tilt > TAMPER_RULES.tiltDeg ? 'text-danger' : 'text-fg'}>{ev?.reading?.tilt == null ? 'n/a' : `${ev.reading.tilt}°`}</b></div>
                <div className="tile flex items-center justify-between"><span>Last z</span><b className="text-fg">{ev ? ev.z : '—'}</b></div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" padded={false} title="All sensors" subtitle="Click a row to chart it" bodyClassName="max-h-[420px] overflow-y-auto">
          <DataTable
            rows={rows}
            onRowClick={(r) => setAssetId(r.id)}
            columns={[
              { key: 'id', header: 'Asset', strong: true, render: (r) => <span className={r.id === asset.id ? 'text-primary font-bold' : ''}>{r.id}</span> },
              { key: 'type', header: 'Type', render: (r) => ASSET_TYPES[r.type].label },
              { key: 'current', header: 'Current (A)', numeric: true, render: (r) => r.r?.current ?? '—' },
              { key: 'z', header: 'z', numeric: true, render: (r) => <span className={Math.abs(r.e?.z || 0) > TAMPER_RULES.z ? 'text-danger font-bold' : ''}>{r.e?.z ?? '—'}</span> },
              { key: 'door', header: 'Door', render: (r) => (r.r?.door == null ? '—' : r.r.door ? <b className="text-danger">OPEN</b> : 'closed') },
              { key: 'tilt', header: 'Tilt', numeric: true, render: (r) => (r.r?.tilt == null ? '—' : `${r.r.tilt}°`) },
              { key: 'status', header: 'Status', render: (r) => <span className="flex gap-1 flex-wrap"><CauseBadges causes={r.e?.causes} />{r.fault && <Badge tone="neutral">fault: {r.fault.type}</Badge>}</span> },
            ]}
          />
        </Card>
        <Card title={<span>Detection log <Ms>Log pengesanan</Ms></span>} padded={false} bodyClassName="max-h-[420px] overflow-y-auto">
          {s.events.length === 0 && <p className="text-xs text-fg-faint text-center py-8">No tamper readings yet. Inject a fault to see the detector work.</p>}
          <ul>
            {s.events.map((e, i) => (
              <li key={`${e.t}-${e.assetId}-${i}`}>
                <button type="button" onClick={() => setAssetId(e.assetId)} className={`w-full text-left px-4 py-2.5 border-b text-xs transition-colors ${e.assetId === asset.id ? 'bg-primary-soft' : 'hover:bg-surface-raised'}`}>
                  <span className="flex items-center justify-between gap-2">
                    <b className="text-fg">{e.assetId}</b>
                    <span className="text-[10px] text-fg-faint font-mono">{formatMyt(e.t, 'short')}{e.simulated ? ' · sim' : ''}</span>
                  </span>
                  <span className="flex gap-1 flex-wrap mt-1">
                    {e.causes.map((c) => <Badge key={c} tone={c === 'door_open_daytime' ? 'info' : CAUSES[c]?.level === 'HIGH' ? 'danger' : 'warning'}>{CAUSE_LABEL[c]?.label || c}</Badge>)}
                    <span className="text-fg-faint">z = {e.z}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {detail === 'offline' && (
        <Drawer width={560} eyebrow="Sensors" title={`${offline} sensor${offline === 1 ? '' : 's'} offline`} subtitle="Assets on circuits cut by recent thefts send no readings until repaired" onClose={() => setDetail(null)} bodyClassName="overflow-y-auto">
          <DataTable rows={offlineAssets} onRowClick={(a) => { setDetail(null); setPanel({ kind: 'asset', id: a.id }); }} emptyText="All sensors are online."
            columns={[
              { key: 'id', header: 'Asset', strong: true, render: (a) => <>{a.id}<span className="block text-[10px] text-fg-faint font-normal">{ASSET_TYPES[a.type].label} · {zoneName(a.zone)}</span></> },
              { key: 'cause', header: 'Why', render: (a) => <span className="text-[11px]">{a.sensorCause}</span> },
              { key: 'since', header: 'Since', className: 'whitespace-nowrap', render: (a) => (a.sensorSince ? formatMyt(a.sensorSince, 'short') : '—') },
            ]} />
        </Drawer>
      )}
      {detail === 'alerts' && (
        <Drawer width={520} eyebrow="Tamper sensors" title={`${sensorAlerts.length} active tamper alert${sensorAlerts.length === 1 ? '' : 's'}`} subtitle="Open, acknowledged or patrol dispatched" onClose={() => setDetail(null)} bodyClassName="overflow-y-auto">
          <AlertFeed alerts={sensorAlerts} onSelect={(a) => { setDetail(null); setPanel({ kind: 'alert', id: a.id }); }} emptyText="No active tamper alerts. Inject a fault to see the detector work." />
        </Drawer>
      )}
      {detail === 'faults' && (
        <Drawer width={460} eyebrow="Simulation" title="Injected faults" subtitle="Faults stay in place until you restore the asset" onClose={() => setDetail(null)}>
          {Object.keys(s.faults).length === 0 && <p className="text-xs text-fg-faint">No faults injected. Pick an asset and use the buttons under “Simulate tampering”.</p>}
          <ul className="space-y-2">
            {Object.entries(s.faults).map(([id, f]) => (
              <li key={id} className="tile flex items-center justify-between gap-2 text-xs">
                <span><b className="text-fg">{id}</b> · {FAULTS[f.type].label}{f.random ? ' (random)' : ''}<span className="block text-[10px] text-fg-faint">since {formatMyt(f.since, 'short')}</span></span>
                <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => { setAssetId(id); setDetail(null); }}>Chart</Button><Button size="sm" variant="secondary" onClick={() => s.clearFault(id)}>Restore</Button></span>
              </li>
            ))}
          </ul>
        </Drawer>
      )}
      {detail === 'rules' && (
        <Drawer width={480} eyebrow="Detection rules" title="How tampering is detected" onClose={() => setDetail(null)}>
          <div className="space-y-3 text-xs text-fg-muted leading-relaxed">
            <p>Each reading is compared with the asset's daily load profile. The difference is scored against the last {TAMPER_RULES.window} readings taken in the same state (lamp on or off): <span className="kbd">z = (residual − mean) / max(sd, sensor noise)</span>.</p>
            <ul className="space-y-2">
              <li className="tile"><b className="text-fg">Cable cut</b> (HIGH): current below {TAMPER_RULES.cutFraction * 100}% of the expected load while it should be flowing.</li>
              <li className="tile"><b className="text-fg">Panel opened</b> (HIGH): door contact open between 22:00 and 06:00. In daytime it is logged but not alerted (maintenance).</li>
              <li className="tile"><b className="text-fg">Pole struck</b> (HIGH): tilt above {TAMPER_RULES.tiltDeg}°.</li>
              <li className="tile"><b className="text-fg">Abnormal current draw</b> (MEDIUM): |z| above {TAMPER_RULES.z} without a cut, e.g. illegal tapping.</li>
            </ul>
            <p>One alert is kept per asset and cause while it is active, so a cut cable does not raise a new alert every 5 minutes.</p>
          </div>
        </Drawer>
      )}
      <EntityDrawer panel={panel} onChange={setPanel} />
    </div>
  );
}
