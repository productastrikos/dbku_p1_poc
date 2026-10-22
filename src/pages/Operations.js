import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, StatGrid, StatCard, Card, Button, DataTable, FilterChips, Tabs } from '../components/ui';
import EntityDrawer from '../components/guard/EntityDrawer';
import { TaskFormModal } from '../components/guard/Tasks';
import { Title, Ms, TaskStatusBadge, TaskKindBadge, PriorityBadge } from '../components/guard/common';
import { useData, zoneName } from '../data/DataProvider';
import { TASK_KINDS, TASK_STATUS, ALERT_STATUS, REVIEW_STATUS } from '../data/reference';
import { formatMyt, DAY } from '../ai/time';
import { timeAgo } from '../utils';

const ACTIVE = ['open', 'in_progress'];

// Plain-English line for an entry in the action log.
function describe(e) {
  switch (e.kind) {
    case 'alert': return e.status === 'raised' ? `Alert ${e.id} raised${e.note ? `: ${e.note}` : ''}` : `Alert ${e.id} → ${ALERT_STATUS[e.status]?.label || e.status}${e.note ? ` (${e.note})` : ''}`;
    case 'task': return `${e.id} → ${TASK_STATUS[e.status]?.label || e.status}${e.note ? `: ${e.note}` : ''}`;
    case 'review': return `Scrap sale ${e.id} → ${REVIEW_STATUS[e.status]?.label || e.status}${e.note ? ` (${e.note})` : ''}`;
    case 'scrap': return `Scrap sale ${e.id} recorded${e.note ? `: ${e.note}` : ''}`;
    case 'report': return `Police brief drafted for ${e.id}${e.note ? ` (${e.note})` : ''}`;
    default: return `${e.id} ${e.status}${e.note ? `: ${e.note}` : ''}`;
  }
}

