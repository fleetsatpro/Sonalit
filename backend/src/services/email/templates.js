const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const severityMeta = {
  critical: { label: 'CRITICAL', color: '#EF4444' },
  high: { label: 'HIGH', color: '#F97316' },
  normal: { label: 'NOTICE', color: '#F0B429' },
  low: { label: 'INFO', color: '#38BDF8' },
};

function layout({ preheader = '', title, eyebrow = 'SONALIT OPERATIONS', body, ctaLabel, ctaUrl }) {
  const cta = ctaLabel && ctaUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#E7B84B" style="background:#E7B84B;border-radius:8px"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#071018;text-decoration:none;font-weight:800;padding:14px 22px">${escapeHtml(ctaLabel)}</a></td></tr></table>` : '';
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head><body style="margin:0;padding:0;background:#02050A;color:#E5E7EB;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#02050A">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#02050A"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:700px;background:#07101A;border:1px solid #172436;border-radius:18px;overflow:hidden"><tr><td style="padding:22px 28px 20px;border-bottom:1px solid #172436"><table role="presentation" width="100%"><tr><td><p style="margin:0;font-size:10px;line-height:14px;color:#94A3B8;letter-spacing:2.4px;font-weight:800">${escapeHtml(eyebrow)}</p><p style="margin:7px 0 0;font-size:21px;line-height:28px;color:#F8FAFC;font-weight:800">${escapeHtml(title)}</p></td><td align="right" valign="top"><span style="display:inline-block;border:1px solid #26364A;border-radius:999px;padding:6px 10px;font-size:9px;line-height:12px;color:#94A3B8;letter-spacing:1.4px;font-weight:800">SOC / SECURE</span></td></tr></table></td></tr><tr><td style="padding:26px 28px 30px">${body}${cta ? `<table role="presentation" width="100%"><tr><td style="padding-top:26px">${cta}</td></tr></table>` : ''}</td></tr><tr><td style="padding:18px 28px 20px;border-top:1px solid #172436"><p style="margin:0;font-size:10px;line-height:16px;color:#64748B">Automated communication from Sonalit Security Operations. Confirm the current incident state in Sonalit before taking time-critical action.</p></td></tr></table></td></tr></table></body></html>`;
}

function detailRows(rows) {
  return rows.map(([k,v]) => `<tr><td width="34%" style="padding:8px 0;border-bottom:1px solid #152233;font-size:10px;line-height:16px;color:#71839A;text-transform:uppercase;letter-spacing:1px">${escapeHtml(k)}</td><td style="padding:8px 0;border-bottom:1px solid #152233;font-size:13px;line-height:19px;color:#F8FAFC;font-weight:700">${escapeHtml(v)}</td></tr>`).join('');
}

function metric(label, value, accent = '#E2E8F0') {
  return `<td width="25%" valign="top" style="padding:13px 12px;border-right:1px solid #172436"><p style="margin:0 0 6px;font-size:9px;line-height:13px;color:#64748B;letter-spacing:1.1px;font-weight:800">${escapeHtml(label)}</p><p style="margin:0;font-size:14px;line-height:19px;color:${accent};font-weight:800;word-break:break-word">${escapeHtml(value)}</p></td>`;
}

function alertTemplate(data) {
  const severity = String(data.severity || 'normal').toLowerCase(); const meta = severityMeta[severity] || severityMeta.normal;
  const rows = [['Alert type', data.alertType], ['Severity', meta.label], ['Vehicle', data.vehicle || 'Unknown'], ['Region', data.region || 'Unknown'], ['Convoy', data.convoy || 'N/A'], ['Time', data.time || new Date().toISOString()]];
  const body = `<p style="margin:0 0 18px;font-size:15px;line-height:24px;color:#CBD5E1">${escapeHtml(data.message)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${detailRows(rows)}</table>`;
  return { subject: `[${meta.label}] Sonalit operational alert — ${data.alertType || 'Alert'} — ${data.vehicle || 'Unknown vehicle'}`, text: `Sonalit ${meta.label} operational alert\n\nType: ${data.alertType || 'Alert'}\nSeverity: ${severity}\nVehicle: ${data.vehicle || 'Unknown'}\nRegion: ${data.region || 'Unknown'}\nConvoy: ${data.convoy || 'N/A'}\nTime: ${data.time || new Date().toISOString()}\n\n${data.message}`, html: layout({ preheader: `${meta.label} operational alert for ${data.vehicle || 'unknown vehicle'}`, title: `${meta.label} operational alert`, body, ctaLabel: data.ctaLabel, ctaUrl: data.ctaUrl }) };
}

