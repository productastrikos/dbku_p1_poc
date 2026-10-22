import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, StatCard, StatGrid, Card, FilterChips, Tabs, Badge, Button, ProgressBar, Modal, Icon, Drawer, DataTable } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import AssetMap from '../components/guard/AssetMap';
import AlertFeed from '../components/guard/AlertFeed';
import EntityDrawer from '../components/guard/EntityDrawer';
import { TaskList } from '../components/guard/Tasks';
import { Title, Ms, SensorModeBadge } from '../components/guard/common';
import { useData, zoneName } from '../data/DataProvider';
import { useSensors } from '../data/SensorProvider';
import { isActive, formatRM, formatRMShort, ZONE_TONE, ASSET_STATUS, ASSET_TYPES } from '../data/reference';
import { BAND } from '../ai/riskModel';
import { mytParts, sameMytDay, formatMyt, mytDayStart, DAY } from '../ai/time';

const STRATEGY = [
  { icon: 'shield', title: 'Protect', ms: 'Lindungi', text: 'AI CCTV and tamper sensors catch intruders before cables are pulled.', path: '/cctv' },
  { icon: 'recycle', title: 'Trace', ms: 'Jejak', text: 'Scrap sales screened under the Second-Hand Dealers Act 1946.', path: '/scrap' },
  { icon: 'users', title: 'Coordinate', ms: 'Selaras', text: 'Briefs for PDRM, Sarawak Energy and the Ministry of Utility & Telecommunication.', path: '/reports' },
];