export default function Operations() {
  const navigate = useNavigate();
  const { tasks, actionLog, now } = useData();
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('active');
  const [form, setForm] = useState(null);
  const taskParam = params.get('task');
  const [panel, setPanelState] = useState(null);
  const setPanel = (p) => { setPanelState(p); if (!p && taskParam) setParams({}); };
  // Links such as /operations?task=WO-… open that task.
  useEffect(() => { if (taskParam) setPanelState({ kind: 'task', id: taskParam }); }, [taskParam]);

  const rows = tasks
    .filter((t) => kind === 'all' || t.kind === kind)
    .filter((t) => (status === 'all' ? true : status === 'active' ? ACTIVE.includes(t.status) : t.status === status));
  const active = tasks.filter((t) => ACTIVE.includes(t.status));
  const doneWeek = tasks.filter((t) => t.status === 'done' && now - Date.parse(t.updatedAt) < 7 * DAY);

  return (
    <div className="space-y-4">
      <PageHeader
        title={<Title en="Operations" ms="Operasi" />}
        subtitle="Patrols, PDRM notifications and work orders raised from alerts, AI insights and the digital twin, with their progress."
        actions={
          <>
            <Button variant="secondary" icon="truck" onClick={() => setForm('patrol')}>Dispatch patrol</Button>
            <Button variant="secondary" icon="siren" onClick={() => setForm('pdrm')}>Notify PDRM</Button>
            <Button icon="wrench" onClick={() => setForm('work_order')}>New work order</Button>
          </>
        }
      />

      <StatGrid>
        <StatCard label="Open patrols" value={active.filter((t) => t.kind === 'patrol').length} icon="truck"
          status={active.some((t) => t.kind === 'patrol' && t.priority === 'Immediate') ? 'warning' : 'normal'}
          onDetails={() => { setKind('patrol'); setStatus('active'); }}
          subValues={[{ label: 'Immediate', value: active.filter((t) => t.kind === 'patrol' && t.priority === 'Immediate').length }]} />
        <StatCard label="PDRM notifications" value={tasks.filter((t) => t.kind === 'pdrm').length} icon="siren"
          onDetails={() => { setKind('pdrm'); setStatus('all'); }}
          subValues={[{ label: 'Awaiting reply', value: active.filter((t) => t.kind === 'pdrm').length }]} />
        <StatCard label="Open work orders" value={active.filter((t) => t.kind === 'work_order').length} icon="wrench"
          status={active.some((t) => t.kind === 'work_order' && t.priority === 'Critical') ? 'critical' : active.some((t) => t.kind === 'work_order') ? 'warning' : 'normal'}
          onDetails={() => { setKind('work_order'); setStatus('active'); }}
          subValues={[{ label: 'Critical', value: active.filter((t) => t.priority === 'Critical').length }, { label: 'In progress', value: active.filter((t) => t.kind === 'work_order' && t.status === 'in_progress').length }]} />
        <StatCard label="Completed, last 7 days" value={doneWeek.length} icon="check"
          onDetails={() => { setKind('all'); setStatus('done'); }}
          subValues={[{ label: 'All time', value: tasks.filter((t) => t.status === 'done').length }]} />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" padded={false} title={`Tasks (${rows.length})`} subtitle="Click a task to update it"
          actions={
            <>
              <Tabs size="sm" value={kind} onChange={setKind} tabs={[{ value: 'all', label: 'All' }, ...Object.entries(TASK_KINDS).map(([value, k]) => ({ value, label: k.label }))]} />
            </>
          }>
          <div className="px-4 py-2 border-b">
            <FilterChips value={status} onChange={setStatus}
              options={[{ value: 'active', label: 'Open + in progress' }, ...Object.entries(TASK_STATUS).map(([value, s]) => ({ value, label: s.label })), { value: 'all', label: 'All' }]} />
          </div>
          <DataTable
            rows={rows}
            onRowClick={(t) => setPanel({ kind: 'task', id: t.id })}
            emptyText="No tasks in this view."
            columns={[
              { key: 'id', header: 'Task', mono: true, className: 'whitespace-nowrap' },
              { key: 'kind', header: 'Type', render: (t) => <TaskKindBadge kind={t.kind} /> },
              { key: 'title', header: 'What', strong: true, render: (t) => <>{t.title}<span className="block text-[10px] text-fg-faint font-normal">{t.team}{t.zone ? ` · ${zoneName(t.zone)}` : ''}</span></> },
              { key: 'priority', header: 'Priority', render: (t) => <PriorityBadge priority={t.priority} /> },
              { key: 'status', header: 'Status', render: (t) => <TaskStatusBadge status={t.status} /> },
              { key: 'updated', header: 'Updated', className: 'whitespace-nowrap', render: (t) => <span title={`${formatMyt(t.updatedAt)} MYT`}>{timeAgo(t.updatedAt)}</span> },
            ]}
          />
        </Card>

        <Card title={<span>Command log <Ms>Log arahan</Ms></span>} subtitle="Every decision taken in this browser" padded={false} bodyClassName="max-h-[560px] overflow-y-auto">
          {actionLog.length === 0 && <p className="text-xs text-fg-faint text-center py-8 px-4">Nothing logged yet. Responding to an alert, raising a task or reviewing a scrap sale adds an entry here.</p>}
          <ul>
            {actionLog.map((e, i) => {
              const target = e.kind === 'alert' ? `/?alert=${e.id}` : e.kind === 'task' ? null : e.kind === 'report' ? `/reports?event=${e.id}` : '/scrap?view=queue';
              return (
                <li key={`${e.at}-${i}`}>
                  <button type="button" className="w-full text-left px-4 py-2.5 border-b text-xs hover:bg-surface-raised"
                    onClick={() => (e.kind === 'task' ? setPanel({ kind: 'task', id: e.id }) : navigate(target))}>
                    <span className="block text-fg">{describe(e)}</span>
                    <span className="block text-[10px] text-fg-faint font-mono mt-0.5">{formatMyt(e.at, 'short')}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {form && <TaskFormModal kind={form} onClose={() => setForm(null)} onCreated={(id) => setPanel({ kind: 'task', id })}
        context={{ askTitle: true, title: '', source: 'Operations' }} />}
      <EntityDrawer panel={panel} onChange={setPanel} />
    </div>
  );
}
