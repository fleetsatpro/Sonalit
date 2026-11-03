import { useState, useEffect, useCallback } from 'react';
import { dayPlanApi } from '../api/dayPlanApi';
import { reportApi } from '../api/reportApi';
import { useWaypointWatch } from '../hooks/useWaypointWatch';
import type { AuthState, DayPlan } from '../types/ConvoyReport';

const T = {
  void: '#060a08', card: '#162019', raised: '#1d2c21',
  rim: 'rgba(255,255,255,0.07)',
  lime: '#a8e63d', green: '#22c55e',
  purple: '#a855f7', purpleBg: 'rgba(168,85,247,0.12)',
  text: '#d4e8d6', body: '#8aaa8e', sub: '#5a7a5e', void2: '#060a08',
  cond: "'Barlow Condensed', sans-serif",
  mono: "'Share Tech Mono', monospace",
};

/**
 * Always-mounted GPS watcher. When the convoy enters the radius of an
 * unreached waypoint (or the night park), shows a confirm banner.
 * Confirming the night park also records report arrival, unlocking EOD.
 */
export function WaypointPrompt({ auth }: { auth: AuthState }) {
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const refreshPlan = useCallback(() => {
    dayPlanApi.getToday(auth.convoy.id, auth.token)
      .then(setPlan)
      .catch(() => {});
  }, [auth.convoy.id, auth.token]);

  useEffect(() => {
    refreshPlan();
    const interval = setInterval(refreshPlan, 120_000);
    return () => clearInterval(interval);
  }, [refreshPlan]);

  const { nearby, position } = useWaypointWatch(plan, dismissed);

  if (!nearby || !position || !plan) return null;

  async function handleConfirm() {
    if (!nearby || !position || !plan) return;
    setConfirming(true);
    try {
      if (nearby.kind === 'waypoint' && nearby.waypoint) {
        await dayPlanApi.reachWaypoint(plan.id, nearby.waypoint.id, position.lat, position.lng, auth.token);
      } else {
        // Night park reached — record arrival on today's report (unlocks EOD)
        const report = await reportApi.getReport(auth.convoy.id, auth.token);
        await reportApi.submitArrival(report.id, { lat: position.lat, lng: position.lng, accuracy: 0 }, auth.token);
        setDismissed(prev => [...prev, 'night_park']);
      }
      refreshPlan();
    } catch {
      // leave the prompt up; CFO can retry
    } finally {
      setConfirming(false);
    }
  }

  function handleDismiss() {
    if (!nearby) return;
    setDismissed(prev => [...prev, nearby.kind === 'waypoint' && nearby.waypoint ? nearby.waypoint.id : 'night_park']);
  }

  const isNightPark = nearby.kind === 'night_park';

  return (
    <div style={{
      position: 'fixed', left: 12, right: 12, bottom: 86, zIndex: 90,
      background: T.card, border: `1.5px solid ${isNightPark ? T.purple : T.lime}`,
      borderRadius: 14, padding: '14px 16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 26 }}>{isNightPark ? '🌙' : '📍'}</div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: T.cond, fontSize: 15, fontWeight: 900,
            color: isNightPark ? T.purple : T.lime, letterSpacing: 1,
          }}>
            {isNightPark ? 'NIGHT PARK REACHED?' : 'WAYPOINT REACHED?'}
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.text, marginTop: 2 }}>
            {nearby.label}
            <span style={{ color: T.sub, marginLeft: 8 }}>{Math.round(nearby.distance_m)}m away</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={handleDismiss} style={{
          flex: 1, background: T.raised, border: `1px solid ${T.rim}`, borderRadius: 8,
          padding: '10px 0', fontFamily: T.cond, fontSize: 13, fontWeight: 700,
          color: T.body, cursor: 'pointer', letterSpacing: 1,
        }}>NOT YET</button>
        <button onClick={handleConfirm} disabled={confirming} style={{
          flex: 2, background: isNightPark ? T.purple : T.lime, border: 'none', borderRadius: 8,
          padding: '10px 0', fontFamily: T.cond, fontSize: 13, fontWeight: 900,
          color: T.void, cursor: confirming ? 'not-allowed' : 'pointer', letterSpacing: 1,
          opacity: confirming ? 0.6 : 1,
        }}>
          {confirming ? 'CONFIRMING…' : isNightPark ? '✓ CONFIRM ARRIVAL' : '✓ CONFIRM REACHED'}
        </button>
      </div>
    </div>
  );
}
