import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs, StatGrid, StatCard, Card, Button, Badge, DataTable, Modal, DetailGrid, FilterChips, Icon } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import { Title, Ms, LlmBadge, readAsDataUrl, downscale } from '../components/guard/common';
import { useData } from '../data/DataProvider';
import { screenTransactions, hashIc, maskIc, MATERIALS, MATERIALS_MS, RULE_INFO, PHOTO_LABELS, SCRAP_RULES } from '../ai/scrapScreening';
import { LINK_RULES } from '../ai/linking';
import { distanceKm } from '../ai/geo';
import { classifyPhoto } from '../services/llm';
import { toMytInput, fromMytInput, formatMyt, DAY } from '../ai/time';
import { REVIEW_STATUS, formatRM } from '../data/reference';

const EMPTY = { dealerId: 'D04', ic: '', material: 'Aluminium', weightKg: '', pricePerKgRM: '', date: toMytInput(Date.now()), photo: null };
const EXAMPLES = {
  normal: { dealerId: 'D06', ic: '900214-13-5521', material: 'Aluminium', weightKg: '38', pricePerKgRM: '5.10' },
  suspicious: { dealerId: 'D04', ic: '880707-13-6187', material: 'Copper cable', weightKg: '68', pricePerKgRM: '31.50' },
};

function FlagBadges({ flags }) {
  return <span className="flex flex-wrap gap-1">{flags.map((f) => <Badge key={f.rule} tone="danger">{RULE_INFO[f.rule].label}</Badge>)}</span>;
}

