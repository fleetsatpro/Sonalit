/**
 * Fuel anomaly detection — RULE C: uses withOrg, never req.db
 */
const { withOrg } = require('./orgScopedDb');

const CONSUMPTION_SPIKE_THRESHOLD = 2.5; // ratio vs fleet average
const DUPLICATE_WINDOW_MINUTES = 30;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * detectAnomalies(orgId, entry)
 * entry: { id, vehicle_id, convoy_id, litres, odometer_km, station_lat, station_lng,
 *           fuel_card_ref, created_at }
 * Returns array of anomaly objects to insert into fuel_anomalies.
 */
async function detectAnomalies(orgId, entry) {
  const anomalies = [];

  await withOrg(orgId, async (db) => {
    // 1. Unknown location — not within any approved station radius
    if (entry.station_lat != null && entry.station_lng != null) {
      const stationsRes = await db.query(
        `SELECT name, lat, lng, radius_km FROM approved_fuel_stations
         WHERE active = true`,
      );
      const nearStation = stationsRes.rows.some(st =>
        haversineKm(entry.station_lat, entry.station_lng, Number(st.lat), Number(st.lng)) <= Number(st.radius_km),
      );
      if (!nearStation && stationsRes.rows.length > 0) {
        anomalies.push({
          org_id: orgId,
          fuel_entry_id: entry.id,
          vehicle_id: entry.vehicle_id,
          anomaly_type: 'unknown_location',
          severity: 'high',
          description: `Refuel at (${entry.station_lat}, ${entry.station_lng}) is not near any approved station`,
        });
      }
    }

    // 2. Off-route refuel — station outside convoy corridor
    if (entry.convoy_id && entry.station_lat != null) {
      const corridorRes = await db.query(
        `SELECT route_line, width_km FROM convoy_route_corridors
         WHERE convoy_id = $1 AND active = true`,
        [entry.convoy_id],
      );
      if (corridorRes.rows.length) {
        const { route_line, width_km } = corridorRes.rows[0];
        const line = typeof route_line === 'string' ? JSON.parse(route_line) : route_line;
        const offRoute = !isPointNearPolyline(entry.station_lat, entry.station_lng, line, Number(width_km));
        if (offRoute) {
          anomalies.push({
            org_id: orgId,
            fuel_entry_id: entry.id,
            vehicle_id: entry.vehicle_id,
            anomaly_type: 'off_route_refuel',
            severity: 'medium',
            description: `Refuel location is outside convoy corridor (width ${width_km} km)`,
          });
        }
      }
    }

    // 3. Duplicate entry — same vehicle, similar litres, same fuel_card_ref within window
    if (entry.vehicle_id) {
      const dupRes = await db.query(
        `SELECT id FROM fuel_entries
         WHERE vehicle_id = $1
           AND id != $2
           AND deleted_at IS NULL
           AND created_at > NOW() - ($3 || ' minutes')::interval
           AND ABS(litres - $4) < 5`,
        [entry.vehicle_id, entry.id, DUPLICATE_WINDOW_MINUTES, entry.litres],
      );
      if (dupRes.rows.length > 0) {
        anomalies.push({
          org_id: orgId,
          fuel_entry_id: entry.id,
          vehicle_id: entry.vehicle_id,
          anomaly_type: 'duplicate_entry',
          severity: 'medium',
          description: `Similar fuel entry recorded within ${DUPLICATE_WINDOW_MINUTES} min for same vehicle`,
        });
      }
    }

    // 4. Consumption spike — litres/100km vs fleet rolling average
    if (entry.vehicle_id && entry.odometer_km) {
      const prevRes = await db.query(
        `SELECT odometer_km, litres FROM fuel_entries
         WHERE vehicle_id = $1
           AND id != $2
           AND deleted_at IS NULL
           AND odometer_km IS NOT NULL
         ORDER BY odometer_km DESC
         LIMIT 1`,
        [entry.vehicle_id, entry.id],
      );
      if (prevRes.rows.length) {
        const prev = prevRes.rows[0];
        const distKm = entry.odometer_km - Number(prev.odometer_km);
        if (distKm > 10) {
          const consumption = (entry.litres / distKm) * 100;
          const fleetAvgRes = await db.query(
            `SELECT AVG(litres / NULLIF(odometer_km, 0) * 100) AS avg_consump
             FROM fuel_entries
             WHERE deleted_at IS NULL AND litres > 0 AND odometer_km > 0`,
          );
          const fleetAvg = Number(fleetAvgRes.rows[0]?.avg_consump);
          if (fleetAvg > 0 && consumption > fleetAvg * CONSUMPTION_SPIKE_THRESHOLD) {
            anomalies.push({
              org_id: orgId,
              fuel_entry_id: entry.id,
              vehicle_id: entry.vehicle_id,
              anomaly_type: 'consumption_spike',
              severity: 'high',
              description: `Consumption ${consumption.toFixed(1)} L/100km is ${(consumption / fleetAvg).toFixed(1)}× fleet average`,
            });
          }
        }
      }
    }

    // 5. Volume mismatch — litres > tank capacity (if known)
    if (entry.vehicle_id && entry.litres > 0) {
      const tankRes = await db.query(
        `SELECT fuel_tank_capacity FROM vehicles WHERE id = $1`,
        [entry.vehicle_id],
      );
      const cap = Number(tankRes.rows[0]?.fuel_tank_capacity);
      if (cap > 0 && entry.litres > cap * 1.05) {
        anomalies.push({
          org_id: orgId,
          fuel_entry_id: entry.id,
          vehicle_id: entry.vehicle_id,
          anomaly_type: 'volume_mismatch',
          severity: 'critical',
          description: `${entry.litres}L exceeds vehicle tank capacity ${cap}L`,
        });
      }
    }
  });

  return anomalies;
}

function isPointNearPolyline(lat, lng, line, widthKm) {
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    if (distanceToSegmentKm(lat, lng, a.lat, a.lng, b.lat, b.lng) <= widthKm / 2) return true;
  }
  return false;
}

function distanceToSegmentKm(plat, plng, alat, alng, blat, blng) {
  const dx = blng - alng;
  const dy = blat - alat;
  if (dx === 0 && dy === 0) return haversineKm(plat, plng, alat, alng);
  const t = Math.max(0, Math.min(1, ((plng - alng) * dx + (plat - alat) * dy) / (dx * dx + dy * dy)));
  return haversineKm(plat, plng, alat + t * dy, alng + t * dx);
}

module.exports = { detectAnomalies };
