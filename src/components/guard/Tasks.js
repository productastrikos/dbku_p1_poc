import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal, Drawer, DetailGrid, Button, Icon } from '../ui';
import { TaskStatusBadge, TaskKindBadge, PriorityBadge, Ms } from './common';
import { useData, zoneName } from '../../data/DataProvider';
import { ACTION_FORMS, TASK_KINDS, TASK_STATUS } from '../../data/reference';
import { formatMyt } from '../../ai/time';
import { timeAgo } from '../../utils';

// Task kind → the form used to raise it (see ACTION_FORMS).
export const FORM_FOR = { patrol: 'dispatch', pdrm: 'notify', work_order: 'task' };

/**
 * Form that raises a patrol, PDRM notification or work order.
 *   context: { title, assetIds, zone, alertId, source, values } prefilled values
 *   onCreated(id) after the task is saved
 */
export function TaskFormModal({ kind, context = {}, onClose, onCreated }) {
  const { createTask } = useData();
  const cfg = ACTION_FORMS[FORM_FOR[kind]];
  // Work orders always have a title field; patrols and notifications only when asked (no context to name them).
  const askTitle = kind === 'work_order' || context.askTitle;
  const fields = askTitle && kind !== 'work_order' ? [{ key: 'title', label: 'Title', type: 'text', placeholder: 'Short description' }, ...cfg.fields] : cfg.fields;
  const [values, setValues] = useState(() => {
    const v = {};
    fields.forEach((f) => { v[f.key] = f.options?.[0] ?? ''; });
    return { ...v, ...(askTitle && context.title ? { title: context.title } : {}), ...context.values };
  });
  const [error, setError] = useState(null);

  const submit = () => {
    if (askTitle && !values.title?.trim()) return setError('Give it a short title.');
    const id = createTask({
      kind,
      title: askTitle ? values.title.trim() : context.title || TASK_KINDS[kind].label,
      team: values.team || values.station,
      priority: kind === 'pdrm' ? 'Immediate' : values.priority,
      details: [values.channel, values.notes || values.message || values.details].filter(Boolean).join(' · '),
      assetIds: context.assetIds || [], zone: context.zone, alertId: context.alertId || null, source: context.source || 'Command centre',
    });
    onCreated?.(id);
    onClose();
    return undefined;
  };

  return createPortal(
    <Modal width={480} eyebrow={TASK_KINDS[kind].label} title={cfg.title} subtitle={context.title && !askTitle ? context.title : undefined} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon="check" onClick={submit}>{cfg.title}</Button></>}>
      <div className="space-y-3">
        {context.assetIds?.length > 0 && <p className="text-[11px] text-fg-faint">Assets: {context.assetIds.join(', ')}{context.zone ? ` · ${zoneName(context.zone)}` : ''}</p>}
        {fields.map((f) => {
          const common = { value: values[f.key] || '', onChange: (e) => setValues((v) => ({ ...v, [f.key]: e.target.value })), placeholder: f.placeholder };
          return (
            <label key={f.key} className="block">
              <span className="label-caps field-label">{f.label}</span>
              {f.type === 'select' && <select className="select" {...common}>{f.options.map((o) => <option key={o}>{o}</option>)}</select>}
              {f.type === 'textarea' && <textarea className="textarea" rows={3} {...common} />}
              {f.type === 'text' && <input className="input" {...common} />}
            </label>
          );
        })}
        {error && <p className="tile tone-danger text-xs">{error}</p>}
      </div>
    </Modal>,
    document.body,
  );
}

const NEXT = {
  open: [['in_progress', 'Start', 'play', 'primary'], ['done', 'Mark done', 'check', 'soft'], ['cancelled', 'Cancel task', 'close', 'ghost']],
  in_progress: [['done', 'Mark done', 'check', 'primary'], ['cancelled', 'Cancel task', 'close', 'ghost']],
  done: [['open', 'Reopen', 'refresh', 'secondary']],
  cancelled: [['open', 'Reopen', 'refresh', 'secondary']],
};

