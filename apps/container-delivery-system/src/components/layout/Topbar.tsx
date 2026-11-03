import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '@/lib/api.js';
import { IconButton } from '@/components/ui/Button.js';
import { useUIStore } from '@/stores/ui.js';

interface TopbarProps { title: string; subtitle: string }
type SearchArea = 'trips' | 'containers' | 'locks';
interface SearchResult {
  id: string;
  area: SearchArea;
  title: string;
  detail: string;
}
type ApiRow = Record<string, unknown>;
const text = (row: ApiRow, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return 'Not recorded';
};

function asRows(body: unknown): ApiRow[] {
  if (!body || typeof body !== 'object') return [];
  const rows = (body as { data?: unknown }).data;
  return Array.isArray(rows) ? rows as ApiRow[] : [];
}

export function Topbar({ title, subtitle }: TopbarProps) {
  const [time, setTime] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchPartial, setSearchPartial] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { addToast } = useUIStore();
  const navigate = useNavigate();

  const notificationsQuery = useQuery<number | null>({
    queryKey: ['cds-topbar-alert-count'],
    queryFn: async () => {
      const { data: body } = await api.get('/dashboard');
      const payload = body.data ?? body;
      const count = Number(payload.unacknowledged_alerts);
      return Number.isFinite(count) ? count : null;
    },
    refetchInterval: 60_000,
    staleTime: 20_000,
    retry: 1,
  });
  const unreadAlerts = notificationsQuery.data ?? null;

  useEffect(() => {
    const tick = () => setTime(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date()) + ' EAT');
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(false);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  const runSearch = async () => {
    const query = searchText.trim();
    if (!query || searching) return;
    setSearching(true);
    setSearchOpen(false);
    try {
      const requests = await Promise.allSettled([
        api.get('/trips', { params: { search: query, limit: 8 } }),
        api.get('/containers', { params: { search: query, limit: 8 } }),
        api.get('/locks', { params: { search: query, limit: 8 } }),
      ]);
      const results: SearchResult[] = [];
      const partial = requests.some(result => result.status === 'rejected');
      setSearchPartial(partial);
      const tripResponse = requests[0];
      if (tripResponse.status === 'fulfilled') {
        asRows(tripResponse.value.data).forEach(row => results.push({
          id: text(row, 'id'),
          area: 'trips',
          title: text(row, 'trip_number', 'reference'),
          detail: text(row, 'status') + ' · ' + text(row, 'origin') + ' → ' + text(row, 'destination'),
        }));
      }
      const containerResponse = requests[1];
      if (containerResponse.status === 'fulfilled') {
        asRows(containerResponse.value.data).forEach(row => results.push({
          id: text(row, 'id'),
          area: 'containers',
          title: text(row, 'number'),
          detail: text(row, 'status') + ' · ' + text(row, 'current_location', 'container_type'),
        }));
      }
      const lockResponse = requests[2];
      if (lockResponse.status === 'fulfilled') {
        asRows(lockResponse.value.data).forEach(row => results.push({
          id: text(row, 'id'),
          area: 'locks',
          title: text(row, 'serial'),
          detail: text(row, 'status') + ' · ' + text(row, 'location', 'container_number'),
        }));
      }

      setSearchResults(results.slice(0, 12));
      setSearchOpen(true);
      if (requests.every(result => result.status === 'rejected')) {
        addToast('CDS search is unavailable. The API could not return any results.', 'error');
      }
    } catch {
      setSearchResults([]);
      setSearchPartial(true);
      setSearchOpen(true);
      addToast('CDS search failed. No records were changed.', 'error');
    } finally {
      setSearching(false);
    }
  };

  const openResult = (result: SearchResult) => {
    setSearchOpen(false);
    if (result.area === 'trips') void navigate({ to: '/cds/shipments' });
    else if (result.area === 'containers') void navigate({ to: '/cds/containers' });
    else void navigate({ to: '/cds/locks' });
  };

  return (
    <div className="h-16 flex-none border-b border-hair flex items-center gap-4 px-6 bg-ink-1/70 backdrop-blur-[14px]">
      <div className="min-w-0">
        <div className="font-display font-bold text-sm text-text-0">{title}</div>
        <div className="text-2xs text-text-2 font-mono tracking-wide">{subtitle}</div>
      </div>

      <div className="relative flex-1 max-w-[460px] min-w-[160px] h-9 rounded-xl bg-ink-2 border border-glass-border flex items-center gap-2 px-3 text-text-0 text-[13px] ml-2 focus-within:border-glass-border-hover transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          ref={searchRef}
          value={searchText}
          onChange={event => setSearchText(event.target.value)}
          onFocus={() => { if (searchResults.length) setSearchOpen(true); }}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); void runSearch(); }
          }}
          aria-label="Search CDS trips, containers and e-locks"
          aria-expanded={searchOpen}
          className="bg-transparent border-none outline-none text-text-0 font-sans flex-1 min-w-0 placeholder:text-text-2"
          placeholder="Search trips, containers, e-locks…"
        />
        {searching ? <span className="text-[10px] text-text-2">Searching</span> : <kbd className="font-mono text-[10px] text-text-2 border border-glass-border-strong rounded-md px-1.5 py-px">⌘K</kbd>}
        {searchOpen && (
          <div role="listbox" aria-label="CDS search results" className="absolute z-[80] top-full left-0 right-0 mt-2 rounded-xl border border-glass-border-strong bg-ink-1 shadow-2xl overflow-hidden min-w-[320px]">
            <div className="px-3 py-2 border-b border-hair text-[9px] font-mono tracking-widest uppercase text-text-2">
              {searchPartial ? 'Partial results · some sources unavailable' : searchResults.length ? searchResults.length + ' matching records' : 'No matching records'}
            </div>
            {searchResults.map((result, index) => (
              <button key={result.area + ':' + result.id + ':' + index} type="button" role="option" aria-selected={false} onClick={() => openResult(result)} className="w-full text-left px-3 py-2.5 border-b border-hair last:border-0 hover:bg-ink-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-text-0 truncate">{result.title}</span>
                  <span className="text-[9px] uppercase font-mono tracking-wider text-cds-orange">{result.area}</span>
                </div>
                <div className="text-[10px] text-text-2 mt-1 truncate">{result.detail}</div>
              </button>
            ))}
            <button type="button" onClick={() => setSearchOpen(false)} className="w-full px-3 py-2 text-left text-[10px] text-text-2 hover:text-text-0">Close results · Esc</button>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3.5">
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-2xs font-mono font-medium border border-glass-border-strong text-text-1 whitespace-nowrap">
          CDS · Operational view
        </div>
        <div className="font-mono text-2xs text-text-1 border border-glass-border-strong rounded-full px-2.5 py-1.5 whitespace-nowrap">
          {time || '—'}
        </div>
        <IconButton
          onClick={() => { void navigate({ to: '/cds/alerts' }); }}
          title={notificationsQuery.isError || unreadAlerts === null ? 'Alert count unavailable — open alert centre' : unreadAlerts + ' unacknowledged CDS alerts'}
          aria-label="Open CDS alert centre"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          {notificationsQuery.isLoading ? <span className="absolute top-[5px] right-[6px] w-[7px] h-[7px] rounded-full bg-text-2" /> : notificationsQuery.isError || unreadAlerts === null ? <span className="absolute top-[5px] right-[6px] w-[7px] h-[7px] rounded-full bg-cds-red" /> : unreadAlerts > 0 ? <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-cds-orange text-[#170d00] flex items-center justify-center font-mono text-[9px]">{unreadAlerts > 99 ? '99+' : unreadAlerts}</span> : null}
        </IconButton>
        <div className="w-8 h-8 rounded-xl bg-ink-3 border border-glass-border-strong flex items-center justify-center font-display text-[9px] font-bold text-text-0" aria-label="Container Delivery System">CDS</div>
      </div>
    </div>
  );
}
