import { useState, useMemo } from 'react';
import {
  StatusBadge,
  CDSDrawer,
  CDSToastContainer,
  DrawerField,
} from './components.js';
import { useBookingPipeline } from './hooks.js';
import { useCDSStore } from './store.js';
import { PIPELINE_STAGES } from './constants.js';
import type { BookingPipelineItem } from './types.js';

function BookingCard({
  item,
  onClick,
}: {
  item: BookingPipelineItem;
  onClick: () => void;
}) {
  const progress =
    item.trip_count > 0
      ? Math.round((item.trips_completed / item.trip_count) * 100)
      : 0;
  return (
    <div
      className="p-3 rounded-xl bg-ink-2/50 border border-[rgba(255,255,255,0.06)] cursor-pointer hover:border-[rgba(255,255,255,0.12)] transition-colors"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] font-bold text-cds-orange truncate">
          {item.booking_number}
        </span>
        {item.trip_count > 0 && (
          <span className="text-[10px] font-mono text-text-2 whitespace-nowrap">
            {item.trips_completed}/{item.trip_count}
          </span>
        )}
      </div>
      <div className="text-[12px] text-text-0 font-medium mt-1 truncate">
        {item.customer_name ?? '—'}
      </div>
      {item.reference && (
        <div className="text-[10px] text-text-2 font-mono mt-0.5 truncate">
          REF: {item.reference}
        </div>
      )}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-text-2 truncate">
          {item.delivery_location ?? '—'}
        </span>
        {item.eta && (
          <span className="text-[10px] font-mono text-text-2">
            {new Date(item.eta).toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
      </div>
      {item.trip_count > 0 && (
        <div className="mt-2 h-1 rounded bg-ink-3 overflow-hidden">
          <div
            className="h-full rounded bg-cds-teal"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function KanbanView({
  grouped,
  onCardClick,
}: {
  grouped: Record<string, BookingPipelineItem[]>;
  onCardClick: (item: BookingPipelineItem) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-3 min-h-[400px]">
      {PIPELINE_STAGES.map((stage) => {
        const items = grouped[stage.id] ?? [];
        return (
          <div key={stage.id} className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className={`w-2 h-2 rounded-full ${stage.dot}`} />
              <span className="text-[11px] font-display font-bold text-text-1 uppercase tracking-wide">
                {stage.label}
              </span>
              <span
                className={`inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[10px] font-mono font-bold px-1.5 ${stage.dim} ${stage.text}`}
              >
                {items.length}
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)] pr-1">
              {items.length === 0 && (
                <div className="text-[11px] text-text-2 text-center py-8 font-mono">
                  No bookings
                </div>
              )}
              {items.map((item) => (
                <BookingCard
                  key={item.id}
                  item={item}
                  onClick={() => onCardClick(item)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({
  grouped,
  onCardClick,
}: {
  grouped: Record<string, BookingPipelineItem[]>;
  onCardClick: (item: BookingPipelineItem) => void;
}) {
  const [activeTab, setActiveTab] = useState<string>(PIPELINE_STAGES[0].id);
  const items = grouped[activeTab] ?? [];
  return (
    <div>
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {PIPELINE_STAGES.map((stage) => {
          const count = (grouped[stage.id] ?? []).length;
          const active = activeTab === stage.id;
          return (
            <button
              key={stage.id}
              className={`text-[11px] font-mono px-3 py-1.5 rounded-lg cursor-pointer border transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                active
                  ? `${stage.dim} ${stage.text} border-transparent`
                  : 'text-text-2 border-[rgba(255,255,255,0.1)] bg-ink-2 hover:bg-ink-3'
              }`}
              onClick={() => setActiveTab(stage.id)}
            >
              {stage.label}
              <span className="opacity-60">{count}</span>
            </button>
          );
        })}
      </div>
      <div className="border border-[rgba(255,255,255,0.07)] rounded-[14px] bg-gradient-to-b from-[rgba(255,255,255,0.025)] to-[rgba(255,255,255,0.008)] overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {['Booking #', 'Reference', 'Customer', 'Destination', 'Trips', 'ETA'].map(
                (h) => (
                  <th
                    key={h}
                    className="text-left font-mono text-[10px] tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="p-8 text-center text-text-2 font-mono text-sm"
                >
                  No bookings in this stage.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-[rgba(255,255,255,0.07)] cursor-pointer hover:bg-ink-2 transition-colors"
                  onClick={() => onCardClick(item)}
                >
                  <td className="px-3.5 py-3 text-cds-orange font-mono font-semibold text-xs">
                    {item.booking_number}
                  </td>
                  <td className="px-3.5 py-3 text-text-0 font-mono text-xs">
                    {item.reference ?? '—'}
                  </td>
                  <td className="px-3.5 py-3 text-text-0">
                    {item.customer_name ?? '—'}
                  </td>
                  <td className="px-3.5 py-3 text-text-1">
                    {item.delivery_location ?? '—'}
                  </td>
                  <td className="px-3.5 py-3 text-text-1 font-mono">
                    {item.trips_completed}/{item.trip_count}
                  </td>
                  <td className="px-3.5 py-3 text-text-2 font-mono text-xs">
                    {item.eta
                      ? new Date(item.eta).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CDSDashboard() {
  const { data: pipeline, isLoading } = useBookingPipeline();
  const { viewMode, toggleViewMode, openDrawer } = useCDSStore();

  const grouped = useMemo(() => {
    const g: Record<string, BookingPipelineItem[]> = {};
    for (const stage of PIPELINE_STAGES) g[stage.id] = [];
    for (const item of pipeline ?? []) {
      const key = item.pipeline_stage ?? 'received';
      (g[key] ??= []).push(item);
    }
    return g;
  }, [pipeline]);

  const totalActive = (pipeline ?? []).filter(
    (b) => b.pipeline_stage !== 'completed',
  ).length;
  const totalCompleted = (grouped['completed'] ?? []).length;

  const handleCardClick = (item: BookingPipelineItem) => {
    openDrawer(`Booking ${item.booking_number}`, (
      <>
        <DrawerField label="Booking #" value={item.booking_number} />
        <DrawerField label="Reference" value={item.reference ?? '—'} />
        <DrawerField label="Customer" value={item.customer_name ?? '—'} />
        <DrawerField
          label="Status"
          value={<StatusBadge status={item.status} />}
        />
        <DrawerField label="Stage" value={item.pipeline_stage} />
        <DrawerField label="Pickup" value={item.pickup_location ?? '—'} />
        <DrawerField
          label="Delivery"
          value={item.delivery_location ?? '—'}
        />
        <DrawerField label="Commodity" value={item.commodity ?? '—'} />
        <DrawerField
          label="Container"
          value={
            `${item.container_size ?? ''} ${item.container_type ?? ''}`.trim() ||
            '—'
          }
        />
        <DrawerField
          label="Shipping Line"
          value={item.shipping_line ?? '—'}
        />
        <DrawerField
          label="ETA"
          value={item.eta ? new Date(item.eta).toLocaleDateString() : '—'}
        />
        <DrawerField
          label="Trips"
          value={`${item.trips_completed} / ${item.trip_count}`}
        />
        <DrawerField
          label="Created"
          value={new Date(item.created_at).toLocaleDateString()}
        />
      </>
    ));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-2 font-mono text-sm">
        Loading pipeline...
      </div>
    );
  }

  return (
    <div className="px-4 py-5 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display font-extrabold text-[20px] text-text-0">
            Booking Pipeline
          </h1>
          <p className="font-mono text-[11px] text-text-2 tracking-[0.08em] mt-0.5">
            {totalActive} ACTIVE &middot; {totalCompleted} COMPLETED
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            className={`text-[11px] font-mono px-3 py-1.5 rounded-lg border transition-colors ${
              viewMode === 'kanban'
                ? 'bg-cds-orange/15 text-cds-orange border-cds-orange/20'
                : 'text-text-2 border-[rgba(255,255,255,0.1)] bg-ink-2'
            }`}
            onClick={() => viewMode !== 'kanban' && toggleViewMode()}
          >
            Board
          </button>
          <button
            className={`text-[11px] font-mono px-3 py-1.5 rounded-lg border transition-colors ${
              viewMode === 'list'
                ? 'bg-cds-orange/15 text-cds-orange border-cds-orange/20'
                : 'text-text-2 border-[rgba(255,255,255,0.1)] bg-ink-2'
            }`}
            onClick={() => viewMode !== 'list' && toggleViewMode()}
          >
            List
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {PIPELINE_STAGES.filter((s) => s.id !== 'completed').map((stage) => {
          const count = (grouped[stage.id] ?? []).length;
          return (
            <div
              key={stage.id}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${stage.dim}`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${stage.dot}`} />
              <span className={`text-[11px] font-mono ${stage.text}`}>
                {stage.label}
              </span>
              <span
                className={`text-[11px] font-bold font-mono ${stage.text}`}
              >
                {count}
              </span>
            </div>
          );
        })}
      </div>

      {viewMode === 'kanban' ? (
        <KanbanView grouped={grouped} onCardClick={handleCardClick} />
      ) : (
        <ListView grouped={grouped} onCardClick={handleCardClick} />
      )}

      <CDSDrawer />
      <CDSToastContainer />
    </div>
  );
}
