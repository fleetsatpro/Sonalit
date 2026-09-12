import { useState, useEffect } from 'react';
import { dayPlanApi } from '../api/dayPlanApi';
import { useGPSStamp } from '../hooks/useGPSStamp';
import type { AuthState, DayPlan, NewWaypoint } from '../types/ConvoyReport';

const T = {
  void: '#060a08', deep: '#0c1410', surface: '#111d16',
  card: '#162019', raised: '#1d2c21',
  rim: 'rgba(255,255,255,0.07)', rim2: 'rgba(255,255,255,0.12)',
  lime: '#a8e63d', limeBg: 'rgba(168,230,61,0.10)', limeRim: 'rgba(168,230,61,0.25)',
  green: '#22c55e', greenBg: 'rgba(34,197,94,0.10)',
  orange: '#f97316', orangeBg: 'rgba(249,115,22,0.10)',
  red: '#ef4444', redBg: 'rgba(239,68,68,0.10)',
  purple: '#a855f7', purpleBg: 'rgba(168,85,247,0.10)',
  text: '#d4e8d6', body: '#8aaa8e', sub: '#5a7a5e', muted: '#3d5442', white: '#f0f8f2',
  cond: "'Barlow Condensed', sans-serif",
  mono: "'Share Tech Mono', monospace",
};

const inputStyle: React.CSSProperties = {
  width: '100%', background: T.surface, border: `1px solid ${T.rim2}`,
  borderRadius: 8, padding: '11px 12px', color: T.white,
  fontFamily: T.mono, fontSize: 13, outline: 'none', boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontFamily: T.cond, fontSize: 11, color: T.sub, letterSpacing: 2, marginBottom: 6, display: 'block',
};

function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

interface DayPlanScreenProps {
  navigate: (screen: string) => void;
  auth: AuthState | null;
}