function securityAlertTemplate(data) {
  const severity = String(data.severity || 'critical').toLowerCase(); const meta = severityMeta[severity] || severityMeta.critical;
  const coords = data.coordinates && data.coordinates.lat != null && data.coordinates.lng != null ? `${Number(data.coordinates.lat).toFixed(6)}, ${Number(data.coordinates.lng).toFixed(6)}` : 'Unavailable';
  const map = data.mapUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0"><a href="${escapeHtml(data.ctaUrl || data.mapUrl)}" style="text-decoration:none"><img src="${escapeHtml(data.mapUrl)}" width="644" height="386" border="0" alt="Sonalit high-definition incident location map" style="display:block;width:100%;height:auto;border:1px solid #26364A;border-radius:14px;background:#0B1220"></a></td></tr><tr><td style="padding-top:8px"><p style="margin:0;font-size:9px;line-height:14px;color:#64748B">HIGH-DEFINITION INCIDENT MAP · CLICK MAP TO OPEN INCIDENT</p></td></tr></table>`
    : `<table role="presentation" width="100%"><tr><td style="background:#0D1725;border:1px solid #243247;border-radius:12px;padding:20px"><p style="margin:0;font-size:12px;line-height:20px;color:#94A3B8">Incident coordinates are unavailable, so a location map could not be generated.</p></td></tr></table>`;
  const incidentId = data.incidentId || data.panicId || 'Unavailable';
  const ownership = data.ownership || 'Admin / Unassigned';
  const banner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#210B10;border:1px solid #6B2630;border-radius:13px;padding:18px 20px"><table role="presentation" width="100%"><tr><td><p style="margin:0;font-size:10px;line-height:15px;color:#FCA5A5;letter-spacing:1.8px;font-weight:900">● &nbsp;${meta.label} · SECURITY INCIDENT</p><p style="margin:7px 0 0;font-size:20px;line-height:27px;color:#FFFFFF;font-weight:800">Immediate attention required</p></td><td align="right" valign="top"><p style="margin:0;font-size:9px;line-height:14px;color:#FCA5A5;letter-spacing:1px;font-weight:800">${escapeHtml(meta.label)}</p></td></tr></table></td></tr></table>`;
  const summary = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;background:#0B1522;border:1px solid #1D2B3D;border-radius:12px"><tr>${metric('EVENT', data.alertType || 'Security event')}${metric('ASSET', data.vehicle || 'Unknown')}${metric('OWNERSHIP', ownership)}${metric('DETECTED', data.time || 'Now', '#CBD5E1')}</tr></table>`;
  const incidentRows = [
    ['Incident ID', incidentId], ['Device', data.deviceId || 'Unknown'], ['Client', data.clientId || 'Admin / Unassigned'],
    ['Convoy', data.convoy || 'N/A'], ['Convoy status', data.convoyStatus || 'N/A'], ['Region', data.region || 'Unknown'],
    ['Route', data.route || 'N/A'], ['Coordinates', coords], ['Ownership', ownership], ['Detected', data.time || new Date().toISOString()],
  ];
  const message = `<table role="presentation" width="100%" style="margin-top:20px"><tr><td style="background:#0B1522;border-left:3px solid ${meta.color};border-radius:10px;padding:16px 18px"><p style="margin:0 0 7px;font-size:9px;line-height:14px;color:#64748B;letter-spacing:1.6px;font-weight:900">FIELD MESSAGE</p><p style="margin:0;font-size:14px;line-height:23px;color:#E2E8F0">${escapeHtml(data.message || 'Security event requires attention.')}</p></td></tr></table>`;
  const body = `${banner}<p style="margin:22px 0 10px;font-size:10px;line-height:15px;color:#64748B;letter-spacing:1.7px;font-weight:900">SITUATIONAL OVERVIEW</p>${summary}<p style="margin:24px 0 10px;font-size:10px;line-height:15px;color:#64748B;letter-spacing:1.7px;font-weight:900">INCIDENT LOCATION</p>${map}<p style="margin:25px 0 10px;font-size:10px;line-height:15px;color:#64748B;letter-spacing:1.7px;font-weight:900">OPERATIONAL CONTEXT</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${detailRows(incidentRows)}</table>${message}`;
  return {
    subject: `[${meta.label}] Sonalit security incident — ${data.alertType || 'Security event'} — ${data.vehicle || 'Unknown vehicle'}`,
    text: `SONALIT SECURITY OPERATIONS\n\n${meta.label} SECURITY INCIDENT\nImmediate attention required.\n\nIncident ID: ${incidentId}\nEvent: ${data.alertType || 'Security event'}\nVehicle: ${data.vehicle || 'Unknown'}\nDevice: ${data.deviceId || 'Unknown'}\nClient: ${data.clientId || 'Admin / Unassigned'}\nOwnership: ${ownership}\nConvoy: ${data.convoy || 'N/A'}\nRegion: ${data.region || 'Unknown'}\nRoute: ${data.route || 'N/A'}\nCoordinates: ${coords}\nDetected: ${data.time || new Date().toISOString()}\n\nField message:\n${data.message || 'Security event requires attention.'}\n\nMap: ${data.mapUrl || 'Unavailable'}\nOpen incident: ${data.ctaUrl || 'Unavailable'}`,
    html: layout({ preheader: `${meta.label} security incident · ${data.vehicle || 'unknown asset'} · location map included`, title: `${meta.label} security incident`, eyebrow: 'SONALIT SECURITY OPERATIONS', body, ctaLabel: data.ctaLabel || 'OPEN INCIDENT IN SONALIT', ctaUrl: data.ctaUrl || data.mapUrl }),
  };
}

