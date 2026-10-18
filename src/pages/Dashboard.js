import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, StatCard, StatGrid, Card, FilterChips, Tabs, Badge, Button, ProgressBar, Modal, Icon } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import AssetMap from '../components/guard/AssetMap';
import AlertFeed from '../components/guard/AlertFeed';
import AlertDrawer from '../components/guard/AlertDrawer';
import { Title, Ms } from '../components/guard/common';
import { useData } from '../data/DataProvider';
import { useSensors } from '../data/SensorProvider';
import { isActive, formatRMShort, ZONE_TONE } from '../data/reference';
import { BAND } from '../ai/riskModel';
import { mytParts } from '../ai/time';

const STRATEGY = [
  { icon: 'shield', title: 'Protect', ms: 'Lindungi', text: 'AI CCTV and tamper sensors catch intruders before cables are pulled.', path: '/cctv' },
  { icon: 'recycle', title: 'Trace', ms: 'Jejak', text: 'Scrap sales screened under the Second-Hand Dealers Act 1946.', path: '/scrap' },
  { icon: 'users', title: 'Coordinate', ms: 'Selaras', text: 'Briefs for PDRM, Sarawak Energy and the Ministry of Utility & Telecommunication.', path: '/reports' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { zones, assets, cameras, alerts, kpis, risk, incidents, meta, resetDemo } = useData();
  const { running } = useSensors();
  const [zone, setZone] = useState('all');
  const [feed, setFeed] = useState('active');
  const [selected, setSelected] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const inZone = (x) => zone === 'all' || x.zone === zone;
  const feedAlerts = alerts.filter(inZone).filter((a) => (feed === 'active' ? isActive(a) : true));
  const zoneBands = risk.ready ? Object.fromEntries(risk.forecast.map((f) => [f.zone, f.band])) : undefined;
  const darkLights = assets.filter((a) => a.lighting === 'out').length;
  const offline = assets.filter((a) => a.sensor === 'offline').length;

  const byYear = useMemo(() => {
    const years = Array.from({ length: 7 }, (_, i) => 2020 + i);
    return {
      labels: years.map(String),
      datasets: zones.map((z, i) => ({
        label: z.short,
        data: years.map((y) => incidents.filter((x) => x.zone === z.id && mytParts(x.occurredAt).year === y).length),
        color: ['chart-1', 'chart-4', 'chart-3'][i],
      })),
    };
  }, [zones, incidents]);

  const openAsset = (a) => { if (a.openAlerts?.length) setSelected(a.openAlerts[0].id); };

  return (
    <div className="space-y-4">
      <PageHeader
        title={<Title en="Command Dashboard" ms="Pusat Kawalan" />}
        subtitle="Live alerts, asset status and this week's risk across DBKU's three theft hotspots"
        actions={
          <>
            <FilterChips label="Zone" value={zone} onChange={setZone}
              options={[{ value: 'all', label: 'All' }, ...zones.map((z) => ({ value: z.id, label: z.short }))]} />
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => setConfirmReset(true)}>Reset demo</Button>
          </>
        }
      />

      <StatGrid>
        <StatCard label="Alerts today" sublabel="Amaran hari ini" value={kpis.alertsToday} icon="bell"
          status={kpis.highToday ? 'critical' : kpis.alertsToday ? 'warning' : 'normal'}
          subValues={[{ label: 'High', value: kpis.highToday }, { label: 'Active now', value: kpis.activeAlerts }]} />
        <StatCard label="Assets at risk" sublabel="Aset berisiko" value={kpis.assetsAtRisk} unit={`/ ${assets.length}`} icon="alert"
          status={assets.some((a) => a.status === 'alert') ? 'critical' : 'warning'}
          subValues={[{ label: 'Active alert', value: assets.filter((a) => a.status === 'alert').length }, { label: 'Dark lights', value: darkLights }, { label: 'Sensor offline', value: offline }]} />
        <StatCard label="RM loss avoided" sublabel="Kerugian dielakkan" value={formatRMShort(kpis.lossAvoidedRM)} icon="shield"
          subValues={[{ label: 'Intercepted', value: kpis.intercepted }, { label: 'Pilot since', value: '1 Sep' }]} />
        <StatCard label="Suspicious scrap sales" sublabel="Jualan besi buruk disyaki" value={kpis.flagged} icon="recycle"
          status={kpis.flaggedPending ? 'warning' : 'normal'} onDetails={() => navigate('/scrap')}
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
          actions={<>{running && <Badge tone="success" dot>LIVE</Badge>}<Tabs size="sm" value={feed} onChange={setFeed} tabs={[{ value: 'active', label: 'Active' }, { value: 'all', label: 'All' }]} /></>}
          className="flex flex-col"
          bodyClassName="overflow-y-auto flex-1 min-h-0"
          style={{ height: 540 }}
        >
          <AlertFeed alerts={feedAlerts} onSelect={(a) => setSelected(a.id)} emptyText={feed === 'active' ? 'No active alerts. Try the CCTV Analyzer or inject a sensor fault.' : 'No alerts.'} />
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(risk.ready ? risk.forecast : []).filter(inZone).map((f, i) => {
          const z = zones.find((x) => x.id === f.zone);
          return (
            <Card key={f.zone} hoverable className="cursor-pointer" bodyClassName="space-y-2">
              <button type="button" className="w-full text-left space-y-2" onClick={() => navigate('/risk')}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="label-caps">#{i + 1} this week · Ramalan 7 hari</p>
                    <p className="text-sm font-bold text-fg">{z.short}</p>
                  </div>
                  <Badge tone={ZONE_TONE[f.band]} dot>{f.band} · {BAND[f.band].labelMs}</Badge>
                </div>
                <ProgressBar value={f.risk} max={1} tone={ZONE_TONE[f.band]} />
                <p className="text-[11px] text-fg-muted leading-snug">{f.reasons[0]?.text}</p>
              </button>
            </Card>
          );
        })}
        {!risk.ready && <Card className="md:col-span-3"><p className="text-xs text-fg-faint">Training the hotspot risk model…</p></Card>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard className="lg:col-span-2" title="Incidents per year by hotspot" subtitle={`${meta.programme.incidents} incidents since 2020 · RM ${(meta.programme.totalCostRM / 1e6).toFixed(2)}M in repairs`}
          type="bar" stacked legend height={220} data={byYear} />
        <Card title="Why GuardGrid" subtitle="From reactive repair to prevention">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="tile"><p className="label-caps">Incidents</p><p className="text-lg font-bold text-fg">{meta.programme.incidents}</p></div>
            <div className="tile"><p className="label-caps">Repairs</p><p className="text-lg font-bold text-fg">RM {(meta.programme.totalCostRM / 1e6).toFixed(2)}M</p></div>
            <div className="tile"><p className="label-caps">Residents</p><p className="text-lg font-bold text-fg">{meta.programme.residentsAffected.toLocaleString('en-MY')}</p></div>
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
        </Card>
      </div>

      {selected && <AlertDrawer alertId={selected} onClose={() => setSelected(null)} />}
      {confirmReset && (
        <Modal title="Reset demo data?" onClose={() => setConfirmReset(false)}
          footer={<><Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="danger" onClick={resetDemo}>Reset</Button></>}>
          <p className="text-sm text-fg-muted">This removes alerts, scrap submissions, review decisions and briefs created in this browser. The mock seed data stays.</p>
        </Modal>
      )}
    </div>
  );
}
