export const LEVEL_COLOR = {
    high: '#E24B4A',
    medium: '#EF9F27',
    low: '#4ade80',
};
export const LEVEL_BG = {
    high: 'rgba(226,75,74,.15)',
    medium: 'rgba(239,159,39,.15)',
    low: 'rgba(74,222,128,.15)',
};
export const LEVEL_BORDER = {
    high: 'rgba(226,75,74,.5)',
    medium: 'rgba(239,159,39,.5)',
    low: 'rgba(74,222,128,.5)',
};
export function levelColor(l) { return LEVEL_COLOR[l] ?? '#6e6c64'; }
export function levelBg(l) { return LEVEL_BG[l] ?? 'rgba(110,108,100,.1)'; }
export function levelBorder(l) { return LEVEL_BORDER[l] ?? 'rgba(110,108,100,.3)'; }
