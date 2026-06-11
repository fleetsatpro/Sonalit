/**
 * Backend list endpoints return three different shapes:
 *   { data, pagination: { totalCount } }  — vehicles, alerts, convoys
 *   { data, total }                        — drivers, shipments
 *   { data }                               — maintenance (no count)
 *   T[]                                    — legacy flat arrays
 *
 * This converts all of them to { data: T[], total: number }.
 */
export function normalizeList(raw) {
    if (Array.isArray(raw)) {
        return { data: raw, total: raw.length };
    }
    const obj = raw;
    const dataField = obj['data'];
    const data = Array.isArray(dataField) ? dataField : [];
    const pagination = obj['pagination'];
    if (pagination && typeof pagination === 'object') {
        const p = pagination;
        if (typeof p['totalCount'] === 'number')
            return { data, total: p['totalCount'] };
    }
    if (typeof obj['total'] === 'number')
        return { data, total: obj['total'] };
    const meta = obj['meta'];
    if (meta && typeof meta === 'object') {
        const m = meta;
        if (typeof m['total'] === 'number')
            return { data, total: m['total'] };
    }
    return { data, total: data.length };
}
