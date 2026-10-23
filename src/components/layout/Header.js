import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, IconButton, Button, Modal, DetailGrid } from '../ui';
import { useTheme } from '../../theme/ThemeProvider';
import { useData, zoneName } from '../../data/DataProvider';
import { ASSET_TYPES, ALERT_STATUS, TASK_KINDS } from '../../data/reference';
import { formatMyt, sameMytDay } from '../../ai/time';
import { NAV_SECTIONS, ROUTES } from '../../routes';
import { APP, USER } from '../../config';
import { initials } from '../../utils';
import { toneVar } from '../../theme/tones';

// Closes a popup when clicking outside `ref` or pressing Escape.
function useDismiss(ref, open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose]);
}

// Pages come from routes.js; records (assets, alerts, incidents, sales,
// dealers, cameras, tasks) from the data store.
const PAGE_INDEX = NAV_SECTIONS.flatMap((s) =>
  s.items.map((i) => ({ key: i.path, label: i.label, sub: s.label, icon: i.icon, path: i.path, page: true, haystack: `${i.label} ${i.labelMs || ''} ${s.label} ${i.keywords || ''}`.toLowerCase() })));

function useSearchIndex() {
  const { assets, alerts, incidents, transactions, screening, dealers, cameras, tasks } = useData();
  return useMemo(() => {
    const dealerName = Object.fromEntries(dealers.map((d) => [d.id, d.name]));
    const rec = (key, label, sub, icon, path, text) => ({ key, label, sub, icon, path, haystack: `${label} ${sub} ${text || ''}`.toLowerCase() });
    return [
      ...PAGE_INDEX,
      ...assets.map((a) => rec(a.id, `${a.id} · ${a.name}`, `Asset · ${ASSET_TYPES[a.type].label} · ${zoneName(a.zone)}`, ASSET_TYPES[a.type].icon, `/twin?asset=${a.id}`, `${a.road} ${a.status}`)),
      ...alerts.map((a) => rec(a.id, `${a.id} · ${a.title}`, `Alert · ${a.level} · ${ALERT_STATUS[a.status]?.label}`, 'bell', `/?alert=${a.id}`, a.message)),
      ...incidents.map((i) => rec(i.id, `${i.id} · ${i.title}`, `Incident · ${formatMyt(i.occurredAt, 'date')}`, 'fileText', `/reports?event=${i.id}`, `${i.typeLabel} ${i.assetIds.join(' ')}`)),
      ...transactions.map((t) => rec(t.id, `${t.id} · ${t.material}, ${t.weightKg} kg`, `Scrap sale · ${dealerName[t.dealerId]}${screening[t.id]?.suspicious ? ' · flagged' : ''}`, 'recycle',
        screening[t.id]?.suspicious ? `/scrap?review=${t.id}` : `/scrap?view=all&q=${t.id}`, t.sellerIcMasked)),
      ...dealers.map((d) => rec(d.id, d.name, `Scrap dealer · ${d.licenceNo}`, 'recycle', `/scrap?view=all&q=${encodeURIComponent(d.name)}`, d.area)),
      ...cameras.map((c) => rec(c.id, `${c.id} · CCTV`, `Camera on ${c.mountedOn} · ${zoneName(c.zone)}`, 'camera', `/twin?camera=${c.id}`, c.model)),
      ...tasks.map((t) => rec(t.id, `${t.id} · ${t.title}`, `${TASK_KINDS[t.kind]?.label} · ${t.team}`, TASK_KINDS[t.kind]?.icon || 'clipboard', `/operations?task=${t.id}`, t.details)),
    ];
  }, [assets, alerts, incidents, transactions, screening, dealers, cameras, tasks]);
}

