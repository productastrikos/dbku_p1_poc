import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader, Card, Button, Badge, Icon, DataTable } from '../components/ui';
import { Title, Ms, ThreatGauge, LevelBadge, Toggle } from '../components/guard/common';
import { useData } from '../data/DataProvider';
import { loadDetector, toCanvas, analyseFrame, openVideo, analyseVideo, frameAt } from '../ai/detector';
import { scoreThreat, videoMetrics, nearZone, THREAT_RULES, LEVELS } from '../ai/threatScore';
import { estimateLoss } from '../ai/linking';
import { isNight, toMytInput, fromMytInput, formatMyt } from '../ai/time';
import { ASSET_TYPES } from '../data/reference';
import { SAMPLE_FOOTAGE, FOOTAGE_SOURCE, footageUrl, recordedLabel, replayTime, durationLabel } from '../data/footage';
import { resolveColor } from '../components/charts/chartTheme';
import { toneVar } from '../theme/tones';

const DEFAULT_ZONE = { x: 0.4, y: 0.05, w: 0.2, h: 0.9 };
const DEFAULT_MIN_SCORE = 0.35;
const pct = (v) => `${(v * 100).toFixed(2)}%`;

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Could not read this image'));
  img.src = url;
});

/* Burns detections, the asset zone and a caption strip into a JPEG snapshot.
   The strip is black with white text in both themes: evidence images must not
   change with the viewer's theme. */
function composeSnapshot(canvas, { detections, zone, margin, caption }) {
  const scale = Math.min(1, 960 / canvas.width);
  const w = Math.round(canvas.width * scale);
  const h = Math.round(canvas.height * scale);
  const strip = 26;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h + strip;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, strip);
  ctx.drawImage(canvas, 0, strip, w, h);
  ctx.font = '700 12px Lato, system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(caption, 8, 17);
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = resolveColor('primary');
  ctx.lineWidth = 2;
  ctx.strokeRect(zone.x * w, strip + zone.y * h, zone.w * w, zone.h * h);
  ctx.setLineDash([]);
  const near = new Set(nearZone(detections, zone, margin));
  detections.forEach((d) => {
    const c = resolveColor(near.has(d) ? 'danger' : 'info');
    const x = d.box.x * w;
    const y = strip + d.box.y * h;
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, d.box.w * w, d.box.h * h);
    const label = `${d.class} ${Math.round(d.score * 100)}%`;
    ctx.fillStyle = c;
    ctx.fillRect(x, Math.max(strip, y - 16), ctx.measureText(label).width + 8, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 4, Math.max(strip, y - 16) + 12);
  });
  return out.toDataURL('image/jpeg', 0.8);
}

