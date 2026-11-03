/**
 * portalSanitiser — the leak boundary between internal incidents/alerts
 * and what a cargo client sees.
 *
 * NEVER expose: raw message, crew names (beyond assigned CFO),
 * exact tactics, law-enforcement specifics, vehicle IDs, or any
 * other client's convoy data.
 */

const ALERT_TYPE_TO_PORTAL = {
  speed:         'delay',
  geofence:      'deviation',
  mechanical:    'unplanned_stop',
  security:      'sos',
  communication: 'delay',
};

const SEVERITY_MAP = {
  low:      'info',
  medium:   'warning',
  high:     'critical',
  critical: 'critical',
};

const SAFE_TITLES = {
  deviation:      'Route deviation detected',
  unplanned_stop: 'Unplanned stop',
  sos:            'Security alert — response engaged',
  geofence:       'Geofence event',
  delay:          'Transit delay',
  seal:           'Seal status update',
};

function safeSummary(type, severity) {
  const sev = severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'info';
  const map = {
    deviation:      { critical: 'Vehicle route deviation confirmed. Escort responding. Cargo status secure.', warning: 'Vehicle briefly off planned corridor. Escort verifying.', info: 'Minor route variation detected. Escort monitoring.' },
    unplanned_stop: { critical: 'Vehicle stationary — crew contacted, response team alerted.', warning: 'Vehicle stationary outside checkpoint. Crew contacted for status.', info: 'Brief stop detected. No action required at this stage.' },
    sos:            { critical: 'Crew activated emergency signal. Response team engaged. Cargo secure.', warning: 'Security alert received. Escort responding. Update to follow.', info: 'Security notification logged. Being monitored.' },
    geofence:       { critical: 'Vehicle outside authorised zone. Escort verifying.', warning: 'Vehicle approaching boundary of authorised zone.', info: 'Geofence notification received.' },
    delay:          { critical: 'Significant transit delay. Revised ETA to follow.', warning: 'Transit running behind schedule. Escort monitoring.', info: 'Minor delay detected. ETA updated.' },
    seal:           { critical: 'Seal status requires attention. Operator investigating.', warning: 'Seal status flagged for review.', info: 'Seal check completed.' },
  };
  return (map[type] || map['delay'])[sev] || map['delay'].info;
}

function portalStatus(acknowledged_at, resolved_at) {
  if (resolved_at) return 'resolved';
  if (acknowledged_at) return 'responding';
  return 'detected';
}

function sanitisedDetectedLabel(portalType) {
  const labels = {
    deviation:      'Route variation detected by monitoring system',
    unplanned_stop: 'Unplanned stop detected',
    sos:            'Security signal received',
    geofence:       'Geofence event detected',
    delay:          'Transit delay detected',
    seal:           'Seal status flagged',
  };
  return labels[portalType] || 'Event detected';
}

function buildTimeline(type, severity, created_at, acknowledged_at, resolved_at) {
  const portalType = ALERT_TYPE_TO_PORTAL[type] || 'delay';
  const events = [
    { at: created_at.toISOString(), label: sanitisedDetectedLabel(portalType), phase: 'detected' },
  ];
  if (acknowledged_at) {
    events.push({ at: acknowledged_at.toISOString(), label: 'Escort & operations notified — responding', phase: 'responding' });
  }
  if (resolved_at) {
    events.push({ at: resolved_at.toISOString(), label: 'Situation resolved — cargo confirmed secure', phase: 'resolved' });
  }
  return events;
}

/**
 * Project an internal alert row into a sanitised PortalIncident.
 * @param {object} alert — raw DB row from alerts table
 * @returns {object} PortalIncident (safe for client)
 */
function toPortalIncident(alert) {
  const type = ALERT_TYPE_TO_PORTAL[alert.type] || 'delay';
  const severity = SEVERITY_MAP[alert.severity] || 'info';
  const status = portalStatus(alert.acknowledged_at, alert.resolved_at);

  return {
    id: alert.id,
    convoy_id: alert.convoy_id,
    type,
    severity,
    title: SAFE_TITLES[type],
    summary: safeSummary(type, severity),
    status,
    occurred_at: alert.created_at.toISOString(),
    resolved_at: alert.resolved_at ? alert.resolved_at.toISOString() : null,
    timeline: buildTimeline(alert.type, alert.severity, alert.created_at, alert.acknowledged_at, alert.resolved_at),
  };
}

/**
 * Derive the portal security level from a list of open PortalIncidents.
 */
function deriveLevel(incidents) {
  if (incidents.some(i => i.severity === 'critical' && i.status !== 'resolved')) return 'critical';
  if (incidents.some(i => i.severity === 'warning' && i.status !== 'resolved')) return 'warning';
  if (incidents.some(i => i.status !== 'resolved')) return 'warning';
  return 'secure';
}

/**
 * Build a sanitised PortalSecurityStatus headline + detail.
 */
function buildSecurityStatus(convoy_id, incidents, convoyRow) {
  const level = deriveLevel(incidents);
  const openCrit = incidents.find(i => i.severity === 'critical' && i.status !== 'resolved');
  const openWarn = incidents.find(i => i.status !== 'resolved');

  let headline, detail;
  if (level === 'critical') {
    headline = openCrit?.title || 'Security alert — response engaged';
    detail = 'Live · response team notified · cargo status being confirmed';
  } else if (level === 'warning') {
    headline = openWarn?.title || 'Event in progress';
    detail = 'Escort monitoring · operations tracking · updates to follow';
  } else {
    headline = 'All secure';
    detail = 'Escort active · on schedule · all checkpoints clear';
  }

  const lastPing = convoyRow?.last_ping_at || convoyRow?.updated_at || null;

  return {
    convoy_id,
    level,
    headline,
    detail,
    escort_active: true,
    seal_status: null,
    last_checkin_at: lastPing ? new Date(lastPing).toISOString() : null,
  };
}

module.exports = { toPortalIncident, deriveLevel, buildSecurityStatus };
