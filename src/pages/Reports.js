import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Card, Button, Badge, Tabs, DataTable, DetailGrid, Icon } from '../components/ui';
import { Title, Ms, LlmBadge, LevelBadge, StatusBadge, SourceIcon } from '../components/guard/common';
import { useData, zoneName } from '../data/DataProvider';
import { eventFromAlert, eventFromIncident, buildCaseFile, offlineBrief } from '../services/caseFile';
import { generateBrief } from '../services/llm';
import { buildReportPdf } from '../services/pdf';
import { formatMyt } from '../ai/time';
import { formatRM } from '../data/reference';

function Section({ title, ms, children }) {
  return (
    <div className="space-y-1.5">
      <p className="label-caps text-primary">{title} {ms && <Ms>{ms}</Ms>}</p>
      {children}
    </div>
  );
}

function BriefView({ brief, caseFile, images }) {
  return (
    <div className="space-y-4 text-sm text-fg">
      <div>
        <h2 className="text-base font-bold leading-snug">{brief.title}</h2>
        <p className="text-[11px] text-fg-faint">Ref {caseFile.reference} · drafted by {brief.model}</p>
      </div>
      <Section title="Summary" ms="Ringkasan">
        <p className="text-xs leading-relaxed">{brief.summary}</p>
        <p className="text-xs italic text-fg-muted leading-relaxed">{brief.ringkasanBM}</p>
      </Section>
      <DetailGrid columns={1} items={[{ label: 'What · Apa', value: <span className="text-xs font-normal">{brief.what}</span> }, { label: 'Where · Di mana', value: <span className="text-xs font-normal">{brief.where}</span> }, { label: 'When · Bila', value: <span className="text-xs font-normal">{brief.when}</span> }]} />
      {brief.sequenceOfEvents?.length > 0 && (
        <Section title="Sequence of events">
          <ul className="space-y-1">{brief.sequenceOfEvents.map((s, i) => <li key={i} className="text-xs"><span className="font-mono text-fg-faint mr-2">{s.time}</span>{s.event}</li>)}</ul>
        </Section>
      )}
      <Section title="Evidence" ms="Bukti">
        <ul className="space-y-1">{brief.evidence.map((e) => <li key={e.ref} className="text-xs"><b>{e.ref}</b> {e.description}</li>)}</ul>
        {images.map((img, i) => <figure key={i}><img src={img.dataUrl} alt={img.caption} className="rounded-lg border max-h-72" /><figcaption className="text-[10px] text-fg-faint">E{i + 1}. {img.caption}</figcaption></figure>)}
      </Section>
      <Section title="Linked suspicious scrap sales" ms="Jualan besi buruk berkaitan">
        {brief.linkedScrapSales.length ? (
          <ul className="space-y-1">{brief.linkedScrapSales.map((s) => <li key={s.transactionId} className="text-xs"><b>{s.transactionId}</b> {s.relevance}</li>)}</ul>
        ) : <p className="text-xs text-fg-faint">None within 14 days and 15 km.</p>}
      </Section>
      <Section title="Estimated loss" ms="Anggaran kerugian">
        <p className="text-lg font-bold">{formatRM(caseFile.estimatedLoss.totalRM)}</p>
        <p className="text-xs text-fg-muted">{brief.lossBasis}</p>
      </Section>
      <div className="grid sm:grid-cols-2 gap-4">
        <Section title="Requested police actions"><ul className="list-disc list-inside space-y-1 text-xs">{brief.requestedPoliceActions.map((a) => <li key={a}>{a}</li>)}</ul></Section>
        <Section title="DBKU actions"><ul className="list-disc list-inside space-y-1 text-xs">{brief.dbkuActions.map((a) => <li key={a}>{a}</li>)}</ul></Section>
      </div>
    </div>
  );
}

