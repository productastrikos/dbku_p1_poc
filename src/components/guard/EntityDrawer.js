import React from 'react';
import AlertDrawer from './AlertDrawer';
import { AssetDrawer } from './AssetTwin';
import { TaskDrawer } from './Tasks';

/**
 * One detail drawer at a time for alerts, assets and tasks. Links inside a
 * drawer (an alert's asset, a task's alert…) switch the drawer in place.
 *   panel: { kind: 'alert' | 'asset' | 'task', id } or null
 */
export default function EntityDrawer({ panel, onChange }) {
  if (!panel) return null;
  const close = () => onChange(null);
  const nav = {
    onOpenAlert: (id) => onChange({ kind: 'alert', id }),
    onOpenAsset: (id) => onChange({ kind: 'asset', id }),
    onOpenTask: (id) => onChange({ kind: 'task', id }),
  };
  if (panel.kind === 'alert') return <AlertDrawer key={panel.id} alertId={panel.id} onClose={close} {...nav} />;
  if (panel.kind === 'asset') return <AssetDrawer key={panel.id} assetId={panel.id} onClose={close} {...nav} />;
  if (panel.kind === 'task') return <TaskDrawer key={panel.id} taskId={panel.id} onClose={close} {...nav} />;
  return null;
}
