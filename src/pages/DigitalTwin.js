import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, Card, Badge, Button, FilterChips, DataTable, Icon, IconButton } from '../components/ui';
import AssetMap from '../components/guard/AssetMap';
import { AssetTwin } from '../components/guard/AssetTwin';
import EntityDrawer from '../components/guard/EntityDrawer';
import { Title, Ms, Toggle, SensorModeBadge, LevelBadge, StatusBadge } from '../components/guard/common';
import { useData } from '../data/DataProvider';
import { useSensors } from '../data/SensorProvider';
import { ASSET_TYPES, ASSET_STATUS, ZONE_TONE, formatRM, formatRMShort } from '../data/reference';
import { formatMyt } from '../ai/time';
import { metres } from '../data/network';
import { toneVar } from '../theme/tones';

const LAYERS = [
  ['streetlight', 'Streetlights', 'lightbulb'],
  ['distribution_box', 'Pillars and distribution boxes', 'box'],
  ['switchboard', 'Main switchboards', 'bolt'],
  ['cable', 'Cable runs', 'route'],
  ['power', 'Power network', 'bolt', 'Feeders and lighting circuits; grey dashed where supply is cut'],
  ['lighting', 'Lamp light pools', 'lightbulb', 'Area each working lamp lights; dashed rings where a lamp is dark'],
  ['cameras', 'CCTV units', 'camera'],
  ['coverage', 'CCTV field of view', 'eye', '90° heads, 150 m nominal range'],
  ['dealers', 'Scrap dealers', 'recycle'],
  ['route', 'Tonight\'s patrol route', 'truck'],
  ['heat', 'Risk heat (7-day)', 'map'],
];
const STATUS_ORDER = ['alert', 'watch', 'offline', 'normal'];

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => COMPASS[Math.round(deg / 22.5) % 16];

function Circuits({ assets, tasks, network, onSelectAsset, onOpenTask }) {
  const zonesShown = new Set(assets.map((a) => a.zone));
  const circuits = network.circuits.filter((c) => zonesShown.has(c.zone));
  const full = circuits.filter((c) => c.dead === 0).length;
  const down = circuits.filter((c) => c.dead > 0);
  const repairFor = (c, cut) => tasks.find((t) => t.kind === 'work_order' && ['open', 'in_progress'].includes(t.status)
    && t.assetIds.some((id) => id === cut?.id || c.lights.some((l) => l.id === id)));
  return (
    <div>
      <p className="label-caps mb-1.5">Lighting circuits · {full} of {circuits.length} with full supply</p>
      <div className="grid grid-cols-3 gap-1.5">
        {circuits.map((c) => (
          <button key={c.id} type="button" onClick={() => onSelectAsset((c.cable || c.lights[0]).id)}
            title={`${c.id}: ${c.source?.id}${c.cable ? ` → ${c.cable.id}` : ''} → ${c.lights.map((l) => l.id).join(', ')}`}
            className={`tile !py-1 !px-2 text-left transition-colors hover:border-line-strong ${c.dead ? 'tone-danger' : ''}`}>
            <span className="flex items-center justify-between gap-1 text-[11px]">
              <b className="text-fg">{c.id.slice(4)}<span className="font-normal text-fg-faint"> {c.zone}</span></b>
              <span className="font-semibold" style={{ color: c.dead ? 'var(--app-danger)' : 'var(--app-warning)' }}>{c.energised}/{c.total}</span>
            </span>
            <span className="block text-[10px] text-fg-faint truncate">{c.source?.id}{c.cable ? ` → ${c.cable.id}` : ''}</span>
          </button>
        ))}
      </div>
      {down.map((c) => {
        const cut = network.breakFor(c.lights.find((l) => !network.energised(l.id)).id);
        const wo = repairFor(c, cut);
        // A dark light marked "circuit cut" lost its feed where the circuit leaves its pillar.
        const where = cut?.type === 'streetlight' ? `where it leaves ${cut.upstream}` : `at ${cut?.id}`;
        return (
          <p key={c.id} className="text-[11px] text-fg-muted mt-1.5">
            <b className="text-fg">{c.id}</b>: {c.dead} of {c.total} lights without supply, cut {where} ({(cut?.lightingCause || cut?.sensorCause || 'cause not recorded').replace(/^No feed since the /, '').replace(/^./, (ch) => ch.toLowerCase())}).
            {wo && <> Repair <button type="button" className="link-btn" onClick={() => onOpenTask(wo.id)}>{wo.id}</button> is {wo.status === 'in_progress' ? 'in progress' : 'open'}.</>}
          </p>
        );
      })}
    </div>
  );
}

