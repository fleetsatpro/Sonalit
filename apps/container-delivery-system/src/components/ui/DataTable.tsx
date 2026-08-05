import React, { useState, useMemo } from 'react';

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
  pageSize?: number;
}

export function DataTable<T>({ columns, data, keyExtractor, onRowClick, searchable, searchPlaceholder, filters, emptyMessage = 'No records found.', pageSize = 25 }: DataTableProps<T>) {
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
            <div className="h-[34px] rounded-[9px] bg-ink-2 border border-[rgba(255,255,255,0.07)] flex items-center gap-[7px] px-[11px] text-text-2 text-[12.5px] ml-auto min-w-[220px]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input
                className="bg-transparent border-none outline-none text-text-0 font-sans flex-1"
                placeholder={searchPlaceholder ?? 'Search…'}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
          )}
        </div>
      )}

      <div className="border border-[rgba(255,255,255,0.07)] rounded-[14px] bg-gradient-to-b from-[rgba(255,255,255,0.025)] to-[rgba(255,255,255,0.008)] overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={`text-left font-mono text-[10px] tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium ${col.sortable ? 'cursor-pointer select-none hover:text-text-1' : ''} ${col.className ?? ''}`}
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
                <td colSpan={columns.length} className="p-8 text-center text-text-2">{emptyMessage}</td>
              </tr>
            ) : (
              paged.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  className={`border-t border-[rgba(255,255,255,0.07)] transition-colors ${onRowClick ? 'cursor-pointer hover:bg-ink-2' : ''}`}
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
        <div className="flex items-center justify-between mt-3 text-[11px] text-text-2 font-mono">
          <span>Page {page + 1} of {totalPages} ({data.length} records)</span>
          <div className="flex gap-2">
            <button className="px-2 py-1 rounded bg-ink-2 border border-[rgba(255,255,255,0.07)] text-text-1 disabled:opacity-30" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <button className="px-2 py-1 rounded bg-ink-2 border border-[rgba(255,255,255,0.07)] text-text-1 disabled:opacity-30" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FilterChip({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      className={`text-[11.5px] font-mono px-3 py-1.5 rounded-lg cursor-pointer border transition-colors ${active ? 'bg-cds-orange/15 text-cds-orange border-cds-orange/20' : 'text-text-2 border-[rgba(255,255,255,0.12)] bg-ink-2 hover:bg-ink-3'}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
