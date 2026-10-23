import React from 'react';
import { resolveColor } from '../charts/chartTheme';
import { TAMPER_RULES } from '../../ai/anomaly';

/* Live schematic of one asset, drawn from its latest reading: the pole leans
   by the measured tilt, the hatch or door opens when the contact reads open,
   the lamp glows only when it is actually lit, and the supply line turns grey
   and dashed when nothing reaches the asset. */

// Theme tokens, read in place so the drawing follows the theme.
const AMBER = 'var(--app-warning)';       // energised supply
const DEAD = 'var(--app-text-faint)';     // no supply
const METAL = 'var(--app-text-faint)';    // poles, plinths
const STEEL = 'var(--app-text-muted)';    // fittings
const GLOW = 'var(--app-warning-soft)';   // lamp light

function Signal({ x, y, rssi }) {
  const bars = rssi >= -95 ? 3 : rssi >= -105 ? 2 : 1;
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 1, 2].map((i) => <rect key={i} x={i * 4} y={6 - i * 3} width="3" height={3 + i * 3} rx="0.6" fill={i < bars ? 'currentColor' : 'var(--app-border-strong)'} />)}
    </g>
  );
}

function Supply({ x1, x2, y, live, label }) {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={live ? AMBER : DEAD} strokeWidth="3" strokeDasharray={live ? undefined : '6 5'} strokeLinecap="round">
        {live && <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.2s" repeatCount="indefinite" />}
      </line>
      {live && <line x1={x1} y1={y} x2={x2} y2={y} stroke="var(--app-on-color)" strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="2 8">
        <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.2s" repeatCount="indefinite" />
      </line>}
      <text x={x1} y={y + 13} fontSize="8.5" fill="var(--app-text-faint)">{label}</text>
    </g>
  );
}

function Streetlight({ asset, reading, live, lit }) {
  const tilt = reading?.tilt ?? 0;
  const open = reading?.door === 1;
  const leaning = tilt > TAMPER_RULES.tiltDeg;
  const head = lit ? GLOW : asset.lighting === 'out' ? STEEL : 'var(--app-surface-raised)';
  return (
    <>
      <Supply x1={4} x2={96} y={132} live={live} label={live ? `supply from ${asset.upstream}` : `no supply · ${asset.upstream}`} />
      <line x1="0" y1="124" x2="260" y2="124" stroke="var(--app-border-strong)" strokeWidth="1.5" />
      <g transform={`rotate(${tilt} 96 124)`}>
        {lit && <polygon points="150,30 118,124 182,124" fill={GLOW} opacity="0.28" />}
        <rect x="93" y="22" width="6" height="102" rx="2" fill={leaning ? resolveColor('danger') : METAL} />
        <path d="M96 24 Q 120 12 146 26" stroke={METAL} strokeWidth="4" fill="none" strokeLinecap="round" />
        <rect x="138" y="24" width="24" height="8" rx="3" fill={head} stroke={STEEL} strokeWidth="1" />
        {lit && <circle cx="150" cy="32" r="9" fill={GLOW} opacity="0.45" />}
        {asset.lighting === 'out' && <path d="M144 18 l12 12 M156 18 l-12 12" stroke={resolveColor('danger')} strokeWidth="2" />}
        <rect x="99" y="62" width="13" height="16" rx="2" fill="var(--app-surface-raised)" stroke="var(--app-border-strong)" />
        <circle cx="105.5" cy="68" r="2" fill={live ? resolveColor('success') : DEAD} />
        {open
          ? <rect x="81" y="101" width="12" height="15" rx="1" fill={resolveColor('danger')} transform="rotate(-35 93 101)" />
          : <rect x="93.5" y="101" width="5" height="15" rx="1" fill={STEEL} />}
      </g>
      {leaning && <text x="96" y="14" textAnchor="middle" fontSize="9" fontWeight="700" fill={resolveColor('danger')}>leaning {tilt}°</text>}
    </>
  );
}

