import React from 'react';
import { LevelBadge, StatusBadge, SourceIcon } from './common';
import { zoneName } from '../../data/DataProvider';
import { LEVELS } from '../../ai/threatScore';
import { timeAgo } from '../../utils';
import { formatMyt } from '../../ai/time';

/** Newest-first list of alerts. */
export default function AlertFeed({ alerts, onSelect, emptyText = 'No alerts.' }) {
  if (!alerts.length) return <p className="text-center text-xs text-fg-faint py-8">{emptyText}</p>;
  return (
    <ul>
      {alerts.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={() => onSelect?.(a)} className="w-full text-left flex gap-3 px-4 py-3 border-b hover:bg-surface-raised transition-colors">
            <span className={`tile tone-${LEVELS[a.level]?.tone || 'neutral'} !p-1.5 h-fit`}><SourceIcon source={a.source} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 flex-wrap">
                <LevelBadge level={a.level} />
                <span className="text-xs font-semibold text-fg truncate">{a.title}</span>
              </span>
              <span className="block text-[11px] text-fg-muted mt-0.5 line-clamp-2">{a.message}</span>
              <span className="flex items-center gap-2 mt-1 text-[10px] text-fg-faint">
                <span title={`${formatMyt(a.createdAt)} MYT`}>{timeAgo(a.createdAt)}</span>·<span>{zoneName(a.zone)}</span>·<StatusBadge status={a.status} />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
