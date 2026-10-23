import React, { useEffect, useState } from 'react';
import Sidebar, { BrandMark } from './Sidebar';
import Header from './Header';
import NotificationsPanel from './NotificationsPanel';
import InsightsPanel from './InsightsPanel';
import { Button, IconButton, Modal } from '../ui';
import { useTheme } from '../../theme/ThemeProvider';
import { APP, USER } from '../../config';

// Below 1024px the sidebar is an off-canvas drawer (theme.css, section 10).
const isDrawerViewport = () => window.matchMedia?.('(max-width: 1023px)').matches;

/* App shell: sidebar, header, scrollable content area, and the
   slide-out side panels. */
export default function Layout({ children }) {
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [panel, setPanel] = useState(null); // 'notifications' | 'insights' | null
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));
  const toggleSidebar = () => (isDrawerViewport() ? setNavOpen((o) => !o) : setCollapsed((c) => !c));

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setNavOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className="shell">
      <Sidebar collapsed={collapsed && !navOpen} open={navOpen} onNavigate={() => setNavOpen(false)} />
      {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onToggleSidebar={toggleSidebar}
          activePanel={panel}
          onTogglePanel={togglePanel}
          onSignOut={() => setConfirmSignOut(true)}
        />
        <main className="shell-main"><div className="shell-content">{children}</div></main>
      </div>

      {panel === 'notifications' && <NotificationsPanel onClose={() => setPanel(null)} />}
      {panel === 'insights' && <InsightsPanel onClose={() => setPanel(null)} />}

      {confirmSignOut && (
        <Modal title="Sign out?" onClose={() => setConfirmSignOut(false)}
          footer={<><Button variant="secondary" onClick={() => setConfirmSignOut(false)}>Cancel</Button><Button variant="danger" icon="logout" onClick={() => { setConfirmSignOut(false); setPanel(null); setSignedOut(true); }}>Sign out</Button></>}>
          <p className="text-sm text-fg-muted">The command centre keeps running: sensors, alerts and your decisions stay in this browser. Sign in again to continue.</p>
        </Modal>
      )}

      {signedOut && (
        <div className="overlay overlay-solid" style={{ zIndex: 2000 }} role="dialog" aria-modal="true" aria-label="Signed out">
          <div className="auth-split">
            <section className="auth-ink astk-on-ink astk-aurora">
              <BrandMark height={104} />
              <div>
                <p className="astk-eyebrow auth-ink-eyebrow">{APP.subtitle}</p>
                <h2 className="auth-ink-statement">Early warning for vandalism and electrical theft</h2>
                <p className="auth-ink-text">Prevention, early detection and disruption of the resale channel across Kuching Utara.</p>
              </div>
              <p className="auth-ink-foot">{APP.fullName}</p>
            </section>

            <section className="auth-form">
              <div className="auth-theme-toggle">
                <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={toggleTheme} />
              </div>
              <div className="card p-8 w-full text-center space-y-4">
                <div className="flex justify-center md:hidden"><BrandMark height={72} /></div>
                <div>
                  <h1 className="page-title">{APP.fullName || APP.name}</h1>
                  <p className="page-subtitle">{APP.subtitle}</p>
                </div>
                <p className="text-sm text-fg-muted">You have signed out.</p>
                <Button block icon="user" onClick={() => setSignedOut(false)}>Sign in as {USER.name}</Button>
                <p className="text-[10px] text-fg-faint">Prototype: no password is needed.</p>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
