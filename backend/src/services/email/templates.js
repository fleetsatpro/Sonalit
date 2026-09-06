const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const severityMeta = {
  critical: { label: 'CRITICAL', glyph: '●', color: '#EF4444' },
  high: { label: 'HIGH', glyph: '●', color: '#F97316' },
  normal: { label: 'NOTICE', glyph: '●', color: '#F0B429' },
  low: { label: 'INFO', glyph: '●', color: '#38BDF8' },
};

function layout({ preheader = '', title, eyebrow = 'SONALIT OPERATIONS', body, ctaLabel, ctaUrl }) {
  const cta = ctaLabel && ctaUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#E5B64A" style="background-color:#E5B64A;border-radius:8px"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#081018;text-decoration:none;font-weight:700;padding:13px 20px">${escapeHtml(ctaLabel)}</a></td></tr></table>` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head><body style="margin:0;padding:0;background:#050912;color:#E5E7EB;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#050912">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#050912"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#0B111C;border:1px solid #182233"><tr><td style="padding:24px 26px 18px;border-bottom:1px solid #1B2738"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle"><p style="margin:0;font-size:11px;line-height:16px;color:#8EA0B5;letter-spacing:2px;font-weight:700">${escapeHtml(eyebrow)}</p><p style="margin:5px 0 0;font-size:20px;line-height:28px;color:#F8FAFC;font-weight:800;letter-spacing:.2px">${escapeHtml(title)}</p></td><td align="right" valign="middle"><p style="margin:0;font-size:10px;line-height:14px;color:#64748B;letter-spacing:1.4px;font-weight:700">SOC / ALERT</p></td></tr></table></td></tr><tr><td style="padding:22px 26px 26px">${body}${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding-top:24px">${cta}</td></tr></table>` : ''}</td></tr><tr><td style="padding:18px 26px 20px;border-top:1px solid #1B2738"><p style="margin:0;font-size:11px;line-height:17px;color:#64748B">Automated security communication from Sonalit Security Operations. Verify the live incident state in Sonalit before taking time-critical action.</p></td></tr></table></td></tr></table></body></html>`;
}

function detailRows(rows) {
  return rows.map(([k,v]) => `<tr><td width="38%" style="padding:8px 0;font-size:12px;line-height:18px;color:#7F91A8;text-transform:uppercase;letter-spacing:.7px">${escapeHtml(k)}</td><td style="padding:8px 0;font-size:13px;line-height:19px;color:#F8FAFC;font-weight:700">${escapeHtml(v)}</td></tr>`).join('');
}

function alertTemplate(data) {
  const severity = String(data.severity || 'normal').toLowerCase(); const meta = severityMeta[severity] || severityMeta.normal;
  const rows = [['Alert type', data.alertType], ['Severity', `${meta.glyph} ${meta.label}`], ['Vehicle', data.vehicle || 'Unknown'], ['Region', data.region || 'Unknown'], ['Convoy', data.convoy || 'N/A'], ['Time', data.time || new Date().toISOString()]];
  const body = `<p style="margin:0 0 18px;font-size:15px;line-height:24px;color:#CBD5E1">${escapeHtml(data.message)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${detailRows(rows)}</table>`;
  return { subject: `[${meta.label}] Sonalit operational alert — ${data.alertType || 'Alert'} — ${data.vehicle || 'Unknown vehicle'}`, text: `Sonalit ${meta.label} operational alert\n\nType: ${data.alertType || 'Alert'}\nSeverity: ${severity}\nVehicle: ${data.vehicle || 'Unknown'}\nRegion: ${data.region || 'Unknown'}\nConvoy: ${data.convoy || 'N/A'}\nTime: ${data.time || new Date().toISOString()}\n\n${data.message}`, html: layout({ preheader: `${meta.label} operational alert for ${data.vehicle || 'unknown vehicle'}`, title: `${meta.label} operational alert`, body, ctaLabel: data.ctaLabel, ctaUrl: data.ctaUrl }) };
}

