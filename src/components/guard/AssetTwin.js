import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import { Drawer, Badge, Button } from '../ui';
import { LevelBadge, StatusBadge, Ms } from './common';
import { TaskFormModal, TaskList } from './Tasks';
import AssetSchematic from './AssetSchematic';
import { lampsOnAt } from '../../data/network';
import { resolveColor, withAlpha, tooltipOptions, axisOptions } from '../charts/chartTheme';
import { useTheme } from '../../theme/ThemeProvider';
import { useData } from '../../data/DataProvider';
import { useSensors } from '../../data/SensorProvider';
import { ASSET_TYPES, ASSET_STATUS, ZONE_TONE, formatRM } from '../../data/reference';
import { expectedCurrent, expectedState, FAULTS } from '../../ai/sensorSim';
import { TAMPER_RULES } from '../../ai/anomaly';
import { formatMyt, atMytHour } from '../../ai/time';
import { timeAgo } from '../../utils';

const WINDOWS = { '6 h': 72, '24 h': 288 }; // 5-minute readings

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs py-1">
      <span className="text-fg-faint shrink-0">{label}</span>
      <span className="text-fg font-medium text-right">{children}</span>
    </div>
  );
}

function Section({ title, ms, children, extra }) {
  return (
    <div className="space-y-2">
      <p className="label-caps flex items-center justify-between gap-2"><span>{title} {ms && <Ms>{ms}</Ms>}</span>{extra}</p>
      {children}
    </div>
  );
}

function Sparkline({ asset, history }) {
  const { theme } = useTheme();
  const c = resolveColor('primary');
  const data = {
    labels: history.map((r) => formatMyt(r.t, 'time')),
    datasets: [
      { label: 'Current (A)', data: history.map((r) => r.current), borderColor: c, backgroundColor: withAlpha(c, 0.12), fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 },
      { label: 'Expected (A)', data: history.map((r) => +expectedCurrent(asset, r.t).toFixed(3)), borderColor: resolveColor('neutral'), borderDash: [4, 4], fill: false, pointRadius: 0, borderWidth: 1.2 },
    ],
  };
  const options = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: tooltipOptions() },
    scales: { ...axisOptions(), x: { ...axisOptions().x, ticks: { ...axisOptions().x.ticks, maxTicksLimit: 4 } } },
  };
  return <div style={{ height: 110 }}><Line key={theme} data={data} options={options} /></div>;
}

const TYPE_ROLE = { switchboard: 'Main switchboard', distribution_box: 'Pillar', cable: 'Cable', streetlight: 'Streetlight' };
const linkLabel = (a) => (a.circuit ? `circuit ${a.circuit}` : a.feeder ? `feeder ${a.feeder}` : 'incoming supply');

