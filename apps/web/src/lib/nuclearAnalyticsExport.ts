// "Nuclear Analytics" themed Excel export — a dark, ops-styled workbook matching
// a reference template's exact palette and card/table anatomy. Every figure in
// this workbook is computed from real data — the convoy rows on screen for the
// Command Center / Convoy Register / Risk & Compliance sheets, and a live
// org-wide aggregation (GET /analytics/nuclear-report) for the historical
// sheets (Performance, Fleet & Util, Trends & Forecast, Client & SLA).
// Nothing here is invented demo data. Where the source template asked for
// something that genuinely cannot be computed honestly — a per-client SLA
// *target* (not stored anywhere) or a real demand forecast — this either
// omits the field or labels a real historical statistic plainly instead of
// dressing it up as a prediction. See the "Data Notes" sheet for exactly
// what is live vs. what a sparse young org will see as "insufficient data".
//
// Type-only import — erased at compile time, so exceljs itself (a large lib)
// is not pulled into this page's chunk until exportNuclearAnalytics() actually
// runs (see the dynamic import() there), not merely when Convoys.tsx loads.
import type ExcelJS from 'exceljs';
import { api } from './api.js';

export interface NuclearConvoyRow {
  id: string;
  name: string;
  status: string;
  route_origin?: string | null;
  route_destination?: string | null;
  departure_time?: string | null;
  estimated_arrival?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  priority?: string | null;
  region?: string | null;
  vehicle_count?: number;
  client_name?: string | null;
  open_alert_count?: number | string | null;
  open_incident_count?: number | string | null;
  seal_intact?: boolean | null;
}

export interface NuclearExportFilters {
  status?: string;
  client?: string;
  search?: string;
}

// ─── Aggregate report shape — GET /analytics/nuclear-report ────────────────
interface WeeklyOnTime {
  week_start: string;
  completed: string | number;
  on_time: string | number;
}
interface RoutePerformance {
  route_origin: string;
  route_destination: string;
  trips: string | number;
  avg_hours: string | number | null;
  on_time_pct: string | number | null;
  incidents: string | number;
}
interface FleetStats {
  total: string | number;
  active: string | number;
  idle: string | number;
  maintenance: string | number;
  offline: string | number;
}
interface FleetByType {
  type: string;
  count: string | number;
  active: string | number;
  avg_capacity_kg: string | number | null;
}
interface MaintenanceDowntime {
  type: string;
  downtime_hours: string | number;
}
interface DailyDeparted {
  day: string;
  departed: string | number;
}
interface DailyArrived {
  day: string;
  arrived: string | number;
  completed: string | number;
}
interface WeekdayAvg {
  dow: number;
  avg_count: string | number;
}
interface ClientLeaderboardRow {
  id: string;
  name: string;
  company: string | null;
  convoys: string | number;
  completed: string | number;
  on_time: string | number;
  avg_transit_hours: string | number | null;
}
interface NuclearReport {
  generated_at: string;
  weekly_on_time: WeeklyOnTime[];
  route_performance: RoutePerformance[];
  fleet_stats: FleetStats;
  fleet_by_type: FleetByType[];
  maintenance_downtime_by_type: MaintenanceDowntime[];
  daily_departed: DailyDeparted[];
  daily_arrived: DailyArrived[];
  weekday_departure_avg: WeekdayAvg[];
  client_leaderboard: ClientLeaderboardRow[];
}

async function fetchNuclearReport(): Promise<NuclearReport | null> {
  try {
    const res = await api.get<{ data: NuclearReport }>('/analytics/nuclear-report');
    return res.data.data;
  } catch {
    // Older backend, permission gap, or a transient network error — the
    // export still ships with the on-screen-data sheets; Data Notes says
    // plainly that the aggregate sheets were skipped, rather than guessing.
    return null;
  }
}

const num = (v: string | number | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// ─── Palette — lifted 1:1 from the reference workbook's cell fills/fonts ─────
const PAL = {
  void: 'FF0B1120', // page/title-bar background
  card: 'FF1F2937', // card + table row fill
  header: 'FF111827', // section-label bar fill
  border: 'FF374151', // thin card/table border
  text: 'FFF9FAFB', // primary text
  muted: 'FF94A3B8', // secondary/label text
  accent: 'FF22D3EE', // cyan — section titles, links
  ok: 'FF34D399', // green — good/verified/pass
  warn: 'FFFBBF24', // amber — watch/medium
  danger: 'FFFB7185', // red — critical/unverified/high
  leadRow: 'FF1E3A5F', // highlighted leading row (leaderboard-style emphasis)
} as const;

const FONT = 'Arial';

function solid(hex: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: hex } };
}
function thinBorder(): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style: 'thin', color: { argb: PAL.border } };
  return { top: side, bottom: side, left: side, right: side };
}
function font(opts: {
  size: number;
  bold?: boolean;
  color?: string;
  italic?: boolean;
}): Partial<ExcelJS.Font> {
  return {
    name: FONT,
    size: opts.size,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    color: { argb: opts.color ?? PAL.text },
  };
}