function clientPulseTemplate(data) {
  const snapshot = data.snapshotAt || new Date().toISOString(); const count = Number(data.activeBookingCount || 0);
  const body = `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#CBD5E1">Please find attached the latest CDS Active Booking Manifest, showing all currently active bookings and their latest recorded state.</p><p style="margin:0;font-size:13px;line-height:20px;color:#94A3B8">Snapshot: <strong style="color:#F8FAFC">${escapeHtml(snapshot)}</strong><br>Active bookings: <strong style="color:#F8FAFC">${count}</strong><br>The spreadsheet reflects the Booking Manifest at the snapshot time.</p>`;
  return { subject: `CDS Client Pulse — Active Booking Manifest — ${data.dateLabel}`, text: `Please find attached the latest CDS Active Booking Manifest, showing all currently active bookings and their latest recorded state.\n\nSnapshot: ${snapshot}\nActive bookings: ${count}\n\nThe spreadsheet reflects the Booking Manifest at the snapshot time.\n\nRegards,\nSonalit Operations`, html: layout({ preheader: `CDS active booking manifest snapshot — ${data.dateLabel}`, title: 'CDS Client Pulse', eyebrow: 'SONALIT CDS · CLIENT PULSE', body }) };
}

function genericTemplate(data) { const body = `<p style="margin:0;font-size:15px;line-height:24px;color:#CBD5E1">${escapeHtml(data.message)}</p>`; return { subject: data.subject, text: data.message, html: layout({ preheader: data.subject, title: data.title || data.subject, body, ctaLabel: data.ctaLabel, ctaUrl: data.ctaUrl }) }; }

module.exports = { escapeHtml, alertTemplate, securityAlertTemplate, clientPulseTemplate, genericTemplate };