function NetworkOverview({ assets, cameras, tasks, network, onSelectAsset, onOpenTask }) {
  const types = Object.keys(ASSET_TYPES);
  const sl = assets.filter((a) => a.type === 'streetlight');
  const dark = sl.filter((a) => a.lighting === 'out');
  const theft = dark.filter((a) => a.lightingCause?.startsWith('Circuit cut')).length;
  const covered = assets.filter((a) => a.cameraId).length;
  const openWork = tasks.filter((t) => ['open', 'in_progress'].includes(t.status) && t.assetIds.some((id) => assets.some((a) => a.id === id)));
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">Select an asset on the map or in the list to open its live twin.</p>
      <div className="tile !p-0 overflow-hidden">
        <div className="grid text-[11px]" style={{ gridTemplateColumns: '1fr repeat(4, 34px)' }}>
          <span className="label-caps px-3 py-2">Type</span>
          {STATUS_ORDER.map((s) => (
            <span key={s} className="py-2 flex justify-center" title={`${ASSET_STATUS[s].label}: ${ASSET_STATUS[s].hint}`}>
              <span className="legend-dot !mr-0" style={{ background: toneVar(ASSET_STATUS[s].tone) }} />
            </span>
          ))}
          {types.map((t) => (
            <React.Fragment key={t}>
              <span className="px-3 py-1.5 border-t font-semibold text-fg">{ASSET_TYPES[t].label}</span>
              {STATUS_ORDER.map((s) => {
                const n = assets.filter((a) => a.type === t && a.status === s).length;
                return <span key={s} className="py-1.5 border-t text-center font-semibold" style={{ color: n && s !== 'normal' ? toneVar(ASSET_STATUS[s].tone) : 'var(--app-text-muted)' }}>{n}</span>;
              })}
            </React.Fragment>
          ))}
        </div>
        <p className="px-3 py-1.5 border-t text-[10px] text-fg-faint">{STATUS_ORDER.map((s) => ASSET_STATUS[s].label).join(' · ')}</p>
      </div>
      <Circuits assets={assets} tasks={tasks} network={network} onSelectAsset={onSelectAsset} onOpenTask={onOpenTask} />
      <div className="grid grid-cols-2 gap-2">
        <div className="tile"><p className="label-caps">Streetlights dark</p><p className="text-lg font-bold text-fg">{dark.length}<span className="text-xs font-normal text-fg-faint"> / {sl.length}</span></p><p className="text-[10px] text-fg-faint">{theft} from theft, {dark.length - theft} lamp failures</p></div>
        <div className="tile"><p className="label-caps">Sensors online</p><p className="text-lg font-bold text-fg">{assets.filter((a) => a.sensor !== 'offline').length}<span className="text-xs font-normal text-fg-faint"> / {assets.length}</span></p><p className="text-[10px] text-fg-faint">Offline ones are on cut circuits</p></div>
        <div className="tile"><p className="label-caps">CCTV cover</p><p className="text-lg font-bold text-fg">{covered}<span className="text-xs font-normal text-fg-faint"> / {assets.length}</span></p><p className="text-[10px] text-fg-faint">{cameras.length} existing solar units</p></div>
        <div className="tile"><p className="label-caps">Open work</p><p className="text-lg font-bold text-fg">{openWork.length}</p><p className="text-[10px] text-fg-faint">Patrols and work orders</p></div>
      </div>
    </div>
  );
}