function Cabinet({ asset, reading, live, outgoing }) {
  const open = reading?.door === 1;
  const big = asset.type === 'switchboard';
  const w = big ? 96 : 70;
  const x = 130 - w / 2;
  const ways = Math.max(outgoing.length, 1);
  return (
    <>
      <Supply x1={4} x2={x} y={112} live={live} label={asset.upstream ? (live ? `from ${asset.upstream}` : `no supply · ${asset.upstream}`) : 'Sarawak Energy supply'} />
      <line x1="0" y1="124" x2="260" y2="124" stroke="var(--app-border-strong)" strokeWidth="1.5" />
      <rect x={x - 6} y="118" width={w + 12} height="6" fill={METAL} />
      <rect x={x} y={big ? 26 : 40} width={w} height={big ? 92 : 78} rx="4" fill="var(--app-surface-raised)" stroke="var(--app-border-strong)" strokeWidth="1.5" />
      {open ? (
        <>
          {[0, 1, 2].map((i) => <rect key={i} x={x + 10} y={(big ? 40 : 52) + i * 14} width={w - 20} height="4" rx="1" fill="var(--app-warning-strong)" />)}
          <polygon points={`${x},${big ? 26 : 40} ${x - 26},${big ? 34 : 46} ${x - 26},${big ? 112 : 112} ${x},118`} fill={resolveColor('danger')} opacity="0.85" />
        </>
      ) : (
        <>
          <line x1={x + w / 2} y1={big ? 30 : 44} x2={x + w / 2} y2="114" stroke="var(--app-border-strong)" />
          <circle cx={x + w / 2 + 6} cy={big ? 72 : 80} r="2.5" fill={STEEL} />
        </>
      )}
      <rect x={x + w - 16} y={big ? 32 : 46} width="11" height="13" rx="2" fill="var(--app-surface)" stroke="var(--app-border-strong)" />
      <circle cx={x + w - 10.5} cy={big ? 37 : 51} r="2" fill={live ? resolveColor('success') : DEAD} />
      {outgoing.slice(0, 5).map((o, i) => {
        const y = 60 + (i * 50) / ways;
        return (
          <g key={o.id}>
            <line x1={x + w} y1={y} x2="256" y2={y} stroke={o.live ? AMBER : DEAD} strokeWidth="2" strokeDasharray={o.live ? undefined : '5 4'} />
            <text x="256" y={y - 3} textAnchor="end" fontSize="8.5" fill="var(--app-text-faint)">{o.label}</text>
          </g>
        );
      })}
      {open && <text x={x + w / 2} y="20" textAnchor="middle" fontSize="9" fontWeight="700" fill={resolveColor('danger')}>door open</text>}
    </>
  );
}

function Cable({ asset, reading, live }) {
  const flowing = live && (reading?.current ?? 1) > 0;
  return (
    <>
      <rect x="0" y="62" width="260" height="62" fill="var(--app-surface-raised)" />
      <text x="6" y="58" fontSize="8.5" fill="var(--app-text-faint)">ground level</text>
      <line x1="0" y1="62" x2="260" y2="62" stroke="var(--app-border-strong)" strokeWidth="1.5" />
      <rect x="10" y="86" width="240" height="14" rx="7" fill="none" stroke="var(--app-border-strong)" strokeWidth="1.5" />
      {live ? (
        <Supply x1={16} x2={244} y={93} live={flowing} label="" />
      ) : (
        <>
          <line x1="16" y1="93" x2="110" y2="93" stroke={DEAD} strokeWidth="3" strokeDasharray="6 5" />
          <line x1="150" y1="93" x2="244" y2="93" stroke={DEAD} strokeWidth="3" strokeDasharray="6 5" />
          <path d="M122 83 l16 20 M138 83 l-16 20" stroke={resolveColor('danger')} strokeWidth="2.5" />
          <text x="130" y="76" textAnchor="middle" fontSize="9" fontWeight="700" fill={resolveColor('danger')}>cut</text>
        </>
      )}
      <text x="10" y="116" fontSize="8.5" fill="var(--app-text-faint)">{asset.upstream}</text>
      <text x="250" y="116" textAnchor="end" fontSize="8.5" fill="var(--app-text-faint)">{asset.lengthM} m · {asset.spec?.laid}</text>
      <rect x="20" y="70" width="12" height="12" rx="2" fill="var(--app-surface)" stroke="var(--app-border-strong)" />
      <circle cx="26" cy="76" r="2" fill={live ? resolveColor('success') : DEAD} />
    </>
  );
}

/**
 * Props: asset, reading (latest sensor reading or null), live (energised),
 * lit (lamp lit now), outgoing ([{ id, label, live }]) for pillars and switchboards.
 */
export default function AssetSchematic({ asset, reading, live, lit, outgoing = [] }) {
  return (
    <div className="tile !p-2">
      <svg viewBox="0 0 260 140" className="w-full" role="img" aria-label={`${asset.id} schematic`} style={{ color: 'var(--app-text-muted)' }}>
        {asset.type === 'streetlight' && <Streetlight asset={asset} reading={reading} live={live} lit={lit} />}
        {(asset.type === 'distribution_box' || asset.type === 'switchboard') && <Cabinet asset={asset} reading={reading} live={live} outgoing={outgoing} />}
        {asset.type === 'cable' && <Cable asset={asset} reading={reading} live={live} />}
        {asset.node && (
          <g>
            <text x="256" y="11" textAnchor="end" fontSize="8.5" fill="var(--app-text-faint)">{asset.node.id}</text>
            <Signal x={186} y={3} rssi={asset.node.rssiDbm} />
            <text x="256" y="22" textAnchor="end" fontSize="8.5" fill="var(--app-text-faint)">{asset.node.rssiDbm} dBm</text>
          </g>
        )}
      </svg>
    </div>
  );
}