function setCell(
  ws: ExcelJS.Worksheet,
  addr: string,
  value: unknown,
  opts: {
    size: number;
    bold?: boolean;
    color?: string;
    fill?: string;
    align?: 'left' | 'center' | 'right';
    border?: boolean;
    italic?: boolean;
  } = { size: 9 },
) {
  const cell = ws.getCell(addr);
  cell.value = value as ExcelJS.CellValue;
  cell.font = font(opts);
  if (opts.fill) cell.fill = solid(opts.fill);
  if (opts.border) cell.border = thinBorder();
  cell.alignment = { horizontal: opts.align ?? 'left', vertical: 'middle' };
  return cell;
}

function sectionLabel(ws: ExcelJS.Worksheet, addr: string, text: string) {
  setCell(ws, addr, text, { size: 9, bold: true, color: PAL.accent, fill: PAL.void });
}

function tableHeaderRow(ws: ExcelJS.Worksheet, row: number, startCol: number, headers: string[]) {
  headers.forEach((h, i) => {
    const cell = ws.getCell(row, startCol + i);
    cell.value = h;
    cell.font = font({ size: 8, bold: true, color: PAL.muted });
    cell.fill = solid(PAL.header);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
}

// ─── Derived, real metrics ────────────────────────────────────────────────
function statusTone(status: string): { color: string } {
  if (status === 'active') return { color: PAL.ok };
  if (status === 'completed') return { color: PAL.accent };
  if (status === 'planned' || status === 'draft') return { color: PAL.warn };
  if (status === 'cancelled') return { color: PAL.danger };
  return { color: PAL.muted };
}

function sealLabel(v: boolean | null | undefined): { label: string; color: string } {
  if (v === true) return { label: 'VERIFIED', color: PAL.ok };
  if (v === false) return { label: 'COMPROMISED', color: PAL.danger };
  return { label: 'UNVERIFIED', color: PAL.warn };
}

function priorityColor(p: string | null | undefined): string {
  const v = (p ?? '').toUpperCase();
  if (v === 'HIGH' || v === 'CRITICAL') return PAL.danger;
  if (v === 'MEDIUM' || v === 'MED') return PAL.warn;
  if (v === 'LOW') return PAL.ok;
  return PAL.muted;
}

function fmtDateTime(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? d
    : `${dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

// ─── Sheet 1: Command Center ───────────────────────────────────────────────
function buildCommandCenter(wb: ExcelJS.Workbook, rows: NuclearConvoyRow[], generatedAt: Date) {
  const ws = wb.addWorksheet('00 Command Center', {
    properties: { tabColor: { argb: PAL.accent } },
  });
  ws.getColumn(1).width = 2;
  [2, 3, 4, 5, 6, 7, 8, 9].forEach((c) => (ws.getColumn(c).width = 13));

  ws.mergeCells('B2:E2');
  setCell(ws, 'B2', '◈  SONALIT · CONVOY COMMAND CENTER', {
    size: 16,
    bold: true,
    color: PAL.text,
    fill: PAL.void,
  });
  ws.mergeCells('F2:I2');
  setCell(
    ws,
    'F2',
    `LIVE  ·  ${generatedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${generatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
    { size: 9, color: PAL.accent, fill: PAL.void, align: 'right' },
  );
  ws.getRow(2).height = 26;

  const total = rows.length;
  const active = rows.filter((r) => r.status === 'active').length;
  const completed = rows.filter((r) => r.status === 'completed').length;
  const planned = rows.filter((r) => r.status === 'planned' || r.status === 'draft').length;
  const openAlerts = rows.reduce((s, r) => s + (Number(r.open_alert_count ?? 0) || 0), 0);
  const sealRisk = rows.filter((r) => r.seal_intact !== true).length;

  const stats: [string, string | number, string][] = [
    ['TOTAL CONVOYS', total, PAL.text],
    ['ACTIVE NOW', active, PAL.ok],
    ['COMPLETED', completed, PAL.accent],
    ['PLANNED', planned, PAL.warn],
    ['OPEN ALERTS', openAlerts, openAlerts > 0 ? PAL.danger : PAL.text],
    ['SEAL RISK', sealRisk, sealRisk > 0 ? PAL.danger : PAL.ok],
  ];
  const startRow = 4;
  stats.forEach(([label, value, color], i) => {
    const col = 2 + i;
    setCell(ws, ws.getCell(startRow, col).address, label, {
      size: 7,
      bold: true,
      color: PAL.muted,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, ws.getCell(startRow + 1, col).address, value, {
      size: 14,
      bold: true,
      color,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
  });
  ws.getRow(startRow).height = 14;
  ws.getRow(startRow + 1).height = 20;

  // Critical action queue — real: unverified/compromised seals + open incidents.
  let row = startRow + 4;
  sectionLabel(ws, `B${row}`, '  CRITICAL ACTION QUEUE');
  row += 1;
  tableHeaderRow(ws, row, 2, ['Priority', 'Convoy', 'Issue', 'Vehicles', 'Client']);
  row += 1;
  const actionRows = rows
    .filter(
      (r) =>
        r.seal_intact !== true ||
        (Number(r.open_incident_count ?? 0) || 0) > 0 ||
        (Number(r.open_alert_count ?? 0) || 0) > 0,
    )
    .sort((a, b) => {
      const score = (r: NuclearConvoyRow) =>
        (Number(r.open_incident_count ?? 0) || 0) * 10 +
        (r.seal_intact === false ? 8 : r.seal_intact !== true ? 3 : 0) +
        (Number(r.open_alert_count ?? 0) || 0);
      return score(b) - score(a);
    })
    .slice(0, 12);

  if (actionRows.length === 0) {
    setCell(ws, `B${row}`, 'All clear — no open seal, alert, or incident issues in this export.', {
      size: 8,
      color: PAL.ok,
      fill: PAL.card,
      border: true,
    });
    ws.mergeCells(`B${row}:F${row}`);
    row += 1;
  } else {
    for (const r of actionRows) {
      const seal = sealLabel(r.seal_intact);
      const incidents = Number(r.open_incident_count ?? 0) || 0;
      const alerts = Number(r.open_alert_count ?? 0) || 0;
      const parts: string[] = [];
      if (incidents > 0) parts.push(`${incidents} open incident${incidents === 1 ? '' : 's'}`);
      if (r.seal_intact !== true) parts.push(`seal ${seal.label.toLowerCase()}`);
      if (alerts > 0) parts.push(`${alerts} open alert${alerts === 1 ? '' : 's'}`);
      const priority = incidents > 0 || r.seal_intact === false ? 'P0' : alerts > 0 ? 'P1' : 'P2';
      const priorityColorVal =
        priority === 'P0' ? PAL.danger : priority === 'P1' ? PAL.warn : PAL.muted;
      setCell(ws, `B${row}`, priority, {
        size: 8,
        bold: true,
        color: priorityColorVal,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `C${row}`, r.name, {
        size: 8,
        bold: true,
        color: PAL.accent,
        fill: PAL.card,
        border: true,
      });
      setCell(ws, `D${row}`, parts.join(' · ') || '—', {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        border: true,
      });
      setCell(ws, `E${row}`, r.vehicle_count ?? '—', {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `F${row}`, r.client_name ?? '—', {
        size: 8,
        color: PAL.muted,
        fill: PAL.card,
        border: true,
      });
      row += 1;
    }
  }

  row += 1;
  ws.mergeCells(`B${row}:I${row}`);
  setCell(
    ws,
    `B${row}`,
    `Sonalit Fleet OS · Command Center · Generated ${generatedAt.toLocaleString('en-GB')} · ${total} convoy${total === 1 ? '' : 's'} in scope`,
    { size: 7, color: PAL.muted, fill: PAL.void, align: 'center' },
  );
}

// ─── Sheet 2: Convoy Register — the real, full data table ─────────────────
function buildConvoyRegister(wb: ExcelJS.Workbook, rows: NuclearConvoyRow[]) {
  const ws = wb.addWorksheet('01 Convoy Register', {
    properties: { tabColor: { argb: PAL.accent } },
  });
  ws.getColumn(1).width = 2;
  const widths = [2, 12, 22, 12, 18, 26, 10, 9, 16, 16, 8, 8, 12];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells('B2:M2');
  setCell(ws, 'B2', 'CONVOY REGISTER · FULL EXPORT', {
    size: 14,
    bold: true,
    color: PAL.text,
    fill: PAL.void,
  });
  ws.getRow(2).height = 24;

  const headers = [
    'ID',
    'Name',
    'Status',
    'Client',
    'Route',
    'Priority',
    'Vehicles',
    'Departure',
    'ETA',
    'Alerts',
    'Incidents',
    'Seal',
  ];
  tableHeaderRow(ws, 4, 2, headers);
  ws.getRow(4).height = 16;

  let row = 5;
  for (const c of rows) {
    const st = statusTone(c.status);
    const seal = sealLabel(c.seal_intact);
    const alerts = Number(c.open_alert_count ?? 0) || 0;
    const incidents = Number(c.open_incident_count ?? 0) || 0;
    const origin = c.route_origin ?? c.region ?? '—';
    const dest = c.route_destination ?? '—';

    setCell(ws, `B${row}`, c.id.slice(0, 8).toUpperCase(), {
      size: 8,
      color: PAL.muted,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, `C${row}`, c.name, {
      size: 9,
      bold: true,
      color: PAL.text,
      fill: PAL.card,
      border: true,
    });
    setCell(ws, `D${row}`, c.status.toUpperCase(), {
      size: 8,
      bold: true,
      color: st.color,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, `E${row}`, c.client_name ?? 'Unassigned', {
      size: 8,
      color: PAL.text,
      fill: PAL.card,
      border: true,
    });
    setCell(ws, `F${row}`, `${origin} → ${dest}`, {
      size: 8,
      color: PAL.text,
      fill: PAL.card,
      border: true,
    });
    setCell(ws, `G${row}`, (c.priority ?? '—').toUpperCase(), {
      size: 8,
      bold: true,
      color: priorityColor(c.priority),
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, `H${row}`, c.vehicle_count ?? '—', {
      size: 8,
      color: PAL.text,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, `I${row}`, fmtDateTime(c.departure_time ?? c.start_date), {
      size: 8,
      color: PAL.text,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, `J${row}`, fmtDateTime(c.estimated_arrival ?? c.end_date), {
      size: 8,
      color: PAL.text,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, `K${row}`, alerts, {
      size: 8,
      bold: alerts > 0,
      color: alerts > 0 ? PAL.danger : PAL.muted,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, `L${row}`, incidents, {
      size: 8,
      bold: incidents > 0,
      color: incidents > 0 ? PAL.danger : PAL.muted,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, `M${row}`, seal.label, {
      size: 8,
      bold: true,
      color: seal.color,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    row += 1;
  }

  ws.views = [{ state: 'frozen', ySplit: 4 }];
  if (rows.length > 0) ws.autoFilter = { from: { row: 4, column: 2 }, to: { row: 4, column: 13 } };
}

// ─── Sheet 3: Performance — weekly on-time trend + route history ──────────
function buildPerformance(wb: ExcelJS.Workbook, report: NuclearReport | null) {
  const ws = wb.addWorksheet('02 Performance', {
    properties: { tabColor: { argb: PAL.accent } },
  });
  ws.getColumn(1).width = 2;
  const widths = [2, 14, 20, 20, 10, 10, 12, 10];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells('B2:H2');
  setCell(ws, 'B2', 'PERFORMANCE · WEEKLY ON-TIME · ROUTE HISTORY', {
    size: 14,
    bold: true,
    color: PAL.text,
    fill: PAL.void,
  });
  ws.getRow(2).height = 24;

  if (!report) {
    setCell(
      ws,
      'B4',
      'Aggregate performance data was not available for this export — see 07 Data Notes.',
      { size: 9, color: PAL.warn, fill: PAL.card, border: true },
    );
    ws.mergeCells('B4:H4');
    return;
  }

  let row = 4;
  sectionLabel(ws, `B${row}`, '  WEEKLY ON-TIME TREND  ·  ORG-WIDE');
  row += 1;
  tableHeaderRow(ws, row, 2, ['Week Of', 'Completed', 'On-Time', 'On-Time %']);
  row += 1;
  if (report.weekly_on_time.length === 0) {
    setCell(
      ws,
      `B${row}`,
      'Insufficient data — no completed convoys in the trailing weeks window.',
      { size: 8, color: PAL.muted, fill: PAL.card, border: true, italic: true },
    );
    ws.mergeCells(`B${row}:E${row}`);
    row += 1;
  } else {
    for (const w of report.weekly_on_time) {
      const completed = num(w.completed);
      const onTime = num(w.on_time);
      const pct = completed > 0 ? Math.round((onTime / completed) * 1000) / 10 : null;
      const weekLabel = new Date(w.week_start).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      setCell(ws, `B${row}`, weekLabel, { size: 8, color: PAL.text, fill: PAL.card, border: true });
      setCell(ws, `C${row}`, completed, {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `D${row}`, onTime, {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `E${row}`, pct == null ? '—' : `${pct}%`, {
        size: 8,
        bold: true,
        color: pct == null ? PAL.muted : pct >= 90 ? PAL.ok : pct >= 70 ? PAL.warn : PAL.danger,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      row += 1;
    }
  }

  row += 1;
  sectionLabel(ws, `B${row}`, '  ROUTE PERFORMANCE  ·  TOP 10 BY VOLUME');
  row += 1;
  tableHeaderRow(ws, row, 2, [
    'Origin',
    'Destination',
    'Trips',
    'Avg Hrs',
    'On-Time %',
    'Incidents',
  ]);
  row += 1;
  if (report.route_performance.length === 0) {
    setCell(ws, `B${row}`, 'Insufficient data — no completed trips with route data yet.', {
      size: 8,
      color: PAL.muted,
      fill: PAL.card,
      border: true,
      italic: true,
    });
    ws.mergeCells(`B${row}:G${row}`);
  } else {
    for (const r of report.route_performance) {
      const trips = num(r.trips);
      const avgHours = r.avg_hours == null ? null : num(r.avg_hours);
      const onTimePct = r.on_time_pct == null ? null : num(r.on_time_pct);
      const incidents = num(r.incidents);
      setCell(ws, `B${row}`, r.route_origin ?? '—', {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        border: true,
      });
      setCell(ws, `C${row}`, r.route_destination ?? '—', {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        border: true,
      });
      setCell(ws, `D${row}`, trips, {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `E${row}`, avgHours == null ? '—' : avgHours.toFixed(1), {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `F${row}`, onTimePct == null ? '—' : `${onTimePct}%`, {
        size: 8,
        bold: true,
        color:
          onTimePct == null ? PAL.muted : onTimePct >= 90 ? PAL.ok : onTimePct >= 70 ? PAL.warn : PAL.danger,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `G${row}`, incidents, {
        size: 8,
        bold: incidents > 0,
        color: incidents > 0 ? PAL.danger : PAL.muted,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      row += 1;
    }
  }
}

// ─── Sheet 4: Fleet & Util — fleet stats + asset-type breakdown + downtime ─
function buildFleetUtil(wb: ExcelJS.Workbook, report: NuclearReport | null) {
  const ws = wb.addWorksheet('03 Fleet & Util', {
    properties: { tabColor: { argb: PAL.ok } },
  });
  ws.getColumn(1).width = 2;
  const widths = [2, 16, 10, 10, 16, 16];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells('B2:F2');
  setCell(ws, 'B2', 'FLEET & UTILIZATION', {
    size: 14,
    bold: true,
    color: PAL.text,
    fill: PAL.void,
  });
  ws.getRow(2).height = 24;

  if (!report) {
    setCell(
      ws,
      'B4',
      'Aggregate fleet data was not available for this export — see 07 Data Notes.',
      { size: 9, color: PAL.warn, fill: PAL.card, border: true },
    );
    ws.mergeCells('B4:F4');
    return;
  }

  const fs = report.fleet_stats;
  const stats: [string, string | number, string][] = [
    ['TOTAL FLEET', num(fs.total), PAL.text],
    ['ACTIVE', num(fs.active), PAL.ok],
    ['IDLE', num(fs.idle), PAL.muted],
    ['MAINTENANCE', num(fs.maintenance), PAL.warn],
    ['OFFLINE', num(fs.offline), num(fs.offline) > 0 ? PAL.danger : PAL.muted],
  ];
  stats.forEach(([label, value, color], i) => {
    const col = 2 + i;
    setCell(ws, ws.getCell(4, col).address, label, {
      size: 7,
      bold: true,
      color: PAL.muted,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, ws.getCell(5, col).address, value, {
      size: 13,
      bold: true,
      color,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
  });
  ws.getRow(4).height = 12;
  ws.getRow(5).height = 18;

  let row = 7;
  sectionLabel(ws, `B${row}`, '  FLEET BY ASSET TYPE');
  row += 1;
  tableHeaderRow(ws, row, 2, ['Type', 'Count', 'Active', 'Avg Capacity (kg)']);
  row += 1;
  if (report.fleet_by_type.length === 0) {
    setCell(ws, `B${row}`, 'Insufficient data — no vehicle type records found.', {
      size: 8,
      color: PAL.muted,
      fill: PAL.card,
      border: true,
      italic: true,
    });
    ws.mergeCells(`B${row}:E${row}`);
    row += 1;
  } else {
    for (const t of report.fleet_by_type) {
      setCell(ws, `B${row}`, t.type ?? 'Unclassified', {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        border: true,
      });
      setCell(ws, `C${row}`, num(t.count), {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `D${row}`, num(t.active), {
        size: 8,
        color: PAL.ok,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `E${row}`, t.avg_capacity_kg == null ? '—' : num(t.avg_capacity_kg).toLocaleString('en-GB'), {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      row += 1;
    }
  }

  row += 1;
  sectionLabel(ws, `B${row}`, '  MAINTENANCE DOWNTIME  ·  LAST 30 DAYS');
  row += 1;
  tableHeaderRow(ws, row, 2, ['Type', 'Downtime (hrs)']);
  row += 1;
  if (report.maintenance_downtime_by_type.length === 0) {
    setCell(ws, `B${row}`, 'No maintenance downtime recorded in the last 30 days.', {
      size: 8,
      color: PAL.ok,
      fill: PAL.card,
      border: true,
      italic: true,
    });
    ws.mergeCells(`B${row}:C${row}`);
  } else {
    for (const m of report.maintenance_downtime_by_type) {
      setCell(ws, `B${row}`, m.type ?? 'Unclassified', {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        border: true,
      });
      setCell(ws, `C${row}`, num(m.downtime_hours).toFixed(1), {
        size: 8,
        color: PAL.warn,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      row += 1;
    }
  }
}

// ─── Sheet 5: Risk & Compliance — real seal + incident/alert register ─────
function buildRiskCompliance(wb: ExcelJS.Workbook, rows: NuclearConvoyRow[]) {
  const ws = wb.addWorksheet('04 Risk & Compliance', {
    properties: { tabColor: { argb: PAL.danger } },
  });
  ws.getColumn(1).width = 2;
  const widths = [2, 16, 22, 14, 10, 10];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells('B2:F2');
  setCell(ws, 'B2', 'RISK · COMPLIANCE · SEAL REGISTER', {
    size: 14,
    bold: true,
    color: PAL.text,
    fill: PAL.void,
  });
  ws.getRow(2).height = 24;

  const totalOpenAlerts = rows.reduce((s, r) => s + (Number(r.open_alert_count ?? 0) || 0), 0);
  const totalOpenIncidents = rows.reduce(
    (s, r) => s + (Number(r.open_incident_count ?? 0) || 0),
    0,
  );
  const unverifiedSeals = rows.filter((r) => r.seal_intact !== true).length;
  const compromisedSeals = rows.filter((r) => r.seal_intact === false).length;

  const stats: [string, string | number, string][] = [
    ['OPEN ALERTS', totalOpenAlerts, totalOpenAlerts > 0 ? PAL.warn : PAL.ok],
    ['OPEN INCIDENTS', totalOpenIncidents, totalOpenIncidents > 0 ? PAL.danger : PAL.ok],
    ['UNVERIFIED SEALS', unverifiedSeals, unverifiedSeals > 0 ? PAL.warn : PAL.ok],
    ['COMPROMISED SEALS', compromisedSeals, compromisedSeals > 0 ? PAL.danger : PAL.ok],
  ];
  stats.forEach(([label, value, color], i) => {
    const col = 2 + i;
    setCell(ws, ws.getCell(4, col).address, label, {
      size: 7,
      bold: true,
      color: PAL.muted,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
    setCell(ws, ws.getCell(5, col).address, value, {
      size: 13,
      bold: true,
      color,
      fill: PAL.card,
      align: 'center',
      border: true,
    });
  });
  ws.getRow(4).height = 12;
  ws.getRow(5).height = 18;

  let row = 7;
  sectionLabel(ws, `B${row}`, '  SEAL REGISTER  ·  NOT VERIFIED');
  row += 1;
  tableHeaderRow(ws, row, 2, ['Convoy', 'Client', 'Status', 'Alerts', 'Incidents']);
  row += 1;
  const sealIssues = rows.filter((r) => r.seal_intact !== true);
  if (sealIssues.length === 0) {
    setCell(ws, `B${row}`, 'All exported convoys have a verified seal.', {
      size: 8,
      color: PAL.ok,
      fill: PAL.card,
      border: true,
    });
    ws.mergeCells(`B${row}:F${row}`);
    row += 1;
  } else {
    for (const r of sealIssues) {
      const seal = sealLabel(r.seal_intact);
      setCell(ws, `B${row}`, r.name, {
        size: 8,
        bold: true,
        color: PAL.accent,
        fill: PAL.card,
        border: true,
      });
      setCell(ws, `C${row}`, r.client_name ?? '—', {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        border: true,
      });
      setCell(ws, `D${row}`, seal.label, {
        size: 8,
        bold: true,
        color: seal.color,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      const alerts = Number(r.open_alert_count ?? 0) || 0;
      const incidents = Number(r.open_incident_count ?? 0) || 0;
      setCell(ws, `E${row}`, alerts, {
        size: 8,
        color: alerts > 0 ? PAL.warn : PAL.muted,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `F${row}`, incidents, {
        size: 8,
        color: incidents > 0 ? PAL.danger : PAL.muted,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      row += 1;
    }
  }
}

// ─── Sheet 6: Trends & Forecast — 14-day volume + trailing historical avg ──
function buildTrendsForecast(wb: ExcelJS.Workbook, report: NuclearReport | null) {
  const ws = wb.addWorksheet('05 Trends & Forecast', {
    properties: { tabColor: { argb: PAL.warn } },
  });
  ws.getColumn(1).width = 2;
  const widths = [2, 14, 10, 10, 12];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells('B2:E2');
  setCell(ws, 'B2', 'TRENDS · 14-DAY VOLUME · HISTORICAL OUTLOOK', {
    size: 14,
    bold: true,
    color: PAL.text,
    fill: PAL.void,
  });
  ws.getRow(2).height = 24;

  if (!report) {
    setCell(
      ws,
      'B4',
      'Aggregate trend data was not available for this export — see 07 Data Notes.',
      { size: 9, color: PAL.warn, fill: PAL.card, border: true },
    );
    ws.mergeCells('B4:E4');
    return;
  }

  let row = 4;
  sectionLabel(ws, `B${row}`, '  DAILY DEPARTED / ARRIVED  ·  LAST 14 DAYS');
  row += 1;
  tableHeaderRow(ws, row, 2, ['Day', 'Departed', 'Arrived', 'Completed']);
  row += 1;

  const byDay = new Map<string, { departed: number; arrived: number; completed: number }>();
  for (const d of report.daily_departed) {
    byDay.set(d.day, { departed: num(d.departed), arrived: 0, completed: 0 });
  }
  for (const a of report.daily_arrived) {
    const existing = byDay.get(a.day) ?? { departed: 0, arrived: 0, completed: 0 };
    existing.arrived = num(a.arrived);
    existing.completed = num(a.completed);
    byDay.set(a.day, existing);
  }
  const days = Array.from(byDay.keys()).sort();

  if (days.length === 0) {
    setCell(ws, `B${row}`, 'Insufficient data — no departures or arrivals in the last 14 days.', {
      size: 8,
      color: PAL.muted,
      fill: PAL.card,
      border: true,
      italic: true,
    });
    ws.mergeCells(`B${row}:E${row}`);
    row += 1;
  } else {
    for (const day of days) {
      const v = byDay.get(day);
      if (!v) continue;
      const label = new Date(day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      setCell(ws, `B${row}`, label, { size: 8, color: PAL.text, fill: PAL.card, border: true });
      setCell(ws, `C${row}`, v.departed, {
        size: 8,
        color: PAL.accent,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `D${row}`, v.arrived, {
        size: 8,
        color: PAL.ok,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      setCell(ws, `E${row}`, v.completed, {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      row += 1;
    }
  }

  row += 1;
  sectionLabel(
    ws,
    `B${row}`,
    '  WEEKDAY DEPARTURE AVERAGE  ·  TRAILING 5-WEEK HISTORICAL AVG (NOT A FORECAST)',
  );
  row += 1;
  tableHeaderRow(ws, row, 2, ['Weekday', 'Avg Departures']);
  row += 1;
  const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (report.weekday_departure_avg.length === 0) {
    setCell(ws, `B${row}`, 'Insufficient data — fewer than 5 weeks of departure history.', {
      size: 8,
      color: PAL.muted,
      fill: PAL.card,
      border: true,
      italic: true,
    });
    ws.mergeCells(`B${row}:C${row}`);
  } else {
    const sorted = [...report.weekday_departure_avg].sort((a, b) => a.dow - b.dow);
    for (const w of sorted) {
      setCell(ws, `B${row}`, dowNames[w.dow] ?? `Day ${w.dow}`, {
        size: 8,
        color: PAL.text,
        fill: PAL.card,
        border: true,
      });
      setCell(ws, `C${row}`, num(w.avg_count).toFixed(1), {
        size: 8,
        bold: true,
        color: PAL.accent,
        fill: PAL.card,
        align: 'center',
        border: true,
      });
      row += 1;
    }
  }
}

// ─── Sheet 7: Client & SLA — client leaderboard with real on-time score ────
function buildClientSla(wb: ExcelJS.Workbook, report: NuclearReport | null) {
  const ws = wb.addWorksheet('06 Client & SLA', {
    properties: { tabColor: { argb: PAL.accent } },
  });
  ws.getColumn(1).width = 2;
  const widths = [2, 22, 20, 10, 10, 10, 14, 10];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells('B2:H2');
  setCell(ws, 'B2', 'CLIENT LEADERBOARD · ON-TIME SCORE', {
    size: 14,
    bold: true,
    color: PAL.text,
    fill: PAL.void,
  });
  ws.getRow(2).height = 24;

  if (!report) {
    setCell(
      ws,
      'B4',
      'Aggregate client data was not available for this export — see 07 Data Notes.',
      { size: 9, color: PAL.warn, fill: PAL.card, border: true },
    );
    ws.mergeCells('B4:H4');
    return;
  }

  let row = 4;
  tableHeaderRow(ws, row, 2, [
    'Client',
    'Company',
    'Convoys',
    'Completed',
    'On-Time',
    'Avg Transit (hrs)',
    'Score',
  ]);
  row += 1;

  if (report.client_leaderboard.length === 0) {
    setCell(ws, `B${row}`, 'Insufficient data — no clients with convoy history yet.', {
      size: 8,
      color: PAL.muted,
      fill: PAL.card,
      border: true,
      italic: true,
    });
    ws.mergeCells(`B${row}:H${row}`);
  } else {
    const sorted = [...report.client_leaderboard].sort(
      (a, b) => num(b.completed) - num(a.completed),
    );
    sorted.forEach((c, i) => {
      const completed = num(c.completed);
      const onTime = num(c.on_time);
      const score = completed > 0 ? Math.round((onTime / completed) * 1000) / 10 : null;
      const isLead = i === 0 && completed > 0;
      const fill = isLead ? PAL.leadRow : PAL.card;
      setCell(ws, `B${row}`, c.name, { size: 8, bold: true, color: PAL.text, fill, border: true });
      setCell(ws, `C${row}`, c.company ?? '—', { size: 8, color: PAL.muted, fill, border: true });
      setCell(ws, `D${row}`, num(c.convoys), {
        size: 8,
        color: PAL.text,
        fill,
        align: 'center',
        border: true,
      });
      setCell(ws, `E${row}`, completed, {
        size: 8,
        color: PAL.text,
        fill,
        align: 'center',
        border: true,
      });
      setCell(ws, `F${row}`, onTime, { size: 8, color: PAL.text, fill, align: 'center', border: true });
      setCell(ws, `G${row}`, c.avg_transit_hours == null ? '—' : num(c.avg_transit_hours).toFixed(1), {
        size: 8,
        color: PAL.text,
        fill,
        align: 'center',
        border: true,
      });
      setCell(ws, `H${row}`, score == null ? '—' : `${score}%`, {
        size: 8,
        bold: true,
        color: score == null ? PAL.muted : score >= 90 ? PAL.ok : score >= 70 ? PAL.warn : PAL.danger,
        fill,
        align: 'center',
        border: true,
      });
      row += 1;
    });
  }
}

// ─── Sheet 8: Data Notes — methodology + honest scope caveats ─────────────
function buildDataNotes(
  wb: ExcelJS.Workbook,
  rows: NuclearConvoyRow[],
  report: NuclearReport | null,
  filters: NuclearExportFilters | undefined,
  generatedAt: Date,
) {
  const ws = wb.addWorksheet('07 Data Notes', { properties: { tabColor: { argb: PAL.muted } } });
  ws.getColumn(1).width = 2;
  ws.getColumn(2).width = 90;

  ws.mergeCells('B2:C2');
  setCell(ws, 'B2', 'DATA NOTES · METHODOLOGY · SCOPE', {
    size: 13,
    bold: true,
    color: PAL.text,
    fill: PAL.void,
  });
  ws.getRow(2).height = 22;

  let row = 4;
  const note = (text: string, opts: { title?: boolean; muted?: boolean } = {}) => {
    setCell(ws, `B${row}`, text, {
      size: opts.title ? 9 : 8,
      bold: opts.title === true,
      color: opts.title ? PAL.accent : opts.muted ? PAL.muted : PAL.text,
      fill: PAL.void,
    });
    row += 1;
  };

  note('SOURCE', { title: true });
  note(`• Live Sonalit API — /convoys — fetched ${generatedAt.toLocaleString('en-GB')}.`);
  note(
    `• ${rows.length} convoy${rows.length === 1 ? '' : 's'} included in this export${
      filters?.status && filters.status !== 'all' ? `, status = ${filters.status}` : ''
    }${
      filters?.client && filters.client !== 'all' ? `, client filter applied` : ''
    }${filters?.search ? `, search = "${filters.search}"` : ''}.`,
  );
  note(
    report
      ? '• Aggregate history — /analytics/nuclear-report — org-wide, NOT filtered by the on-screen search/status/client filters above.'
      : '• Aggregate history endpoint (/analytics/nuclear-report) was unreachable for this export — sheets 02, 03, 05, 06 are skipped.',
    { muted: !report },
  );
  row += 1;

  note('SHEETS IN THIS WORKBOOK', { title: true });
  note(
    '• 00 Command Center — live totals + critical action queue, computed from this export’s rows.',
  );
  note('• 01 Convoy Register — the full convoy table, styled.');
  note(
    report
      ? '• 02 Performance — weekly on-time % and per-route history, computed org-wide from completed convoys.'
      : '• 02 Performance — SKIPPED (aggregate endpoint unavailable).',
    { muted: !report },
  );
  note(
    report
      ? '• 03 Fleet & Util — fleet counts by status and asset type, plus real maintenance downtime (last 30 days).'
      : '• 03 Fleet & Util — SKIPPED (aggregate endpoint unavailable).',
    { muted: !report },
  );
  note(
    '• 04 Risk & Compliance — seal, alert, and incident counts, computed from this export’s rows.',
  );
  note(
    report
      ? '• 05 Trends & Forecast — 14-day departed/arrived volume and a trailing 5-week same-weekday historical average.'
      : '• 05 Trends & Forecast — SKIPPED (aggregate endpoint unavailable).',
    { muted: !report },
  );
  note(
    report
      ? '• 06 Client & SLA — client leaderboard with real on-time % (Score), org-wide.'
      : '• 06 Client & SLA — SKIPPED (aggregate endpoint unavailable).',
    { muted: !report },
  );
  row += 1;

  note('METHODOLOGY', { title: true });
  note(
    '• On-time % = completed convoys arriving at/before their recorded ETA, divided by total completed convoys.',
  );
  note(
    '• "Historical Outlook" (05 Trends & Forecast) is a trailing 5-week same-weekday AVERAGE of past departures — a historical statistic, not a prediction of future demand.',
  );
  note(
    '• Client "Score" (06 Client & SLA) is that client’s real on-time % across their completed convoys — there is no stored per-client SLA target, so no target-vs-actual comparison is shown.',
  );
  note(
    '• Route "Avg Hrs" is the mean transit time for completed trips on that route (departure → arrival).',
  );
  note('• Any figure with zero eligible records renders as "Insufficient data", never a misleading zero.');
  row += 1;

  note('NOT INCLUDED — NO HONEST SOURCE EXISTS YET', { title: true });
  note('• Per-client contractual SLA targets — not stored anywhere in Sonalit today.', {
    muted: true,
  });
  note(
    '• True demand forecasting (e.g. ML-based) — only a historical average is shown, deliberately not labelled a forecast.',
    { muted: true },
  );
  row += 1;

  note('Nothing in this workbook is fabricated or illustrative. Every number traces to a live query.', {
    title: true,
  });
}

// ─── Entry point ────────────────────────────────────────────────────────────
export async function exportNuclearAnalytics(
  rows: NuclearConvoyRow[],
  filename: string,
  filters?: NuclearExportFilters,
): Promise<void> {
  const [{ default: ExcelJSRuntime }, report] = await Promise.all([
    import('exceljs'),
    fetchNuclearReport(),
  ]);
  const wb = new ExcelJSRuntime.Workbook();
  wb.creator = 'Sonalit Fleet OS';
  wb.created = new Date();

  const generatedAt = new Date();
  buildCommandCenter(wb, rows, generatedAt);
  buildConvoyRegister(wb, rows);
  buildPerformance(wb, report);
  buildFleetUtil(wb, report);
  buildRiskCompliance(wb, rows);
  buildTrendsForecast(wb, report);
  buildClientSla(wb, report);
  buildDataNotes(wb, rows, report, filters, generatedAt);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
