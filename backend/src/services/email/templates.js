const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const severityMeta = {
  critical: { label: 'CRITICAL', glyph: '●' },
  high: { label: 'HIGH', glyph: '●' },
  normal: { label: 'NOTICE', glyph: '●' },
  low: { label: 'INFO', glyph: '●' },
};

function layout({ preheader = '', title, eyebrow = 'SONALIT OPERATIONS', body, ctaLabel, ctaUrl }) {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader);
  const cta = ctaLabel && ctaUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F0B429" style="background-color:#F0B429;border-radius:6px"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#081018;text-decoration:none;font-weight:700;padding-top:12px;padding-right:18px;padding-bottom:12px;padding-left:18px">${escapeHtml(ctaLabel)}</a></td></tr></table>` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head><body style="margin:0;padding:0;background-color:#070B12;color:#E5E7EB;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#070B12">${safePreheader}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#070B12" style="background-color:#070B12"><tr><td align="center" style="padding-top:28px;padding-right:16px;padding-bottom:28px;padding-left:16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#0D1321"><tr><td style="padding-top:26px;padding-right:28px;padding-bottom:12px;padding-left:28px"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;color:#94A3B8;letter-spacing:1.4px">${escapeHtml(eyebrow)}</p><h1 style="margin-top:8px;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:32px;color:#F8FAFC">${safeTitle}</h1></td></tr><tr><td style="padding-top:12px;padding-right:28px;padding-bottom:28px;padding-left:28px">${body}${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding-top:24px">${cta}</td></tr></table>` : ''}</td></tr><tr><td style="padding-top:18px;padding-right:28px;padding-bottom:20px;padding-left:28px;border-top:1px solid #1F2937"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#64748B">Automated message from Sonalit. Please do not rely on this email alone for time-critical operational decisions.</p></td></tr></table></td></tr></table></body></html>`;
}

function alertTemplate(data) {
  const severity = String(data.severity || 'normal').toLowerCase();
  const meta = severityMeta[severity] || severityMeta.normal;
  const rows = [
    ['Alert type', data.alertType], ['Severity', `${meta.glyph} ${meta.label}`],
    ['Vehicle', data.vehicle || 'Unknown'], ['Region', data.region || 'Unknown'],
    ['Convoy', data.convoy || 'N/A'], ['Time', data.time || new Date().toISOString()],
  ].map(([k, v]) => `<tr><td style="padding-top:8px;padding-bottom:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:#94A3B8">${escapeHtml(k)}</td><td style="padding-top:8px;padding-bottom:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:#F8FAFC;font-weight:700">${escapeHtml(v)}</td></tr>`).join('');
  const body = `<p style="margin-top:0;margin-right:0;margin-bottom:18px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#CBD5E1">${escapeHtml(data.message)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
  return { subject: `[${meta.label}] Sonalit operational alert — ${data.alertType || 'Alert'} — ${data.vehicle || 'Unknown vehicle'}`, text: `Sonalit ${meta.label} operational alert\n\nType: ${data.alertType || 'Alert'}\nSeverity: ${severity}\nVehicle: ${data.vehicle || 'Unknown'}\nRegion: ${data.region || 'Unknown'}\nConvoy: ${data.convoy || 'N/A'}\nTime: ${data.time || new Date().toISOString()}\n\n${data.message}`, html: layout({ preheader: `${meta.label} operational alert for ${data.vehicle || 'unknown vehicle'}`, title: `${meta.label} operational alert`, body, ctaLabel: data.ctaLabel, ctaUrl: data.ctaUrl }) };
}

function genericTemplate(data) {
  const body = `<p style="margin-top:0;margin-right:0;margin-bottom:18px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#CBD5E1">${escapeHtml(data.message)}</p>`;
  return { subject: data.subject, text: data.message, html: layout({ preheader: data.subject, title: data.title || data.subject, body, ctaLabel: data.ctaLabel, ctaUrl: data.ctaUrl }) };
}

module.exports = { escapeHtml, alertTemplate, genericTemplate };