/* ─── Submit form ─────────────────────────────────────────── */
function SubmitSale() {
  const navigate = useNavigate();
  const { dealers, transactions, submitTransaction, llm } = useData();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onPhoto = async (file) => {
    if (!file) return set('photo', null);
    const dataUrl = await downscale(await readAsDataUrl(file), 1024);
    set('photo', { name: file.name, dataUrl });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const digits = form.ic.replace(/\D/g, '');
    if (digits.length !== 12) return setError('Enter the seller\'s 12-digit MyKad number.');
    if (!(+form.weightKg > 0)) return setError('Enter the weight in kg.');
    setBusy(true);
    try {
      let photo = { label: null, description: 'No photo provided', source: 'none' };
      if (form.photo) {
        const thumbnail = await downscale(form.photo.dataUrl, 320, 0.7);
        try {
          const c = await classifyPhoto({ dataUrl: form.photo.dataUrl, declaredMaterial: form.material });
          photo = { label: c.label, description: c.description, confidence: c.confidence, indicators: c.infrastructureIndicators, source: `LLM vision (${c.model})`, thumbnail };
        } catch (err) {
          photo = { label: null, description: `Not classified: ${err.message}`, source: 'unclassified', thumbnail };
        }
      }
      const maxN = Math.max(...transactions.map((t) => +t.id.slice(3)));
      const tx = {
        id: `TX-${String(maxN + 1).padStart(4, '0')}`,
        dealerId: form.dealerId,
        date: fromMytInput(form.date).toISOString(),
        sellerId: await hashIc(digits),
        sellerIcMasked: maskIc(digits),
        material: form.material,
        weightKg: +(+form.weightKg).toFixed(1),
        pricePerKgRM: form.pricePerKgRM ? +form.pricePerKgRM : null,
        photo,
        submitted: true,
      };
      const screened = screenTransactions([...transactions, tx])[tx.id];
      submitTransaction(tx);
      setResult({ tx, screened });
      setForm({ ...EMPTY, date: toMytInput(Date.now()) });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
      <Card className="xl:col-span-3" title={<span>Record a purchase <Ms>Rekod pembelian</Ms></span>}
        subtitle="Dealer submission. The IC is hashed in the browser; only the last 4 digits are stored."
        actions={<><Button size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, ...EXAMPLES.normal }))}>Example: normal</Button><Button size="sm" variant="soft" onClick={() => setForm((f) => ({ ...f, ...EXAMPLES.suspicious }))}>Example: suspicious</Button></>}>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block sm:col-span-2">
            <span className="label-caps field-label">Dealer · Peniaga</span>
            <select className="select" value={form.dealerId} onChange={(e) => set('dealerId', e.target.value)}>
              {dealers.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.licenceNo}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label-caps field-label">Seller IC · No. KP penjual</span>
            <input className="input font-mono" inputMode="numeric" placeholder="YYMMDD-PB-####" value={form.ic} onChange={(e) => set('ic', e.target.value)} autoComplete="off" />
          </label>
          <label className="block">
            <span className="label-caps field-label">Date and time (MYT) · Tarikh</span>
            <input type="datetime-local" className="input" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </label>
          <label className="block">
            <span className="label-caps field-label">Material · Jenis bahan</span>
            <select className="select" value={form.material} onChange={(e) => set('material', e.target.value)}>
              {MATERIALS.map((m) => <option key={m} value={m}>{m} · {MATERIALS_MS[m]}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label-caps field-label">Weight (kg) · Berat</span>
              <input type="number" min="0" step="0.1" className="input" value={form.weightKg} onChange={(e) => set('weightKg', e.target.value)} />
            </label>
            <label className="block">
              <span className="label-caps field-label">RM / kg</span>
              <input type="number" min="0" step="0.01" className="input" value={form.pricePerKgRM} onChange={(e) => set('pricePerKgRM', e.target.value)} />
            </label>
          </div>
          <label className="block sm:col-span-2">
            <span className="label-caps field-label">Photo of the load · Foto</span>
            <input type="file" accept="image/*" className="input" onChange={(e) => onPhoto(e.target.files[0])} />
            <span className="text-[10px] text-fg-faint">An LLM vision call labels it as one of: {PHOTO_LABELS.join(' · ')}.</span>
          </label>
          {form.photo && <img src={form.photo.dataUrl} alt="Load preview" className="sm:col-span-2 max-h-48 rounded-lg border object-contain" />}
          {error && <p className="sm:col-span-2 tile tone-danger text-xs">{error}</p>}
          <div className="sm:col-span-2 flex items-center justify-between gap-2 pt-1">
            <LlmBadge llm={llm} />
            <Button type="submit" icon="check" disabled={busy}>{busy ? 'Screening…' : 'Submit and screen · Hantar'}</Button>
          </div>
        </form>
      </Card>

      <Card className="xl:col-span-2" title="Screening result" subtitle="Rules run on every submission">
        {!result && (
          <ul className="space-y-2 text-xs text-fg-muted">
            {Object.entries(RULE_INFO).map(([k, r]) => (
              <li key={k} className="tile"><b className="text-fg">{r.label}</b> <Ms>{r.labelMs}</Ms></li>
            ))}
            <li className="text-[11px] text-fg-faint">Repeat sellers are matched across all dealers through the hashed IC.</li>
          </ul>
        )}
        {result && (
          <div className="space-y-3">
            <div className={`tile tone-${result.screened.suspicious ? 'danger' : 'success'}`}>
              <p className="text-sm font-bold">{result.screened.suspicious ? 'Flagged: sent to the PDRM review queue' : 'Recorded: no rules triggered'}</p>
              <p className="text-[11px] text-fg-muted">{result.tx.id} · {result.tx.material} {result.tx.weightKg} kg · seller {result.tx.sellerIcMasked} (ref {result.tx.sellerId})</p>
              {result.screened.suspicious && <button type="button" className="link-btn mt-1" onClick={() => navigate(`/scrap?review=${result.tx.id}`)}>REVIEW IT NOW</button>}
            </div>
            {result.screened.flags.map((f) => (
              <div key={f.rule} className="tile text-xs"><b className="text-fg">{RULE_INFO[f.rule].label}</b><p className="text-fg-muted">{f.detail}</p></div>
            ))}
            <div className="tile text-xs flex gap-3">
              {result.tx.photo.thumbnail && <img src={result.tx.photo.thumbnail} alt="" className="w-20 h-20 object-cover rounded" />}
              <div>
                <p className="label-caps mb-1">Photo</p>
                <p className="text-fg font-semibold">{result.tx.photo.label || 'Not classified'}{result.tx.photo.confidence != null ? ` (${Math.round(result.tx.photo.confidence * 100)}%)` : ''}</p>
                <p className="text-fg-muted">{result.tx.photo.description}</p>
                {result.tx.photo.indicators?.length > 0 && <p className="text-fg-faint mt-1">Signs: {result.tx.photo.indicators.join(', ')}</p>}
                <p className="text-[10px] text-fg-faint mt-1">{result.tx.photo.source}</p>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── Review queue ────────────────────────────────────────── */
function linkedEvents(tx, dealer, incidents, alerts, assets) {
  const t = Date.parse(tx.date);
  const events = [
    ...incidents.map((i) => { const a = assets.find((x) => x.id === i.assetIds[0]); return { id: i.id, title: i.title, time: Date.parse(i.occurredAt), lat: a.lat, lng: a.lng, kind: 'Incident' }; }),
    ...alerts.filter((a) => a.level === 'HIGH' && a.status !== 'false_alarm').map((a) => ({ id: a.id, title: a.title, time: Date.parse(a.createdAt), lat: a.lat, lng: a.lng, kind: 'Alert' })),
  ];
  return events
    .map((e) => ({ ...e, days: (t - e.time) / DAY, km: distanceKm([e.lat, e.lng], [dealer.lat, dealer.lng]) }))
    .filter((e) => e.days >= 0 && e.days <= LINK_RULES.days && e.km <= LINK_RULES.km)
    .sort((a, b) => a.days - b.days);
}

function ReviewQueue({ status, setStatus, initialOpen }) {
  const navigate = useNavigate();
  const { transactions, screening, dealers, reviewOf, setReview, incidents, alerts, assets } = useData();
  const [open, setOpen] = useState(initialOpen || null);
  const [note, setNote] = useState(initialOpen ? reviewOf(initialOpen).note || '' : '');
  const [saved, setSaved] = useState(null);
  const decide = (id, decision) => { setReview(id, decision, note); setSaved(`${id}: ${REVIEW_STATUS[decision].label}`); setOpen(null); };
  const dealerById = Object.fromEntries(dealers.map((d) => [d.id, d]));
  const flagged = transactions.filter((t) => screening[t.id]?.suspicious).reverse();
  const rows = flagged.filter((t) => status === 'all' || reviewOf(t.id).status === status);
  const tx = open && transactions.find((t) => t.id === open);
  const links = tx ? linkedEvents(tx, dealerById[tx.dealerId], incidents, alerts, assets) : [];

  return (
    <>
      {saved && <p className="tile tone-success text-xs font-bold text-fg mb-3 flex items-center gap-2" role="status"><Icon name="check" size={14} className="text-success shrink-0" />{saved}. The decision is in the command log.</p>}
      <Card padded={false} title={<span>PDRM review queue <Ms>Senarai semakan PDRM</Ms></span>} subtitle="Click a sale to review it"
        actions={<FilterChips value={status} onChange={setStatus} options={[...Object.entries(REVIEW_STATUS).map(([value, s]) => ({ value, label: `${s.label} (${flagged.filter((t) => reviewOf(t.id).status === value).length})` })), { value: 'all', label: `All (${flagged.length})` }]} />}>
        <DataTable
          rows={rows}
          onRowClick={(r) => { setOpen(r.id); setNote(reviewOf(r.id).note || ''); }}
          emptyText="Nothing in this view."
          columns={[
            { key: 'id', header: 'Sale', mono: true, className: 'whitespace-nowrap' },
            { key: 'date', header: 'Date (MYT)', className: 'whitespace-nowrap', render: (r) => formatMyt(r.date, 'short') },
            { key: 'dealer', header: 'Dealer', render: (r) => dealerById[r.dealerId].name },
            { key: 'seller', header: 'Seller', render: (r) => <span className="font-mono text-[11px] whitespace-nowrap">{r.sellerIcMasked}</span> },
            { key: 'material', header: 'Material', strong: true, render: (r) => `${r.material}, ${r.weightKg} kg` },
            { key: 'flags', header: 'Why flagged', render: (r) => <FlagBadges flags={screening[r.id].flags} /> },
            { key: 'status', header: 'Status', render: (r) => { const s = REVIEW_STATUS[reviewOf(r.id).status]; return <Badge tone={s.tone} plain>{s.label.toUpperCase()}</Badge>; } },
          ]}
        />
      </Card>

      {tx && (
        <Modal width={640} eyebrow={`${tx.id} · ${dealerById[tx.dealerId].licenceNo}`} title={`${tx.material}, ${tx.weightKg} kg`} subtitle={`${formatMyt(tx.date)} MYT · ${dealerById[tx.dealerId].name}`}
          onClose={() => setOpen(null)}
          footer={
            <>
              <span className="mr-auto"><Badge tone={REVIEW_STATUS[reviewOf(tx.id).status].tone} plain>{REVIEW_STATUS[reviewOf(tx.id).status].label.toUpperCase()}</Badge></span>
              {reviewOf(tx.id).status !== 'pending' && <Button variant="ghost" onClick={() => decide(tx.id, 'pending')}>Back to queue</Button>}
              <Button variant="ghost" disabled={reviewOf(tx.id).status === 'cleared'} onClick={() => decide(tx.id, 'cleared')}>Clear · Bersihkan</Button>
              <Button variant="danger" icon="siren" disabled={reviewOf(tx.id).status === 'referred'} onClick={() => decide(tx.id, 'referred')}>Refer to PDRM · Rujuk</Button>
            </>
          }>
          <div className="space-y-4">
            <DetailGrid columns={3} items={[
              { label: 'Seller', value: <span className="font-mono">{tx.sellerIcMasked}</span> },
              { label: 'Seller ref (hashed IC)', value: <span className="font-mono">{tx.sellerId}</span> },
              { label: 'Value', value: tx.pricePerKgRM ? formatRM(tx.pricePerKgRM * tx.weightKg) : '—' },
            ]} />
            <div className="space-y-2">
              <p className="label-caps">Why flagged</p>
              {screening[tx.id].flags.map((f) => <div key={f.rule} className="tile tone-danger text-xs"><b>{RULE_INFO[f.rule].label}</b> <Ms>{RULE_INFO[f.rule].labelMs}</Ms><p className="text-fg-muted">{f.detail}</p></div>)}
            </div>
            <div className="tile text-xs flex gap-3">
              {tx.photo?.thumbnail ? <img src={tx.photo.thumbnail} alt="" className="w-20 h-20 object-cover rounded" /> : <span className="stat-card-icon"><Icon name="eye" /></span>}
              <div><p className="label-caps mb-1">Photo · {tx.photo?.label || 'not classified'}</p><p className="text-fg-muted">{tx.photo?.description}</p><p className="text-[10px] text-fg-faint">{tx.photo?.source}</p></div>
            </div>
            {screening[tx.id].related.length > 0 && (
              <div>
                <p className="label-caps mb-1">Same seller in the 7-day window</p>
                <ul className="text-xs space-y-1">
                  {screening[tx.id].related.map((id) => { const r = transactions.find((t) => t.id === id); return <li key={id} className="text-fg-muted">{id} · {formatMyt(r.date, 'short')} · {dealerById[r.dealerId].name} · {r.material} {r.weightKg} kg</li>; })}
                </ul>
              </div>
            )}
            <div>
              <p className="label-caps mb-1">Possible source events (theft in the {LINK_RULES.days} days before, dealer within {LINK_RULES.km} km)</p>
              {links.length === 0 && <p className="text-xs text-fg-faint">None found.</p>}
              <ul className="space-y-1">
                {links.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-fg-muted"><b className="text-fg">{e.id}</b> {e.title} · {e.days.toFixed(1)} days before · {e.km.toFixed(1)} km</span>
                    <button type="button" className="link-btn" onClick={() => navigate(`/reports?event=${e.id}`)}>REPORT</button>
                  </li>
                ))}
              </ul>
            </div>
            <label className="block">
              <span className="label-caps field-label">Review note</span>
              <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the decision…" />
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ─── All sales ───────────────────────────────────────────── */
function AllSales({ initialQuery = '', onReview }) {
  const { transactions, screening, dealers } = useData();
  const [q, setQ] = useState(initialQuery);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [open, setOpen] = useState(null);
  const first = transactions[0] && formatMyt(transactions[0].date, 'date');
  const dealerById = Object.fromEntries(dealers.map((d) => [d.id, d]));
  const rows = transactions
    .filter((t) => (!onlyFlagged || screening[t.id]?.suspicious) && (!q || `${t.id} ${t.material} ${t.sellerIcMasked} ${dealerById[t.dealerId].name}`.toLowerCase().includes(q.toLowerCase())))
    .slice().reverse();
  const chart = useMemo(() => ({
    labels: dealers.map((d) => d.id),
    datasets: [
      { label: 'Normal', data: dealers.map((d) => transactions.filter((t) => t.dealerId === d.id && !screening[t.id]?.suspicious).length), color: 'chart-1' },
      { label: 'Flagged', data: dealers.map((d) => transactions.filter((t) => t.dealerId === d.id && screening[t.id]?.suspicious).length), color: 'danger' },
    ],
  }), [dealers, transactions, screening]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <ChartCard title="Sales per dealer" subtitle={`${transactions.length} sales recorded since ${first}`} type="bar" stacked legend height={300} data={chart} />
      <Card className="xl:col-span-2" padded={false} title={`All sales (${rows.length})`} subtitle="Click a sale for its record" bodyClassName="max-h-[520px] overflow-y-auto"
        actions={<><input className="input" style={{ width: 170 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /><button type="button" className={`chip ${onlyFlagged ? 'is-active' : ''}`} onClick={() => setOnlyFlagged((v) => !v)}>Flagged only</button></>}>
        <DataTable
          rows={rows}
          onRowClick={(r) => (screening[r.id]?.suspicious ? onReview(r.id) : setOpen(r.id))}
          columns={[
            { key: 'id', header: 'Sale', mono: true, className: 'whitespace-nowrap' },
            { key: 'date', header: 'Date', render: (r) => formatMyt(r.date, 'short') },
            { key: 'dealer', header: 'Dealer', render: (r) => dealerById[r.dealerId].name },
            { key: 'seller', header: 'Seller', render: (r) => <span className="font-mono text-[11px] whitespace-nowrap">{r.sellerIcMasked}</span> },
            { key: 'material', header: 'Material', render: (r) => r.material },
            { key: 'weight', header: 'kg', numeric: true, strong: true, render: (r) => r.weightKg },
            { key: 'flag', header: '', render: (r) => (screening[r.id]?.suspicious ? <Badge tone="danger" dot>Flagged</Badge> : null) },
          ]}
        />
      </Card>
      {open && (() => {
        const tx = transactions.find((t) => t.id === open);
        const d = dealerById[tx.dealerId];
        return (
          <Modal width={520} eyebrow={`${tx.id} · ${d.licenceNo}`} title={`${tx.material}, ${tx.weightKg} kg`} subtitle={`${formatMyt(tx.date)} MYT · ${d.name}`} onClose={() => setOpen(null)}
            footer={<Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>}>
            <div className="space-y-3">
              <p className="tile tone-success text-xs font-semibold">No screening rule fired for this sale.</p>
              <DetailGrid columns={3} items={[
                { label: 'Seller', value: <span className="font-mono">{tx.sellerIcMasked}</span> },
                { label: 'Price', value: tx.pricePerKgRM ? `RM ${tx.pricePerKgRM.toFixed(2)}/kg` : '—' },
                { label: 'Value', value: tx.pricePerKgRM ? formatRM(tx.pricePerKgRM * tx.weightKg) : '—' },
              ]} />
              <p className="tile text-xs"><span className="label-caps mr-2">Photo · {tx.photo?.label || 'not classified'}</span>{tx.photo?.description}</p>
              <p className="text-[11px] text-fg-faint">Dealer area: {d.area}. Licensed since {formatMyt(`${d.licensedSince}T00:00:00+08:00`, 'date')}.</p>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

const TABS = [
  { value: 'submit', label: 'Submit sale' },
  { value: 'queue', label: 'PDRM review queue' },
  { value: 'all', label: 'All sales' },
];

export default function ScrapRegistry() {
  const { transactions, kpis, screening, reviewOf, dealers } = useData();
  const [params, setParams] = useSearchParams();
  const view = params.get('view');
  const [tab, setTabState] = useState(TABS.some((t) => t.value === view) ? view : params.get('review') ? 'queue' : params.get('q') ? 'all' : 'queue');
  const [status, setStatus] = useState(params.get('review') ? 'all' : 'pending');
  const [review, setReviewOpen] = useState(params.get('review'));
  useEffect(() => {
    if (TABS.some((t) => t.value === view)) setTabState(view);
    if (params.get('review')) { setTabState('queue'); setStatus('all'); setReviewOpen(params.get('review')); }
  }, [params, view]);
  const setTab = (t) => { setTabState(t); setParams({ view: t }); };
  const flagged = transactions.filter((t) => screening[t.id]?.suspicious);
  const referred = flagged.filter((t) => reviewOf(t.id).status === 'referred').length;
  const cleared = flagged.filter((t) => reviewOf(t.id).status === 'cleared').length;
  const showQueue = (s) => { setStatus(s); setTab('queue'); };

  return (
    <div className="space-y-4">
      <PageHeader
        title={<Title en="Scrap Registry" ms="Daftar Besi Buruk" />}
        subtitle="Dealers record each purchase under the Second-Hand Dealers Act 1946. The command centre screens every sale and queues suspicious ones for PDRM."
        actions={<Tabs tabs={TABS} value={tab} onChange={setTab} />}
      />
      <StatGrid>
        <StatCard label="Sales recorded" value={transactions.length} icon="clipboard" onDetails={() => setTab('all')}
          subValues={[{ label: 'Dealers', value: dealers.length }, { label: 'Since', value: formatMyt(transactions[0].date, 'date').replace(/ \d{4}$/, '') }]} />
        <StatCard label="Flagged" value={kpis.flagged} icon="alert" status={kpis.flagged ? 'warning' : 'normal'} onDetails={() => showQueue('all')}
          subValues={[{ label: 'Rate', value: `${((kpis.flagged / transactions.length) * 100).toFixed(1)}%` }, { label: 'Cleared', value: cleared }]} />
        <StatCard label="Pending review" value={kpis.flaggedPending} icon="hourglass" status={kpis.flaggedPending ? 'warning' : 'normal'} onDetails={() => showQueue('pending')} />
        <StatCard label="Referred to PDRM" value={referred} icon="siren" onDetails={() => showQueue('referred')}
          subValues={[{ label: 'Copper cable limit', value: `${SCRAP_RULES.copperCableKg} kg` }]} />
      </StatGrid>
      {tab === 'submit' && <SubmitSale />}
      {tab === 'queue' && <ReviewQueue key={review || 'queue'} status={status} setStatus={setStatus} initialOpen={review} />}
      {tab === 'all' && <AllSales key={params.get('q') || 'all'} initialQuery={params.get('q') || ''} onReview={(id) => { setStatus('all'); setReviewOpen(id); setTabState('queue'); setParams({ view: 'queue', review: id }); }} />}
    </div>
  );
}
