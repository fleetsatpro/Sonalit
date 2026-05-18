export function formatDate(iso, opts = {}) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    ...opts,
  }).format(new Date(iso));
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function statusColor(status) {
  const map = {
    active:      'text-success',
    idle:        'text-slate-400',
    planned:     'text-blue-400',
    completed:   'text-success',
    aborted:     'text-danger',
    maintenance: 'text-amber-400',
    offline:     'text-slate-600',
    high:        'text-amber-400',
    critical:    'text-red-400',
    medium:      'text-blue-400',
    low:         'text-success',
  };
  return map[status] || 'text-slate-400';
}

export function priorityColor(p) {
  return { critical: '#F25252', high: '#F0B429', medium: '#60a5fa', low: '#22D3A0' }[p] || '#94a3b8';
}

export function truncate(str, n = 40) {
  if (!str) return '—';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

export function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export function classNames(...args) {
  return args.filter(Boolean).join(' ');
}
