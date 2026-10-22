import React from 'react';
import { Badge, Icon } from '../ui';
import { LEVELS } from '../../ai/threatScore';
import { ALERT_STATUS, SOURCES, TASK_STATUS, TASK_KINDS, PRIORITY_TONE } from '../../data/reference';
import { formatMyt } from '../../ai/time';

/** Small Bahasa Malaysia label shown next to an English one. */
export const Ms = ({ children, className = '' }) => <span className={`ms-label ${className}`}>{children}</span>;

/** Page title with its Bahasa Malaysia name underneath. */
export function Title({ en, ms }) {
  return (
    <span className="flex flex-col">
      <span>{en}</span>
      <span className="ms-label font-normal not-italic tracking-normal" style={{ fontSize: 11 }}>{ms}</span>
    </span>
  );
}

export function LevelBadge({ level, withMs = false }) {
  const l = LEVELS[level] || LEVELS.LOW;
  return <Badge tone={l.tone} dot>{l.label}{withMs ? ` · ${l.labelMs}` : ''}</Badge>;
}

export function StatusBadge({ status }) {
  const s = ALERT_STATUS[status] || ALERT_STATUS.open;
  return <Badge tone={s.tone} plain>{s.label.toUpperCase()}</Badge>;
}

export function TaskStatusBadge({ status }) {
  const s = TASK_STATUS[status] || TASK_STATUS.open;
  return <Badge tone={s.tone} plain>{s.label.toUpperCase()}</Badge>;
}

export function TaskKindBadge({ kind }) {
  const k = TASK_KINDS[kind];
  return <Badge tone={kind === 'pdrm' ? 'danger' : kind === 'patrol' ? 'info' : 'primary'}><Icon name={k?.icon || 'clipboard'} size={11} />{k?.label || kind}</Badge>;
}

export const PriorityBadge = ({ priority }) => <Badge tone={PRIORITY_TONE[priority] || 'neutral'} plain>{String(priority || '').toUpperCase()}</Badge>;

export function SourceIcon({ source, size = 14 }) {
  return <Icon name={SOURCES[source]?.icon || 'alert'} size={size} />;
}

/** On/off switch. */
export function Toggle({ on, onChange, label, hint }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onChange} className="flex items-center gap-3 text-left">
      <span className="w-9 h-5 shrink-0 rounded-full flex items-center px-0.5 border transition-colors" style={{ background: on ? 'var(--color-primary)' : 'var(--color-surface-raised)' }}>
        <span className="w-4 h-4 rounded-full bg-white transition-transform" style={{ transform: on ? 'translateX(16px)' : 'none' }} />
      </span>
      <span>
        <span className="block text-xs font-medium text-fg">{label}</span>
        {hint && <span className="block text-[10px] text-fg-faint">{hint}</span>}
      </span>
    </button>
  );
}

/** Sensor network clock: LIVE on the real clock, or the simulated time. */
export function SensorModeBadge({ sensors, showTime = false }) {
  if (sensors.live) return <Badge tone="success" dot>LIVE{showTime ? ` · ${formatMyt(sensors.time, 'time')}` : ''}</Badge>;
  return <span title="The sensor clock is simulated and runs ahead of real time"><Badge tone="warning" dot>SIMULATION · {formatMyt(sensors.time, 'short')}</Badge></span>;
}

/** Banner that says whether the LLM is live or the offline fallback is in use. */
export function LlmBadge({ llm }) {
  if (llm.checking) return <Badge tone="neutral">Checking LLM…</Badge>;
  return llm.enabled
    ? <Badge tone="accent" dot>LLM: {llm.model}</Badge>
    : <span title={llm.reason}><Badge tone="warning" dot>LLM offline: template fallback</Badge></span>;
}

/** Ring gauge 0–100 for the threat score. */
export function ThreatGauge({ score, level, size = 132 }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const tone = LEVELS[level]?.tone || 'success';
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`Threat score ${score} of 100, ${level}`}>
      <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="gauge-track" />
      <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" stroke={`var(--color-${tone})`} strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray 0.4s ease' }} />
      <text x="60" y="58" textAnchor="middle" fontSize="30" fontWeight="800" fill="var(--color-text)">{score}</text>
      <text x="60" y="78" textAnchor="middle" fontSize="11" fontWeight="700" fill={`var(--color-${tone})`}>{level}</text>
    </svg>
  );
}

/** Reads a File as a data URL. */
export const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

/** Downscales an image data URL to a JPEG no wider than maxW. */
export async function downscale(dataUrl, maxW = 1024, quality = 0.82) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