function Search() {
  const navigate = useNavigate();
  const index = useSearchIndex();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const inputRef = useRef(null);
  useDismiss(ref, open, () => { setOpen(false); setQuery(''); });

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); setOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Every word must match; pages first, then exact id matches, then the rest in index order.
  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const q = query.trim().toLowerCase();
    return index
      .filter((item) => words.every((w) => item.haystack.includes(w)))
      .map((item, i) => ({ item, rank: (item.page ? 0 : 2) - (item.key.toLowerCase() === q ? 2 : 0) + i / 1e5 }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 10)
      .map((r) => r.item);
  }, [query, index]);

  const go = (path) => { navigate(path); setOpen(false); setQuery(''); inputRef.current?.blur(); };

  return (
    <div className="search hidden sm:flex" ref={ref}>
      <Icon name="search" size={14} className="text-fg-faint" />
      <input
        ref={inputRef}
        value={query}
        placeholder="Search assets, alerts, sales… (Ctrl+K)"
        aria-label="Search"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) go(results[0].path); }}
      />
      {open && query.trim() && (
        <div className="menu left-0 right-0">
          <div className="menu-section">
            {results.length === 0 && <p className="menu-empty">No results for “{query}”. Try an asset ID, road or dealer name.</p>}
            {results.map((r) => (
              <button key={`${r.key}-${r.path}`} type="button" className="menu-item" onMouseDown={(e) => { e.preventDefault(); go(r.path); }}>
                <Icon name={r.icon} size={15} />
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-fg truncate">{r.label}</span>
                  <span className="block text-[10px] text-fg-faint truncate">{r.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="header-clock hidden md:inline-block">
      {now.toLocaleTimeString(APP.locale, { hour12: false, timeZone: APP.timeZone })} <span className="text-fg-faint">MYT</span>
    </span>
  );
}

function ProfileModal({ onClose }) {
  const navigate = useNavigate();
  const { actionLog, tasks, rebasedDays, meta } = useData();
  const { theme } = useTheme();
  const today = actionLog.filter((e) => sameMytDay(e.at, Date.now()));
  return (
    <Modal title={USER.name} eyebrow="Profile" subtitle={USER.role} onClose={onClose}
      footer={<><Button variant="secondary" onClick={() => { onClose(); navigate('/operations'); }}>Command log</Button><Button onClick={onClose}>Close</Button></>}>
      <div className="space-y-3">
        <DetailGrid items={[
          { label: 'Unit', value: 'DBKU Enforcement' },
          { label: 'Station', value: APP.subtitle },
          { label: 'Decisions today', value: today.length },
          { label: 'Open tasks', value: tasks.filter((t) => ['open', 'in_progress'].includes(t.status)).length },
          { label: 'Theme', value: theme === 'dark' ? 'Dark' : 'Light' },
          { label: 'Time zone', value: 'Malaysia Time (UTC+8)' },
        ]} />
        <p className="text-[11px] text-fg-faint leading-relaxed">
          Prototype: there is no sign-in service. Your decisions are kept in this browser only. Mock data dated {meta.asOf}{rebasedDays ? ` is shown moved forward ${rebasedDays} day${rebasedDays === 1 ? '' : 's'} so recent events stay recent` : ''}.
        </p>
      </div>
    </Modal>
  );
}

function ProfileMenu({ onOpenNotifications, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  const ref = useRef(null);
  const { toggleTheme } = useTheme();
  useDismiss(ref, open, () => setOpen(false));

  const item = (icon, label, onClick, tone) => (
    <button type="button" className={`menu-item ${tone || ''}`} role="menuitem" onClick={() => { setOpen(false); onClick?.(); }}>
      <Icon name={icon} size={15} />{label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="avatar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={USER.name} aria-label={`Account menu for ${USER.name}`}>
        {initials(USER.name)}
      </button>
      {open && (
        <div className="menu right-0" role="menu">
          <div className="profile-menu-header">
            <div className="avatar" aria-hidden="true">{initials(USER.name)}</div>
            <div className="min-w-0">
              <p className="name truncate">{USER.name}</p>
              <p className="role">{USER.role}</p>
              <p className="status">On duty</p>
            </div>
          </div>
          <div className="menu-section">
            {item('user', 'Profile', () => setProfile(true))}
            {item('bell', 'Notifications', onOpenNotifications)}
            {item('settings', 'Toggle theme', toggleTheme)}
          </div>
          <div className="menu-section">
            {item('logout', 'Sign out', onSignOut, 'danger')}
          </div>
        </div>
      )}
      {profile && createPortal(<ProfileModal onClose={() => setProfile(false)} />, document.body)}
    </div>
  );
}

export default function Header({ onToggleSidebar, activePanel, onTogglePanel, onSignOut }) {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { notifications } = useData();
  const f = APP.features;

  const unread = notifications.filter((n) => !n.read);
  const hasDanger = unread.some((n) => n.tone === 'danger');
  const pageTitle = ROUTES.find((r) => r.path === pathname)?.label || '';

  return (
    <header className="header">
      <IconButton icon="menu" label="Toggle sidebar" onClick={onToggleSidebar} />

      <div className="hidden sm:flex flex-col ml-1 mr-2 leading-tight">
        <span className="header-eyebrow">{APP.subtitle}</span>
        <span className="text-[11px] text-fg-muted mt-0.5">{pageTitle}</span>
      </div>

      {f.search && <Search />}
      <div className="flex-1" />
      {f.clock && <Clock />}

      {f.themeToggle && (
        <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={toggleTheme} />
      )}

      {f.insights && (
        <button type="button" className={`app-advisory-btn ${activePanel === 'insights' ? 'is-on' : ''}`}
          onClick={() => onTogglePanel('insights')} aria-pressed={activePanel === 'insights'} aria-label="AI Insights">
          <Icon name="sparkles" size={16} />
          <span className="hidden md:inline">AI Insights</span>
        </button>
      )}

      {f.notifications && (
        <IconButton icon="bell" label="Notifications" active={activePanel === 'notifications'} onClick={() => onTogglePanel('notifications')}>
          {unread.length > 0 && (
            <span className="notify-count" style={{ background: toneVar(hasDanger ? 'danger' : 'warning') }}>{unread.length}</span>
          )}
        </IconButton>
      )}

      <ProfileMenu onOpenNotifications={() => activePanel !== 'notifications' && onTogglePanel('notifications')} onSignOut={onSignOut} />
    </header>
  );
}
