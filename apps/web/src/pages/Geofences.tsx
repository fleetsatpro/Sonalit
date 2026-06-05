import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  IconSearch, IconRoute, IconMapPin, IconAlertTriangle, IconX,
  IconPlus, IconLoader2, IconMaximize, IconZoomIn, IconZoomOut, IconRefresh,
  IconToggleLeft, IconToggleRight, IconLayersLinked,
} from '@tabler/icons-react'
import { api } from '../lib/api.js'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Geofence {
  id: string; name: string; type: string; active: boolean
  coordinates: unknown; radius: number|null
  lat: number|null; lng: number|null; region: string|null; created_at: string
}
interface GeoEvent {
  id: string; event_type: string; geofence_name: string|null
  vehicle_id: string|null; created_at: string; deviation_km: number|null
}
type LayerKey = 'dark'|'satellite'|'osm'
type RpTab = 'zones'|'events'|'new'

// ── Palette ───────────────────────────────────────────────────────────────────
const BG='#04070d',BG1='#07090f',BG2='#09101c',BG3='#0c1424'
const B1='#122038',B2='#1a2e4a'
const ACC='#00c8f0',GRN='#00e87a',RED='#ff2d55',ORG='#ff8c00',YLW='#ffd000',PUR='#a855f7'
const TEXT='#c0d4e8',SUB='#607890',MUTED='#304558'

// ── Map Layer Styles ──────────────────────────────────────────────────────────
const DARK_URL='https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const SAT_STYLE:maplibregl.StyleSpecification={version:8,sources:{
  sat:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'© Esri World Imagery'},
  ref:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'© Esri'},
},layers:[{id:'sat',type:'raster',source:'sat'},{id:'ref',type:'raster',source:'ref'}]}
const OSM_STYLE:maplibregl.StyleSpecification={version:8,sources:{
  osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'},
},layers:[{id:'osm',type:'raster',source:'osm'}]}
const STYLES:Record<LayerKey,{lbl:string;style:string|maplibregl.StyleSpecification}> = {
  dark:{lbl:'Dark',style:DARK_URL}, satellite:{lbl:'Satellite',style:SAT_STYLE}, osm:{lbl:'OpenStreet',style:OSM_STYLE},
}

// ── GL IDs ────────────────────────────────────────────────────────────────────
const GL_L=['gf-poly-fill','gf-poly-out','gf-line-buf','gf-line-ctr','gf-sel-fill','gf-sel-out']
const GL_S=['gf-polys','gf-lines','gf-sel']

// ── Helpers ───────────────────────────────────────────────────────────────────
function coordsToPoints(c:unknown):number[][]|null{
  if(typeof c==='string'){try{return coordsToPoints(JSON.parse(c))}catch{return null}}
  if(c!==null&&typeof c==='object'&&!Array.isArray(c)){
    const o=c as Record<string,unknown>
    if(Array.isArray(o['coordinates']))return coordsToPoints(o['coordinates'])
    if(Array.isArray(o['path'])){
      const pts=(o['path'] as unknown[]).map(p=>Array.isArray(p)?[Number((p as unknown[])[1]),Number((p as unknown[])[0])]:null).filter((p):p is number[]=>p!==null&&p.length===2)
      return pts.length>=2?pts:null
    }
    return null
  }
  if(!Array.isArray(c)||c.length<2)return null
  if(Array.isArray(c[0])&&Array.isArray((c[0] as unknown[])[0]))return coordsToPoints(c[0])
  if(Array.isArray(c[0]))return(c as unknown[][]).map(p=>[Number(p[0]),Number(p[1])])
  type LL={lat?:number;lng?:number;latitude?:number;longitude?:number}
  return(c as LL[]).map(p=>[p.lng??p.longitude??0,p.lat??p.latitude??0])
}
function isCorridor(g:Geofence,pts:number[][]|null):boolean{
  return['corridor','linear','line','linestring','route'].includes((g.type??'').toLowerCase())||(!!pts&&pts.length===2)
}
function typeKey(g:Geofence):string{
  const t=(g.type??'').toLowerCase()
  if(t.includes('border')||t.includes('post'))return 'border'
  if(['corridor','linear','line','linestring','route'].some(x=>t.includes(x)))return 'corridor'
  if(t.includes('restrict'))return 'restricted'
  return 'safe'
}
const TYPE_COLOR:Record<string,string>={border:ORG,corridor:ACC,restricted:RED,safe:GRN}
const tc=(g:Geofence)=>g.active?(TYPE_COLOR[typeKey(g)]??GRN):MUTED
const fmtAge=(iso:string)=>{const d=Math.floor((Date.now()-new Date(iso).getTime())/60000);return d<1?'just now':d<60?`${d}m ago`:d<1440?`${Math.floor(d/60)}h ago`:`${Math.floor(d/1440)}d ago`}
const evColor=(t:string)=>t==='enter'?GRN:t==='exit'?SUB:t.includes('dev')?RED:ORG