export default function CctvAnalyzer() {
  const { assets, zones, cameras, addAlert, updateAlert } = useData();
  const [model, setModel] = useState({ state: 'loading' });
  const [media, setMedia] = useState(null);       // { kind, name, url, canvas?, video? }
  const [analysis, setAnalysis] = useState(null); // image: { detections, luminance, lowLight, enhancedUrl } | video: { frames, step, duration }
  const [busy, setBusy] = useState(null);         // progress message
  const [error, setError] = useState(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [frameUrl, setFrameUrl] = useState(null);
  const [showEnhanced, setShowEnhanced] = useState(true);
  const [zone, setZone] = useState(DEFAULT_ZONE);
  const [draft, setDraft] = useState(null);
  const [margin, setMargin] = useState(0.08);
  const [minScore, setMinScore] = useState(DEFAULT_MIN_SCORE);
  const [params] = useSearchParams();
  const [assetId, setAssetId] = useState(params.get('asset') || 'SL-SEM-06');
  useEffect(() => { if (params.get('asset')) setAssetId(params.get('asset')); }, [params]);
  const [captureTime, setCaptureTime] = useState(toMytInput(Date.now()));
  const [inferNight, setInferNight] = useState(true);
  const [dwellManual, setDwellManual] = useState(0);
  const [alertId, setAlertId] = useState(null);
  const [over, setOver] = useState(false);
  const [sample, setSample] = useState(null);     // the bundled sample clip on stage, if any
  const [fetching, setFetching] = useState(null); // id of the sample being downloaded
  const fileInput = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    loadDetector().then((m) => setModel({ state: 'ready', backend: m.backend })).catch((e) => setModel({ state: 'error', message: e.message }));
  }, []);

  const asset = assets.find((a) => a.id === assetId);
  const camera = cameras.find((c) => c.id === asset?.cameraId);

  /* ─── Analysis ──────────────────────────────────────────── */
  const runImage = useCallback(async (canvas, score = minScore) => {
    setBusy('Detecting people and vehicles…');
    const r = await analyseFrame(canvas, { minScore: score });
    setAnalysis({ kind: 'image', detections: r.detections, luminance: r.luminance, lowLight: r.lowLight, enhancedUrl: r.enhanced?.toDataURL('image/jpeg', 0.9) || null, enhanced: r.enhanced });
    setBusy(null);
  }, [minScore]);

  const runVideo = useCallback(async (video, score = minScore) => {
    setBusy('Sampling video frames… 0%');
    const r = await analyseVideo(video, { minScore: score, onProgress: (p) => setBusy(`Sampling video frames… ${Math.round(p * 100)}%`) });
    setAnalysis({ kind: 'video', ...r });
    setBusy(null);
    return r;
  }, [minScore]);

  // `preset` is a sample from SAMPLE_FOOTAGE: it brings its own asset zone and confidence.
  const onFile = async (file, preset = null) => {
    if (!file) return;
    const startZone = preset?.zone || DEFAULT_ZONE;
    const score = preset?.minScore ?? minScore;
    setError(null);
    setAnalysis(null);
    setAlertId(null);
    setZone(startZone);
    setDwellManual(0);
    setSample(preset);
    if (media?.url) URL.revokeObjectURL(media.url);
    const url = URL.createObjectURL(file);
    try {
      await loadDetector();
      if (file.type.startsWith('video/')) {
        const video = await openVideo(url);
        setMedia({ kind: 'video', name: file.name, url, video });
        const r = await runVideo(video, score);
        const m = videoMetrics(r.frames, startZone, margin, r.step);
        setViewIndex(m.keyIndex);
      } else {
        const img = await loadImage(url);
        const canvas = toCanvas(img, img.naturalWidth, img.naturalHeight);
        setMedia({ kind: 'image', name: file.name, url, canvas });
        await runImage(canvas, score);
      }
    } catch (e) {
      setBusy(null);
      setError(e.message || 'Analysis failed');
    }
  };

  // Loads a bundled sample on the asset it is paired with (pole → streetlight,
  // wall panel → distribution box). An asset picked through the URL is kept
  // when it is the same kind. The clip replays at the time of day it was recorded.
  const loadSample = async (s) => {
    setFetching(s.id);
    setError(null);
    try {
      const res = await fetch(footageUrl(s.file));
      if (!res.ok) throw new Error(`Could not load ${s.file} (HTTP ${res.status})`);
      const blob = await res.blob();
      const pinned = assets.find((a) => a.id === params.get('asset'));
      const suggested = assets.find((a) => a.id === s.assetId);
      setAssetId(pinned && pinned.type === suggested?.type ? pinned.id : s.assetId);
      // The recording time is known, so a dark frame is not taken as night by itself.
      setCaptureTime(toMytInput(replayTime(s)));
      setInferNight(false);
      setMinScore(s.minScore ?? DEFAULT_MIN_SCORE);
      setFetching(null);
      await onFile(new File([blob], s.file, { type: blob.type || (s.kind === 'video' ? 'video/mp4' : 'image/jpeg') }), { ...s, minScore: s.minScore ?? DEFAULT_MIN_SCORE });
    } catch (e) {
      setError(e.message || 'Could not load the sample');
    } finally {
      setFetching(null);
    }
  };

  // Keeps the same alert (if any) and updates it with the new detections.
  const rerun = async () => {
    try {
      if (media.kind === 'image') await runImage(media.canvas);
      else await runVideo(media.video);
    } catch (e) { setBusy(null); setError(e.message); }
  };

  // Video: show the selected sampled frame.
  useEffect(() => {
    let cancelled = false;
    if (analysis?.kind === 'video' && media?.video && analysis.frames[viewIndex]) {
      frameAt(media.video, analysis.frames[viewIndex].t).then((c) => { if (!cancelled) setFrameUrl(c.toDataURL('image/jpeg', 0.85)); });
    }
    return () => { cancelled = true; };
  }, [analysis, viewIndex, media]);

  /* ─── Scoring ───────────────────────────────────────────── */
  const metrics = useMemo(() => (analysis?.kind === 'video' ? videoMetrics(analysis.frames, zone, margin, analysis.step) : null), [analysis, zone, margin]);
  const detections = analysis?.kind === 'video' ? analysis.frames[viewIndex]?.detections || [] : analysis?.detections || [];
  const lowLight = analysis?.kind === 'video' ? Boolean(analysis.frames[viewIndex]?.lowLight) : Boolean(analysis?.lowLight);
  const captureMs = fromMytInput(captureTime).getTime();
  const nightByClock = isNight(captureMs);
  const night = nightByClock || (inferNight && lowLight);
  const dwell = metrics ? metrics.dwellMinutes : Number(dwellManual) || 0;
  const scoringDetections = useMemo(
    () => (metrics ? analysis.frames[metrics.keyIndex]?.detections || [] : analysis?.detections || []),
    [metrics, analysis],
  );
  const threat = analysis ? scoreThreat({ detections: scoringDetections, zone, margin, night, dwellMinutes: dwell, vehicleParked: metrics ? metrics.parked : undefined }) : null;
  const nearSet = new Set(nearZone(detections, zone, margin));

  /* ─── Alerting: a HIGH score raises (then keeps updating) one alert ── */
  // Sample clips are never attributed to a DBKU camera.
  const footageLabel = sample ? `Sample footage, MEVA ${sample.camera}` : camera?.id || 'Uploaded footage';
  const buildSnapshot = useCallback(async () => {
    const caption = `DBKU · ${footageLabel} · ${assetId} · ${formatMyt(captureMs, 'short')} MYT · Score ${threat.score} ${threat.level}${lowLight ? ' · low-light enhanced' : ''}`;
    if (analysis.kind === 'video') {
      const f = analysis.frames[metrics.keyIndex];
      const c = await frameAt(media.video, f.t);
      return composeSnapshot(c, { detections: f.detections, zone, margin, caption });
    }
    return composeSnapshot(lowLight && analysis.enhanced ? analysis.enhanced : media.canvas, { detections: analysis.detections, zone, margin, caption });
  }, [analysis, media, metrics, zone, margin, footageLabel, assetId, captureMs, threat, lowLight]);

  const alertPayload = useCallback(async () => ({
    source: 'cctv', level: threat.level, type: 'intrusion', score: threat.score,
    title: `Intrusion near asset · ${assetId}`,
    message: `${threat.near.map((d) => d.class).join(', ') || 'Object'} near ${asset.name} (${ASSET_TYPES[asset.type].label.toLowerCase()})${night ? ' at night' : ''}${dwell > THREAT_RULES.dwellMinutes ? `, ${dwell.toFixed(1)} min dwell` : ''}${sample ? ' · sample footage' : ''}`,
    assetId, zone: asset.zone, lat: asset.lat, lng: asset.lng,
    estimatedLossRM: estimateLoss({ asset, assets, type: 'intrusion' }).totalRM,
    evidence: {
      snapshot: await buildSnapshot(), cameraId: sample ? null : camera?.id || null, capturedAt: new Date(captureMs).toISOString(), fileName: media.name,
      sample: sample ? {
        id: sample.id, title: sample.title, camera: `MEVA ${sample.camera}`, site: sample.site,
        recorded: recordedLabel(sample), license: FOOTAGE_SOURCE.license, credit: FOOTAGE_SOURCE.credit,
      } : null,
      detections: scoringDetections.map((d) => ({ class: d.class, score: d.score, box: d.box, near: nearZone([d], zone, margin).length > 0 })),
      factors: threat.factors, zone, margin, lowLight, luminance: analysis.kind === 'image' ? analysis.luminance : null,
      nightBasis: night ? (nightByClock ? 'capture time' : 'low light') : null,
    },
  }), [threat, assetId, asset, assets, night, nightByClock, dwell, buildSnapshot, camera, sample, captureMs, media, scoringDetections, zone, margin, lowLight, analysis]);

  const scoreKey = threat ? `${threat.score}|${assetId}|${JSON.stringify(zone)}|${margin}|${scoringDetections.length}` : '';
  useEffect(() => {
    if (!threat || busy) return undefined;
    if (!alertId && threat.level !== 'HIGH') return undefined;
    const id = setTimeout(async () => {
      const payload = await alertPayload();
      if (alertId) updateAlert(alertId, payload);
      else setAlertId(addAlert(payload));
    }, alertId ? 700 : 150);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreKey, busy]);

  const logEvent = async () => setAlertId(addAlert(await alertPayload()));

  /* ─── Drawing the asset zone ─────────────────────────────── */
  const rel = (e) => {
    const r = stageRef.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = rel(e); setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); };
  const onMove = (e) => { if (draft) { const p = rel(e); setDraft((d) => ({ ...d, x1: p.x, y1: p.y })); } };
  const onUp = () => {
    if (!draft) return;
    const z = { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) };
    if (z.w > 0.015 && z.h > 0.015) setZone(z);
    setDraft(null);
  };
  const shownZone = draft ? { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) } : zone;

  const stageSrc = media?.kind === 'video' ? frameUrl : (lowLight && showEnhanced && analysis?.enhancedUrl) || media?.url;

  return (
    <div className="space-y-4">
      <PageHeader
        title={<Title en="CCTV Analyzer" ms="Analisis CCTV" />}
        subtitle="Upload CCTV stills or video, or pick a sample clip. COCO-SSD runs in your browser, so footage never leaves this device."
        actions={
          <>
            {model.state === 'loading' && <Badge tone="info" dot>Loading COCO-SSD model…</Badge>}
            {model.state === 'ready' && <Badge tone="success" dot>COCO-SSD ready · {model.backend}</Badge>}
            {model.state === 'error' && <span title={model.message}><Badge tone="danger" dot>Model failed to load</Badge></span>}
          </>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Card
            title={media ? (sample ? `${sample.title} · ${media.name}` : media.name) : 'Footage'}
            subtitle={analysis ? 'Drag on the image to redraw the asset zone (the lamp post, box or switchboard).' : 'Image (JPG/PNG) or video (MP4/WebM)'}
            actions={media && (
              <>
                {analysis?.kind === 'image' && analysis.lowLight && <Toggle on={showEnhanced} onChange={() => setShowEnhanced((s) => !s)} label="Enhanced view" />}
                <Button variant="secondary" size="sm" icon="upload" onClick={() => fileInput.current.click()}>New file</Button>
              </>
            )}
          >
            <input ref={fileInput} type="file" accept="image/*,video/*" hidden onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
            {!media && (
              <div
                className={`dropzone ${over ? 'is-over' : ''}`}
                role="button" tabIndex={0}
                onClick={() => fileInput.current.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }}
              >
                <Icon name="camera" size={28} />
                <p className="text-sm font-semibold">Drop CCTV footage here or click to upload</p>
                <p className="text-xs">Or pick a sample clip below. <Ms>Muat naik rakaman CCTV</Ms></p>
              </div>
            )}
            {!media && error && <p className="tile tone-danger text-xs mt-3">{error}</p>}
            {media && (
              <div className="space-y-3">
                {sample && (
                  <p className="tile text-[11px] text-fg-muted">
                    <b className="text-fg">Sample footage, not a DBKU camera.</b> MEVA camera {sample.camera}, {sample.site}, {FOOTAGE_SOURCE.site} ·
                    recorded {recordedLabel(sample)} · {sample.cut}. Capture time is set to {sample.replayAt} MYT, the same time of day, so the night rule
                    applies as it would to a live camera.{sample.minScore !== DEFAULT_MIN_SCORE ? ` Minimum confidence ${Math.round(sample.minScore * 100)}% for this camera view.` : ''} {FOOTAGE_SOURCE.license}, Kitware Inc. and IARPA.
                  </p>
                )}
                <div className="stage" ref={stageRef}>
                  {stageSrc ? <img src={stageSrc} alt="Analysed frame" draggable={false} /> : <div style={{ aspectRatio: '16/9' }} />}
                  {analysis && (
                    <div className="stage-overlay" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
                      <div className="zone-margin" style={{ left: pct(shownZone.x - margin), top: pct(shownZone.y - margin), width: pct(shownZone.w + 2 * margin), height: pct(shownZone.h + 2 * margin) }} />
                      <div className="zone-box" style={{ left: pct(shownZone.x), top: pct(shownZone.y), width: pct(shownZone.w), height: pct(shownZone.h) }}>
                        <span className="zone-label">ASSET ZONE · {assetId}</span>
                      </div>
                      {detections.map((d, i) => (
                        <div key={i} className={`det-box ${nearSet.has(d) ? 'is-near' : ''}`} style={{ left: pct(d.box.x), top: pct(d.box.y), width: pct(d.box.w), height: pct(d.box.h) }}>
                          <span className="det-label">{d.class} {Math.round(d.score * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {busy && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm font-semibold gap-2">
                      <Icon name="cpu" size={18} />{busy}
                    </div>
                  )}
                </div>

                {analysis?.kind === 'video' && (
                  <div>
                    <div className="flex items-end gap-px h-10" aria-label="Frame timeline">
                      {analysis.frames.map((f, i) => {
                        const n = nearZone(f.detections, zone, margin).length;
                        return (
                          <button key={f.t} type="button" title={`${f.t}s · ${f.detections.length} objects${n ? `, ${n} near asset` : ''}`}
                            className={`timeline-bar ${i === viewIndex ? 'is-active' : ''}`} onClick={() => setViewIndex(i)}
                            style={{ height: `${20 + Math.min(80, f.detections.length * 20)}%`, background: toneVar(n ? 'danger' : f.detections.length ? 'info' : 'neutral-soft') }} />
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-fg-faint mt-1">
                      Frame {viewIndex + 1}/{analysis.frames.length} at {analysis.frames[viewIndex]?.t}s · sampled every {analysis.step}s of {analysis.duration.toFixed(0)}s · red = person/vehicle near the asset
                    </p>
                  </div>
                )}

                {error && <p className="tile tone-danger text-xs">{error}</p>}
                {analysis && (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                    <label className="flex items-center gap-2">
                      <span className="label-caps">Proximity margin</span>
                      <input type="range" min="0" max="0.25" step="0.01" value={margin} onChange={(e) => setMargin(+e.target.value)} />
                      <span className="kbd">{Math.round(margin * 100)}%</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <span className="label-caps">Min. confidence</span>
                      <input type="range" min="0.15" max="0.8" step="0.05" value={minScore} onChange={(e) => setMinScore(+e.target.value)} />
                      <span className="kbd">{Math.round(minScore * 100)}%</span>
                    </label>
                    <Button size="sm" variant="secondary" icon="refresh" disabled={Boolean(busy)} onClick={rerun}>Re-run detection</Button>
                    {lowLight && (
                      <span className="text-fg-faint flex items-center gap-1"><Icon name="moon" size={13} />
                        Low light{analysis.kind === 'image' ? ` (mean luminance ${analysis.luminance}/255)` : ''}: a second pass ran on an enhanced frame
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>

          {analysis && (
            <Card title="Detections" subtitle="People and vehicles found by COCO-SSD" padded={false}>
              <DataTable
                rowKey="key"
                rows={detections.map((d, i) => ({ ...d, key: i, isNear: nearSet.has(d) }))}
                emptyText="No person, car, motorcycle or truck detected. Try lowering the confidence."
                columns={[
                  { key: 'class', header: 'Object', strong: true },
                  { key: 'score', header: 'Confidence', numeric: true, render: (d) => `${Math.round(d.score * 100)}%` },
                  { key: 'near', header: 'Near asset', render: (d) => (d.isNear ? <Badge tone="danger">Yes</Badge> : <Badge tone="neutral">No</Badge>) },
                  { key: 'pass', header: 'Pass', render: (d) => (d.pass === 'enhanced' ? 'Low-light enhanced' : 'Original') },
                  { key: 'box', header: 'Box (x, y, w, h)', mono: true, render: (d) => [d.box.x, d.box.y, d.box.w, d.box.h].map((v) => v.toFixed(2)).join(', ') },
                ]}
              />
            </Card>
          )}

          <Card
            title={<span>Sample CCTV footage <Ms>Rakaman CCTV contoh</Ms></span>}
            subtitle="Real fixed-camera surveillance video from the open MEVA dataset. Pick one to run it through the detector with its asset zone already marked."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {SAMPLE_FOOTAGE.map((s) => {
                const active = sample?.id === s.id;
                return (
                  <button key={s.id} type="button" disabled={Boolean(fetching || busy)} onClick={() => loadSample(s)} aria-pressed={active}
                    className={`flex flex-col text-left rounded-lg border overflow-hidden transition-colors disabled:opacity-60 ${active ? 'border-primary bg-primary-soft' : 'hover:border-line-strong'}`}>
                    <span className="relative block">
                      <img src={footageUrl(s.poster)} alt="" loading="lazy" className="w-full aspect-video object-cover" />
                      <span className="absolute top-1.5 left-1.5 flex gap-1 text-[10px] font-semibold text-white">
                        <span className="rounded bg-black/70 px-1.5 py-0.5">{s.kind === 'video' ? `Video ${durationLabel(s.durationSec)}` : 'Still'}</span>
                        <span className="rounded bg-black/70 px-1.5 py-0.5">{s.light}</span>
                      </span>
                      {fetching === s.id && <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-xs font-semibold">Loading…</span>}
                    </span>
                    <span className="block p-2.5 space-y-1">
                      <span className="block text-xs font-semibold text-fg leading-snug">{s.title}</span>
                      <span className="block text-[10px] text-fg-faint">MEVA {s.camera} · {recordedLabel(s)} · zone on {s.assetId}{s.minScore ? ` · min. confidence ${Math.round(s.minScore * 100)}%` : ''}</span>
                      <span className="block text-[11px] text-fg-muted">{s.scene}</span>
                      <span className="block text-[10px] text-fg-faint"><b className="text-fg-muted">Expected:</b> {s.expect}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-fg-faint mt-3">
              Footage: {FOOTAGE_SOURCE.credit}, licensed <a className="link-btn" href={FOOTAGE_SOURCE.licenseUrl} target="_blank" rel="noreferrer">{FOOTAGE_SOURCE.license}</a>
              {' '}(<a className="link-btn" href={FOOTAGE_SOURCE.url} target="_blank" rel="noreferrer">mevadata.org</a>). Recorded with consenting actors at the {FOOTAGE_SOURCE.site}, March 2018.
              {' '}{FOOTAGE_SOURCE.changes} None of it shows DBKU assets.
            </p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Scene" subtitle="Which asset and when">
            <div className="space-y-3">
              <label className="block">
                <span className="label-caps field-label">Asset in view · Aset</span>
                <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                  {zones.map((z) => (
                    <optgroup key={z.id} label={z.name}>
                      {assets.filter((a) => a.zone === z.id).map((a) => <option key={a.id} value={a.id}>{a.id} · {ASSET_TYPES[a.type].label} · {a.road}</option>)}
                    </optgroup>
                  ))}
                </select>
                <span className="text-[10px] text-fg-faint">{camera ? `Covered by ${camera.id} (${camera.model})` : 'No existing CCTV covers this asset'}</span>
              </label>
              <label className="block">
                <span className="label-caps field-label">Capture time (MYT) · Masa rakaman</span>
                <input type="datetime-local" className="input" value={captureTime} onChange={(e) => setCaptureTime(e.target.value)} />
              </label>
              <Toggle on={inferNight} onChange={() => setInferNight((v) => !v)} label="Infer night from low light"
                hint="Counts a dark frame as night even if the capture time is unknown" />
              {media?.kind !== 'video' ? (
                <label className="block">
                  <span className="label-caps field-label">Dwell from camera log (min) · Tempoh berlegar</span>
                  <div className="flex gap-2">
                    <input type="number" min="0" step="0.5" className="input" style={{ width: 90 }} value={dwellManual} onChange={(e) => setDwellManual(e.target.value)} />
                    {[0, 2, 4, 6].map((m) => <button key={m} type="button" className={`chip ${+dwellManual === m ? 'is-active' : ''}`} onClick={() => setDwellManual(m)}>{m}</button>)}
                  </div>
                  <span className="text-[10px] text-fg-faint">One still frame can't show how long someone stayed. Enter it from the camera's motion log, or upload video to measure it.</span>
                </label>
              ) : (
                <div className="tile text-xs space-y-1">
                  <p><span className="label-caps mr-2">Dwell near asset</span><b className="text-fg">{metrics ? `${metrics.dwellMinutes.toFixed(1)} min` : '—'}</b></p>
                  <p><span className="label-caps mr-2">Stationary vehicle</span><b className="text-fg">{metrics ? (metrics.parked ? `yes, ${metrics.parkedSeconds}s` : 'no') : '—'}</b></p>
                  <p className="text-[10px] text-fg-faint">Measured from the video; the key frame is used for the snapshot.</p>
                </div>
              )}
            </div>
          </Card>

          <Card title={<span>Threat score <Ms>Skor ancaman</Ms></span>}>
            {!threat && <p className="text-xs text-fg-faint">Upload footage to score it.</p>}
            {threat && (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <ThreatGauge score={threat.score} level={threat.level} />
                  <div className="space-y-1">
                    <LevelBadge level={threat.level} withMs />
                    <p className="text-xs text-fg-muted">HIGH at {THREAT_RULES.high} or more.</p>
                    <p className="text-[11px] text-fg-faint">Night: {night ? (nightByClock ? 'capture time is 22:00–06:00' : 'inferred from low light') : 'no'}</p>
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {threat.factors.map((f) => (
                    <li key={f.key} className={`flex items-start justify-between gap-3 tile !py-2 ${f.met ? `tone-${LEVELS[threat.level].tone}` : ''}`}>
                      <span>
                        <span className={`block text-xs font-semibold ${f.met ? 'text-fg' : 'text-fg-faint'}`}>{f.label} <Ms>{f.labelMs}</Ms></span>
                        <span className="block text-[10px] text-fg-faint">{f.detail}</span>
                      </span>
                      <span className={`text-sm font-bold ${f.met ? 'text-fg' : 'text-fg-faint'}`}>{f.met ? `+${f.points}` : `0/${f.points}`}</span>
                    </li>
                  ))}
                </ul>
                {alertId ? (
                  <div className={`tile tone-${LEVELS[threat.level].tone} text-xs`}>
                    <p className="font-bold">{threat.level === 'HIGH' ? 'HIGH alert raised' : 'Event logged'}: {alertId}</p>
                    <p className="text-fg-muted">Snapshot, timestamp, asset ID and bounding boxes saved. <Link className="link-btn" to={`/?alert=${alertId}`}>OPEN ALERT</Link> · <Link className="link-btn" to={`/twin?asset=${assetId}`}>ASSET TWIN</Link></p>
                  </div>
                ) : (
                  <Button variant="secondary" block icon="plus" onClick={logEvent} disabled={Boolean(busy)}>Log as {threat.level} event</Button>
                )}
              </div>
            )}
          </Card>

          <Card padded={false} title={<span>Existing CCTV units <Ms>Unit CCTV sedia ada</Ms></span>} subtitle="Solar 2MP cameras with no analytics; the command centre scores their footage">
            <ul>
              {cameras.map((c) => {
                const active = c.covers.includes(assetId);
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setAssetId(c.mountedOn)}
                      className={`w-full text-left px-4 py-2.5 border-b text-xs transition-colors ${active ? 'bg-primary-soft' : 'hover:bg-surface-raised'}`}>
                      <span className="flex items-center justify-between gap-2">
                        <b className="text-fg">{c.id}</b>
                        <span className="text-[10px] text-fg-faint">{zones.find((z) => z.id === c.zone)?.short}</span>
                      </span>
                      <span className="block text-[10px] text-fg-faint mt-0.5">On {c.mountedOn} · covers {c.covers.join(', ')}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