/** Where the asset's supply comes from and what it feeds, with live state. */
function PowerSupply({ asset, network, onSelectAsset }) {
  const live = network.energised(asset.id);
  const chain = network.chain(asset.id).reverse();
  const cut = network.breakFor(asset.id);
  const kids = network.children(asset.id);
  const lights = network.downstream(asset.id).filter((a) => a.type === 'streetlight');
  const litCount = lights.filter((a) => network.energised(a.id)).length;
  const item = (a, sub) => (
    <button type="button" onClick={() => onSelectAsset?.(a.id)} disabled={a.id === asset.id}
      className="w-full text-left flex items-center gap-2 text-xs py-0.5 hover:text-primary disabled:hover:text-fg">
      <span className="legend-dot shrink-0" style={{ background: network.energised(a.id) ? '#f59e0b' : '#9ca3af' }} />
      <b className={a.id === asset.id ? 'text-primary' : 'text-fg'}>{a.id}</b>
      <span className="text-fg-faint truncate">{TYPE_ROLE[a.type]}{sub ? ` · ${sub}` : ''}</span>
    </button>
  );
  return (
    <Section title="Power supply" ms="Bekalan kuasa" extra={<Badge tone={live ? 'success' : 'danger'} dot>{live ? 'Energised' : 'No supply'}</Badge>}>
      <div className="tile !py-2">
        <p className="text-[10px] text-fg-faint mb-1">Sarawak Energy, 415 V three-phase</p>
        <ol className="space-y-0.5 border-l-2 pl-2" style={{ borderColor: live ? '#f59e0b' : '#9ca3af' }}>
          {chain.map((a) => <li key={a.id}>{item(a, a.upstream ? linkLabel(a) : null)}</li>)}
        </ol>
      </div>
      {cut && (
        <p className="tile tone-danger text-[11px]">
          No supply{cut.id === asset.id ? ` on the cable from ${asset.upstream}` : ` past ${cut.id}`}: {(cut.lightingCause || cut.sensorCause || 'cut').replace(/^No feed since the /, '')}.
        </p>
      )}
      {kids.length > 0 && (
        <div className="tile !py-2">
          <p className="label-caps mb-1">Feeds {kids.length} · {lights.length ? `${litCount} of ${lights.length} downstream lights have supply` : 'no lights downstream'}</p>
          <ul className="space-y-0.5 max-h-40 overflow-y-auto">
            {kids.map((a) => <li key={a.id}>{item(a, linkLabel(a))}</li>)}
          </ul>
        </div>
      )}
    </Section>
  );
}

/**
 * Live digital-twin view of one asset: status, sensor telemetry, lighting,
 * CCTV cover, value, zone risk, alerts, incidents and work in progress.
 */
