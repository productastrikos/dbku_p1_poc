import React, { useState } from 'react';
import Sidebar, { BrandMark } from './Sidebar';
import Header from './Header';
import NotificationsPanel from './NotificationsPanel';
import InsightsPanel from './InsightsPanel';
import { Button, Modal } from '../ui';
import { APP, USER } from '../../config';

/* App shell: sidebar, header, scrollable content area, and the
   slide-out side panels. */
export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState(null); // 'notifications' | 'insights' | null
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));

  return (
    <div className="shell">
      <Sidebar collapsed={collapsed} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onToggleSidebar={() => setCollapsed((c) => !c)}
          activePanel={panel}
          onTogglePanel={togglePanel}
          onSignOut={() => setConfirmSignOut(true)}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
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
        <div className="overlay overlay-center" style={{ zIndex: 2000, background: 'var(--color-bg)' }} role="dialog" aria-modal="true" aria-label="Signed out">
          <div className="card p-8 w-full max-w-sm text-center space-y-4">
            <div className="flex justify-center"><BrandMark /></div>
            <div>
              <h1 className="page-title">{APP.name}</h1>
              <p className="page-subtitle">{APP.subtitle}</p>
            </div>
            <p className="text-sm text-fg-muted">You have signed out.</p>
            <Button block icon="user" onClick={() => setSignedOut(false)}>Sign in as {USER.name}</Button>
            <p className="text-[10px] text-fg-faint">Prototype: no password is needed.</p>
          </div>
        </div>
      )}
    </div>
  );
}
