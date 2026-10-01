        markersRef.current.set(v.id, marker)
      }
    }
  }, [vehicles, onSelect])

  // fly to selected (one-shot, when selection changes)
  useEffect(() => {
    const map = mapRef.current; if (!map || !selectedId) return
    const v = vehicles.find(x => x.id === selectedId)
    if (v?.lat != null) map.flyTo({ center: [v.lng!, v.lat!], zoom: Math.max(map.getZoom(), 9), duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // follow mode ("Track" action) — keep the camera glued to the tracked
  // vehicle/device as new positions stream in, until the operator toggles off.
  useEffect(() => {
    const map = mapRef.current; if (!map || !trackedId) return
    const v = vehicles.find(x => x.id === trackedId)
    if (v?.lat != null) map.easeTo({ center: [v.lng!, v.lat!], zoom: Math.max(map.getZoom(), 12), duration: 600 })
  }, [trackedId, vehicles])

  // keyframes
  useEffect(() => {
    if (document.getElementById('lf-map-styles')) return
    const s = document.createElement('style'); s.id = 'lf-map-styles'
    s.textContent = `
      @keyframes lf-mping{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.2);opacity:0}}
      @keyframes lf-sos-ring{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.5);opacity:.2}}
      @keyframes lf-sos-marker{0%,100%{box-shadow:0 0 12px #ef444466,0 2px 8px rgba(0,0,0,.8)}50%{box-shadow:0 0 24px #ef4444cc,0 2px 8px rgba(0,0,0,.8)}}
    `
    document.head.appendChild(s)
  }, [])

  const geoCount = geofences?.length ?? 0
  const riskCount = riskZones?.length ?? 0

  return (
    <div className="spatial-map-shell" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#05070d' }} />

      {/* top-right controls */}
      <div className="spatial-map-control" style={{ position: 'absolute', right: 14, top: 14, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          onClick={() => setWorldSpatialOn(v => !v)}
          title={worldSpatialOn ? 'Hide external world intelligence' : 'Show external world intelligence'}
          aria-label={worldSpatialOn ? 'Hide external world intelligence' : 'Show external world intelligence'}
          style={{ width: 34, height: 34, borderRadius: 9, background: worldSpatialOn ? 'rgba(196,181,253,.15)' : 'rgba(8,11,20,.92)', border: `1px solid ${worldSpatialOn ? 'rgba(196,181,253,.58)' : 'rgba(255,255,255,.11)'}`, color: worldSpatialOn ? '#c4b5fd' : '#7a7e8a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: worldSpatialOn ? '0 0 18px rgba(196,181,253,.16), inset 0 0 12px rgba(196,181,253,.06)' : 'none', transition: 'all .18s ease' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
        </button>
        {/* traffic toggle — hidden entirely if no TOMTOM_API_KEY is configured server-side */}
        {trafficStatus?.configured && (
          <button
            onClick={() => setTrafficOn(v => !v)}
            title={trafficOn ? 'Hide traffic (congestion + incidents)' : 'Show traffic (congestion + incidents) — coverage is sparse or absent in some conflict corridors'}
            style={{ width: 34, height: 34, borderRadius: 7, background: trafficOn ? 'rgba(239,68,68,.18)' : 'rgba(8,11,20,.92)', border: `1px solid ${trafficOn ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.11)'}`, color: trafficOn ? '#ef4444' : '#7a7e8a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="20" rx="1"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>
          </button>
        )}
        {/* base-layer cycle: operational map → satellite → NASA Earth observation */}
        <button onClick={cycleMapMode} title={mapMode === 'dark' ? 'Satellite' : mapMode === 'satellite' ? 'Earth observation' : 'Dark map'} style={{ width: 34, height: 34, borderRadius: 7, background: mapMode !== 'dark' ? 'rgba(232,168,48,.18)' : 'rgba(8,11,20,.92)', border: `1px solid ${mapMode !== 'dark' ? 'rgba(232,168,48,.6)' : 'rgba(255,255,255,.11)'}`, color: mapMode !== 'dark' ? '#e8a830' : '#7a7e8a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
        </button>
        {/* zoom in */}
        <button onClick={() => mapRef.current?.zoomIn()} style={{ width: 34, height: 34, borderRadius: 7, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(255,255,255,.11)', color: '#7a7e8a', fontFamily: 'IBM Plex Mono,monospace', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
        {/* zoom out */}
        <button onClick={() => mapRef.current?.zoomOut()} style={{ width: 34, height: 34, borderRadius: 7, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(255,255,255,.11)', color: '#7a7e8a', fontFamily: 'IBM Plex Mono,monospace', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
        {/* fit all */}
        <button onClick={() => {
          const p = vehicles.filter(v => v.lat != null); if (!p.length || !mapRef.current) return
          const lngs = p.map(v => v.lng!); const lats = p.map(v => v.lat!)
          mapRef.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, maxZoom: 8 })
        }} style={{ width: 34, height: 34, borderRadius: 7, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(255,255,255,.11)', color: '#7a7e8a', fontFamily: 'IBM Plex Mono,monospace', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⊕</button>
      </div>

      {/* XD glass world-context legend */}
      <div className="spatial-map-control gev-panel" style={{ position: 'absolute', right: 56, top: 14, zIndex: 500, width: 228, maxWidth: 'calc(100vw - 90px)', background: 'linear-gradient(180deg, rgba(9,13,22,.88), rgba(7,10,17,.78))', border: '1px solid rgba(196,181,253,.18)', boxShadow: '0 14px 40px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06)', backdropFilter: 'blur(14px)', borderRadius: 10, padding: '10px 11px', color: '#dfe0db' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, letterSpacing: '.14em', color: '#a7a0bd' }}>GEV · XD WORLD CONTEXT</div>
            <div style={{ marginTop: 2, fontFamily: 'Barlow Condensed,sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: '.02em', color: '#f1f5f9' }}>Global spatial signal fabric</div>
          </div>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: worldError ? '#ef4444' : worldFetching ? '#f59e0b' : '#5eead4', boxShadow: worldError ? '0 0 10px rgba(239,68,68,.55)' : worldFetching ? '0 0 10px rgba(245,158,11,.45)' : '0 0 10px rgba(94,234,212,.45)' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#c4b5fd', boxShadow: '0 0 10px rgba(196,181,253,.35)' }} />
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#cbd5e1' }}>ORBITAL</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#5eead4', boxShadow: '0 0 10px rgba(94,234,212,.35)' }} />
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#cbd5e1' }}>CAMERAS</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#60a5fa' }} />
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#cbd5e1' }}>AIR / SEA</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#cbd5e1' }}>TRAFFIC / HAZARD</span>
          </div>
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,.06)', margin: '3px 0 7px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: worldError ? '#ef4444' : '#94a3b8' }}>
            {worldError ? 'WORLD CONTEXT UNAVAILABLE' : worldFetching ? 'SYNCING EXTERNAL SIGNALS' : String(externalWorldFeatures(worldContext).features.length) + ' SIGNALS IN VIEW'}
          </span>
          {geoCount > 0 || riskCount > 0 ? <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8, color: '#22d3ee' }}>{geoCount + riskCount} LOCAL ZONES</span> : null}
        </div>
        <div style={{ marginTop: 6, fontFamily: 'IBM Plex Mono,monospace', fontSize: 7.5, lineHeight: 1.45, color: '#6f7480' }}>
          Modelled orbital ≠ live telemetry · geometry ≠ visual acquisition · operational GPS remains authority.
        </div>
      </div>

      {/* coords */}
      <div className="spatial-status-chip" style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 500, background: 'rgba(8,11,20,.64)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 7, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, backdropFilter: 'blur(10px)', boxShadow: '0 8px 24px rgba(0,0,0,.2)' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8f96a3" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span ref={coordsRef} style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8.5, color: '#8f96a3' }}>hover for coords</span>
      </div>
    </div>
  )
}