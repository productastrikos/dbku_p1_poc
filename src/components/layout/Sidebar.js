import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../ui';
import { NAV_SECTIONS } from '../../routes';
import { APP, USER } from '../../config';
import { initials } from '../../utils';

// `compact` swaps in the square mark where the full crest would be too small.
export function BrandMark({ compact = false, height = 40 }) {
  if (compact && APP.logoCompact) return <img src={APP.logoCompact} alt={APP.fullName || APP.name} className="brand-logo-compact" />;
  return APP.logo
    ? <span className="brand-logo"><img src={APP.logo} alt={`${APP.fullName || APP.name} crest`} style={{ height }} /></span>
    : <div className="brand-mark">{APP.logoInitials || initials(APP.name)}</div>;
}

/* open: the off-canvas drawer is showing (below 1024px).
   onNavigate: called after a nav item is chosen, so the drawer can close. */
export default function Sidebar({ collapsed, open = false, onNavigate }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const go = (path) => { navigate(path); onNavigate?.(); };

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className="sidebar-brand astk-lockup" onClick={() => go('/')} title={APP.fullName} aria-label={`${APP.fullName || APP.name}: go to the dashboard`}>
        <BrandMark compact={collapsed} />
        {!collapsed && (
          <>
            <span className="astk-lockup-rule" />
            <span className="astk-lockup-text">
              <span className="astk-lockup-name">{APP.name}</span>
              {APP.fullName && <span className="astk-lockup-descriptor">{APP.fullName}</span>}
            </span>
          </>
        )}
      </button>

      <nav className="nav" aria-label="Main">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            {collapsed ? <div className="h-3" /> : <p className="nav-section-label">{section.label}</p>}
            {section.items.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`nav-item ${pathname === item.path ? 'is-active' : ''}`}
                aria-current={pathname === item.path ? 'page' : undefined}
                onClick={() => go(item.path)}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
              >
                <Icon name={item.icon} size={16} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="sidebar-user">
          <div className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{initials(USER.name)}</div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-fg truncate">{USER.name}</p>
            <p className="text-[10px] text-fg-faint truncate">{USER.role}</p>
          </div>
        </div>
      )}
    </aside>
  );
}
