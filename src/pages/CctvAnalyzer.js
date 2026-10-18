import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Card, Button, Badge, Icon, DataTable } from '../components/ui';
import { Title, Ms, ThreatGauge, LevelBadge, Toggle } from '../components/guard/common';
import { useData } from '../data/DataProvider';
import { loadDetector, toCanvas, analyseFrame, openVideo, analyseVideo, frameAt } from '../ai/detector';
import { scoreThreat, videoMetrics, nearZone, THREAT_RULES, LEVELS } from '../ai/threatScore';
import { estimateLoss } from '../ai/linking';
import { isNight, toMytInput, fromMytInput, formatMyt } from '../ai/time';
import { ASSET_TYPES } from '../data/reference';
import { resolveColor } from '../components/charts/chartTheme';

const DEFAULT_ZONE = { x: 0.4, y: 0.05, w: 0.2, h: 0.9 };
const pct = (v) => `${(v * 100).toFixed(2)}%`;

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Could not read this image'));
  img.src = url;
});

/* Burns detections, the asset zone and a caption strip into a JPEG snapshot. */
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
  ctx.font = '600 12px Inter, system-ui, sans-serif';
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
  const [minScore, setMinScore] = useState(0.35);
  const [assetId, setAssetId] = useState('SL-SEM-06');
  const [captureTime, setCaptureTime] = useState(toMytInput(Date.now()));
  const [inferNight, setInferNight] = useState(true);
  const [dwellManual, setDwellManual] = useState(0);
  const [alertId, setAlertId] = useState(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    loadDetector().then((m) => setModel({ state: 'ready', backend: m.backend })).catch((e) => setModel({ state: 'error', message: e.message }));
  }, []);

  const asset = assets.find((a) => a.id === assetId);
  const camera = cameras.find((c) => c.id === asset?.cameraId);

  /* ─── Analysis ──────────────────────────────────────────── */
  const runImage = useCallback(async (canvas) => {
    setBusy('Detecting people and vehicles…');
    const r = await analyseFrame(canvas, { minScore });
    setAnalysis({ kind: 'image', detections: r.detections, luminance: r.luminance, lowLight: r.lowLight, enhancedUrl: r.enhanced?.toDataURL('image/jpeg', 0.9) || null, enhanced: r.enhanced });
    setBusy(null);
  }, [minScore]);

  const runVideo = useCallback(async (video) => {
    setBusy('Sampling video frames… 0%');
    const r = await analyseVideo(video, { minScore, onProgress: (p) => setBusy(`Sampling video frames… ${Math.round(p * 100)}%`) });
    setAnalysis({ kind: 'video', ...r });
    setBusy(null);
    return r;
  }, [minScore]);

  const onFile = async (file) => {
    if (!file) return;
    setError(null);
    setAnalysis(null);
    setAlertId(null);
    setZone(DEFAULT_ZONE);
    setDwellManual(0);
    if (media?.url) URL.revokeObjectURL(media.url);
    const url = URL.createObjectURL(file);
    try {
      await loadDetector();
      if (file.type.startsWith('video/')) {
        const video = await openVideo(url);
        setMedia({ kind: 'video', name: file.name, url, video });
        const r = await runVideo(video);
        const m = videoMetrics(r.frames, DEFAULT_ZONE, margin, r.step);
        setViewIndex(m.keyIndex);
      } else {
        const img = await loadImage(url);
        const canvas = toCanvas(img, img.naturalWidth, img.naturalHeight);
        setMedia({ kind: 'image', name: file.name, url, canvas });
        await runImage(canvas);
      }
    } catch (e) {
      setBusy(null);
      setError(e.message || 'Analysis failed');
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
  const buildSnapshot = useCallback(async () => {
    const caption = `GuardGrid · ${camera?.id || 'Uploaded footage'} · ${assetId} · ${formatMyt(captureMs, 'short')} MYT · Score ${threat.score} ${threat.level}${lowLight ? ' · low-light enhanced' : ''}`;
    if (analysis.kind === 'video') {
      const f = analysis.frames[metrics.keyIndex];
      const c = await frameAt(media.video, f.t);
      return composeSnapshot(c, { detections: f.detections, zone, margin, caption });
    }
    return composeSnapshot(lowLight && analysis.enhanced ? analysis.enhanced : media.canvas, { detections: analysis.detections, zone, margin, caption });
  }, [analysis, media, metrics, zone, margin, camera, assetId, captureMs, threat, lowLight]);

  const alertPayload = useCallback(async () => ({
    source: 'cctv', level: threat.level, type: 'intrusion', score: threat.score,
    title: `Intrusion near asset · ${assetId}`,
    message: `${threat.near.map((d) => d.class).join(', ') || 'Object'} near ${asset.name} (${ASSET_TYPES[asset.type].label.toLowerCase()})${night ? ' at night' : ''}${dwell > THREAT_RULES.dwellMinutes ? `, ${dwell.toFixed(1)} min dwell` : ''}`,
    assetId, zone: asset.zone, lat: asset.lat, lng: asset.lng,
    estimatedLossRM: estimateLoss({ asset, assets, type: 'intrusion' }).totalRM,
    evidence: {
      snapshot: await buildSnapshot(), cameraId: camera?.id || null, capturedAt: new Date(captureMs).toISOString(), fileName: media.name,
      detections: scoringDetections.map((d) => ({ class: d.class, score: d.score, box: d.box, near: nearZone([d], zone, margin).length > 0 })),
      factors: threat.factors, zone, margin, lowLight, luminance: analysis.kind === 'image' ? analysis.luminance : null,
      nightBasis: night ? (nightByClock ? 'capture time' : 'low light') : null,
    },
  }), [threat, assetId, asset, assets, night, nightByClock, dwell, buildSnapshot, camera, captureMs, media, scoringDetections, zone, margin, lowLight, analysis]);

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
        subtitle="Upload CCTV stills or video. COCO-SSD runs in your browser, so footage never leaves this device."
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
            title={media ? media.name : 'Footage'}
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
                <p className="text-xs">Try a night-time photo of a person beside a lamp post. <Ms>Muat naik rakaman CCTV</Ms></p>
              </div>
            )}
            {media && (
              <div className="space-y-3">
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
                            style={{ height: `${20 + Math.min(80, f.detections.length * 20)}%`, background: `var(--color-${n ? 'danger' : f.detections.length ? 'info' : 'neutral-soft'})` }} />
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
                  { key: 'score', header: 'Confidence', render: (d) => `${Math.round(d.score * 100)}%` },
                  { key: 'near', header: 'Near asset', render: (d) => (d.isNear ? <Badge tone="danger">Yes</Badge> : <Badge tone="neutral">No</Badge>) },
                  { key: 'pass', header: 'Pass', render: (d) => (d.pass === 'enhanced' ? 'Low-light enhanced' : 'Original') },
                  { key: 'box', header: 'Box (x, y, w, h)', mono: true, render: (d) => [d.box.x, d.box.y, d.box.w, d.box.h].map((v) => v.toFixed(2)).join(', ') },
                ]}
              />
            </Card>
          )}
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
                    <p className="text-fg-muted">Snapshot, timestamp, asset ID and bounding boxes saved. <Link className="link-btn" to="/">VIEW ON MAP</Link></p>
                  </div>
                ) : (
                  <Button variant="secondary" block icon="plus" onClick={logEvent} disabled={Boolean(busy)}>Log as {threat.level} event</Button>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