/* KPI drill-downs: the records behind each number. */
function KpiDrawer({ kind, onClose, onOpen }) {
  const { alerts, assets, now } = useData();
  if (kind === 'today') {
    const todays = alerts.filter((a) => sameMytDay(a.createdAt, now));
    const day0 = mytDayStart(now) - 13 * DAY;
    const days = Array.from({ length: 14 }, (_, i) => day0 + i * DAY);
    const count = (d, level) => alerts.filter((a) => a.level === level && mytDayStart(a.createdAt) === d).length;
    return (
      <Drawer width={520} eyebrow="Alerts today" title={`${todays.length} alert${todays.length === 1 ? '' : 's'} on ${formatMyt(now, 'date')}`} subtitle="Malaysia Time, from midnight" onClose={onClose}>
        <div className="space-y-4">
          <ChartCard title="Alerts per day, last 14 days" type="bar" stacked legend height={160}
            data={{ labels: days.map((d) => `${mytParts(d).day}/${mytParts(d).month}`), datasets: [{ label: 'HIGH', data: days.map((d) => count(d, 'HIGH')), color: 'danger' }, { label: 'MEDIUM', data: days.map((d) => count(d, 'MEDIUM')), color: 'warning' }] }} />
          <Card padded={false} title="Today">
            <AlertFeed alerts={todays} onSelect={(a) => onOpen({ kind: 'alert', id: a.id })} emptyText="No alerts so far today." />
          </Card>
        </div>
      </Drawer>
    );
  }
  if (kind === 'risk') {
    const rows = assets.filter((a) => a.status !== 'normal').sort((a, b) => ['alert', 'watch', 'offline'].indexOf(a.status) - ['alert', 'watch', 'offline'].indexOf(b.status));
    return (
      <Drawer width={620} eyebrow="Assets at risk" title={`${rows.length} of ${assets.length} assets need attention`} subtitle="Active alert, watch (MEDIUM alert or dark streetlight) or sensor offline" onClose={onClose} bodyClassName="overflow-y-auto">
        <DataTable rows={rows} onRowClick={(a) => onOpen({ kind: 'asset', id: a.id })}
          columns={[
            { key: 'id', header: 'Asset', strong: true, render: (a) => <>{a.id}<span className="block text-[10px] text-fg-faint font-normal">{ASSET_TYPES[a.type].label} · {zoneName(a.zone)}</span></> },
            { key: 'status', header: 'Status', render: (a) => <Badge tone={ASSET_STATUS[a.status].tone} dot>{ASSET_STATUS[a.status].label}</Badge> },
            { key: 'why', header: 'Why', render: (a) => <span className="text-[11px]">{a.statusReason}</span> },
          ]} />
      </Drawer>
    );
  }
  if (kind === 'loss') {
    const rows = alerts.filter((a) => a.status === 'intercepted');
    const total = rows.reduce((s, a) => s + (a.estimatedLossRM || 0), 0);
    return (
      <Drawer width={600} eyebrow="RM loss avoided" title={formatRM(total)} subtitle={`${rows.length} intrusion${rows.length === 1 ? '' : 's'} intercepted before anything was taken`} onClose={onClose} bodyClassName="overflow-y-auto">
        <DataTable rows={rows} onRowClick={(a) => onOpen({ kind: 'alert', id: a.id })} emptyText="No intercepted alerts yet."
          columns={[
            { key: 'id', header: 'Alert', mono: true },
            { key: 'when', header: 'When', render: (a) => formatMyt(a.createdAt, 'short') },
            { key: 'what', header: 'What', strong: true, render: (a) => a.title },
            { key: 'loss', header: 'Value protected', render: (a) => <b className="text-fg">{formatRM(a.estimatedLossRM)}</b> },
          ]} />
        <p className="text-[11px] text-fg-faint px-4 py-3 border-t">Value protected is the replacement cost of the asset (plus a feeder section for streetlights and RM 1,500 call-out), from the GuardGrid replacement-cost table. It counts only alerts marked “Intercepted, no loss”.</p>
      </Drawer>
    );
  }
  return null;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { zones, assets, cameras, alerts, kpis, risk, incidents, meta, tasks, resetDemo } = useData();
  const sensors = useSensors();
  const [params, setParams] = useSearchParams();
  const [zone, setZone] = useState('all');
  const [feed, setFeed] = useState('active');
  const [panel, setPanelState] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const alertParam = params.get('alert');

  // Links such as /?alert=AL-… (notifications, search, CCTV) open that alert.
  useEffect(() => { if (alertParam) setPanelState({ kind: 'alert', id: alertParam }); }, [alertParam]);
  const setPanel = (p) => { setPanelState(p); if (!p && alertParam) setParams({}); };

  const inZone = (x) => zone === 'all' || x.zone === zone;
  const feedAlerts = alerts.filter(inZone).filter((a) => (feed === 'active' ? isActive(a) : true));
  const recentlyClosed = alerts.filter(inZone).filter((a) => !isActive(a) && Date.now() - Date.parse(a.createdAt) < 14 * DAY);
  const zoneBands = risk.ready ? Object.fromEntries(risk.forecast.map((f) => [f.zone, f.band])) : undefined;
  const openTasks = tasks.filter((t) => ['open', 'in_progress'].includes(t.status));
  const thisYear = mytParts(Date.now()).year;

  const byYear = useMemo(() => {
    const years = Array.from({ length: thisYear - 2020 + 1 }, (_, i) => 2020 + i);
    return {
      labels: years.map(String),
      datasets: zones.map((z, i) => ({
        label: z.short,
        data: years.map((y) => incidents.filter((x) => x.zone === z.id && mytParts(x.occurredAt).year === y).length),
        color: ['chart-1', 'chart-4', 'chart-3'][i],
      })),
    };
  }, [zones, incidents, thisYear]);

  // An alerting asset opens its alert; any other asset opens its digital twin.
  const openAsset = (a) => setPanel(a.openAlerts?.length ? { kind: 'alert', id: a.openAlerts[0].id } : { kind: 'asset', id: a.id });

  return (
    <div className="space-y-4">
      <PageHeader
        title={<Title en="Command Dashboard" ms="Pusat Kawalan" />}
        subtitle={`Live alerts, asset status and this week's risk across DBKU's three theft hotspots · ${formatMyt(Date.now(), 'date')}`}
        actions={
          <>
            <FilterChips label="Zone" value={zone} onChange={setZone}
              options={[{ value: 'all', label: 'All' }, ...zones.map((z) => ({ value: z.id, label: z.short }))]} />
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => setConfirmReset(true)}>Reset demo</Button>
          </>
        }
      />

      <StatGrid>
        <StatCard label="Alerts today" value={kpis.alertsToday} icon="bell"
          status={kpis.highToday ? 'critical' : kpis.alertsToday ? 'warning' : 'normal'} onDetails={() => setKpi('today')}
          subValues={[{ label: 'High', value: kpis.highToday }, { label: 'Active now', value: kpis.activeAlerts }]} />
        <StatCard label="Assets at risk" value={kpis.assetsAtRisk} unit={`/ ${assets.length}`} icon="alert"
          status={kpis.byStatus.alert ? 'critical' : kpis.assetsAtRisk ? 'warning' : 'normal'} onDetails={() => setKpi('risk')}
          subValues={[{ label: 'Alert', value: kpis.byStatus.alert }, { label: 'Watch', value: kpis.byStatus.watch }, { label: 'Offline', value: kpis.byStatus.offline }]} />
        <StatCard label="RM loss avoided" value={formatRMShort(kpis.lossAvoidedRM)} icon="shield" onDetails={() => setKpi('loss')}
          subValues={[{ label: 'Intercepted', value: kpis.intercepted }, { label: 'Pilot since', value: formatMyt(meta.pilotStart, 'date').replace(/ \d{4}$/, '') }]} />
        <StatCard label="Suspicious scrap sales" value={kpis.flagged} icon="recycle"
          status={kpis.flaggedPending ? 'warning' : 'normal'} onDetails={() => navigate('/scrap?view=queue')}
          subValues={[{ label: 'Pending PDRM review', value: kpis.flaggedPending }]} />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <AssetMap key={zone} assets={assets.filter(inZone)} zones={zones.filter(inZone)} zoneBands={zoneBands} cameras={cameras.filter(inZone)}
            focus={zone === 'all' ? undefined : zone} height={540} onSelectAsset={openAsset} />
        </div>
        <Card
          padded={false}
          title="Live alert feed"
          subtitle="Suapan amaran langsung"
          actions={<><SensorModeBadge sensors={sensors} /><Tabs size="sm" value={feed} onChange={setFeed} tabs={[{ value: 'active', label: `Active (${alerts.filter(inZone).filter(isActive).length})` }, { value: 'all', label: 'All' }]} /></>}
          className="flex flex-col"
          bodyClassName="overflow-y-auto flex-1 min-h-0"
          style={{ height: 540 }}
        >
          <AlertFeed alerts={feedAlerts} onSelect={(a) => setPanel({ kind: 'alert', id: a.id })} emptyText={feed === 'active' ? 'No active alerts. Try the CCTV Analyzer or inject a sensor fault.' : 'No alerts.'} />
          {feed === 'active' && recentlyClosed.length > 0 && (
            <>
              <p className="label-caps px-4 pt-4 pb-1">Closed in the last 14 days</p>
              <div className="opacity-80"><AlertFeed alerts={recentlyClosed} onSelect={(a) => setPanel({ kind: 'alert', id: a.id })} /></div>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(risk.ready ? risk.forecast : []).filter(inZone).map((f) => {
          const z = zones.find((x) => x.id === f.zone);
          return (
            <Card key={f.zone} hoverable className="cursor-pointer" bodyClassName="space-y-2">
              <button type="button" className="w-full text-left space-y-2" onClick={() => navigate('/risk')}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="label-caps">#{risk.forecast.indexOf(f) + 1} this week · Ramalan 7 hari</p>
                    <p className="text-sm font-bold text-fg">{z.short}</p>
                  </div>
                  <Badge tone={ZONE_TONE[f.band]} dot>{f.band} · {BAND[f.band].labelMs}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <ProgressBar className="flex-1" value={f.risk} max={1} tone={ZONE_TONE[f.band]} />
                  <span className="text-xs font-bold text-fg tabular-nums">{f.risk.toFixed(2)}</span>
                </div>
                <p className="text-[11px] text-fg-muted leading-snug">{f.reasons[0]?.text}</p>
              </button>
            </Card>
          );
        })}
        {!risk.ready && <Card className="md:col-span-3"><p className="text-xs text-fg-faint">Training the hotspot risk model…</p></Card>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard className="lg:col-span-2" title="Incidents per year by hotspot" subtitle={`${incidents.length} incidents since 2020 · RM ${(meta.programme.totalCostRM / 1e6).toFixed(2)}M in repairs`}
          type="bar" stacked legend height={220} data={byYear} />
        <Card title={<span>Open operations <Ms>Operasi terbuka</Ms></span>} subtitle={`${openTasks.length} patrols, notifications and work orders`}
          actions={<Button size="sm" variant="ghost" onClick={() => navigate('/operations')}>View all</Button>} bodyClassName="max-h-[260px] overflow-y-auto">
          <TaskList tasks={openTasks.filter((t) => zone === 'all' || t.zone === zone).slice(0, 6)} onSelect={(id) => setPanel({ kind: 'task', id })} emptyText="Nothing open." />
        </Card>
      </div>

      <Card title="Why GuardGrid" subtitle="From reactive repair to prevention">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="grid grid-cols-3 gap-2 h-fit">
            <div className="tile"><p className="label-caps">Incidents</p><p className="text-lg font-bold text-fg">{meta.programme.incidents}</p><p className="text-[10px] text-fg-faint">since 2020</p></div>
            <div className="tile"><p className="label-caps">Repairs</p><p className="text-lg font-bold text-fg">RM {(meta.programme.totalCostRM / 1e6).toFixed(2)}M</p><p className="text-[10px] text-fg-faint">recorded cost</p></div>
            <div className="tile"><p className="label-caps">Residents</p><p className="text-lg font-bold text-fg">{meta.programme.residentsAffected.toLocaleString('en-MY')}</p><p className="text-[10px] text-fg-faint">affected by outages</p></div>
          </div>
          <ul className="space-y-2">
            {STRATEGY.map((s) => (
              <li key={s.title}>
                <button type="button" onClick={() => navigate(s.path)} className="w-full text-left flex gap-2.5 items-start group">
                  <span className="stat-card-icon !w-7 !h-7"><Icon name={s.icon} size={15} /></span>
                  <span>
                    <span className="text-xs font-bold text-fg group-hover:text-primary">{s.title}</span> <Ms>{s.ms}</Ms>
                    <span className="block text-[11px] text-fg-muted leading-snug">{s.text}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {kpi && <KpiDrawer kind={kpi} onClose={() => setKpi(null)} onOpen={(p) => { setKpi(null); setPanel(p); }} />}
      <EntityDrawer panel={panel} onChange={setPanel} />
      {confirmReset && (
        <Modal title="Reset demo data?" onClose={() => setConfirmReset(false)}
          footer={<><Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="danger" onClick={resetDemo}>Reset</Button></>}>
          <p className="text-sm text-fg-muted">This removes alerts, tasks, scrap submissions, review decisions and briefs created in this browser. The mock seed data stays.</p>
        </Modal>
      )}
    </div>
  );
}
