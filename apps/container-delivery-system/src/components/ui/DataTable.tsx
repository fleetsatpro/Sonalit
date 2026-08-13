import React, { useState, useMemo } from 'react';
import { SearchInput } from './SearchInput.js';
import { EmptyState } from './EmptyState.js';

interface Column<T> {
  id: string;
  header: string;
  accessor: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  pageSize?: number;
}

export function DataTable<T>({ columns, data, keyExtractor, onRowClick, searchable, searchPlaceholder, filters, emptyMessage = 'No records found.', emptyIcon, pageSize = 25 }: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(data.length / pageSize);
  const paged = useMemo(() => data.slice(page * pageSize, (page + 1) * pageSize), [data, page, pageSize]);

  const handleSort = (colId: string) => {
    if (sortCol === colId) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(colId); setSortDir('asc'); }
  };

  return (
    <div>
      {(searchable || filters) && (
        <div className="flex items-center gap-2.5 mb-4 flex-wrap">
          {filters}
          {searchable && (
            <SearchInput
              value={search}
              onChange={(v) => { setSearch(v); setPage(0); }}
              placeholder={searchPlaceholder}
              className="ml-auto"
            />
          )}
        </div>
      )}

      <div className="glass p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className={`text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium ${col.sortable ? 'cursor-pointer select-none hover:text-text-1' : ''} ${col.className ?? ''}`}
                    onClick={col.sortable ? () => handleSort(col.id) : undefined}
                  >
                    {col.header}
                    {sortCol === col.id && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState
                      icon={emptyIcon}
                      title={emptyMessage}
                    />
                  </td>
                </tr>
              ) : (
                paged.map((row) => (
                  <tr
                    key={keyExtractor(row)}
                    className={`border-t border-hair transition-colors ${onRowClick ? 'cursor-pointer hover:bg-ink-2' : ''}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => (
                      <td key={col.id} className={`px-3.5 py-3 text-text-0 ${col.className ?? ''}`}>
                        {col.accessor(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-hair text-[11px] text-text-2 font-mono">
            <span>Page {page + 1} of {totalPages} ({data.length} records)</span>
            <div className="flex gap-1.5">
              <button
                className="px-2.5 py-1 rounded-lg bg-ink-2 border border-glass-border text-text-1 hover:text-text-0 hover:bg-ink-3 disabled:opacity-30 transition-colors"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </button>
              <button
                className="px-2.5 py-1 rounded-lg bg-ink-2 border border-glass-border text-text-1 hover:text-text-0 hover:bg-ink-3 disabled:opacity-30 transition-colors"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function FilterChip({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      className={`text-[11.5px] font-mono px-3 py-1.5 rounded-lg cursor-pointer border transition-colors ${active ? 'bg-cds-orange/15 text-cds-orange border-cds-orange/20' : 'text-text-2 border-glass-border bg-ink-2 hover:bg-ink-3'}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
