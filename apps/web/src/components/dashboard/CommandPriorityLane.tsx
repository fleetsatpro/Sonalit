import React, { Suspense, lazy, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, Clock3, Radio, Siren } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import type { DashboardAlert, FeedItem } from '../../stores/dashboardStore.js';

const ResponseCrewPanel = lazy(() => import('./ResponseCrewPanel.js'));

export interface CommandRecord {
  id: string;
  title: string;
  summary?: string;
  at: string;
  severity: string;
  source: string;
  type?: string;
  ackId?: string;
}

interface CommandPriorityLaneProps {
  alerts?: DashboardAlert[];
  loading: boolean;
  unavailable: boolean;
  onSelect: (record: CommandRecord) => void;
}

function severityOf(value?: string): string {
  const severity = String(value ?? '').toLowerCase();
  if (severity === 'critical' || severity === 'panic' || severity === 'sos') return 'critical';
  if (severity === 'high' || severity === 'alert') return 'high';
  if (severity === 'medium' || severity === 'incident' || severity === 'warn') return 'medium';
  if (severity === 'low' || severity === 'info') return 'low';
  return 'unclassified';
}

function severityRank(value: string): number {
  return value === 'critical' ? 0 : value === 'high' ? 1 : value === 'medium' ? 2 : 3;
}

function relativeAge(value: string): string {
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return 'Time unavailable';
  const seconds = Math.max(0, Math.floor((Date.now() - stamp) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

function severityLabel(value: string): string {
  return value === 'unclassified' ? 'Unclassified' : value.charAt(0).toUpperCase() + value.slice(1);
}

export default function CommandPriorityLane({
  alerts,
  loading,
  unavailable,
  onSelect,
}: CommandPriorityLaneProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const feedItems = useDashboardStore((state) => state.feedItems);
  const panic = useDashboardStore((state) => state.panicState);
  const voiceNote = useDashboardStore((state) => state.voiceNoteAlert);
  const removeAlert = useDashboardStore.getState().removeAlert;
  const [showTeams, setShowTeams] = useState(false);

  const acknowledge = useMutation({
    mutationFn: async (id: string) => {
      await api.patch('/alerts/' + id + '/acknowledge');
    },
    onSuccess: (_result, id) => {
      removeAlert(id);
      queryClient.invalidateQueries({ queryKey: ['alerts-unread-count'] });
    },
  });

  const records = useMemo(() => {
    const sourceAlerts = alerts ?? [];
    const alertIds = new Set(sourceAlerts.map((item) => item.id));
    const fromAlerts: CommandRecord[] = sourceAlerts.map((item) => ({
      id: 'alert-' + item.id,
      title: item.title || 'Alert without a title',
      summary: item.summary && item.summary.trim() !== item.title.trim() ? item.summary : undefined,
      at: item.occurred_at,
      severity: severityOf(item.severity),
      source: 'Alert register',
      type: item.type,
      ...(!item.acknowledged ? { ackId: item.id } : {}),
    }));
    const fromFeed: CommandRecord[] = feedItems
      .filter((item: FeedItem) => !alertIds.has(item.id))
      .map((item) => ({
        id: 'event-' + item.id,
        title: item.message || item.type || 'Operational event',
        at: item.timestamp,
        severity: severityOf(item.severity ?? item.type),
        source: 'Operational feed',
        type: item.type,
      }));
    return [...fromAlerts, ...fromFeed].sort((left, right) =>
      severityRank(left.severity) - severityRank(right.severity)
      || new Date(right.at).getTime() - new Date(left.at).getTime()
    );
  }, [alerts, feedItems]);

  const priorityCount = records.filter((item) => item.severity === 'critical' || item.severity === 'high').length;

  return (
    <aside className='cc2-lane' aria-labelledby='cc2-priority-title'>
      <header className='cc2-lane__header'>
        <div>
          <span className='cc2-section-label'>OPERATOR RESPONSE</span>
          <h2 id='cc2-priority-title'>Priority queue</h2>
        </div>
        <div className='cc2-lane__count' aria-label={priorityCount + ' high-priority items'}>
          <strong>{priorityCount}</strong>
          <span>Priority</span>
        </div>
      </header>

      <div className='cc2-lane__items'>
        {panic && (
          <section className='cc2-panic-record'>
            <div className='cc2-panic-record__top'>
              <span><Siren size={14} /> Panic active</span>
              <time>{relativeAge(panic.triggered_at)}</time>
            </div>
            <p>
              {panic.vehicle_id ? 'Vehicle ' + panic.vehicle_id : 'An assigned device'}
              {panic.mode ? ' · ' + panic.mode.replace(/_/g, ' ') : ''}
            </p>
            <button type='button' onClick={() => navigate({ to: '/panic-center' as any })}>
              Open Panic Centre <ArrowUpRight size={14} />
            </button>
          </section>
        )}

        {voiceNote && (
          <button
            type='button'
            className='cc2-voice-record'
            onClick={() => navigate({ to: '/guardian' as any })}
          >
            <span className='cc2-voice-record__icon'><Radio size={16} /></span>
            <span>
              <strong>New voice note</strong>
              <small>{voiceNote.deviceName} · {relativeAge(voiceNote.createdAt)}</small>
            </span>
            <ArrowUpRight size={14} />
          </button>
        )}

        {records.length > 0 ? (
          records.slice(0, 8).map((record) => (
            <article className='cc2-record' key={record.id}>
              <div className='cc2-record__top'>
                <span className={'cc2-severity cc2-severity--' + record.severity}>
                  {severityLabel(record.severity)}
                </span>
                <time><Clock3 size={12} /> {relativeAge(record.at)}</time>
              </div>
              <button
                type='button'
                className='cc2-record__open'
                onClick={() => onSelect(record)}
              >
                <strong>{record.title}</strong>
                {record.summary && <span>{record.summary}</span>}
                <small>{record.source}</small>
              </button>
              {record.ackId && (
                <button
                  type='button'
                  className='cc2-record__ack'
                  onClick={() => acknowledge.mutate(record.ackId!)}
                  disabled={acknowledge.isPending}
                >
                  <Check size={13} />
                  {acknowledge.isPending ? 'Saving…' : 'Acknowledge'}
                </button>
              )}
            </article>
          ))
        ) : (
          <div className='cc2-lane__empty'>
            {loading
              ? 'Loading the alert register…'
              : unavailable
                ? 'The alert register is unavailable. No status is inferred.'
                : 'No priority items in the current response window.'}
          </div>
        )}
      </div>

      <footer className='cc2-lane__footer'>
        <button type='button' onClick={() => navigate({ to: '/alerts' as any })}>
          Open alert register <ArrowUpRight size={14} />
        </button>
        <button
          type='button'
          className='cc2-lane__teams-toggle'
          aria-expanded={showTeams}
          onClick={() => setShowTeams((value) => !value)}
        >
          Response teams <ChevronDown size={14} className={showTeams ? 'is-open' : ''} />
        </button>
      </footer>

      {showTeams && (
        <section className='cc2-lane__teams' aria-label='Response team dispatch'>
          <Suspense fallback={<p className='cc2-lane__loading'>Loading response teams…</p>}>
            <ResponseCrewPanel />
          </Suspense>
        </section>
      )}
    </aside>
  );
}