function securityAlertTemplate(data) {
  const severity = String(data.severity || 'critical').toLowerCase(); const meta = severityMeta[severity] || severityMeta.critical;
  const coords = data.coordinates && data.coordinates.lat != null && data.coordinates.lng != null ? `${Number(data.coordinates.lat).toFixed(6)}, ${Number(data.coordinates.lng).toFixed(6)}` : 'Unavailable';
  const map = data.mapUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0 0 22px"><a href="${escapeHtml(data.ctaUrl || data.mapUrl)}" style="text-decoration:none"><img src="${escapeHtml(data.mapUrl)}" width="588" height="353" border="0" alt="High-definition Sonalit security incident map" style="display:block;width:100%;max-width:588px;height:auto;border:0;border-radius:12px"></a></td></tr></table>` : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#111A28" style="background-color:#111A28;border:1px solid #223047;border-radius:10px;padding:18px"><p style="margin:0;font-size:13px;line-height:20px;color:#94A3B8">Incident coordinates are not available for this event.</p></td></tr></table>`;
  const banner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#2A1115" style="background-color:#2A1115;border:1px solid #5B2028;border-radius:10px;padding:15px 16px"><p style="margin:0;font-size:11px;line-height:16px;color:#FCA5A5;letter-spacing:1.5px;font-weight:800">${meta.glyph} &nbsp; ${meta.label} SECURITY INCIDENT</p><p style="margin:5px 0 0;font-size:15px;line-height:22px;color:#F8FAFC;font-weight:700">Immediate attention required.</p></td></tr></table>`;
  const incidentRows = [
    ['Event', data.alertType || 'Security event'],
    ['Severity', meta.label],
    ['Vehicle', data.vehicle || 'Unknown'],
    ['Device', data.deviceId || 'Unknown'],
    ['Client', data.clientId || 'Admin / Unassigned'],
    ['Convoy', data.convoy || 'N/A'],
    ['Convoy status', data.convoyStatus || 'N/A'],
    ['Region', data.region || 'Unknown'],
    ['Route', data.route || 'N/A'],
    ['Ownership', data.ownership || 'Unknown'],
    ['Detected', data.time || new Date().toISOString()],
    ['Coordinates', coords],
  ];
  const body = `${banner}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-top:22px"><p style="margin:0 0 8px;font-size:10px;line-height:15px;color:#64748B;letter-spacing:1.7px;font-weight:800">INCIDENT LOCATION</p>${map}</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:2px">${detailRows(incidentRows)}</table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0F1826" style="background-color:#0F1826;border:1px solid #1F2C40;border-radius:10px;padding:16px;margin-top:16px"><p style="margin:0 0 6px;font-size:10px;line-height:15px;color:#64748B;letter-spacing:1.5px;font-weight:800">INCIDENT MESSAGE</p><p style="margin:0;font-size:14px;line-height:22px;color:#E2E8F0">${escapeHtml(data.message || 'Security event requires attention.')}</p></td></tr></table>`;
  return { subject: `[${meta.label}] Sonalit security incident — ${data.alertType || 'Security event'} — ${data.vehicle || 'Unknown vehicle'}`, text: `SONALIT SECURITY OPERATIONS\n\n${meta.label} SECURITY INCIDENT\nImmediate attention required.\n\nEvent: ${data.alertType || 'Security event'}\nVehicle: ${data.vehicle || 'Unknown'}\nDevice: ${data.deviceId || 'Unknown'}\nClient: ${data.clientId || 'Admin / Unassigned'}\nConvoy: ${data.convoy || 'N/A'}\nConvoy status: ${data.convoyStatus || 'N/A'}\nRegion: ${data.region || 'Unknown'}\nRoute: ${data.route || 'N/A'}\nOwnership: ${data.ownership || 'Unknown'}\nDetected: ${data.time || new Date().toISOString()}\nCoordinates: ${coords}\n\nIncident message:\n${data.message || 'Security event requires attention.'}\n\nMap: ${data.mapUrl || 'Unavailable'}\nOpen incident: ${data.ctaUrl || 'Unavailable'}`, html: layout({ preheader: `${meta.label} security incident for ${data.vehicle || 'unknown vehicle'} — map and incident context included`, title: `${meta.label} security incident`, eyebrow: 'SONALIT SECURITY OPERATIONS', body, ctaLabel: data.ctaLabel, ctaUrl: data.ctaUrl || data.mapUrl }) };
}

function clientPulseTemplate(data) {
  const snapshot = data.snapshotAt || new Date().toISOString(); const count = Number(data.activeBookingCount || 0);
  const body = `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#CBD5E1">Please find attached the latest CDS Active Booking Manifest, showing all currently active bookings and their latest recorded state.</p><p style="margin:0;font-size:13px;line-height:20px;color:#94A3B8">Snapshot: <strong style="color:#F8FAFC">${escapeHtml(snapshot)}</strong><br>Active bookings: <strong style="color:#F8FAFC">${count}</strong><br>The spreadsheet reflects the Booking Manifest at the snapshot time.</p>`;
  return { subject: `CDS Client Pulse — Active Booking Manifest — ${data.dateLabel}`, text: `Please find attached the latest CDS Active Booking Manifest, showing all currently active bookings and their latest recorded state.\n\nSnapshot: ${snapshot}\nActive bookings: ${count}\n\nThe spreadsheet reflects the Booking Manifest at the snapshot time.\n\nRegards,\nSonalit Operations`, html: layout({ preheader: `CDS active booking manifest snapshot — ${data.dateLabel}`, title: 'CDS Client Pulse', eyebrow: 'SONALIT CDS · CLIENT PULSE', body }) };
}

function genericTemplate(data) { const body = `<p style="margin:0;font-size:15px;line-height:24px;color:#CBD5E1">${escapeHtml(data.message)}</p>`; return { subject: data.subject, text: data.message, html: layout({ preheader: data.subject, title: data.title || data.subject, body, ctaLabel: data.ctaLabel, ctaUrl: data.ctaUrl }) }; }

module.exports = { escapeHtml, alertTemplate, securityAlertTemplate, clientPulseTemplate, genericTemplate };