function CameraPanel({ camera, onSelectAsset, onOpenAlert }) {
  const navigate = useNavigate();
  const { assets, alerts } = useData();
  const covered = camera.covers.map((id) => assets.find((a) => a.id === id)).filter(Boolean);
  const distance = (a) => Math.round(Math.min(...(a.path || [[a.lat, a.lng]]).map((p) => metres([camera.lat, camera.lng], p))));
  const camAlerts = alerts.filter((a) => a.evidence?.cameraId === camera.id);
  return (
    <div className="space-y-4">
      <div className="tile text-xs space-y-1">
        <p><span className="label-caps mr-2">Model</span>{camera.model}</p>
        <p><span className="label-caps mr-2">Mounted on</span><button type="button" className="link-btn" onClick={() => onSelectAsset(camera.mountedOn)}>{camera.mountedOn}</button>, {camera.mountHeightM} m up</p>
        <p><span className="label-caps mr-2">View</span>{camera.heads.length === 2 ? 'Two heads' : 'One head'}, {camera.heads[0].fovDeg}° each, aimed {camera.heads.map((h) => `${h.heading}° (${compass(h.heading)})`).join(' and ')}</p>
        <p><span className="label-caps mr-2">Range</span>{camera.heads[0].rangeM} m nominal; people are only reliably detected much closer in low light</p>
        <p className="text-fg-faint">The command centre scores this camera's footage with COCO-SSD; the unit itself has no analytics.</p>
      </div>
      <div>
        <p className="label-caps mb-1.5">Covers {covered.length} assets</p>
        <ul className="space-y-1">
          {covered.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onSelectAsset(a.id)} className="w-full text-left flex items-center gap-2 text-xs py-1 hover:text-primary">
                <span className="legend-dot shrink-0" style={{ background: toneVar(ASSET_STATUS[a.status].tone) }} />
                <b className="text-fg shrink-0">{a.id}</b><span className="text-fg-faint truncate">{a.name}</span>
                <span className="ml-auto text-[10px] text-fg-faint shrink-0">{a.id === camera.mountedOn ? 'mount' : `${distance(a)} m`}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="label-caps mb-1.5">CCTV alerts from this unit ({camAlerts.length})</p>
        {camAlerts.length === 0 && <p className="text-xs text-fg-faint">None.</p>}
        <ul className="space-y-1.5">
          {camAlerts.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onOpenAlert(a.id)} className="w-full text-left tile !py-2 hover:border-line-strong">
                <span className="flex items-center justify-between gap-2"><LevelBadge level={a.level} /><StatusBadge status={a.status} /></span>
                <span className="block text-xs font-semibold text-fg mt-1">{a.title}</span>
                <span className="block text-[10px] text-fg-faint mt-0.5">{a.id} · {formatMyt(a.createdAt, 'short')} · score {a.score}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Button block icon="camera" onClick={() => navigate(`/cctv?asset=${camera.mountedOn}`)}>Analyse footage from {camera.id}</Button>
    </div>
  );
}

