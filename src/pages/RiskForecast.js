import React, { useState } from 'react';
import { PageHeader, Card, Badge, ProgressBar, Tabs, Icon, DataTable } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import AssetMap from '../components/guard/AssetMap';
import { Title, Ms } from '../components/guard/common';
import { useData } from '../data/DataProvider';
import { BAND, RISK_BANDS, FEATURE_NAMES, GROUPS, bandFor } from '../ai/riskModel';
import { mytParts, mytDayStart, DAY, DAYS_EN, formatMyt } from '../ai/time';
import { ASSET_TYPES, ZONE_TONE } from '../data/reference';

const FEATURE_LABEL = {
  zone_SEM: 'Zone: Bulatan Semariang', zone_KUL: 'Zone: Jalan Kulas Bridge', zone_BIN: 'Zone: Jambatan Amar Juma\'ani',
  fri_sat_night: 'Friday/Saturday night', hour_sin: 'Hour (sine)', hour_cos: 'Hour (cosine)',
  lights_out: 'Share of streetlights dark', incidents_30d: 'Incidents in last 30 days', dealer_km: 'Km to nearest scrap dealer',
};
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const dayLabel = (t) => { const p = mytParts(t); return `${DAYS_EN[p.dow]} ${p.day}`; };

function HeatGrid({ heat, start }) {
  return (
    <div className="overflow-x-auto">
      <div className="heat-grid" style={{ minWidth: 560 }}>
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="heat-head">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
        {heat.map((row, d) => (
          <React.Fragment key={d}>
            <span className="heat-head text-left font-semibold">{dayLabel(start + d * DAY)}</span>
            {row.map((p, h) => (
              <span key={h} className="heat-cell" title={`${dayLabel(start + d * DAY)} ${hh(h)} · score ${p.toFixed(2)}`}
                style={{ background: `var(--color-${ZONE_TONE[bandFor(p)]})`, opacity: 0.2 + 0.8 * p }} />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function RiskForecast() {
  const { zones, assets, dealers, risk, meta, incidents } = useData();
  const [zoneTab, setZoneTab] = useState(null);

  if (!risk.ready) {
    return (
      <div className="space-y-4">
        <PageHeader title={<Title en="Risk Forecast" ms="Ramalan Risiko" />} />
        <Card><p className="text-sm text-fg-muted flex items-center gap-2"><Icon name="cpu" />Training the logistic regression on {incidents.length} incidents…</p></Card>
      </div>
    );
  }

  const { forecast, route, model } = risk;
  const active = zoneTab || forecast[0].zone;
  const sel = forecast.find((f) => f.zone === active);
  const start = mytDayStart(Date.now());
  const zoneOf = (id) => zones.find((z) => z.id === id);
  const bands = Object.fromEntries(forecast.map((f) => [f.zone, f.band]));

  return (
    <div className="space-y-4">
      <PageHeader
        title={<Title en="Risk Forecast" ms="Ramalan Risiko" />}
        subtitle={`7-day hotspot risk from a logistic regression trained in your browser on ${model.positives} incidents and ${model.negatives.toLocaleString()} sampled normal hours (2020–${mytParts(Date.now()).year}).`}
        actions={<><Badge tone="accent" dot>Training AUC {model.auc}</Badge><Badge tone="neutral">Updated {formatMyt(Date.now(), 'time')} MYT</Badge></>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {forecast.map((f, i) => {
          const z = zoneOf(f.zone);
          const maxC = Math.max(...f.reasons.map((r) => r.value), 0.01);
          return (
            <Card key={f.zone} className={active === f.zone ? 'ring-2 ring-primary' : ''} bodyClassName="space-y-3">
              <button type="button" className="w-full text-left space-y-3" onClick={() => setZoneTab(f.zone)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="label-caps">Rank #{i + 1} · Kedudukan</p>
                    <p className="text-sm font-bold text-fg leading-snug">{z.name}</p>
                  </div>
                  <Badge tone={ZONE_TONE[f.band]} dot>{f.band.toUpperCase()} · {BAND[f.band].labelMs}</Badge>
                </div>
                <div className="flex items-end gap-3">
                  <span className="text-3xl font-extrabold text-fg leading-none">{f.risk.toFixed(2)}</span>
                  <span className="text-[11px] text-fg-faint pb-0.5">7-day risk · peak {f.peak.p.toFixed(2)} on {DAYS_EN[f.features.nightOf]} night around {hh(f.peak.hour)}</span>
                </div>
                <ProgressBar value={f.risk} max={1} tone={ZONE_TONE[f.band]} />
              </button>
              <div className="pt-2 border-t">
                <p className="label-caps mb-2">Top 3 reasons <Ms>Sebab utama</Ms></p>
                <ol className="space-y-2">
                  {f.reasons.map((r, k) => (
                    <li key={r.key} className="flex gap-2">
                      <span className="w-4 h-4 rounded-full bg-primary text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5" style={{ color: 'var(--color-on-primary)' }}>{k + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-fg">{r.label}</span>
                          <span className="flex-1 h-1 rounded bg-surface-raised"><span className="block h-1 rounded bg-primary" style={{ width: `${(r.value / maxC) * 100}%` }} /></span>
                        </span>
                        <span className="block text-[11px] text-fg-muted leading-snug">{r.text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <AssetMap assets={assets} zones={zones} zoneBands={bands} dealers={dealers} route={{ ...route, base: meta.patrolBase }} heat height={520} />
        </div>
        <Card padded={false} title={<span>Night patrol route <Ms>Laluan rondaan malam</Ms></span>}
          subtitle={`Ordered by risk · depart 22:30 · ≈ ${route.km} km (straight-line × 1.35)`} bodyClassName="max-h-[460px] overflow-y-auto">
          <ol>
            <li className="px-4 py-2.5 border-b text-xs flex items-center gap-2 text-fg-faint"><Icon name="home" size={14} />Start: {meta.patrolBase.name} · 22:30</li>
            {route.stops.map((s, i) => (
              <li key={s.asset.id} className="px-4 py-2.5 border-b flex gap-3">
                <span className="route-stop shrink-0" style={{ position: 'static' }}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-fg">{s.asset.id} <span className="font-normal text-fg-faint">{ASSET_TYPES[s.asset.type].label}</span></span>
                    <span className="font-mono text-[11px] text-fg">{s.eta}</span>
                  </span>
                  <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <Badge tone={ZONE_TONE[s.band]}>{zoneOf(s.zone).short}</Badge>
                    {s.why.map((w) => <span key={w} className="text-[10px] text-fg-faint">{w}</span>)}
                  </span>
                </span>
              </li>
            ))}
            {route.revisit && (
              <li className="px-4 py-3 text-xs tile tone-warning m-3">
                Second pass: return to {zoneOf(route.revisit.zone).short} around {hh(route.revisit.hour)}, the model's peak hour.
              </li>
            )}
          </ol>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title={<span>Hourly risk, next 7 days <Ms>Peta haba risiko</Ms></span>}
          subtitle="Model score per hour. Colour shows the band; darker is higher."
          actions={<Tabs size="sm" value={active} onChange={setZoneTab} tabs={forecast.map((f) => ({ value: f.zone, label: zoneOf(f.zone).short }))} />}>
          <HeatGrid heat={sel.heat} start={start} />
          <div className="flex gap-4 mt-3 text-[10px] text-fg-faint">
            <span><span className="legend-dot" style={{ background: 'var(--color-success)' }} />Low &lt; {RISK_BANDS.medium}</span>
            <span><span className="legend-dot" style={{ background: 'var(--color-warning)' }} />Medium {RISK_BANDS.medium}–{RISK_BANDS.high}</span>
            <span><span className="legend-dot" style={{ background: 'var(--color-danger)' }} />High &gt; {RISK_BANDS.high}</span>
          </div>
        </Card>
        <ChartCard title="Nightly peak score" subtitle="Highest hourly score each night, 22:00–06:00" legend height={230} yMax={1}
          data={{
            labels: sel.nightly.map((n) => dayLabel(n.date)),
            datasets: forecast.map((f, i) => ({ label: zoneOf(f.zone).short, data: f.nightly.map((n) => n.p), color: ['chart-1', 'chart-4', 'chart-3'][i], fill: false })),
          }}
          thresholds={[{ value: RISK_BANDS.high, tone: 'danger', label: 'High' }, { value: RISK_BANDS.medium, tone: 'warning', label: 'Medium' }]} />
      </div>

      <Card title="How the model works" subtitle="Transparent by design: every weight is visible" padded={false}>
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div className="p-4 space-y-2 text-xs text-fg-muted leading-relaxed border-b lg:border-b-0 lg:border-r">
            <p><b className="text-fg">Training data.</b> Each of the {model.positives} incident hours is a positive example; two random hours per zone per day since 2020 are negatives ({model.negatives.toLocaleString()} rows). Positives are re-weighted so both classes count equally.</p>
            <p><b className="text-fg">Features.</b> {Object.values(GROUPS).map((g) => g.label).join(', ')}. Lighting status comes from the outage history; dealer distance uses the dealers licensed at that time.</p>
            <p><b className="text-fg">Output.</b> A 0–1 relative risk score per zone-hour. The 7-day risk is the average of each night's peak score. Low &lt; {RISK_BANDS.medium}, Medium {RISK_BANDS.medium}–{RISK_BANDS.high}, High &gt; {RISK_BANDS.high}.</p>
            <p><b className="text-fg">Reasons.</b> The top 3 positive contributions at the zone's peak hour, measured against an average night across the network.</p>
            <p><b className="text-fg">Live inputs.</b> Dark streetlights and new HIGH alerts update the forecast immediately.</p>
          </div>
          <DataTable
            rowKey="name"
            rows={FEATURE_NAMES.map((name, j) => ({ name, w: model.weights[j] }))}
            columns={[
              { key: 'name', header: 'Feature', strong: true, render: (r) => FEATURE_LABEL[r.name] },
              {
                key: 'w', header: 'Standardised weight',
                render: (r) => (
                  <span className="flex items-center gap-2">
                    <span className="w-24 h-1.5 rounded bg-surface-raised relative">
                      <span className="absolute h-1.5 rounded" style={{ left: r.w >= 0 ? '50%' : `${50 + Math.max(-50, (r.w / 2) * 50)}%`, width: `${Math.min(50, Math.abs(r.w / 2) * 50)}%`, background: `var(--color-${r.w >= 0 ? 'danger' : 'success'})` }} />
                    </span>
                    <span className="font-mono">{r.w >= 0 ? '+' : ''}{r.w.toFixed(2)}</span>
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