export function AssetTwin({ assetId, onOpenAlert, onOpenTask, onSelectAsset }) {
  const navigate = useNavigate();
  const { assets, cameras, zones, incidents, alerts, tasks, risk, network, transactions } = useData();
  const s = useSensors();
  const [form, setForm] = useState(null);
  const [win, setWin] = useState('6 h');
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) return <p className="text-xs text-fg-faint">Unknown asset {assetId}.</p>;
  const selectAsset = onSelectAsset || ((id) => navigate(`/twin?asset=${id}`));

  const type = ASSET_TYPES[asset.type];
  const st = ASSET_STATUS[asset.status];
  const zone = zones.find((z) => z.id === asset.zone);
  const camera = cameras.find((c) => c.id === asset.cameraId);
  const mounted = cameras.find((c) => c.mountedOn === asset.id);
  const online = asset.sensor !== 'offline';
  const history = (s.history[asset.id] || []).slice(-WINDOWS[win]);
  const last = s.evals[asset.id]?.reading || history[history.length - 1];
  const lastZ = s.evals[asset.id]?.z ?? last?.z;
  const fault = s.faults[asset.id];
  const zf = risk.ready ? risk.forecast.find((f) => f.zone === asset.zone) : null;
  const assetAlerts = alerts.filter((a) => a.assetId === asset.id);
  const assetIncidents = incidents.filter((i) => i.assetIds.includes(asset.id)).slice().reverse();
  const assetTasks = tasks.filter((t) => t.assetIds?.includes(asset.id));
  const lossTotal = assetIncidents.reduce((sum, i) => sum + i.costRM, 0);
  const lampOn = asset.type === 'streetlight' && last ? expectedState(asset, last.t) === 'on' : null;
  const live = network.energised(asset.id);
  const clock = last?.t ?? s.time ?? Date.now();
  const lit = asset.type === 'streetlight' && live && asset.lighting !== 'out' && lampsOnAt(clock);
  const outgoing = network.children(asset.id).map((k) => ({ id: k.id, label: `${k.id} · ${k.circuit || k.feeder}`, live: network.energised(k.id) }));
  // Rated draw when lit / at the evening peak, from the same load model the anomaly detector learns.
  const ratedA = expectedCurrent({ ...asset, lighting: 'on', lightingSince: undefined }, atMytHour(clock, 20));
  const copperSales = transactions.filter((t) => t.material === 'Copper cable');
  const copperPrice = copperSales.length ? copperSales.reduce((sum, t) => sum + t.pricePerKgRM, 0) / copperSales.length : null;
  const sp = asset.spec || {};

  return (
    <div className="space-y-5">
      <div className={`tile tone-${st.tone}`}>
        <p className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold">{st.label} <Ms>{st.labelMs}</Ms></span>
          {fault && <Badge tone="neutral">Injected: {FAULTS[fault.type].label}</Badge>}
        </p>
        <p className="text-[11px] text-fg-muted mt-0.5">{asset.statusReason}</p>
      </div>

      <AssetSchematic asset={asset} reading={online ? last : null} live={live} lit={lit} outgoing={outgoing} />

      <Section title="Live telemetry" ms="Telemetri langsung"
        extra={online && last && (
          <span className="flex items-center gap-2 text-[10px] font-normal normal-case tracking-normal text-fg-faint">
            {s.live ? 'Live' : 'Simulated'} · {formatMyt(last.t, 'short')}
            <span className="flex">
              {Object.keys(WINDOWS).map((k) => (
                <button key={k} type="button" onClick={() => setWin(k)} aria-pressed={win === k}
                  className={`chip !py-0 !px-1.5 !text-[10px] ${win === k ? 'is-active' : ''}`}>{k}</button>
              ))}
            </span>
          </span>
        )}>
        {online && last ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="tile !p-2"><p className="label-caps">Current</p><p className={`text-sm font-bold ${Math.abs(lastZ || 0) > TAMPER_RULES.z || last.current === 0 ? 'text-danger' : 'text-fg'}`}>{last.current} A</p></div>
              <div className="tile !p-2"><p className="label-caps">z-score</p><p className={`text-sm font-bold ${Math.abs(lastZ || 0) > TAMPER_RULES.z ? 'text-danger' : 'text-fg'}`}>{lastZ ?? '—'}</p></div>
              <div className="tile !p-2"><p className="label-caps">Door</p><p className={`text-sm font-bold ${last.door === 1 ? 'text-danger' : 'text-fg'}`}>{last.door == null ? 'n/a' : last.door ? 'OPEN' : 'Closed'}</p></div>
              <div className="tile !p-2"><p className="label-caps">Tilt</p><p className={`text-sm font-bold ${last.tilt > TAMPER_RULES.tiltDeg ? 'text-danger' : 'text-fg'}`}>{last.tilt == null ? 'n/a' : `${last.tilt}°`}</p></div>
            </div>
            <Sparkline asset={asset} history={history} />
            <p className="text-[10px] text-fg-faint">Current draw over the last {win}; dashed line is the asset's expected load. Expected now: {expectedCurrent(asset, last.t).toFixed(2)} A.</p>
          </>
        ) : (
          <p className="tile tone-neutral text-xs">{asset.sensorCause || 'No sensor feed'}{asset.sensorSince ? ` (since ${formatMyt(asset.sensorSince, 'short')}, ${timeAgo(asset.sensorSince)})` : ''}. Readings resume when the circuit is repaired.</p>
        )}
      </Section>

      {network.byId[asset.id] && <PowerSupply asset={asset} network={network} onSelectAsset={selectAsset} />}

      <Section title="Asset" ms="Aset">
        <div className="tile !py-1.5 divide-y divide-line">
          <Row label="Type">{type.label} <Ms>{type.labelMs}</Ms></Row>
          <Row label="Location">{asset.road}, {zone?.short}</Row>
          {asset.type === 'streetlight' && (
            <>
              <Row label="Lamp">{sp.lamp} · {sp.luminaire}</Row>
              <Row label="Pole">{sp.poleHeightM} m · {sp.pole}</Row>
              <Row label="Draw when lit">{ratedA.toFixed(2)} A at 230 V</Row>
            </>
          )}
          {asset.type === 'distribution_box' && (
            <>
              <Row label="Enclosure">{sp.enclosure}</Row>
              <Row label="Rating">{sp.ratingA} A, {sp.waysUsed} of {sp.ways} ways used</Row>
              <Row label="Security">{sp.lock}</Row>
              <Row label="Typical load">{ratedA.toFixed(1)} A at the 20:00 peak</Row>
            </>
          )}
          {asset.type === 'switchboard' && (
            <>
              <Row label="Supply">{sp.supply}</Row>
              <Row label="Rating">{sp.ratingA} A, {sp.outgoing} outgoing ways</Row>
              <Row label="Enclosure">{sp.enclosure} · {sp.metering}</Row>
              <Row label="Typical load">{ratedA.toFixed(1)} A at the 20:00 peak</Row>
            </>
          )}
          {asset.type === 'cable' && (
            <>
              <Row label="Conductor">{sp.conductor}</Row>
              <Row label="Carries">{sp.role === 'feeder' ? `Feeder ${asset.feeder}` : `Lighting circuit ${asset.circuit}`} · {sp.laid}</Row>
              <Row label="Copper">
                ≈ {sp.copperKg?.toLocaleString('en-MY')} kg
                {copperPrice && <span className="block text-[10px] font-normal text-fg-faint">Worth ≈ {formatRM(Math.round((sp.copperKg * copperPrice) / 100) * 100)} as scrap (RM {copperPrice.toFixed(2)}/kg, {copperSales.length} registry sales), against {formatRM(asset.replacementCostRM)} to replace</span>}
              </Row>
            </>
          )}
          {asset.type === 'streetlight' && (
            <Row label="Lighting">
              {asset.lighting === 'out'
                ? <span className="text-danger">Dark{asset.lightingSince ? ` since ${formatMyt(asset.lightingSince, 'date')}` : ''}{asset.lightingCause ? ` · ${asset.lightingCause}` : ''}</span>
                : <>Working · {lampOn == null ? 'on 19:00–07:00' : lampOn ? 'lamp on (19:00–07:00)' : 'lamp off until 19:00'}</>}
            </Row>
          )}
          <Row label="CCTV">{mounted ? `${mounted.id} mounted here` : camera ? `Covered by ${camera.id}` : <span className="text-warning">No CCTV cover</span>}</Row>
          <Row label="Installed">{asset.installed}</Row>
          {asset.lengthM && <Row label="Cable length">{asset.lengthM.toLocaleString('en-MY')} m</Row>}
          <Row label="Replacement value">{formatRM(asset.replacementCostRM)}</Row>
          <Row label="Coordinates"><span className="font-mono text-[11px]">{asset.lat.toFixed(5)}, {asset.lng.toFixed(5)}</span></Row>
        </div>
      </Section>

      {asset.node && (
        <Section title="Sensor node" ms="Nod sensor">
          <div className="tile !py-1.5 divide-y divide-line">
            <Row label="Node">{asset.node.id} · {asset.node.kind}</Row>
            <Row label="Link">{asset.node.link} · {asset.node.rssiDbm} dBm ({asset.node.rssiDbm >= -95 ? 'good' : asset.node.rssiDbm >= -105 ? 'fair' : 'weak'})</Row>
            <Row label="Reports">Every {asset.node.intervalMin} min, and at once on a change · firmware {asset.node.firmware}</Row>
            <Row label="Last heard">{online && last ? `${formatMyt(last.t, 'short')}${s.live ? ` (${timeAgo(last.t)})` : ' (simulated clock)'}` : <span className="text-danger">Silent since {asset.sensorSince ? formatMyt(asset.sensorSince, 'short') : 'unknown'}: the node is powered from the cut circuit</span>}</Row>
          </div>
        </Section>
      )}

      {zf && (
        <Section title="Zone risk this week" ms="Risiko zon">
          <button type="button" onClick={() => navigate('/risk')} className="w-full text-left tile hover:border-line-strong transition-colors">
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-fg">{zone?.short}</span>
              <Badge tone={ZONE_TONE[zf.band]} dot>{zf.band} · {zf.risk.toFixed(2)}</Badge>
            </span>
            <span className="block text-[11px] text-fg-muted mt-1">{zf.reasons[0]?.text}</span>
          </button>
        </Section>
      )}

      <Section title={`Alerts (${assetAlerts.length})`} ms="Amaran">
        {assetAlerts.length === 0 ? <p className="text-xs text-fg-faint">No alerts on this asset.</p> : (
          <ul className="space-y-1.5">
            {assetAlerts.slice(0, 6).map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => onOpenAlert?.(a.id)} className="w-full text-left tile !py-2 hover:border-line-strong transition-colors">
                  <span className="flex items-center gap-2 flex-wrap"><LevelBadge level={a.level} /><span className="text-xs font-semibold text-fg">{a.title}</span><span className="ml-auto"><StatusBadge status={a.status} /></span></span>
                  <span className="block text-[10px] text-fg-faint mt-0.5">{a.id} · {formatMyt(a.createdAt, 'short')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Incident history (${assetIncidents.length})`} ms="Sejarah insiden" extra={lossTotal > 0 && <span className="normal-case tracking-normal font-semibold text-fg">{formatRM(lossTotal)}</span>}>
        {assetIncidents.length === 0 ? <p className="text-xs text-fg-faint">No recorded theft or vandalism at this asset since 2020.</p> : (
          <ul className="space-y-1">
            {assetIncidents.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => navigate(`/reports?event=${i.id}`)} className="w-full text-left flex items-start justify-between gap-2 text-xs py-1 hover:text-primary">
                  <span><span className="font-mono text-[10px] text-fg-faint mr-1.5">{formatMyt(i.occurredAt, 'date')}</span>{i.title}</span>
                  <b className="text-fg shrink-0">{formatRM(i.costRM)}</b>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Work and patrols (${assetTasks.length})`} ms="Kerja dan rondaan">
        <TaskList tasks={assetTasks} onSelect={(id) => (onOpenTask ? onOpenTask(id) : navigate(`/operations?task=${id}`))} emptyText="Nothing raised for this asset." />
      </Section>

      <div className="grid grid-cols-2 gap-2 pt-3 border-t">
        <Button variant="secondary" icon="truck" onClick={() => setForm('patrol')}>Dispatch patrol</Button>
        <Button variant="secondary" icon="wrench" onClick={() => setForm('work_order')}>Work order</Button>
        <Button variant="ghost" icon="signal" disabled={!online} onClick={() => navigate(`/sensors?asset=${asset.id}`)}>Sensor detail</Button>
        <Button variant="ghost" icon="camera" onClick={() => navigate(`/cctv?asset=${asset.id}`)}>Analyse CCTV</Button>
      </div>

      {form && (
        <TaskFormModal kind={form} onClose={() => setForm(null)} onCreated={(id) => onOpenTask?.(id)}
          context={{
            title: form === 'patrol' ? `Patrol check: ${asset.id}` : asset.lighting === 'out' ? `Restore ${asset.id}` : `Inspect ${asset.id}`,
            assetIds: [asset.id], zone: asset.zone, source: `Asset ${asset.id}`,
            values: form === 'work_order' ? { details: `${asset.name}, ${asset.road}. ${asset.statusReason}.` } : { notes: `${asset.name}, ${asset.road}` },
          }} />
      )}
    </div>
  );
}

export function AssetDrawer({ assetId, onClose, onOpenAlert, onOpenTask, onOpenAsset }) {
  const { assets } = useData();
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) return null;
  return (
    <Drawer width={500} eyebrow={`Digital twin · ${ASSET_TYPES[asset.type].label}`} title={`${asset.id} · ${asset.name}`} subtitle={asset.road}
      headerExtra={<Badge tone={ASSET_STATUS[asset.status].tone} dot>{ASSET_STATUS[asset.status].label}</Badge>} onClose={onClose}>
      <AssetTwin key={assetId} assetId={assetId} onOpenAlert={onOpenAlert} onOpenTask={onOpenTask} onSelectAsset={onOpenAsset} />
    </Drawer>
  );
}