export default function DigitalTwin() {
  const { zones, assets, cameras, dealers, risk, meta, incidents, tasks, network } = useData();
  const sensors = useSensors();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('asset');
  const cameraId = params.get('camera');
  const [zone, setZone] = useState('all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState(null);
  const [layers, setLayers] = useState({
    streetlight: true, distribution_box: true, switchboard: true, cable: true, power: true, lighting: true,
    cameras: true, coverage: true, dealers: false, route: false, heat: false,
  });

  const select = (id) => setParams(id ? { asset: id } : {});
  const inZone = (x) => zone === 'all' || x.zone === zone;
  const zoneAssets = assets.filter(inZone);
  const visible = zoneAssets.filter((a) => layers[a.type] && (status === 'all' || a.status === status));
  const listed = visible.filter((a) => !q || `${a.id} ${a.name} ${a.road}`.toLowerCase().includes(q.trim().toLowerCase()));
  const selected = assets.find((a) => a.id === selectedId);
  const camera = cameras.find((c) => c.id === cameraId);
  const bands = risk.ready ? Object.fromEntries(risk.forecast.map((f) => [f.zone, f.band])) : undefined;
  const route = risk.ready && layers.route ? { stops: risk.route.stops.filter((s) => inZone(s)), base: meta.patrolBase } : null;

  const zoneRows = useMemo(() => zones.map((z) => {
    const za = assets.filter((a) => a.zone === z.id);
    const zi = incidents.filter((i) => i.zone === z.id);
    const f = risk.ready ? risk.forecast.find((x) => x.zone === z.id) : null;
    return {
      id: z.id, name: z.short, assets: za.length,
      atRisk: za.filter((a) => a.status !== 'normal').length,
      dark: za.filter((a) => a.lighting === 'out').length,
      lights: za.filter((a) => a.type === 'streetlight').length,
      offline: za.filter((a) => a.sensor === 'offline').length,
      cctv: za.filter((a) => a.cameraId).length,
      incidents: zi.length, cost: zi.reduce((s, i) => s + i.costRM, 0),
      last: zi[zi.length - 1]?.occurredAt, f,
    };
  }), [zones, assets, incidents, risk]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={<Title en="Digital Twin" ms="Kembar Digital" />}
        subtitle={`Live model of the ${assets.length} protected assets in DBKU's three hotspots: status, sensor telemetry, lighting, CCTV coverage and risk.`}
        actions={
          <>
            <SensorModeBadge sensors={sensors} showTime />
            <FilterChips label="Zone" value={zone} onChange={(v) => { setZone(v); }}
              options={[{ value: 'all', label: 'All' }, ...zones.map((z) => ({ value: z.id, label: z.short }))]} />
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {[['all', 'All assets', 'primary'], ...STATUS_ORDER.map((s) => [s, ASSET_STATUS[s].label, ASSET_STATUS[s].tone])].map(([value, label, tone]) => {
          const n = value === 'all' ? zoneAssets.length : zoneAssets.filter((a) => a.status === value).length;
          return (
            <button key={value} type="button" onClick={() => setStatus(value)} title={ASSET_STATUS[value]?.hint}
              className={`tile !py-2 !px-3 flex items-center gap-2 text-xs transition-colors ${status === value ? `tone-${tone}` : 'hover:border-line-strong'}`}>
              {value !== 'all' && <span className="legend-dot" style={{ background: toneVar(tone) }} />}
              <span className="font-semibold text-fg">{label}</span>
              <span className="font-bold">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="space-y-4">
          <Card title={<span>Layers <Ms>Lapisan</Ms></span>} bodyClassName="space-y-2.5">
            {LAYERS.map(([key, label, , hint]) => (
              <Toggle key={key} on={layers[key]} onChange={() => setLayers((l) => ({ ...l, [key]: !l[key] }))} label={label}
                hint={key === 'heat' && bands ? Object.entries(bands).map(([z, b]) => `${z} ${b}`).join(' · ') : hint} />
            ))}
          </Card>
          <Card padded={false} title={`Assets (${listed.length})`} subtitle="Click to open the twin"
            actions={<input className="input" style={{ width: 120 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter assets" />}
            bodyClassName="max-h-[340px] overflow-y-auto">
            <ul>
              {listed.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => select(a.id)}
                    className={`w-full text-left px-4 py-2 border-b flex items-center gap-2.5 text-xs transition-colors ${a.id === selectedId ? 'bg-primary-soft' : 'hover:bg-surface-raised'}`}>
                    <span className={`legend-dot shrink-0 ${a.lighting === 'out' ? 'is-dark' : ''}`} style={{ background: toneVar(ASSET_STATUS[a.status].tone) }} />
                    <Icon name={ASSET_TYPES[a.type].icon} size={13} className="text-fg-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-fg">{a.id}</span>
                      <span className="block text-[10px] text-fg-faint truncate">{a.status === 'normal' ? a.name : a.statusReason}</span>
                    </span>
                  </button>
                </li>
              ))}
              {listed.length === 0 && <li className="text-xs text-fg-faint text-center py-6">No assets match.</li>}
            </ul>
          </Card>
        </div>

        <div className="xl:col-span-2">
          <AssetMap
            assets={visible} zones={zones.filter(inZone)} zoneBands={bands} heat={layers.heat}
            cameras={layers.cameras ? cameras.filter(inZone) : undefined} coverage={layers.cameras && layers.coverage}
            network={network} power={layers.power} lighting={layers.lighting} clock={sensors.time}
            dealers={layers.dealers ? dealers : undefined} route={route || undefined}
            selectedId={selectedId || cameraId} fitKey={`${zone}`} height={760}
            onSelectAsset={(a) => select(a.id)} onSelectCamera={(c) => setParams({ camera: c.id })}
          />
        </div>

        <Card
          padded={false}
          title={selected ? `${selected.id} · ${selected.name}` : camera ? `${camera.id} · CCTV unit` : 'Network overview'}
          subtitle={selected ? `${ASSET_TYPES[selected.type].label} · ${selected.road}` : camera ? `Covers ${camera.covers.length} assets` : `${visible.length} assets shown`}
          actions={(selected || camera) && <IconButton icon="close" label="Clear selection" plain onClick={() => select(null)} />}
          bodyClassName="p-4 max-h-[700px] overflow-y-auto"
        >
          {selected && <AssetTwin key={selected.id} assetId={selected.id} onSelectAsset={select} onOpenAlert={(id) => setPanel({ kind: 'alert', id })} onOpenTask={(id) => setPanel({ kind: 'task', id })} />}
          {!selected && camera && <CameraPanel camera={camera} onSelectAsset={select} onOpenAlert={(id) => setPanel({ kind: 'alert', id })} />}
          {!selected && !camera && <NetworkOverview assets={zoneAssets} cameras={cameras.filter(inZone)} tasks={tasks} network={network} onSelectAsset={select} onOpenTask={(id) => setPanel({ kind: 'task', id })} />}
        </Card>
      </div>

      <Card padded={false} title={<span>Hotspot summary <Ms>Ringkasan zon</Ms></span>} subtitle="Click a zone to focus the twin on it">
        <DataTable
          rows={zoneRows}
          onRowClick={(r) => setZone(zone === r.id ? 'all' : r.id)}
          columns={[
            { key: 'name', header: 'Zone', strong: true, render: (r) => <span className={zone === r.id ? 'text-primary font-bold' : ''}>{r.name}</span> },
            { key: 'assets', header: 'Assets', numeric: true },
            { key: 'atRisk', header: 'At risk', numeric: true, render: (r) => <span className={r.atRisk ? 'text-warning font-semibold' : ''}>{r.atRisk}</span> },
            { key: 'dark', header: 'Lights dark', numeric: true, render: (r) => `${r.dark} / ${r.lights}` },
            { key: 'offline', header: 'Sensors offline', numeric: true },
            { key: 'cctv', header: 'CCTV cover', numeric: true, render: (r) => `${r.cctv} / ${r.assets} (${Math.round((r.cctv / r.assets) * 100)}%)` },
            { key: 'risk', header: '7-day risk', render: (r) => (r.f ? <Badge tone={ZONE_TONE[r.f.band]} dot>{r.f.band} · {r.f.risk.toFixed(2)}</Badge> : '…') },
            { key: 'incidents', header: 'Incidents since 2020', numeric: true, render: (r) => `${r.incidents} · ${formatRMShort(r.cost)}` },
            { key: 'last', header: 'Last incident', render: (r) => (r.last ? formatMyt(r.last, 'date') : '—') },
          ]}
        />
        <p className="text-[10px] text-fg-faint px-4 py-2 border-t">Repair costs are DBKU incident records ({formatRM(zoneRows.reduce((s, r) => s + r.cost, 0))} in total).</p>
      </Card>

      <EntityDrawer panel={panel} onChange={setPanel} />
    </div>
  );
}