export default function Reports() {
  const data = useData();
  const { alerts, incidents, assets, llm, briefs, saveBrief, risk } = data;
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('event')?.startsWith('INC') ? 'incidents' : 'alerts');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  // HIGH alerts first; the sort is stable, so each group stays newest-first.
  const alertEvents = useMemo(() => [...alerts].sort((a, b) => (b.level === 'HIGH') - (a.level === 'HIGH')), [alerts]);
  const incidentList = useMemo(() => [...incidents].reverse(), [incidents]);
  // Default: the newest active HIGH alert, else the newest confirmed theft.
  const selectedId = params.get('event')
    || alertEvents.find((a) => a.level === 'HIGH' && ['open', 'acknowledged', 'dispatched'].includes(a.status))?.id
    || alertEvents.find((a) => a.status === 'confirmed_theft')?.id
    || incidentList[0]?.id;
  const select = (id) => setParams({ event: id });

  const event = useMemo(() => {
    const a = alerts.find((x) => x.id === selectedId);
    if (a) return eventFromAlert(a, assets);
    const i = incidents.find((x) => x.id === selectedId);
    return i ? eventFromIncident(i, assets) : null;
  }, [selectedId, alerts, incidents, assets]);

  const caseFile = useMemo(() => (event ? buildCaseFile(event, { ...data, forecast: risk.forecast }) : null), [event, data, risk.forecast]);
  const images = event?.alert?.evidence?.snapshot
    ? [{ dataUrl: event.alert.evidence.snapshot, caption: `CCTV snapshot, ${event.alert.evidence.cameraId || 'uploaded footage'}, ${formatMyt(event.alert.evidence.capturedAt || event.time)} MYT, threat score ${event.alert.score}` }]
    : [];
  const saved = event && briefs[event.id];

  const generate = async () => {
    setBusy(true);
    setNotice(null);
    let brief;
    if (llm.enabled) {
      try {
        brief = await generateBrief({ context: caseFile, images });
      } catch (e) {
        setNotice(`The LLM call failed (${e.message}). Used the offline template instead.`);
        brief = offlineBrief(caseFile, event);
      }
    } else {
      setNotice(`No LLM configured (${llm.reason}). Used the offline template.`);
      brief = offlineBrief(caseFile, event);
    }
    saveBrief(event.id, { brief, caseFile, generatedAt: new Date().toISOString() });
    setBusy(false);
  };

  const download = async () => {
    const doc = await buildReportPdf({ brief: saved.brief, caseFile: saved.caseFile, images });
    doc.save(`GuardGrid_${event.id}_PDRM_brief.pdf`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={<Title en="Reports" ms="Laporan" />}
        subtitle="Turn an alert or incident into a structured brief for PDRM: what, where, when, evidence, linked scrap sales and estimated loss."
        actions={<LlmBadge llm={llm} />}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card padded={false} title="Events" subtitle="Choose what to report"
          actions={<Tabs size="sm" value={tab} onChange={setTab} tabs={[{ value: 'alerts', label: `Alerts (${alerts.length})` }, { value: 'incidents', label: `Incidents (${incidents.length})` }]} />}
          bodyClassName="max-h-[640px] overflow-y-auto">
          <ul>
            {(tab === 'alerts' ? alertEvents : incidentList).map((x) => {
              const isAlert = tab === 'alerts';
              const active = x.id === selectedId;
              return (
                <li key={x.id}>
                  <button type="button" onClick={() => select(x.id)}
                    className={`w-full text-left px-4 py-3 border-b flex gap-3 transition-colors ${active ? 'bg-primary-soft' : 'hover:bg-surface-raised'}`}>
                    <span className="text-fg-faint mt-0.5">{isAlert ? <SourceIcon source={x.source} /> : <Icon name="fileText" size={14} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 flex-wrap">
                        {isAlert ? <LevelBadge level={x.level} /> : <Badge tone="neutral">{x.typeLabel}</Badge>}
                        {briefs[x.id] && <Badge tone="accent">Brief ready</Badge>}
                      </span>
                      <span className="block text-xs font-semibold text-fg mt-1">{x.title}</span>
                      <span className="block text-[10px] text-fg-faint">{x.id} · {formatMyt(isAlert ? x.createdAt : x.occurredAt, 'short')} · {zoneName(x.zone)}{!isAlert && ` · ${formatRM(x.costRM)}`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="xl:col-span-2 space-y-4">
          {!event && <Card><p className="text-sm text-fg-faint">Select an event.</p></Card>}
          {event && caseFile && (
            <>
              <Card
                title={<span className="flex items-center gap-2 flex-wrap">{caseFile.event.title} {event.kind === 'alert' && <StatusBadge status={event.status} />}</span>}
                subtitle={`Case file ${caseFile.reference}`}
                actions={
                  <Button variant="accent" icon="sparkles" disabled={busy} onClick={generate}>
                    {busy ? 'Drafting…' : saved ? 'Regenerate' : 'Generate Police Report'}
                  </Button>
                }
              >
                <div className="space-y-4">
                  <DetailGrid columns={3} items={[
                    { label: 'What', value: caseFile.event.type },
                    { label: 'When (MYT)', value: caseFile.event.occurredAt.replace(' MYT', '') },
                    { label: 'Where', value: `${caseFile.location.asset?.id} · ${zoneName(event.zone)}` },
                    { label: 'Detected by', value: caseFile.event.detectedBy },
                    { label: 'Estimated loss', value: formatRM(caseFile.estimatedLoss.totalRM) },
                    { label: 'Linked scrap sales', value: caseFile.linkedScrapSales.length },
                  ]} />
                  {images.length > 0 && <img src={images[0].dataUrl} alt="Evidence snapshot" className="rounded-lg border max-h-64" />}
                  <div>
                    <p className="label-caps mb-1">Evidence <Ms>Bukti</Ms></p>
                    <ul className="space-y-1">{caseFile.evidence.map((e) => <li key={e.ref} className="text-xs text-fg-muted"><b className="text-fg">{e.ref} · {e.kind}.</b> {e.summary}</li>)}</ul>
                  </div>
                  <div>
                    <p className="label-caps mb-1">Linked suspicious scrap sales <Ms>(14 days after, within 15 km)</Ms></p>
                    <DataTable
                      rowKey="transactionId"
                      rows={caseFile.linkedScrapSales}
                      emptyText="No flagged sales in the window."
                      columns={[
                        { key: 'transactionId', header: 'Sale', mono: true },
                        { key: 'dealer', header: 'Dealer', render: (s) => s.dealer },
                        { key: 'material', header: 'Material', strong: true, render: (s) => `${s.material}, ${s.weightKg} kg` },
                        { key: 'when', header: 'After / distance', render: (s) => `${s.daysAfterEvent} d · ${s.kmFromSite} km` },
                        { key: 'flags', header: 'Flags', render: (s) => <span className="text-[11px]">{s.screeningFlags.join('; ')}</span> },
                      ]}
                    />
                  </div>
                  <div className="tile">
                    <p className="label-caps mb-1">Estimated loss <Ms>{caseFile.estimatedLoss.basis}</Ms></p>
                    {caseFile.estimatedLoss.items.map((i) => <p key={i.item} className="flex justify-between text-xs"><span className="text-fg-muted">{i.item}</span><b className="text-fg">{formatRM(i.rm)}</b></p>)}
                  </div>
                  {notice && <p className="tile tone-warning text-xs">{notice}</p>}
                </div>
              </Card>

              {saved && (
                <Card
                  title={<span>Police report draft <Ms>Draf laporan polis</Ms></span>}
                  subtitle={`Generated ${formatMyt(saved.generatedAt)} MYT · ${saved.brief.model}`}
                  actions={<Button icon="download" onClick={download}>Download PDF</Button>}
                >
                  <BriefView brief={saved.brief} caseFile={saved.caseFile} images={images} />
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