/** Task detail with its history and status actions. */
export function TaskDrawer({ taskId, onClose, onOpenAsset, onOpenAlert }) {
  const { tasks, updateTask } = useData();
  const [note, setNote] = useState('');
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;

  const act = (status) => { updateTask(task.id, status, note.trim() || undefined); setNote(''); };

  return (
    <Drawer width={480} eyebrow={`${TASK_KINDS[task.kind].label} · ${task.id}`} title={task.title}
      subtitle={`Raised ${formatMyt(task.createdAt)} MYT · ${task.source}`} headerExtra={<TaskStatusBadge status={task.status} />} onClose={onClose}>
      <div className="space-y-4">
        <DetailGrid items={[
          { label: task.kind === 'pdrm' ? 'Station' : 'Team', value: task.team || '—' },
          { label: 'Priority', value: <PriorityBadge priority={task.priority} /> },
          { label: 'Zone', value: task.zone ? zoneName(task.zone) : '—' },
          { label: 'Last update', value: <span title={formatMyt(task.updatedAt)}>{timeAgo(task.updatedAt)}</span> },
        ]} />
        {task.details && <p className="tile text-xs text-fg-muted leading-relaxed">{task.details}</p>}

        {(task.assetIds?.length > 0 || task.alertId) && (
          <div className="space-y-1.5">
            <p className="label-caps">Linked</p>
            <div className="flex flex-wrap gap-1.5">
              {task.alertId && <button type="button" className="chip" onClick={() => onOpenAlert?.(task.alertId)}><Icon name="bell" size={12} />{task.alertId}</button>}
              {task.assetIds.map((id) => <button key={id} type="button" className="chip" onClick={() => onOpenAsset?.(id)}><Icon name="pin" size={12} />{id}</button>)}
            </div>
          </div>
        )}

        <div>
          <p className="label-caps mb-2">History <Ms>Sejarah</Ms></p>
          <ol className="space-y-2 border-l-2 border-line pl-3">
            {[...task.history].reverse().map((h, i) => (
              <li key={i} className="text-xs">
                <span className="flex items-center gap-2"><TaskStatusBadge status={h.status} /><span className="text-[10px] text-fg-faint font-mono">{formatMyt(h.at, 'short')}</span></span>
                {h.note && <span className="block text-fg-muted mt-0.5">{h.note}</span>}
              </li>
            ))}
          </ol>
        </div>

        <div className="pt-3 border-t space-y-2">
          <p className="label-caps">Update <Ms>Kemas kini</Ms></p>
          <textarea className="textarea" rows={2} placeholder="Note for the log (optional)…" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {NEXT[task.status].map(([status, label, icon, variant]) => (
              <Button key={status} variant={variant} icon={icon} onClick={() => act(status)} title={TASK_STATUS[status].labelMs}>{label}</Button>
            ))}
            <Button variant="ghost" icon="plus" disabled={!note.trim()} onClick={() => act(task.status)}>Add note</Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/** Compact clickable list of tasks. */
export function TaskList({ tasks, onSelect, emptyText = 'No tasks.' }) {
  if (!tasks.length) return <p className="text-xs text-fg-faint">{emptyText}</p>;
  return (
    <ul className="space-y-1.5">
      {tasks.map((t) => (
        <li key={t.id}>
          <button type="button" onClick={() => onSelect?.(t.id)} className="w-full text-left tile !py-2 hover:border-line-strong transition-colors">
            <span className="flex items-center gap-2 flex-wrap">
              <TaskKindBadge kind={t.kind} />
              <span className="text-[10px] font-mono text-fg-faint">{t.id}</span>
              <span className="ml-auto"><TaskStatusBadge status={t.status} /></span>
            </span>
            <span className="block text-xs font-semibold text-fg mt-1">{t.title}</span>
            <span className="block text-[10px] text-fg-faint">{t.team} · updated {timeAgo(t.updatedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
