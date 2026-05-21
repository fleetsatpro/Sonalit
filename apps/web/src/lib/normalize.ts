export interface NormalizedList<T> {
  data: T[];
  total: number;
}

/**
 * Backend list endpoints return three different shapes:
 *   { data, pagination: { totalCount } }  — vehicles, alerts, convoys
 *   { data, total }                        — drivers, shipments
 *   { data }                               — maintenance (no count)
 *   T[]                                    — legacy flat arrays
 *
 * This converts all of them to { data: T[], total: number }.
 */
export function normalizeList<T>(raw: unknown): NormalizedList<T> {
  if (Array.isArray(raw)) {
    return { data: raw as T[], total: (raw as T[]).length };
  }
  const obj = raw as Record<string, unknown>;
  const dataField = obj['data'];
  const data: T[] = Array.isArray(dataField) ? (dataField as T[]) : [];

  const pagination = obj['pagination'];
  if (pagination && typeof pagination === 'object') {
    const p = pagination as Record<string, unknown>;
    if (typeof p['totalCount'] === 'number') return { data, total: p['totalCount'] };
  }
  if (typeof obj['total'] === 'number') return { data, total: obj['total'] };
  const meta = obj['meta'];
  if (meta && typeof meta === 'object') {
    const m = meta as Record<string, unknown>;
    if (typeof m['total'] === 'number') return { data, total: m['total'] };
  }

  return { data, total: data.length };
}