export function DayPlanScreen({ navigate, auth }: DayPlanScreenProps) {
  const [plan, setPlan]               = useState<DayPlan | null>(null);
  const [loading, setLoading]         = useState(true);
  const [editing, setEditing]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // form state
  const [startLabel, setStartLabel]       = useState('');
  const [nightParkLabel, setNightParkLabel] = useState('');
  const [nightParkCoords, setNightParkCoords] = useState('');
  const [waypoints, setWaypoints]         = useState<NewWaypoint[]>([]);
  const [wpLabel, setWpLabel]             = useState('');
  const [wpCoords, setWpCoords]           = useState('');
  const [modifyReason, setModifyReason]   = useState('');

  const { gps } = useGPSStamp();

  useEffect(() => {
    if (!auth) return;
    dayPlanApi.getToday(auth.convoy.id, auth.token)
      .then(p => setPlan(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [auth]);

  if (!auth) return null;
  const safeAuth = auth;

  function addWaypoint() {
    const coords = parseLatLng(wpCoords);
    if (!wpLabel.trim()) { setError('Waypoint needs a name.'); return; }
    if (!coords) { setError('Waypoint coordinates must be "lat, lng" (paste from Google Maps).'); return; }
    setError(null);
    setWaypoints(prev => [...prev, { label: wpLabel.trim(), lat: coords.lat, lng: coords.lng }]);
    setWpLabel('');
    setWpCoords('');
  }

  async function handleSave() {
    if (!nightParkLabel.trim()) { setError('Night park location name is required.'); return; }
    const npCoords = nightParkCoords.trim() ? parseLatLng(nightParkCoords) : null;
    if (nightParkCoords.trim() && !npCoords) {
      setError('Night park coordinates must be "lat, lng" (paste from Google Maps).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing && plan) {
        const updated = await dayPlanApi.modify(plan.id, {
          night_park_label: nightParkLabel.trim(),
          ...(npCoords ? { night_park_lat: npCoords.lat, night_park_lng: npCoords.lng } : {}),
          waypoints,
          ...(modifyReason.trim() ? { modified_reason: modifyReason.trim() } : {}),
        }, safeAuth.token);
        setPlan(updated);
        setEditing(false);
      } else {
        const created = await dayPlanApi.create({
          convoy_id: safeAuth.convoy.id,
          ...(startLabel.trim() ? { start_label: startLabel.trim() } : {}),
          ...(gps ? { start_lat: gps.lat, start_lng: gps.lng } : {}),
          night_park_label: nightParkLabel.trim(),
          ...(npCoords ? { night_park_lat: npCoords.lat, night_park_lng: npCoords.lng } : {}),
          waypoints,
        }, safeAuth.token);
        setPlan(created);
      }
      setWaypoints([]);
      setModifyReason('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not save day plan');
    } finally {
      setSaving(false);
    }
  }

  function startEditing() {
    if (!plan) return;
    setNightParkLabel(plan.night_park_label);
    setNightParkCoords(
      plan.night_park_lat != null ? `${plan.night_park_lat}, ${plan.night_park_lng}` : ''
    );
    setWaypoints([]);
    setEditing(true);
  }

  const showForm = !plan || editing;
  const reachedCount = plan?.waypoints.filter(w => w.reached_at).length ?? 0;

  return (
    <div style={{ minHeight: '100dvh', background: T.void, display: 'flex', flexDirection: 'column' }}>
      {/* Sub-header */}
      <div style={{
        background: T.deep, borderBottom: `1px solid ${T.rim}`,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => navigate('home')} style={{
          background: T.raised, border: `1px solid ${T.rim}`, borderRadius: 8,
          padding: '8px 12px', fontFamily: T.cond, fontSize: 14, color: T.body,
          cursor: 'pointer', letterSpacing: 1,
        }}>← BACK</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.cond, fontSize: 20, fontWeight: 900, color: T.white, letterSpacing: 2 }}>DAY PLAN</div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>Route plan for today</div>
        </div>
        <div style={{
          background: T.purpleBg, border: `1px solid ${T.purple}44`,
          borderRadius: 6, padding: '4px 10px',
          fontFamily: T.cond, fontSize: 12, fontWeight: 700, color: T.purple, letterSpacing: 2,
        }}>PLAN</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 40px' }}>
        {loading && (
          <div style={{ fontFamily: T.mono, fontSize: 12, color: T.sub, textAlign: 'center', padding: 32 }}>
            Loading…
          </div>
        )}

        {/* ── Existing plan view ── */}
        {!loading && plan && !editing && (
          <>
            <div style={{ background: T.card, border: `1px solid ${T.rim}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontFamily: T.cond, fontSize: 13, fontWeight: 700, color: T.sub, letterSpacing: 3 }}>TODAY'S PLAN</span>
                {plan.modified_at && (
                  <span style={{ fontFamily: T.mono, fontSize: 9, color: T.orange }}>MODIFIED</span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Start */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: T.lime }} />
                    <div style={{ width: 2, flex: 1, minHeight: 24, background: T.rim2 }} />
                  </div>
                  <div style={{ paddingBottom: 16 }}>
                    <div style={{ fontFamily: T.cond, fontSize: 14, fontWeight: 700, color: T.text }}>
                      {plan.start_label || 'Start point'}
                    </div>
                    {plan.start_lat != null && (
                      <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>
                        {Number(plan.start_lat).toFixed(5)}, {Number(plan.start_lng).toFixed(5)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Waypoints */}
                {plan.waypoints.map(wp => (
                  <div key={wp.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{
                        width: 12, height: 12, borderRadius: '50%',
                        background: wp.reached_at ? T.green : 'transparent',
                        border: `2px solid ${wp.reached_at ? T.green : T.muted}`,
                        boxSizing: 'border-box',
                      }} />
                      <div style={{ width: 2, flex: 1, minHeight: 24, background: T.rim2 }} />
                    </div>
                    <div style={{ paddingBottom: 16, flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: T.cond, fontSize: 14, fontWeight: 700, color: wp.reached_at ? T.green : T.text }}>
                          {wp.reached_at ? '✓ ' : ''}{wp.label}
                        </span>
                        {wp.reached_at && (
                          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.green }}>
                            {new Date(wp.reached_at).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>
                        {Number(wp.lat).toFixed(5)}, {Number(wp.lng).toFixed(5)} · {wp.radius_m}m radius
                      </div>
                    </div>
                  </div>
                ))}

                {/* Night park */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: T.purple, marginTop: 2 }} />
                  <div>
                    <div style={{ fontFamily: T.cond, fontSize: 14, fontWeight: 700, color: T.purple }}>
                      🌙 {plan.night_park_label}
                    </div>
                    {plan.night_park_lat != null && (
                      <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>
                        {Number(plan.night_park_lat).toFixed(5)}, {Number(plan.night_park_lng).toFixed(5)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {plan.waypoints.length > 0 && (
                <div style={{ marginTop: 14, fontFamily: T.mono, fontSize: 10, color: T.sub }}>
                  {reachedCount}/{plan.waypoints.length} waypoints reached
                </div>
              )}
              {plan.modified_reason && (
                <div style={{
                  marginTop: 10, padding: '8px 10px', background: T.orangeBg,
                  border: `1px solid ${T.orange}44`, borderRadius: 8,
                  fontFamily: T.mono, fontSize: 10, color: T.orange,
                }}>
                  Modified: {plan.modified_reason}
                </div>
              )}
            </div>

            <button onClick={startEditing} style={{
              width: '100%', background: T.orangeBg, border: `1px solid ${T.orange}55`,
              borderRadius: 12, padding: '13px 0', cursor: 'pointer',
              fontFamily: T.cond, fontSize: 15, fontWeight: 900, color: T.orange, letterSpacing: 2,
            }}>
              ⚠️ MODIFY PLAN (EMERGENCY)
            </button>
          </>
        )}

        {/* ── Create / edit form ── */}
        {!loading && showForm && (
          <div style={{ background: T.card, border: `1px solid ${T.rim}`, borderRadius: 14, padding: 16 }}>
            <div style={{ fontFamily: T.cond, fontSize: 13, fontWeight: 700, color: T.sub, letterSpacing: 3, marginBottom: 14 }}>
              {editing ? 'MODIFY PLAN' : 'SET TODAY\'S PLAN'}
            </div>

            {!editing && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>STARTING POINT (GPS AUTO-STAMPED)</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. Mombasa Depot"
                  value={startLabel}
                  onChange={e => setStartLabel(e.target.value)}
                />
                <div style={{ fontFamily: T.mono, fontSize: 9, color: gps ? T.lime : T.muted, marginTop: 4 }}>
                  {gps ? `📍 ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'Waiting for GPS lock…'}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>NIGHT PARK LOCATION *</label>
              <input
                style={inputStyle}
                placeholder="e.g. Voi Truck Stop"
                value={nightParkLabel}
                onChange={e => setNightParkLabel(e.target.value)}
              />
              <input
                style={{ ...inputStyle, marginTop: 8 }}
                placeholder="Coordinates: -3.3945, 38.5560 (optional)"
                value={nightParkCoords}
                onChange={e => setNightParkCoords(e.target.value)}
              />
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.muted, marginTop: 4 }}>
                With coordinates, arrival is auto-detected when you reach the night park
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>WAYPOINTS {editing ? '(REPLACES UNREACHED)' : '(OPTIONAL)'}</label>
              {waypoints.map((wp, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                  background: T.surface, borderRadius: 8, padding: '8px 10px',
                }}>
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: T.lime }}>{i + 1}</span>
                  <span style={{ flex: 1, fontFamily: T.cond, fontSize: 13, color: T.text }}>{wp.label}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>
                    {wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}
                  </span>
                  <button
                    onClick={() => setWaypoints(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', fontSize: 14 }}
                  >✕</button>
                </div>
              ))}
              <input
                style={inputStyle}
                placeholder="Waypoint name e.g. Mtito Andei"
                value={wpLabel}
                onChange={e => setWpLabel(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="-2.6885, 38.1670"
                  value={wpCoords}
                  onChange={e => setWpCoords(e.target.value)}
                />
                <button onClick={addWaypoint} style={{
                  background: T.limeBg, border: `1px solid ${T.limeRim}`, borderRadius: 8,
                  padding: '0 16px', fontFamily: T.cond, fontSize: 14, fontWeight: 900,
                  color: T.lime, cursor: 'pointer', letterSpacing: 1,
                }}>+ ADD</button>
              </div>
            </div>

            {editing && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>REASON FOR CHANGE</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. Road closed at Mtito Andei"
                  value={modifyReason}
                  onChange={e => setModifyReason(e.target.value)}
                />
              </div>
            )}

            {error && (
              <div style={{
                background: T.redBg, border: `1px solid ${T.red}55`,
                borderRadius: 8, padding: '10px 14px', marginBottom: 14,
                fontFamily: T.mono, fontSize: 11, color: T.red,
              }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {editing && (
                <button onClick={() => { setEditing(false); setError(null); }} style={{
                  flex: 1, background: T.raised, border: `1px solid ${T.rim}`, borderRadius: 10,
                  padding: '14px 0', fontFamily: T.cond, fontSize: 15, fontWeight: 900,
                  color: T.body, cursor: 'pointer', letterSpacing: 2,
                }}>CANCEL</button>
              )}
              <button onClick={handleSave} disabled={saving} style={{
                flex: 2, background: saving ? T.muted : T.lime, border: 'none', borderRadius: 10,
                padding: '14px 0', fontFamily: T.cond, fontSize: 15, fontWeight: 900,
                color: T.void, cursor: saving ? 'not-allowed' : 'pointer', letterSpacing: 2,
              }}>
                {saving ? 'SAVING…' : editing ? 'SAVE CHANGES' : 'SET DAY PLAN'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