// ── Main Component ────────────────────────────────────────────────────────────
export default function Geofences() {
  const mapEl = useRef<HTMLDivElement>(null)
  const map   = useRef<maplibregl.Map|null>(null)
  const qc    = useQueryClient()

  const [layer,  setLayer]  = useState<LayerKey>('dark')
  const [tab,    setTab]    = useState<RpTab>('zones')
  const [selId,  setSelId]  = useState<string|null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [coords, setCoords] = useState('0°N 0°E')
  const [newForm,setNewForm]= useState({name:'',type:'corridor',region:'',coords_json:''})

  const { data: geoData, isLoading } = useQuery<Geofence[]>({
    queryKey: ['geofences'],
    queryFn: async () => { const r=await api.get<{data:Geofence[]}|Geofence[]>('/geofences'); return Array.isArray(r.data)?r.data:(r.data?.data??[]) },
  })
  const { data: evData } = useQuery<{data:GeoEvent[]}>({
    queryKey: ['geoevents'],
    queryFn: () => api.get('/geofences/events',{params:{limit:200}}).then(r=>r.data),
    refetchInterval: 30_000,
  })

  const toggleMut = useMutation({
    mutationFn: ({id,active}:{id:string;active:boolean}) => api.patch(`/geofences/${id}`,{active}),
    onSuccess: () => void qc.invalidateQueries({queryKey:['geofences']}),
  })
  const createMut = useMutation({
    mutationFn: (b:{name:string;type:string;region:string;coordinates:unknown}) => api.post('/geofences',b),
    onSuccess: () => { void qc.invalidateQueries({queryKey:['geofences']}); setTab('zones'); setNewForm({name:'',type:'corridor',region:'',coords_json:''}) },
  })
  const deleteMut = useMutation({
    mutationFn: (id:string) => api.delete(`/geofences/${id}`),
    onSuccess: () => { void qc.invalidateQueries({queryKey:['geofences']}); setSelId(null) },
  })

  // Map init
  useEffect(() => {
    if (!mapEl.current || map.current) return
    map.current = new maplibregl.Map({ container: mapEl.current, style: DARK_URL, center: [32, -2], zoom: 4.5 })
    map.current.on('mousemove', e => {
      const lat=e.lngLat.lat, lng=e.lngLat.lng
      setCoords(`${Math.abs(lat).toFixed(4)}°${lat>=0?'N':'S'} ${Math.abs(lng).toFixed(4)}°${lng>=0?'E':'W'}`)
    })
    return () => { map.current?.remove(); map.current = null }
  }, [])

  // Layer switch
  useEffect(() => {
    if (!map.current) return
    const s = STYLES[layer]!.style
    map.current.setStyle(typeof s === 'string' ? s : (s as maplibregl.StyleSpecification))
  }, [layer])

  // Draw geofences
  useEffect(() => {
    const m = map.current
    if (!m || !geoData) return
    const draw = () => {
      GL_L.forEach(l => { if (m.getLayer(l)) m.removeLayer(l) })
      GL_S.forEach(s => { if (m.getSource(s)) m.removeSource(s) })
      const polys:GeoJSON.Feature<GeoJSON.Polygon>[] = []
      const lines:GeoJSON.Feature<GeoJSON.LineString>[] = []
      const bounds = new maplibregl.LngLatBounds()
      for (const g of geoData) {
        const pts = coordsToPoints(g.coordinates)
        const col = tc(g)
        const tk  = typeKey(g)
        if (!pts) {
          if (g.lat!=null&&g.lng!=null) bounds.extend([g.lng,g.lat])
          continue
        }
        if (isCorridor(g, pts)) {
          lines.push({type:'Feature',properties:{id:g.id,col,tk},geometry:{type:'LineString',coordinates:pts}})
          pts.forEach(p=>bounds.extend([p[0]!,p[1]!]))
        } else {
          const first=pts[0]!,last=pts[pts.length-1]!
          const ring=first[0]===last[0]&&first[1]===last[1]?pts:[...pts,first]
          polys.push({type:'Feature',properties:{id:g.id,col,tk},geometry:{type:'Polygon',coordinates:[ring]}})
          ring.forEach(p=>bounds.extend([p[0]!,p[1]!]))
        }
      }
      const colorExpr:maplibregl.ExpressionSpecification=['match',['get','tk'],'border',ORG,'corridor',ACC,'restricted',RED,GRN]
      m.addSource('gf-polys',{type:'geojson',data:{type:'FeatureCollection',features:polys}})
      m.addLayer({id:'gf-poly-fill',type:'fill',source:'gf-polys',paint:{'fill-color':colorExpr,'fill-opacity':0.1}})
      m.addLayer({id:'gf-poly-out', type:'line',source:'gf-polys',paint:{'line-color':colorExpr,'line-width':1.5,'line-dasharray':[5,3]}})
      m.addSource('gf-lines',{type:'geojson',data:{type:'FeatureCollection',features:lines}})
      m.addLayer({id:'gf-line-buf',type:'line',source:'gf-lines',paint:{'line-color':colorExpr,'line-width':14,'line-opacity':0.1}})
      m.addLayer({id:'gf-line-ctr',type:'line',source:'gf-lines',paint:{'line-color':colorExpr,'line-width':2,'line-dasharray':[6,3]}})
      m.addSource('gf-sel',{type:'geojson',data:{type:'FeatureCollection',features:[]}})
      m.addLayer({id:'gf-sel-fill',type:'fill',source:'gf-sel',filter:['==','$type','Polygon'],paint:{'fill-color':'#fff','fill-opacity':0.12}})
      m.addLayer({id:'gf-sel-out', type:'line',source:'gf-sel',paint:{'line-color':'#fff','line-width':2.5,'line-dasharray':[3,1.5]}})
      if (!bounds.isEmpty()) m.fitBounds(bounds,{padding:60,maxZoom:12,duration:600})
    }
    if (m.loaded()) draw(); else m.once('load', draw)
    m.on('style.load', draw)
    return () => { m.off('style.load', draw) }
  }, [geoData])

  // Selection highlight
  useEffect(() => {
    const m = map.current
    const src = m?.getSource('gf-sel') as maplibregl.GeoJSONSource|undefined
    if (!src) return
    if (!selId||!geoData) { src.setData({type:'FeatureCollection',features:[]}); return }
    const g = geoData.find(x=>x.id===selId)
    if (!g) { src.setData({type:'FeatureCollection',features:[]}); return }
    const pts = coordsToPoints(g.coordinates)
    const feats:GeoJSON.Feature[] = []
    if (pts) {
      if (isCorridor(g, pts)) feats.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:pts}})
      else { const f=pts[0]!,l=pts[pts.length-1]!; const ring=f[0]===l[0]&&f[1]===l[1]?pts:[...pts,f]; feats.push({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}}) }
    }
    src.setData({type:'FeatureCollection',features:feats})
  }, [selId, geoData])

  const flyTo = useCallback((g:Geofence) => {
    const m = map.current; if (!m) return
    const pts = coordsToPoints(g.coordinates)
    if (pts?.length) {
      const b=new maplibregl.LngLatBounds(); pts.forEach(p=>b.extend([p[0]!,p[1]!]))
      if (!b.isEmpty()) { m.fitBounds(b,{padding:80,maxZoom:14,duration:800}); return }
    }
    if (g.lat!=null&&g.lng!=null) m.flyTo({center:[g.lng,g.lat],zoom:12,duration:800})
  }, [])

  const handleSelect = useCallback((g:Geofence) => {
    setSelId(p=>p===g.id?null:g.id); flyTo(g)
  }, [flyTo])

  const zones = geoData ?? []
  const events = evData?.data ?? []
  const today = Date.now() - 86400000
  const kpi = useMemo(() => ({
    active:   zones.filter(g=>g.active).length,
    total:    zones.length,
    corridors:zones.filter(g=>typeKey(g)==='corridor').length,
    borders:  zones.filter(g=>typeKey(g)==='border').length,
    evToday:  events.filter(e=>new Date(e.created_at).getTime()>today).length,
    devs:     events.filter(e=>e.event_type.includes('dev')).length,
  }), [zones, events, today])

  const selG = zones.find(g=>g.id===selId)
  const selEvents = selG ? events.filter(e=>e.geofence_name===selG.name).slice(0,5) : []

  const filteredZones = useMemo(() => zones.filter(g => {
    if (filter==='border'&&typeKey(g)!=='border') return false
    if (filter==='corridor'&&typeKey(g)!=='corridor') return false
    if (filter==='inactive'&&g.active) return false
    if (search) { const q=search.toLowerCase(); if (![g.name,g.type,g.region??''].join(' ').toLowerCase().includes(q)) return false }
    return true
  }), [zones, filter, search])

  const btn=(lbl:string,active:boolean,fn:()=>void,color?:string)=>(
    <button key={lbl} type="button" onClick={fn} style={{padding:'2px 9px',borderRadius:2,fontSize:8,fontWeight:600,cursor:'pointer',letterSpacing:'.09em',textTransform:'uppercase' as const,fontFamily:'var(--font-mono)',transition:'all .12s',border:`1px solid ${active?(color??ACC):B1}`,background:active?`${color??ACC}18`:'transparent',color:active?(color??ACC):MUTED}}>{lbl}</button>
  )

  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 56px)',background:BG,color:TEXT,fontFamily:'var(--font-sans)',overflow:'hidden'}}>
      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}} .gf-scrollbar::-webkit-scrollbar{width:2px} .gf-scrollbar::-webkit-scrollbar-thumb{background:${B2}}`}</style>

      {/* KPI Strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',borderBottom:`1px solid ${B1}`,background:BG1,flexShrink:0}}>
        {[
          {l:'Zones Active',  v:kpi.active,   c:GRN, s:`of ${kpi.total} total`},
          {l:'Corridors',     v:kpi.corridors, c:ACC, s:`${kpi.borders} borders`},
          {l:'Inactive',      v:kpi.total-kpi.active, c:MUTED, s:'disabled zones'},
          {l:'Events / 24h',  v:kpi.evToday,  c:YLW, s:'crossings + exits'},
          {l:'Deviations',    v:kpi.devs,     c:RED, s:'route violations'},
          {l:'Active Rate',   v:`${kpi.total?Math.round(kpi.active/kpi.total*100):0}%`, c:PUR, s:'coverage'},
        ].map((k,i)=>(
          <div key={i} style={{padding:'10px 14px',borderRight:`1px solid ${B1}`,display:'flex',flexDirection:'column',gap:4,position:'relative',overflow:'hidden'}}>
            <div style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.14em',color:MUTED,textTransform:'uppercase'}}>{k.l}</div>
            <div style={{fontSize:21,fontWeight:600,fontFamily:'var(--font-mono)',lineHeight:1,color:k.c}}>{isLoading?'—':k.v}</div>
            <div style={{fontSize:9,color:MUTED,fontFamily:'var(--font-mono)'}}>{k.s}</div>
            <div style={{position:'absolute',bottom:0,left:0,right:0,height:2,background:k.c,opacity:.35}}/>
          </div>
        ))}
      </div>

      {/* Body */}
      <div style={{display:'flex',flex:1,minHeight:0}}>

        {/* Map area */}
        <div style={{flex:1,position:'relative',overflow:'hidden'}}>
          <div ref={mapEl} style={{width:'100%',height:'100%',background:BG}}/>

          {/* Map toolbar */}
          <div style={{position:'absolute',top:10,left:10,zIndex:400,display:'flex',gap:5,alignItems:'center'}}>
            {(['dark','satellite','osm'] as LayerKey[]).map(k=>(
              <button key={k} type="button" onClick={()=>setLayer(k)}
                style={{padding:'5px 11px',background:'rgba(4,7,13,.9)',border:`1px solid ${layer===k?ACC:B2}`,borderRadius:3,fontSize:10,fontWeight:600,color:layer===k?ACC:SUB,cursor:'pointer',letterSpacing:'.07em',textTransform:'uppercase',fontFamily:'var(--font-mono)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',gap:5}}>
                <IconLayersLinked size={11}/>{STYLES[k]!.lbl}
              </button>
            ))}
            <div style={{width:1,height:22,background:B2}}/>
            <button type="button" onClick={()=>setTab('new')}
              style={{padding:'5px 11px',background:'rgba(4,7,13,.9)',border:`1px solid ${ORG}`,borderRadius:3,fontSize:10,fontWeight:600,color:ORG,cursor:'pointer',letterSpacing:'.07em',textTransform:'uppercase',fontFamily:'var(--font-mono)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',gap:5}}>
              <IconPlus size={11}/>Draw Zone
            </button>
          </div>

          {/* Map controls */}
          <div style={{position:'absolute',top:10,right:10,zIndex:400,display:'flex',flexDirection:'column',gap:4}}>
            {[{i:<IconZoomIn size={13}/>,fn:()=>map.current?.zoomIn()},{i:<IconZoomOut size={13}/>,fn:()=>map.current?.zoomOut()},{i:<IconMaximize size={13}/>,fn:()=>{ const m=map.current; if(m&&geoData?.length){const b=new maplibregl.LngLatBounds();geoData.forEach(g=>{if(g.lat!=null&&g.lng!=null)b.extend([g.lng,g.lat])});if(!b.isEmpty())m.fitBounds(b,{padding:60,maxZoom:10})}}}].map((c,i)=>(
              <button key={i} type="button" onClick={c.fn} style={{width:30,height:30,background:'rgba(4,7,13,.9)',border:`1px solid ${B2}`,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:SUB,backdropFilter:'blur(6px)',borderRadius:3}}>{c.i}</button>
            ))}
          </div>

          {/* Map legend */}
          <div style={{position:'absolute',top:50,right:10,zIndex:400,background:'rgba(4,7,13,.92)',border:`1px solid ${B2}`,borderRadius:3,padding:'10px 12px',display:'flex',flexDirection:'column',gap:6,backdropFilter:'blur(8px)'}}>
            {[{c:ORG,l:'Border Post'},{c:ACC,l:'Corridor'},{c:RED,l:'Restricted'},{c:GRN,l:'Safe Zone'},{c:MUTED,l:'Inactive'}].map(({c,l})=>(
              <div key={l} style={{display:'flex',alignItems:'center',gap:7,fontSize:9,color:SUB,fontFamily:'var(--font-mono)'}}>
                <div style={{width:7,height:7,borderRadius:'50%',background:c,flexShrink:0}}/>{l}
              </div>
            ))}
          </div>

          {/* Coordinate display */}
          <div style={{position:'absolute',bottom:12,left:12,zIndex:400,fontFamily:'var(--font-mono)',fontSize:9,color:MUTED,background:'rgba(4,7,13,.85)',padding:'3px 8px',border:`1px solid ${B1}`,borderRadius:2,backdropFilter:'blur(4px)'}}>{coords}</div>

          {/* Selected banner */}
          {selG && (
            <div style={{position:'absolute',top:10,left:'50%',transform:'translateX(-50%)',zIndex:500,background:`rgba(0,200,240,.1)`,border:`1px solid ${ACC}`,borderRadius:3,padding:'6px 14px',fontFamily:'var(--font-mono)',fontSize:11,color:ACC,backdropFilter:'blur(8px)',display:'flex',alignItems:'center',gap:10}}>
              {selG.name}<button type="button" onClick={()=>setSelId(null)} style={{background:'none',border:'none',color:ACC,cursor:'pointer',padding:0}}><IconX size={12}/></button>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{width:320,display:'flex',flexDirection:'column',background:BG1,borderLeft:`1px solid ${B1}`,overflow:'hidden',flexShrink:0}}>
          {/* Tabs */}
          <div style={{display:'flex',borderBottom:`1px solid ${B1}`,flexShrink:0}}>
            {(['zones','events','new'] as RpTab[]).map(t=>(
              <button key={t} type="button" onClick={()=>setTab(t)}
                style={{flex:1,padding:'9px 6px',fontSize:9,fontWeight:600,letterSpacing:'.1em',cursor:'pointer',textAlign:'center',textTransform:'uppercase',fontFamily:'var(--font-mono)',transition:'all .14s',border:'none',borderBottom:`2px solid ${tab===t?ACC:'transparent'}`,background:tab===t?`rgba(0,200,240,.04)`:BG1,color:tab===t?ACC:MUTED}}>
                {t==='zones'?`Zones${zones.length?' ('+zones.length+')':''}`:t==='events'?`Events${events.length?' ('+events.length+')':''}`:t==='new'?'+ New':t}
              </button>
            ))}
          </div>

          {/* Zones tab */}
          {tab==='zones' && (
            <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0,overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',gap:7,padding:'9px 12px',borderBottom:`1px solid ${B1}`,background:BG2,flexShrink:0}}>
                <IconSearch size={13} color={MUTED}/>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search zones, regions…" style={{background:'none',border:'none',outline:'none',color:TEXT,fontSize:11,flex:1,fontFamily:'var(--font-mono)'}}/>
              </div>
              <div style={{display:'flex',gap:3,padding:'7px 12px 6px',borderBottom:`1px solid ${B1}`,flexShrink:0,flexWrap:'wrap'}}>
                {[['all','All'],['border','Border'],['corridor','Corridor'],['inactive','Inactive']].map((p)=>btn(p[1]!,filter===p[0]!,()=>setFilter(p[0]!)))}
              </div>
              <div className="gf-scrollbar" style={{flex:1,overflowY:'auto',minHeight:0}}>
                {isLoading && <div style={{display:'flex',alignItems:'center',gap:8,padding:20,color:MUTED,fontFamily:'var(--font-mono)',fontSize:10}}><IconLoader2 size={14} className="animate-spin"/>Loading…</div>}
                {filteredZones.map(g=>{
                  const col=tc(g); const tk=typeKey(g)
                  const icoColor=tk==='border'?ORG:tk==='corridor'?ACC:tk==='restricted'?RED:GRN
                  const IcoComp=tk==='border'?IconMapPin:tk==='corridor'?IconRoute:IconAlertTriangle
                  return (
                    <div key={g.id} onClick={()=>handleSelect(g)} style={{display:'grid',gridTemplateColumns:'30px 1fr auto',gap:'0 9px',alignItems:'center',padding:'8px 12px',borderBottom:`1px solid rgba(18,32,56,.8)`,cursor:'pointer',background:selId===g.id?'rgba(0,200,240,.05)':undefined,transition:'background .1s',position:'relative'}}>
                      {selId===g.id&&<div style={{position:'absolute',right:0,top:0,bottom:0,width:2,background:ACC}}/>}
                      <div style={{width:28,height:28,borderRadius:3,display:'flex',alignItems:'center',justifyContent:'center',background:`${icoColor}18`,border:`1px solid ${icoColor}22`}}>
                        <IcoComp size={13} color={icoColor}/>
                      </div>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:500,fontFamily:'var(--font-mono)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',color:selId===g.id?ACC:TEXT}}>{g.name}</div>
                        <div style={{fontSize:9,color:MUTED,fontFamily:'var(--font-mono)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{g.region??'—'} · {g.type}</div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3,flexShrink:0}}>
                        <span style={{fontSize:8,fontWeight:600,padding:'1px 5px',borderRadius:1,fontFamily:'var(--font-mono)',background:`${col}18`,color:col,border:`1px solid ${col}28`}}>{tk.toUpperCase().slice(0,4)}</span>
                        <button type="button" onClick={e=>{e.stopPropagation();toggleMut.mutate({id:g.id,active:!g.active})}} style={{background:'none',border:'none',cursor:'pointer',padding:0,color:g.active?GRN:MUTED}}>
                          {g.active?<IconToggleRight size={18}/>:<IconToggleLeft size={18}/>}
                        </button>
                      </div>
                    </div>
                  )
                })}
                {!isLoading&&filteredZones.length===0&&<div style={{padding:32,textAlign:'center',color:MUTED,fontFamily:'var(--font-mono)',fontSize:10}}>NO ZONES FOUND</div>}
              </div>
              {/* Detail panel */}
              {selG && (
                <div style={{borderTop:`1px solid ${B1}`,background:BG2,flexShrink:0,padding:12}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:10}}>
                    <div>
                      <div style={{fontFamily:'var(--font-mono)',fontSize:13,fontWeight:600,color:ACC}}>{selG.name}</div>
                      <div style={{fontSize:10,color:MUTED,fontFamily:'var(--font-mono)',marginTop:1}}>{selG.region??'—'} · {selG.type}</div>
                    </div>
                    <button type="button" onClick={()=>setSelId(null)} style={{background:'none',border:'none',cursor:'pointer',color:MUTED}}><IconX size={14}/></button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:8}}>
                    {[['Created',selG.created_at?new Date(selG.created_at).toLocaleDateString():'—'],['Status',selG.active?'Active':'Inactive'],['Lat',selG.lat!=null?selG.lat.toFixed(4)+'°':'—'],['Lng',selG.lng!=null?selG.lng.toFixed(4)+'°':'—']].map(([k,v])=>(
                      <div key={k} style={{background:BG3,border:`1px solid ${B1}`,padding:'7px 9px',borderRadius:3}}>
                        <div style={{fontSize:8,color:MUTED,letterSpacing:'.09em',textTransform:'uppercase',fontFamily:'var(--font-mono)',marginBottom:3}}>{k}</div>
                        <div style={{fontSize:13,fontWeight:600,fontFamily:'var(--font-mono)',color:k==='Status'?(selG.active?GRN:MUTED):TEXT}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {selEvents.length>0&&<div style={{marginBottom:8}}><div style={{fontSize:9,color:MUTED,letterSpacing:'.1em',textTransform:'uppercase',fontFamily:'var(--font-mono)',marginBottom:6}}>Recent Events</div>
                    {selEvents.map(e=>(
                      <div key={e.id} style={{display:'flex',gap:7,alignItems:'flex-start',marginBottom:5}}>
                        <div style={{width:6,height:6,borderRadius:'50%',background:evColor(e.event_type),flexShrink:0,marginTop:3}}/>
                        <div style={{fontSize:10,color:SUB,fontFamily:'var(--font-mono)',flex:1}}>{e.event_type.replace('_',' ')}{e.deviation_km!=null?` · ${e.deviation_km.toFixed(1)}km`:''}</div>
                        <div style={{fontSize:9,color:MUTED,fontFamily:'var(--font-mono)',whiteSpace:'nowrap'}}>{fmtAge(e.created_at)}</div>
                      </div>
                    ))}
                  </div>}
                  <div style={{display:'flex',gap:4}}>
                    <button type="button" onClick={()=>toggleMut.mutate({id:selG.id,active:!selG.active})} style={{flex:1,padding:'5px 0',fontSize:9,fontWeight:600,fontFamily:'var(--font-mono)',letterSpacing:'.06em',cursor:'pointer',borderRadius:2,border:`1px solid ${B2}`,background:BG3,color:SUB}}>{selG.active?'Disable':'Enable'}</button>
                    <button type="button" onClick={()=>{if(confirm(`Delete "${selG.name}"?`))deleteMut.mutate(selG.id)}} style={{padding:'5px 10px',fontSize:9,fontWeight:600,fontFamily:'var(--font-mono)',letterSpacing:'.06em',cursor:'pointer',borderRadius:2,border:`1px solid rgba(255,45,85,.25)`,background:'rgba(255,45,85,.06)',color:RED}}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Events tab */}
          {tab==='events' && (
            <div className="gf-scrollbar" style={{flex:1,overflowY:'auto',padding:0}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 12px',borderBottom:`1px solid ${B1}`,background:BG2}}>
                <span style={{fontFamily:'var(--font-mono)',fontSize:8,letterSpacing:'.14em',color:MUTED,textTransform:'uppercase'}}>Live Events</span>
                <button type="button" onClick={()=>void qc.invalidateQueries({queryKey:['geoevents']})} style={{background:'none',border:'none',cursor:'pointer',color:MUTED,padding:0}}><IconRefresh size={12}/></button>
              </div>
              {events.slice(0,50).map(e=>(
                <div key={e.id} style={{display:'flex',gap:7,padding:'6px 12px',borderBottom:`1px solid rgba(18,32,56,.6)`,alignItems:'flex-start'}}>
                  <div style={{width:6,height:6,borderRadius:'50%',background:evColor(e.event_type),flexShrink:0,marginTop:4,...(e.event_type.includes('dev')?{animation:'blink .8s ease-in-out infinite'}:{})}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:10,color:SUB,fontFamily:'var(--font-mono)',lineHeight:1.4}}>{e.geofence_name??'Unknown zone'}{e.deviation_km!=null?` · ${e.deviation_km.toFixed(1)}km dev`:''}</div>
                    <div style={{fontSize:9,color:MUTED,marginTop:1,fontFamily:'var(--font-mono)'}}>{fmtAge(e.created_at)} · {e.event_type.replace(/_/g,' ')}</div>
                  </div>
                  <span style={{fontSize:8,padding:'1px 4px',borderRadius:1,fontFamily:'var(--font-mono)',fontWeight:600,background:`${evColor(e.event_type)}18`,color:evColor(e.event_type),border:`1px solid ${evColor(e.event_type)}28`,flexShrink:0}}>{e.event_type.replace(/_/g,' ').toUpperCase().slice(0,6)}</span>
                </div>
              ))}
              {events.length===0&&<div style={{padding:32,textAlign:'center',color:MUTED,fontFamily:'var(--font-mono)',fontSize:10}}>NO EVENTS RECORDED</div>}
            </div>
          )}

          {/* New zone form */}
          {tab==='new' && (
            <div className="gf-scrollbar" style={{flex:1,overflowY:'auto',padding:14}}>
              <div style={{fontFamily:'var(--font-mono)',fontSize:10,fontWeight:600,color:ACC,letterSpacing:'.08em',textTransform:'uppercase',marginBottom:12}}>New Geofence</div>
              {[{l:'Name',k:'name',ph:'e.g. Malaba Extended'},{l:'Region',k:'region',ph:'e.g. Uganda/Kenya'}].map(({l,k,ph})=>(
                <div key={k} style={{marginBottom:8}}>
                  <label style={{fontSize:8,color:MUTED,letterSpacing:'.09em',textTransform:'uppercase',fontFamily:'var(--font-mono)',display:'block',marginBottom:3}}>{l}</label>
                  <input value={newForm[k as 'name'|'region']} onChange={e=>setNewForm(f=>({...f,[k]:e.target.value}))} placeholder={ph}
                    style={{width:'100%',background:BG3,border:`1px solid ${B2}`,borderRadius:2,padding:'6px 8px',color:TEXT,fontFamily:'var(--font-mono)',fontSize:11,outline:'none'}}/>
                </div>
              ))}
              <div style={{marginBottom:8}}>
                <label style={{fontSize:8,color:MUTED,letterSpacing:'.09em',textTransform:'uppercase',fontFamily:'var(--font-mono)',display:'block',marginBottom:3}}>Type</label>
                <select value={newForm.type} onChange={e=>setNewForm(f=>({...f,type:e.target.value}))}
                  style={{width:'100%',background:BG3,border:`1px solid ${B2}`,borderRadius:2,padding:'6px 8px',color:TEXT,fontFamily:'var(--font-mono)',fontSize:11,outline:'none'}}>
                  {['corridor','border','restricted','safe'].map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                </select>
              </div>
              <div style={{marginBottom:12}}>
                <label style={{fontSize:8,color:MUTED,letterSpacing:'.09em',textTransform:'uppercase',fontFamily:'var(--font-mono)',display:'block',marginBottom:3}}>GeoJSON Coordinates — <code>[[lng,lat],…]</code></label>
                <textarea rows={5} value={newForm.coords_json} onChange={e=>setNewForm(f=>({...f,coords_json:e.target.value}))}
                  placeholder='[[27.45,-11.28],[27.46,-11.27],[27.47,-11.28]]'
                  style={{width:'100%',background:BG3,border:`1px solid ${B2}`,borderRadius:2,padding:'6px 8px',color:TEXT,fontFamily:'var(--font-mono)',fontSize:10,outline:'none',resize:'none'}}/>
              </div>
              {createMut.isError&&<div style={{fontSize:10,color:RED,fontFamily:'var(--font-mono)',marginBottom:8}}>Failed to create geofence.</div>}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
                <button type="button" onClick={()=>setTab('zones')} style={{padding:'7px 0',borderRadius:2,fontFamily:'var(--font-mono)',fontSize:10,fontWeight:600,letterSpacing:'.06em',cursor:'pointer',textAlign:'center',border:`1px solid ${B2}`,color:SUB,background:'none'}}>Cancel</button>
                <button type="button" disabled={!newForm.name||!newForm.coords_json||createMut.isPending}
                  onClick={()=>{let coords:unknown=newForm.coords_json;try{coords=JSON.parse(newForm.coords_json)}catch{}; createMut.mutate({name:newForm.name,type:newForm.type,region:newForm.region,coordinates:coords})}}
                  style={{padding:'7px 0',borderRadius:2,fontFamily:'var(--font-mono)',fontSize:10,fontWeight:600,letterSpacing:'.06em',cursor:'pointer',textAlign:'center',background:'rgba(0,200,240,.12)',border:`1px solid rgba(0,200,240,.3)`,color:ACC,opacity:(!newForm.name||!newForm.coords_json||createMut.isPending)?.5:1}}>
                  {createMut.isPending?'Saving…':'Save Zone'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
