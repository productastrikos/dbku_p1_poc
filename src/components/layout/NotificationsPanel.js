import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Icon, IconButton } from '../ui';
import { useData } from '../../data/DataProvider';
import { timeAgo } from '../../utils';
import { formatMyt } from '../../ai/time';

const GROUPS = [
  { tone: 'danger',  label: 'Critical' },
  { tone: 'warning', label: 'Warning' },
  { tone: 'info',    label: 'Info' },
];

export default function NotificationsPanel({ onClose }) {
  const navigate = useNavigate();
  const { notifications, markRead, markAllRead } = useData();
  const [showRead, setShowRead] = useState(false);
  const unread = notifications.filter((n) => !n.read);
  const shown = showRead ? notifications : unread;

  // Opening a notification marks it read and goes to the record it is about.
  const open = (n) => { markRead(n.id); onClose(); navigate(n.link); };

  return (
    <aside className="side-panel w-80 max-w-full" aria-label="Notifications">
      <div className="panel-header">
        <div>
          <h3 className="app-modal-title">Notifications</h3>
          <p className="text-xs text-fg-faint">{unread.length} unread · {notifications.length} active</p>
        </div>
        <IconButton icon="close" label="Close" plain onClick={onClose} />
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-b text-[10px]">
        <button type="button" className="link-btn" onClick={() => setShowRead((v) => !v)}>{showRead ? 'UNREAD ONLY' : 'SHOW READ'}</button>
        <button type="button" className="link-btn" disabled={!unread.length} onClick={() => markAllRead(unread.map((n) => n.id))}>MARK ALL AS READ</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {GROUPS.map(({ tone, label }) => {
          const items = shown.filter((n) => n.tone === tone);
          if (!items.length) return null;
          return (
            <div key={tone} className="space-y-2">
              <Badge tone={tone} plain>{label.toUpperCase()} ({items.length})</Badge>
              {items.map((n) => (
                <div key={n.id} className={`tile tone-${tone} ${n.read ? 'opacity-60' : ''}`}>
                  <button type="button" className="w-full text-left" onClick={() => open(n)}>
                    <span className="block text-xs font-bold text-fg">{n.title}</span>
                    <span className="block text-[11px] text-fg-muted mt-0.5">{n.message}</span>
                  </button>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-fg-faint" title={`${formatMyt(n.createdAt)} MYT`}>{timeAgo(n.createdAt)}</span>
                    <span className="flex gap-3">
                      <button type="button" className="link-btn" onClick={() => open(n)}>OPEN</button>
                      {!n.read && <button type="button" className="link-btn" onClick={() => markRead(n.id)}>MARK AS READ</button>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="app-empty">
            <Icon name="bell" size={44} className="app-empty-icon" />
            <p className="app-empty-title">You're all caught up</p>
            <p className="app-empty-text">{showRead ? 'There are no active notifications.' : 'No unread notifications. Choose Show read to see earlier ones.'}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
