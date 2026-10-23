import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Icon, IconButton } from '../ui';
import { TaskStatusBadge } from '../guard/common';
import { useData } from '../../data/DataProvider';
import { ACTION_FORMS } from '../../data/reference';

const PRIORITY_TONE = { critical: 'danger', high: 'warning', medium: 'info', low: 'neutral' };

function Section({ title, children }) {
  return (
    <div className="px-4 py-3">
      <p className="label-caps mb-2">{title}</p>
      {children}
    </div>
  );
}

function ActionForm({ form, onChange, onSubmit, onCancel, busy }) {
  const cfg = ACTION_FORMS[form.action];
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-surface-elevated animate-fade-in">
      <div className="px-4 py-3 border-b">
        <p className="app-modal-title">{cfg.title}</p>
        <p className="text-[10px] text-fg-faint mt-0.5 line-clamp-1">{form.insightTitle}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {cfg.fields.map((f) => {
          const common = { value: form.values[f.key] || '', onChange: (e) => onChange(f.key, e.target.value), placeholder: f.placeholder };
          return (
            <label key={f.key} className="block">
              <span className="label-caps field-label">{f.label}</span>
              {f.type === 'select' && <select className="select" {...common}>{f.options.map((o) => <option key={o}>{o}</option>)}</select>}
              {f.type === 'textarea' && <textarea className="textarea" rows={3} {...common} />}
              {f.type === 'text' && <input className="input" {...common} />}
            </label>
          );
        })}
      </div>
      <div className="p-4 border-t space-y-2">
        <Button block onClick={onSubmit} disabled={busy}>{busy ? 'Submitting…' : `Submit: ${cfg.title}`}</Button>
        <Button block variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export default function InsightsPanel({ onClose }) {
  const navigate = useNavigate();
  const { insights, runAction } = useData();
  const [expanded, setExpanded] = useState(insights[0]?.id);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const openForm = (action, insight) => {
    const values = {};
    ACTION_FORMS[action].fields.forEach((f) => { values[f.key] = f.options?.[0] ?? ''; });
    setForm({ action, insightId: insight.id, insightTitle: insight.title, values: { ...values, ...insight.defaults?.[action] } });
  };

  const submit = async () => {
    setBusy(true);
    let id = null;
    try { id = await runAction(form.insightId, form.action, form.values); } finally {
      setBusy(false);
      setToast({ text: `${ACTION_FORMS[form.action].title} submitted${id ? `: ${id}` : ''}`, id });
      setForm(null);
      setTimeout(() => setToast(null), 6000);
    }
  };

  const openTask = (id) => { onClose(); navigate(`/operations?task=${id}`); };

  return (
    <aside className="side-panel w-96 max-w-full" aria-label="AI Insights">
      <div className="panel-header">
        <div>
          <h3 className="app-modal-title flex items-center gap-1.5"><Icon name="sparkles" size={16} className="text-accent" />AI Insights</h3>
          <p className="text-xs text-fg-faint">{insights.length} recommendations</p>
        </div>
        <IconButton icon="close" label="Close" plain onClick={onClose} />
      </div>

      <div className="relative flex-1 min-h-0">
        {toast && (
          <div className="app-toast tone-success absolute top-3 left-3 right-3 z-20 flex items-center justify-between gap-2" role="status">
            <span className="flex items-center gap-2"><Icon name="check" size={14} className="text-success" />{toast.text}</span>
            {toast.id && <button type="button" className="link-btn shrink-0" onClick={() => openTask(toast.id)}>VIEW</button>}
          </div>
        )}

        {form && (
          <ActionForm
            form={form}
            busy={busy}
            onChange={(k, v) => setForm((f) => ({ ...f, values: { ...f.values, [k]: v } }))}
            onSubmit={submit}
            onCancel={() => setForm(null)}
          />
        )}

        <div className="h-full overflow-y-auto p-3 space-y-3">
          {insights.length === 0 && (
            <div className="app-empty">
              <Icon name="sparkles" size={44} className="app-empty-icon" />
              <p className="app-empty-title">No recommendations right now</p>
              <p className="app-empty-text">The risk model may still be training. New insights appear here as alerts and forecasts come in.</p>
            </div>
          )}
          {insights.map((ins) => {
            const open = expanded === ins.id;
            return (
              <div key={ins.id} className="card is-advisory">
                <button type="button" className="w-full text-left p-3.5" onClick={() => setExpanded(open ? null : ins.id)}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={PRIORITY_TONE[ins.priority] || 'neutral'}>{ins.priority.toUpperCase()}</Badge>
                      <span className="text-[10px] text-fg-faint">{ins.category}</span>
                      {ins.actioned?.length > 0 && <Badge tone="success" plain><Icon name="check" size={11} />ACTIONED</Badge>}
                    </div>
                    <Icon name="chevronDown" size={14} className={`text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`} />
                  </div>
                  <p className="text-[13px] font-bold text-fg leading-snug">{ins.title}</p>
                </button>

                {open && (
                  <div className="border-t divide-y divide-line-soft">
                    <Section title="Root cause">
                      <div className="space-y-1.5 pl-2 border-l-2 border-accent">
                        {ins.causes.map(([k, v]) => (
                          <p key={k} className="text-xs text-fg-muted"><span className="font-bold text-fg">{k}: </span>{v}</p>
                        ))}
                      </div>
                    </Section>
                    <Section title="Evidence">
                      <ol className="space-y-1 list-decimal list-inside text-xs text-fg-muted">
                        {ins.evidence.map((e) => <li key={e}>{e}</li>)}
                      </ol>
                    </Section>
                    <Section title="Recommendations">
                      <ul className="space-y-1.5">
                        {ins.recommendations.map((r) => <li key={r} className="text-xs text-fg-muted pl-2 border-l-2 border-line-strong">{r}</li>)}
                      </ul>
                    </Section>
                    {ins.impact && (
                      <Section title="Projected impact">
                        <p className="tile tone-success text-xs font-semibold">{ins.impact}</p>
                      </Section>
                    )}
                    <Section title="Actions">
                      {ins.actioned?.length > 0 && (
                        <ul className="space-y-1 mb-2">
                          {ins.actioned.map((t) => (
                            <li key={t.id}>
                              <button type="button" className="w-full text-left text-[11px] flex items-center justify-between gap-2 hover:text-primary" onClick={() => openTask(t.id)}>
                                <span><b className="font-mono">{t.id}</b> {t.title}</span><TaskStatusBadge status={t.status} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="space-y-1.5">
                        {ins.actions.map((a) => (
                          <Button key={a} variant="soft" block className="justify-between" onClick={() => openForm(a, ins)}>
                            {ACTION_FORMS[a].title}<Icon name="chevronRight" size={14} />
                          </Button>
                        ))}
                      </div>
                    </Section>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
