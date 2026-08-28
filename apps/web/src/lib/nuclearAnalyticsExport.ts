// "Nuclear Analytics" themed Excel export — a dark, ops-styled workbook matching
// a reference template's exact palette and card/table anatomy. Every figure in
// this workbook is computed from the convoy rows actually passed in (the same
// data already on screen in Convoys.tsx) — nothing here is invented demo data.
//
// The reference template also had three sheets (weekly performance trends,
// fleet utilization by asset class, 14-day volume + 7-day forecast, client SLA
// scorecard) that need historical/aggregate backend endpoints Sonalit doesn't
// expose yet. Those are intentionally left out rather than faked — see the
// "Data Notes" sheet, which documents that gap the same way the reference
// template's own notes sheet did.
// Type-only import — erased at compile time, so exceljs itself (a large lib)
// is not pulled into this page's chunk until exportNuclearAnalytics() actually
// runs (see the dynamic import() there), not merely when Convoys.tsx loads.
import type ExcelJS from 'exceljs';

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

// ─── Sheet 3: Risk & Compliance — real seal + incident/alert register ─────
function buildRiskCompliance(wb: ExcelJS.Workbook, rows: NuclearConvoyRow[]) {
  const ws = wb.addWorksheet('02 Risk & Compliance', {
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

// ─── Sheet 4: Data Notes — methodology + honest scope caveats ─────────────
function buildDataNotes(
  wb: ExcelJS.Workbook,
  rows: NuclearConvoyRow[],
  filters: NuclearExportFilters | undefined,
  generatedAt: Date,
) {
  const ws = wb.addWorksheet('03 Data Notes', { properties: { tabColor: { argb: PAL.muted } } });
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
  row += 1;

  note('SHEETS', { title: true });
  note(
    '• 00 Command Center — live totals + critical action queue, computed from this export’s rows.',
  );
  note('• 01 Convoy Register — the full convoy table, styled.');
  note(
    '• 02 Risk & Compliance — seal, alert, and incident counts, computed from this export’s rows.',
  );
  row += 1;

  note('NOT INCLUDED IN THIS VERSION', { title: true });
  note(
    '• Weekly on-time trend and per-route performance history — needs a historical aggregation endpoint.',
    { muted: true },
  );
  note(
    '• Fleet utilization by asset class — needs fleet-capacity data not exposed to this export.',
    { muted: true },
  );
  note(
    '• 14-day volume trend and 7-day capacity forecast — needs a time-series aggregation endpoint.',
    { muted: true },
  );
  note(
    '• Client SLA scorecard (on-time % against target) — needs actual-arrival-vs-ETA data per convoy.',
    { muted: true },
  );
  row += 1;

  note('NEXT PRODUCTION STEPS', { title: true });
  note('1. Add backend aggregation endpoints for the four items above.', { muted: true });
  note(
    '2. Wire them into this export once available — no fabricated figures ship in the meantime.',
    { muted: true },
  );
}

// ─── Entry point ────────────────────────────────────────────────────────────
export async function exportNuclearAnalytics(
  rows: NuclearConvoyRow[],
  filename: string,
  filters?: NuclearExportFilters,
): Promise<void> {
  const { default: ExcelJSRuntime } = await import('exceljs');
  const wb = new ExcelJSRuntime.Workbook();
  wb.creator = 'Sonalit Fleet OS';
  wb.created = new Date();

  const generatedAt = new Date();
  buildCommandCenter(wb, rows, generatedAt);
  buildConvoyRegister(wb, rows);
  buildRiskCompliance(wb, rows);
  buildDataNotes(wb, rows, filters, generatedAt);

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
