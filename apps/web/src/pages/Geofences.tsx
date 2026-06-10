import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../lib/api.js'

interface Vehicle { id:string;registration:string;type:string;status:string;latitude:number|null;longitude:number|null;speed:number|null;fuel_level:number|null;region:string|null;driver_name:string|null }
interface Alert { id:string;type:string;severity:string;message:string;created_at:string;vehicle_id:string|null }
interface Geofence { id:string;name:string;type:string;active:boolean;coordinates:unknown;region:string|null;lat:number|null;lng:number|null }

const V='#010508',SURF='#050f18',RAISED='#081522',OVERLAY='rgba(3,10,18,0.97)'
const CYAN='#00c8ff',GRN='#00e896',AMB='#f5a820',ORG='#f46e22',RED='#f02855',VIO='#7b5fff'
const TEXT='#d8eeff',SUB='#6a8fae',MUTED='#2e4d66',GHOST='#1a3045'
const BD='rgba(0,200,255,0.1)',BDACC='rgba(0,200,255,0.22)'
const RC:Record<string,string>={safe:GRN,medium:AMB,warning:AMB,high:ORG,critical:RED}
const TC:Record<string,string>={free:GRN,light:'#9eff44',moderate:AMB,heavy:ORG,severe:RED}
const REGIONS:{[k:string]:{bounds:[[number,number],[number,number]];name:string}}={
  global:{bounds:[[-60,-180],[75,180]],name:'Global'},africa:{bounds:[[-35,-20],[40,55]],name:'Africa'},
  namerica:{bounds:[[15,-130],[70,-60]],name:'N. America'},samerica:{bounds:[[-55,-80],[10,-35]],name:'S. America'},
  europe:{bounds:[[35,-10],[65,40]],name:'Europe'},asia:{bounds:[[10,60],[55,150]],name:'Asia'},
  oceania:{bounds:[[-45,110],[0,180]],name:'Oceania'},middleeast:{bounds:[[12,35],[42,65]],name:'Mid East'},
}
const SEG_TYPES=['free','light','moderate','heavy','severe']
const pick=<T,>(a:T[]):T=>a[Math.floor(Math.random()*a.length)] as T
const CORRIDORS=[
  {id:'northAtlantic',name:'North Atlantic Lane',region:'europe',risk:'critical',path:[[40.7,-74],[45.2,-50.5],[49.8,-25],[51.2,-8.5],[50.9,-1]] as [number,number][]},
  {id:'suez',name:'Suez Canal Route',region:'middleeast',risk:'high',path:[[35.9,-5.5],[35.5,5],[33.2,20.5],[31.3,32.5],[29.9,34.7]] as [number,number][]},
  {id:'panama',name:'Panama Canal Route',region:'samerica',risk:'high',path:[[25,-80],[20,-78.5],[12,-79.5],[9,-79.5],[8,-79]] as [number,number][]},
  {id:'singapore',name:'Singapore Strait',region:'asia',risk:'warning',path:[[1.3,103.8],[1.2,104.6],[2.5,107.2]] as [number,number][]},
  {id:'shanghai',name:'Shanghai Approach',region:'asia',risk:'medium',path:[[28.5,122],[30.5,122.8],[31.4,121.9]] as [number,number][]},
  {id:'rotterdam',name:'Rotterdam–Hamburg',region:'europe',risk:'medium',path:[[51.92,4.48],[52.37,4.9],[52.55,6.05],[53.55,9.98]] as [number,number][]},
  {id:'dubai',name:'Dubai Gulf',region:'middleeast',risk:'safe',path:[[22,60],[24,57.5],[25.3,55.3]] as [number,number][]},
  {id:'laPacific',name:'LA Pacific',region:'namerica',risk:'warning',path:[[33.7,-118.2],[30,-121],[25,-127]] as [number,number][]},
  {id:'mumbai',name:'Mumbai Approach',region:'asia',risk:'medium',path:[[18,70],[19,72],[19,72.8]] as [number,number][]},
  {id:'southChina',name:'South China Sea',region:'asia',risk:'high',path:[[22.3,114.2],[18,116],[14,115],[10,112],[6,108],[1.3,105]] as [number,number][]},
  {id:'europe',name:'Europe Freight Grid',region:'europe',risk:'medium',path:[[48.85,2.35],[49.5,4.5],[50.5,8],[51,13],[52,20.5]] as [number,number][]},
  {id:'sahara',name:'Trans-Sahara Corridor',region:'africa',risk:'medium',path:[[30,-5],[25,2],[18,10],[10,13]] as [number,number][]},
  {id:'cape',name:'Cape Town Corridor',region:'africa',risk:'safe',path:[[-33.9,18.4],[-30,25],[-26,30]] as [number,number][]},
]
const PREDICTIONS=[
  {title:'Port Congestion',prob:81,trend:'up' as const,detail:'Elevated berth utilization at key hubs.'},
  {title:'Border Delay',prob:74,trend:'flat' as const,detail:'Customs processing slowing at major ports.'},
  {title:'Weather Disruption',prob:69,trend:'down' as const,detail:'North Atlantic storm system weakening.'},
  {title:'Security Incident',prob:58,trend:'up' as const,detail:'Anomalous clustering near Gulf of Aden.'},
]

function sevToRisk(sev:string){return sev==='critical'?'critical':sev==='high'?'high':sev==='medium'?'medium':'warning'}
function fmtAge(iso:string){const d=Math.floor((Date.now()-new Date(iso).getTime())/60000);return d<1?'now':d<60?`${d}m`:d<1440?`${Math.floor(d/60)}h`:`${Math.floor(d/1440)}d`}
function coordsToLL(c:unknown):[number,number][]|null{
  if(typeof c==='string'){try{return coordsToLL(JSON.parse(c))}catch{return null}}
  if(c!==null&&typeof c==='object'&&!Array.isArray(c)){const o=c as Record<string,unknown>;if(Array.isArray(o['coordinates']))return coordsToLL(o['coordinates']);return null}
  if(!Array.isArray(c)||c.length<2)return null
  if(Array.isArray((c as unknown[][])[0])){return(c as number[][]).map(p=>[p[1]??0,p[0]??0])}
  return null
}

export default function Geofences(){
  const mapEl=useRef<HTMLDivElement>(null)
  const map=useRef<maplibregl.Map|null>(null)
  const vehicleMarkers=useRef<Map<string,maplibregl.Marker>>(new Map())
  const [booting,setBooting]=useState(true)
  const [bootPct,setBootPct]=useState(0)
  const [leftOpen,setLeftOpen]=useState(false)
  const [rightOpen,setRightOpen]=useState(false)
  const [region,setRegion]=useState('global')
  const [regionMenuOpen,setRegionMenuOpen]=useState(false)
  const [layers,setLayers]=useState({corridors:true,heatmap:false,threats:false,weather:false})
  const [selVehicle,setSelVehicle]=useState<Vehicle|null>(null)
  const [selCorridorId,setSelCorridorId]=useState<string|null>(null)
  const [tlFilter,setTlFilter]=useState('all')
  const [consoleOpen,setConsoleOpen]=useState(false)
  const [consoleLines,setConsoleLines]=useState<{t:string;c:string}[]>([])
  const [consoleInput,setConsoleInput]=useState('')
  const [dashOpen,setDashOpen]=useState(false)
  const [tmOpen,setTmOpen]=useState(false)
  const [tmOffset,setTmOffset]=useState(0)
  const [toast,setToast]=useState<{msg:string;show:boolean}>({msg:'',show:false})
  const [search,setSearch]=useState('')
  const [utcClock,setUtcClock]=useState('')
  const [aiText,setAiText]=useState('')
  const [aiLoading,setAiLoading]=useState(false)
  const [corridorPanelOpen,setCorridorPanelOpen]=useState(false)
  const [drawMode,setDrawMode]=useState<string|null>(null)
  const [drawPoints,setDrawPoints]=useState<[number,number][]>([])
  const [customZones,setCustomZones]=useState<{id:string;name:string;risk:string}[]>([])

  const {data:vData}=useQuery<{data:Vehicle[]}>({queryKey:['vehicles-intel'],queryFn:()=>api.get('/vehicles').then(r=>r.data),refetchInterval:30_000})
  const {data:aData}=useQuery<{data:Alert[]}>({queryKey:['alerts-intel'],queryFn:()=>api.get('/alerts').then(r=>r.data),refetchInterval:30_000})
  const {data:gData}=useQuery<{data:Geofence[]}>({queryKey:['geofences'],queryFn:()=>api.get('/geofences').then(r=>({data:Array.isArray(r.data)?r.data:r.data?.data??[]}))})

  const vehicles=vData?.data??[]
  const alerts=aData?.data??[]
  const geofences=gData?.data??[]

  const activeVehicles=useMemo(()=>vehicles.filter(v=>v.latitude!=null&&v.longitude!=null),[vehicles])
  const threats=useMemo(()=>alerts.slice(0,20).map(a=>({id:a.id,title:a.message||a.type,sev:sevToRisk(a.severity),time:fmtAge(a.created_at),region:a.vehicle_id?'active':'global'})),[alerts])
  const corridors=useMemo(()=>CORRIDORS.filter(c=>region==='global'||c.region===region).map(c=>({...c,segs:c.path.slice(0,-1).map(()=>pick(SEG_TYPES)),health:({safe:92,medium:70,warning:55,high:35,critical:18}[c.risk as string]||50)})),[region])

  const kpi=useMemo(()=>({
    threat:threats.length?Math.max(...threats.map(t=>({critical:100,high:80,medium:55,warning:40}[t.sev]||40))):42,
    assets:activeVehicles.length,
    geofences:geofences.length+customZones.length,
    anomalies:alerts.filter(a=>!a.vehicle_id||['speed','route_deviation','geofence'].includes(a.type)).length,
  }),[threats,activeVehicles,corridors,geofences,customZones,alerts])

  const tlEvents=useMemo(()=>alerts.filter(a=>tlFilter==='all'||sevToRisk(a.severity)===tlFilter).slice(0,18).map(a=>({id:a.id,time:fmtAge(a.created_at),event:a.message||a.type,sev:sevToRisk(a.severity)})),[alerts,tlFilter])
  const selCorr=corridors.find(c=>c.id===selCorridorId)

  // UTC clock
  useEffect(()=>{
    const t=setInterval(()=>setUtcClock(new Date().toISOString().slice(11,19)+' UTC'),1000)
    return()=>clearInterval(t)
  },[])

  // Boot sequence
  useEffect(()=>{
    let pct=0
    const msgs=['Initialising intelligence modules…','Loading corridor network…','Calibrating threat sensors…','Connecting to fleet telemetry…','Activating AI core…','System online.']
    let mi=0
    const t=setInterval(()=>{
      pct+=Math.random()*18+4
      setBootPct(Math.min(100,Math.floor(pct)))
      if(mi<msgs.length-1&&pct>mi*(100/msgs.length)){mi++}
      if(pct>=100){clearInterval(t);setTimeout(()=>setBooting(false),400)}
    },120)
    return()=>clearInterval(t)
  },[])

  // Map init
  useEffect(()=>{
    if(booting||!mapEl.current||map.current)return
    map.current=new maplibregl.Map({container:mapEl.current,style:'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',center:[10,22],zoom:2.8})
    map.current.addControl(new maplibregl.NavigationControl({showCompass:false}))
    map.current.on('click',()=>{setCorridorPanelOpen(false)})
    return()=>{map.current?.remove();map.current=null;vehicleMarkers.current.clear()}
  },[booting])

  // Draw mode map click
  useEffect(()=>{
    const m=map.current;if(!m||!drawMode)return
    const handler=(e:maplibregl.MapMouseEvent)=>{
      const pt:[number,number]=[e.lngLat.lat,e.lngLat.lng]
      setDrawPoints(prev=>[...prev,pt])
    }
    m.on('click',handler)
    return()=>{m.off('click',handler)}
  },[drawMode])

  // Render corridors on map
  useEffect(()=>{
    const m=map.current;if(!m)return
    const draw=()=>{
      ['gf-corr-glow','gf-corr-line','gf-corr-seg','gf-zones-fill','gf-zones-line'].forEach(id=>{if(m.getLayer(id))m.removeLayer(id)})
      ;['gf-corr-src','gf-zones-src'].forEach(id=>{if(m.getSource(id))m.removeSource(id)})
      if(!layers.corridors)return
      const lines:GeoJSON.Feature<GeoJSON.LineString>[]=corridors.map(c=>({type:'Feature',properties:{risk:c.risk,id:c.id},geometry:{type:'LineString',coordinates:c.path.map(([lat,lng])=>[lng,lat])}}))
      m.addSource('gf-corr-src',{type:'geojson',data:{type:'FeatureCollection',features:lines}})
      m.addLayer({id:'gf-corr-glow',type:'line',source:'gf-corr-src',paint:{'line-color':['match',['get','risk'],'critical',RED,'high',ORG,'warning',AMB,'safe',GRN,AMB],'line-width':16,'line-opacity':0.07}})
      m.addLayer({id:'gf-corr-line',type:'line',source:'gf-corr-src',paint:{'line-color':['match',['get','risk'],'critical',RED,'high',ORG,'warning',AMB,'safe',GRN,AMB],'line-width':2.5,'line-opacity':0.9,'line-dasharray':[1,0]}})
      const polys:GeoJSON.Feature<GeoJSON.Polygon>[]=geofences.filter(g=>!['corridor','linear','route'].includes((g.type||'').toLowerCase())).flatMap(g=>{
        const pts=coordsToLL(g.coordinates);if(!pts||pts.length<3)return[]
        const closed=[...pts,pts[0]!];const ring=closed.map(([lat,lng])=>[lng,lat]);
        return[{type:'Feature' as const,properties:{name:g.name,active:g.active},geometry:{type:'Polygon' as const,coordinates:[ring]}}]
      })
      if(polys.length){
        m.addSource('gf-zones-src',{type:'geojson',data:{type:'FeatureCollection',features:polys}})
        m.addLayer({id:'gf-zones-fill',type:'fill',source:'gf-zones-src',paint:{'fill-color':CYAN,'fill-opacity':0.05}})
        m.addLayer({id:'gf-zones-line',type:'line',source:'gf-zones-src',paint:{'line-color':CYAN,'line-width':1.2,'line-dasharray':[5,4]}})
      }
    }
    if(m.loaded())draw();else m.once('load',draw)
    m.on('style.load',draw)
    return()=>{m.off('style.load',draw)}
  },[corridors,geofences,layers.corridors])

  // Vehicle markers
  useEffect(()=>{
    const m=map.current;if(!m||!m.loaded())return
    const existing=new Set(vehicleMarkers.current.keys())
    activeVehicles.forEach(v=>{
      const col=v.status==='offline'?MUTED:v.status==='maintenance'?ORG:(v.fuel_level!=null&&v.fuel_level<25)?RED:GRN
      const pulse=col===RED?`<circle cx="8" cy="8" r="7" fill="${col}" fill-opacity="0" stroke="${col}" stroke-width="1"><animate attributeName="r" values="5;11" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0" dur="1.4s" repeatCount="indefinite"/></circle>`:''
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${pulse}<circle cx="8" cy="8" r="6" fill="${col}" fill-opacity="0.18" stroke="${col}" stroke-width="1.5"/><circle cx="8" cy="8" r="3" fill="${col}"/></svg>`
      const el=document.createElement('div');el.innerHTML=svg;el.style.cursor='pointer'
      if(vehicleMarkers.current.has(v.id)){
        vehicleMarkers.current.get(v.id)!.setLngLat([v.longitude!,v.latitude!])
      }else{
        const mk=new maplibregl.Marker({element:el}).setLngLat([v.longitude!,v.latitude!]).setPopup(new maplibregl.Popup({offset:14}).setHTML(`<strong style="color:${CYAN}">${v.registration}</strong><br>Type: ${v.type}<br>Status: <span style="color:${col}">${v.status?.toUpperCase()}</span>${v.speed!=null?`<br>Speed: ${Math.round(v.speed)} km/h`:''}${v.fuel_level!=null?`<br>Fuel: ${Math.round(v.fuel_level)}%`:''}`)).addTo(m)
        mk.getElement().addEventListener('click',()=>setSelVehicle(v))
        vehicleMarkers.current.set(v.id,mk)
      }
      existing.delete(v.id)
    })
    existing.forEach(id=>{vehicleMarkers.current.get(id)?.remove();vehicleMarkers.current.delete(id)})
  },[activeVehicles])

  const applyRegion=useCallback((r:string)=>{
    setRegion(r);setRegionMenuOpen(false)
    const b=REGIONS[r]?.bounds;if(b&&map.current)map.current.fitBounds(b,{animate:true,duration:600})
  },[])

  const showToast=useCallback((msg:string)=>{
    setToast({msg,show:true});setTimeout(()=>setToast(t=>({...t,show:false})),7000)
  },[])

  const fetchAI=useCallback(async()=>{
    setAiLoading(true);setAiText('')
    const highRisk=corridors.filter(c=>c.risk==='critical'||c.risk==='high').length
    const cmd=`You are SONALIT AI. Provide a 3-sentence situation assessment: Region: ${REGIONS[region]?.name||region}, Threat index: ${kpi.threat}/100, Active assets: ${kpi.assets}, High-risk corridors: ${highRisk}/${corridors.length}, Anomalies: ${kpi.anomalies}. Include risk outlook (improving/stable/deteriorating). Under 100 words, authoritative.`
    try{
      const r=await api.post('/ai/dispatch',{command:cmd,history:[]})
      setAiText(r.data?.response||'')
    }catch{setAiText(`${highRisk>2?'⚠':'●'} ${highRisk} high-risk corridors active. Threat index ${kpi.threat}/100 · ${kpi.anomalies} anomalies. ${highRisk>2?'Activate contingency routing immediately.':'Standard monitoring in effect.'}`)}
    setAiLoading(false)
  },[corridors,region,kpi])

  const cmdVehicle=useCallback((action:string)=>{
    if(!selVehicle)return
    const msgs={prioritise:`${selVehicle.registration} priority routing activated`,hold:`${selVehicle.registration} hold position issued`,recall:`${selVehicle.registration} recalled to base`,divert:`${selVehicle.registration} diverted to alternate route`}
    showToast(msgs[action as keyof typeof msgs]||'Command sent')
  },[selVehicle,showToast])

  const runConsoleCmd=useCallback((raw:string)=>{
    const addLine=(t:string,c:string)=>setConsoleLines(l=>[...l.slice(-29),{t,c}])
    addLine('> '+raw,'info')
    const cmd=raw.toLowerCase().trim()
    if(cmd==='help'){['help — show commands','status — situation report','region <name> — switch region','asset count — count active assets','ai refresh — refresh assessment','clear — clear console'].forEach(l=>addLine(l,'info'))}
    else if(cmd==='status')addLine(`REGION: ${REGIONS[region]?.name} | THREAT: ${kpi.threat}/100 | ASSETS: ${kpi.assets} | ANOMALIES: ${kpi.anomalies}`,'ok')
    else if(cmd.startsWith('region ')){const r=cmd.split(' ')[1]??'';if(r&&REGIONS[r]){applyRegion(r);addLine('Region: '+REGIONS[r]!.name,'ok')}else addLine('Unknown region','err')}
    else if(cmd==='asset count')addLine(`Total: ${kpi.assets} | Offline: ${vehicles.filter(v=>v.status==='offline').length}`,'ok')
    else if(cmd==='ai refresh'){void fetchAI();addLine('AI refresh triggered','ok')}
    else if(cmd==='clear')setConsoleLines([])
    else addLine('Unknown command. Type "help".','err')
  },[region,kpi,vehicles,applyRegion,fetchAI])

  const finishDraw=useCallback(()=>{
    if(drawPoints.length>=2){
      const id='custom-'+Date.now()
      const name=`CUSTOM-${drawMode?.toUpperCase()}-${id.slice(-4)}`
      setCustomZones(z=>[...z,{id,name,risk:'medium'}])
      showToast(`Custom zone created: ${name}`)
    }
    setDrawMode(null);setDrawPoints([])
  },[drawMode,drawPoints,showToast])

  const searchResults=useMemo(()=>{
    if(search.length<2)return[]
    const q=search.toLowerCase()
    const hits:Array<{type:string;label:string;sub:string}>=[]
    vehicles.filter(v=>v.registration.toLowerCase().includes(q)).slice(0,4).forEach(v=>hits.push({type:'asset',label:v.registration,sub:v.status||''}))
    corridors.filter(c=>c.name.toLowerCase().includes(q)).slice(0,4).forEach(c=>hits.push({type:'corridor',label:c.name,sub:c.risk.toUpperCase()}))
    geofences.filter(g=>g.name.toLowerCase().includes(q)).slice(0,3).forEach(g=>hits.push({type:'zone',label:g.name,sub:g.type}))
    return hits
  },[search,vehicles,corridors,geofences])

  // CSS vars via style tag injected once
  const css=`*,*::before,*::after{box-sizing:border-box}:root{--void:#010508;--surf:#050f18;--raised:#081522;--cyan:#00c8ff;--green:#00e896;--amber:#f5a820;--red:#f02855;--text:#d8eeff;--sub:#6a8fae;--muted:#2e4d66}#gic-wrap{font-family:'Space Grotesk',sans-serif}.gic-scroll::-webkit-scrollbar{width:3px}.gic-scroll::-webkit-scrollbar-thumb{background:${GHOST};border-radius:3px}@keyframes livepulse{0%{box-shadow:0 0 0 0 rgba(0,232,150,.5)}60%{box-shadow:0 0 0 7px rgba(0,232,150,0)}100%{box-shadow:0 0 0 0 rgba(0,232,150,0)}}@keyframes bootalpha{from{opacity:0}to{opacity:1}}.maplibregl-ctrl-group{background:${OVERLAY}!important;border:1px solid ${BD}!important;border-radius:4px!important}.maplibregl-ctrl-group button{color:${SUB}!important}.maplibregl-popup-content{background:${OVERLAY}!important;border:1px solid ${BD}!important;border-radius:8px!important;color:${TEXT}!important;font-size:11px!important;font-family:'JetBrains Mono',monospace!important;line-height:1.8!important}.maplibregl-popup-tip{border-top-color:${OVERLAY}!important}`

  const S=(obj:React.CSSProperties)=>obj

  if(booting)return(
    <div style={S({position:'fixed',inset:0,zIndex:9999,background:V,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:20})}>
      <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:32,fontWeight:700,letterSpacing:'0.32em',color:TEXT,textShadow:`0 0 40px rgba(0,200,255,0.4)`})}>SONALIT</div>
      <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:'0.2em',color:MUTED,textTransform:'uppercase'})}>Global Intelligence Command · Initialising</div>
      <div style={S({width:260,height:2,background:'#081522',borderRadius:2,overflow:'hidden'})}>
        <div style={S({height:'100%',width:bootPct+'%',background:`linear-gradient(90deg,${CYAN},${VIO})`,transition:'width 0.12s linear'})}/>
      </div>
    </div>
  )

  const drawer=(side:'left'|'right',open:boolean,title:string,close:()=>void,children:React.ReactNode)=>(
    <div style={S({position:'absolute',top:0,height:'100%',width:360,[side]:0,background:OVERLAY,backdropFilter:'blur(32px)',zIndex:700,borderRight:side==='left'?`1px solid ${BD}`:'none',borderLeft:side==='right'?`1px solid ${BD}`:'none',transform:open?'none':side==='left'?'translateX(-100%)':'translateX(100%)',transition:'transform .3s cubic-bezier(0.4,0,0.2,1)',display:'flex',flexDirection:'column',overflow:'hidden'})}>
      <div style={S({flexShrink:0,padding:'14px 16px 12px',borderBottom:`1px solid rgba(0,200,255,0.07)`,display:'flex',alignItems:'center',justifyContent:'space-between'})}>
        <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,fontWeight:600,letterSpacing:'0.18em',textTransform:'uppercase',color:CYAN,display:'flex',alignItems:'center',gap:8})}>
          <div style={S({width:6,height:6,borderRadius:'50%',background:CYAN,boxShadow:`0 0 10px ${CYAN}`})}/>
          {title}
        </div>
        <button onClick={close} style={S({width:22,height:22,background:RAISED,border:`1px solid ${BD}`,borderRadius:4,color:MUTED,cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'})}>×</button>
      </div>
      <div className="gic-scroll" style={S({flex:1,overflowY:'auto',padding:'10px 12px'})}>{children}</div>
    </div>
  )

  const secH=(label:string,badge?:number|string)=>(
    <div style={S({display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 2px 6px',fontFamily:"'JetBrains Mono',monospace",fontSize:8,fontWeight:600,letterSpacing:'0.16em',textTransform:'uppercase',color:MUTED,borderBottom:`1px solid ${BD}`,marginBottom:8})}>
      <span>{label}</span>
      {badge!=null&&<span style={S({background:RAISED,border:`1px solid ${BD}`,borderRadius:10,padding:'1px 7px',fontSize:8})}>{badge}</span>}
    </div>
  )

  const threatSevColor=(s:string)=>s==='critical'?RED:s==='high'?ORG:AMB

  return(
    <div id="gic-wrap" style={S({display:'flex',flexDirection:'column',height:'calc(100vh - 56px)',background:V,color:TEXT,overflow:'hidden'})}>
      <style>{css}</style>

      {/* Topbar */}
      <header style={S({flexShrink:0,height:56,display:'flex',alignItems:'stretch',background:'linear-gradient(180deg,rgba(5,14,22,.99),rgba(3,10,18,.97))',borderBottom:`1px solid rgba(0,200,255,0.07)`,position:'relative',zIndex:1100})}>
        {/* Brand */}
        <div style={S({display:'flex',alignItems:'center',gap:10,padding:'0 18px',borderRight:`1px solid ${BD}`,flexShrink:0})}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="15" stroke="rgba(0,200,255,0.2)" strokeWidth="1"/>
            <circle cx="16" cy="16" r="15" stroke="rgba(0,200,255,0.4)" strokeWidth="1" strokeDasharray="4 8"><animateTransform attributeName="transform" type="rotate" from="0 16 16" to="360 16 16" dur="10s" repeatCount="indefinite"/></circle>
            <polygon points="16,9 23,16 16,23 9,16" fill="none" stroke="rgba(0,200,255,0.3)" strokeWidth="1"/>
            <circle cx="16" cy="16" r="3.5" fill="rgba(0,200,255,0.9)"><animate attributeName="r" values="3;4;3" dur="2.2s" repeatCount="indefinite"/></circle>
          </svg>
          <div><div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,letterSpacing:'0.28em'})}>SONALIT</div><div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:7,letterSpacing:'0.18em',color:MUTED,textTransform:'uppercase'})}>Global Intelligence Command</div></div>
        </div>
        {/* KPIs */}
        {[{l:'Threat Index',v:kpi.threat,c:kpi.threat>70?RED:kpi.threat>40?AMB:CYAN,s:'/100'},{l:'Active Assets',v:kpi.assets,c:CYAN,s:'tracking'},{l:'Geofences',v:kpi.geofences,c:GRN,s:'zones'},{l:'Anomalies',v:kpi.anomalies,c:kpi.anomalies>10?RED:AMB,s:'detected'}].map(({l,v,c,s})=>(
          <div key={l} style={S({display:'flex',flexDirection:'column',justifyContent:'center',padding:'0 16px',borderRight:`1px solid ${BD}`,minWidth:82})}>
            <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:7,letterSpacing:'0.14em',textTransform:'uppercase',color:MUTED})}>{l}</div>
            <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:700,lineHeight:1,color:c,textShadow:`0 0 20px ${c}55`})}>{v}</div>
            <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:MUTED})}>{s}</div>
          </div>
        ))}
        {/* Center controls */}
        <div style={S({flex:1,display:'flex',alignItems:'center',gap:8,padding:'0 12px'})}>
          {/* Search */}
          <div style={S({position:'relative',maxWidth:260,flex:1})}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search assets, corridors, zones…" style={S({width:'100%',height:28,background:'rgba(255,255,255,.02)',border:`1px solid ${BD}`,borderRadius:4,color:TEXT,fontSize:10,padding:'0 10px',outline:'none',fontFamily:"'JetBrains Mono',monospace"})}/>
            {searchResults.length>0&&search.length>=2&&(
              <div style={S({position:'absolute',top:'calc(100%+4px)',left:0,right:0,background:OVERLAY,border:`1px solid ${BD}`,borderRadius:6,zIndex:2000,overflow:'hidden'})}>
                {searchResults.map((h,i)=>(
                  <div key={i} onClick={()=>{const v=vehicles.find(x=>x.registration===h.label);if(v){setSelVehicle(v);setSearch('');setRightOpen(true)}else setSearch('')}} style={S({padding:'7px 12px',cursor:'pointer',display:'flex',alignItems:'center',gap:8,fontSize:11})}>
                    <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:MUTED,width:50,textTransform:'uppercase'})}>{h.type}</span>
                    <span>{h.label}</span>
                    <span style={S({marginLeft:'auto',fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:MUTED})}>{h.sub}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Region */}
          <div style={S({position:'relative'})}>
            <button onClick={()=>setRegionMenuOpen(o=>!o)} style={S({display:'flex',alignItems:'center',gap:6,height:28,padding:'0 10px',borderRadius:4,background:'rgba(255,255,255,.02)',border:`1px solid ${BD}`,color:SUB,fontFamily:"'JetBrains Mono',monospace",fontSize:9,textTransform:'uppercase',letterSpacing:'0.08em',cursor:'pointer'})}>
              {REGIONS[region]?.name??region} <span style={{fontSize:8,opacity:.5}}>▼</span>
            </button>
            {regionMenuOpen&&(
              <div style={S({position:'absolute',top:'calc(100%+6px)',left:0,zIndex:1300,background:OVERLAY,border:`1px solid ${BD}`,borderRadius:8,padding:4,minWidth:160})}>
                {Object.entries(REGIONS).map(([k,{name}])=>(
                  <div key={k} onClick={()=>applyRegion(k)} style={S({padding:'7px 12px',borderRadius:4,color:k===region?CYAN:SUB,background:k===region?'rgba(0,200,255,0.07)':'transparent',fontFamily:"'JetBrains Mono',monospace",fontSize:9,textTransform:'uppercase',letterSpacing:'0.08em',cursor:'pointer'})}>
                    {name}{k===region&&<span style={{float:'right',fontSize:6}}>●</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Layer toggles */}
          <div style={S({display:'flex',gap:2,padding:2,background:'rgba(255,255,255,.015)',border:`1px solid ${BD}`,borderRadius:8})}>
            {([['corridors','Corridors'],['heatmap','Heatmap'],['threats','Threats'],['weather','Weather']] as [keyof typeof layers,string][]).map(([k,l])=>(
              <button key={k} onClick={()=>setLayers(ls=>({...ls,[k]:!ls[k]}))} style={S({height:24,padding:'0 9px',borderRadius:4,fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:'0.06em',textTransform:'uppercase',color:layers[k]?CYAN:MUTED,background:layers[k]?'rgba(0,200,255,0.07)':'transparent',cursor:'pointer',display:'flex',alignItems:'center',gap:4})}>
                <div style={S({width:5,height:5,borderRadius:'50%',background:'currentColor'})}/>
                {l}
              </button>
            ))}
          </div>
        </div>
        {/* Right actions */}
        <div style={S({display:'flex',alignItems:'stretch',borderLeft:`1px solid ${BD}`,flexShrink:0})}>
          {([['⊞','Dashboard',()=>setDashOpen(true)],['⏮','Time Machine',()=>setTmOpen((o:boolean)=>!o)],['⌨','Console',()=>setConsoleOpen((o:boolean)=>!o)]] as [string,string,()=>void][]).map(([ico,lbl,fn])=>(
            <button key={lbl} onClick={fn} style={S({display:'flex',alignItems:'center',gap:5,height:'100%',padding:'0 12px',borderRight:`1px solid ${BD}`,fontFamily:"'JetBrains Mono',monospace",fontSize:9,textTransform:'uppercase',letterSpacing:'0.08em',color:MUTED,cursor:'pointer'})}>
              {ico} {lbl}
            </button>
          ))}
          <div style={S({display:'flex',alignItems:'center',gap:8,padding:'0 16px'})}>
            <div style={S({width:6,height:6,borderRadius:'50%',background:GRN,animation:'livepulse 2s ease infinite'})}/>
            <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:'0.12em',color:GRN})}>LIVE</span>
            <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:SUB,minWidth:80})}>{utcClock}</span>
          </div>
        </div>
      </header>

      {/* Map zone */}
      <div style={S({flex:1,position:'relative',overflow:'hidden'})}>
        <div ref={mapEl} style={S({position:'absolute',inset:0,background:V})}/>

        {/* Drawer tabs */}
        {[{side:'left',open:leftOpen,fn:()=>setLeftOpen(o=>!o),lbl:'Threats'},{side:'right',open:rightOpen,fn:()=>setRightOpen(o=>!o),lbl:'Mission'}].map(({side,open,fn,lbl})=>(
          !open&&<div key={side} onClick={fn} style={S({position:'absolute',top:'50%',transform:'translateY(-50%)',zIndex:800,[side]:0,cursor:'pointer'})}>
            <div style={S({background:OVERLAY,border:`1px solid ${BD}`,borderRadius:side==='left'?'0 6px 6px 0':'6px 0 0 6px',[side==='left'?'borderLeft':'borderRight']:'none',padding:'20px 0',writingMode:'vertical-rl',fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:'0.16em',textTransform:'uppercase',color:MUTED,userSelect:'none'})}>
              {lbl}
            </div>
          </div>
        ))}

        {/* Left drawer: Threat Register */}
        {drawer('left',leftOpen,'Threat Register',()=>setLeftOpen(false),(
          <>
            {secH('Active Threats',threats.length)}
            {threats.length===0&&<div style={S({fontSize:10,color:MUTED,padding:'8px',textAlign:'center'})}>No active threats</div>}
            {threats.slice(0,12).map(t=>(
              <div key={t.id} style={S({display:'flex',alignItems:'flex-start',gap:10,padding:'9px 10px',borderRadius:4,background:RAISED,border:`1px solid ${BD}`,marginBottom:5,cursor:'pointer'})}>
                <div style={S({flexShrink:0,width:3,alignSelf:'stretch',borderRadius:2,background:threatSevColor(t.sev),boxShadow:t.sev==='critical'?`0 0 10px ${RED}`:'none'})}/>
                <div style={S({flex:1,minWidth:0})}>
                  <div style={S({fontSize:11,fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'})}>{t.title}</div>
                  <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:MUTED,marginTop:2})}>{t.time} · {t.sev.toUpperCase()}</div>
                </div>
                <button onClick={()=>showToast(`Advisory issued for: ${t.title}`)} style={S({flexShrink:0,height:22,padding:'0 8px',borderRadius:4,background:'rgba(0,200,255,0.07)',border:`1px solid ${BDACC}`,color:CYAN,fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer'})}>Manage</button>
              </div>
            ))}
            {secH('Geofence Registry',geofences.length+customZones.length)}
            {[...geofences.map(g=>({name:g.name,type:g.type||'zone',risk:'medium',id:g.id})),...customZones.map(z=>({name:z.name,type:'custom',risk:z.risk,id:z.id}))].map(g=>(
              <div key={g.id} onClick={()=>{const c=corridors.find(x=>x.id===g.id);if(c){setSelCorridorId(g.id);setCorridorPanelOpen(true)}}} style={S({display:'flex',alignItems:'center',padding:'7px 10px',borderRadius:4,background:RAISED,border:`1px solid ${BD}`,marginBottom:4,cursor:'pointer'})}>
                <span style={S({flex:1,fontSize:11,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{g.name}</span>
                <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:MUTED,margin:'0 8px'})}>{g.type}</span>
                <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,fontWeight:600,padding:'2px 8px',borderRadius:10,color:RC[g.risk]||AMB,background:(RC[g.risk]||AMB)+'18',border:`1px solid ${(RC[g.risk]||AMB)}33`})}>{g.risk.toUpperCase()}</span>
              </div>
            ))}
            {secH('Draw Tools')}
            <p style={S({fontSize:10,color:MUTED,marginBottom:8,lineHeight:1.6})}>Click map points to draw a custom zone.</p>
            <div style={S({display:'flex',gap:6,flexWrap:'wrap',marginBottom:8})}>
              {['polyline','polygon','circle'].map(dt=>(
                <button key={dt} onClick={()=>setDrawMode(dm=>dm===dt?null:dt)} style={S({height:28,padding:'0 12px',borderRadius:4,background:drawMode===dt?'rgba(0,200,255,0.07)':RAISED,border:`1px solid ${drawMode===dt?BDACC:BD}`,color:drawMode===dt?CYAN:MUTED,fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer'})}>{dt}</button>
              ))}
            </div>
            {drawMode&&<div style={S({fontSize:10,color:CYAN,marginBottom:6})}>{drawPoints.length} points — <button onClick={finishDraw} style={S({background:CYAN,color:V,border:'none',borderRadius:3,padding:'2px 8px',fontSize:9,cursor:'pointer',fontFamily:"'JetBrains Mono',monospace"})}>Save Zone</button></div>}
            {customZones.length>0&&<button onClick={()=>{setCustomZones([]);showToast('Custom zones cleared')}} style={S({height:24,padding:'0 10px',borderRadius:4,background:'rgba(240,40,85,.06)',border:`1px solid rgba(240,40,85,.2)`,color:RED,fontFamily:"'JetBrains Mono',monospace",fontSize:9,textTransform:'uppercase',cursor:'pointer'})}>Clear All Custom</button>}
          </>
        ))}

        {/* Right drawer: Mission Control */}
        {drawer('right',rightOpen,'Mission Control',()=>setRightOpen(false),(
          <>
            {selVehicle?(
              <div style={S({background:RAISED,border:`1px solid ${BD}`,borderRadius:8,overflow:'hidden',marginBottom:12})}>
                <div style={S({padding:'12px 14px',background:'rgba(0,200,255,.04)',borderBottom:`1px solid rgba(0,200,255,.07)`,display:'flex',justifyContent:'space-between',alignItems:'flex-start'})}>
                  <div><div style={S({fontSize:13,fontWeight:600,marginBottom:2})}>{selVehicle.registration}</div><div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:MUTED})}>{selVehicle.type} · {selVehicle.status?.toUpperCase()}</div></div>
                  <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,fontWeight:600,padding:'2px 8px',borderRadius:10,color:selVehicle.status==='active'?GRN:selVehicle.status==='offline'?MUTED:AMB,background:selVehicle.status==='active'?GRN+'18':RAISED,border:`1px solid ${selVehicle.status==='active'?GRN+'28':BD}`})}>{selVehicle.status?.toUpperCase()}</span>
                </div>
                <div style={S({padding:'10px 14px',display:'flex',flexDirection:'column',gap:7})}>
                  {[[`Speed`,selVehicle.speed!=null?Math.round(selVehicle.speed)+' km/h':'—'],[`Fuel`,selVehicle.fuel_level!=null?Math.round(selVehicle.fuel_level)+'%':'—'],[`Driver`,selVehicle.driver_name||'—'],[`Region`,selVehicle.region||'—']].map(([l,v])=>(
                    <div key={l} style={S({display:'flex',justifyContent:'space-between',fontFamily:"'JetBrains Mono',monospace",fontSize:10})}><span style={{color:MUTED}}>{l}</span><span style={{fontWeight:500}}>{v}</span></div>
                  ))}
                </div>
                <div style={S({display:'flex',gap:6,padding:'10px 14px',borderTop:`1px solid rgba(0,200,255,.07)`})}>
                  {([['Priority','primary',()=>cmdVehicle('prioritise')],['Hold','secondary',()=>cmdVehicle('hold')],['Recall','secondary',()=>cmdVehicle('recall')],['Divert','danger',()=>cmdVehicle('divert')]] as [string,string,()=>void][]).map(([l,cls,fn])=>(
                    <button key={l} onClick={fn} style={S({flex:1,height:28,borderRadius:4,fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:'0.06em',textTransform:'uppercase',fontWeight:600,cursor:'pointer',background:cls==='primary'?CYAN:cls==='danger'?'rgba(240,40,85,.08)':SURF,border:cls==='danger'?`1px solid rgba(240,40,85,.28)`:cls==='secondary'?`1px solid ${BD}`:'none',color:cls==='primary'?V:cls==='danger'?RED:SUB})}>{l}</button>
                  ))}
                </div>
              </div>
            ):(
              <div style={S({fontSize:11,color:MUTED,padding:12,background:RAISED,border:`1px solid ${BD}`,borderRadius:4,lineHeight:1.7,marginBottom:10})}>
                Select an asset marker on the map or from the list below to access mission controls and issue commands.
              </div>
            )}
            {secH('Active Assets',activeVehicles.length)}
            <div className="gic-scroll" style={S({maxHeight:180,overflowY:'auto'})}>
              {[...vehicles].sort((a,b)=>{const o={offline:0,maintenance:1,active:2};return(o[a.status as keyof typeof o]??3)-(o[b.status as keyof typeof o]??3)}).slice(0,20).map(v=>{
                const col=v.status==='offline'?MUTED:v.status==='maintenance'?ORG:v.fuel_level!=null&&v.fuel_level<25?RED:GRN
                return(
                  <div key={v.id} onClick={()=>{setSelVehicle(v);if(v.latitude&&v.longitude&&map.current)map.current.flyTo({center:[v.longitude,v.latitude],zoom:12,duration:800})}} style={S({display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:4,background:selVehicle?.id===v.id?'rgba(0,200,255,.07)':RAISED,border:`1px solid ${selVehicle?.id===v.id?BDACC:BD}`,marginBottom:4,cursor:'pointer'})}>
                    <div style={S({width:24,height:24,borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center',background:`${col}18`,fontSize:12})}>{v.type==='truck'?'🚛':v.type==='van'?'🚐':v.type==='car'?'🚗':'🚚'}</div>
                    <span style={S({flex:1,fontSize:10,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{v.registration}</span>
                    <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:col})}>{v.status!=='active'?'⚠ '+v.status:v.region||''}</span>
                  </div>
                )
              })}
            </div>
            {secH('Predictive Intelligence')}
            {PREDICTIONS.map(p=>{
              const col=p.prob>80?RED:p.prob>65?AMB:GRN
              return(
                <div key={p.title} title={p.detail} style={S({display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:4,background:RAISED,border:`1px solid ${BD}`,marginBottom:5})}>
                  <span style={S({fontSize:10,fontWeight:500,minWidth:120})}>{p.title}</span>
                  <div style={S({flex:1,height:3,background:V,borderRadius:2,overflow:'hidden'})}><div style={S({height:'100%',width:p.prob+'%',background:col,borderRadius:2,transition:'width .8s'})}/></div>
                  <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:MUTED,width:28,textAlign:'right'})}>{p.prob}%</span>
                  <span style={S({fontSize:8,color:p.trend==='up'?RED:p.trend==='down'?GRN:MUTED})}>{p.trend==='up'?'▲':p.trend==='down'?'▼':'→'}</span>
                </div>
              )
            })}
            {secH('AI Situation Assessment',<span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:VIO,letterSpacing:'0.08em'}}>CLAUDE AI</span> as unknown as string)}
            {aiLoading&&<div style={S({display:'flex',alignItems:'center',gap:8,color:MUTED,fontSize:10,padding:'8px 0'})}><span>Analysing…</span></div>}
            {!aiLoading&&aiText&&<div style={S({background:`linear-gradient(135deg,rgba(0,200,255,.04),rgba(123,95,255,.04))`,border:`1px solid rgba(0,200,255,.12)`,borderRadius:8,padding:12,fontSize:11,lineHeight:1.7,color:SUB})}>{aiText}<br/><button onClick={fetchAI} style={S({marginTop:8,height:26,padding:'0 12px',borderRadius:4,background:CYAN,color:V,fontFamily:"'JetBrains Mono',monospace",fontSize:9,fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer',border:'none'})}>↻ Refresh</button></div>}
            {!aiLoading&&!aiText&&<button onClick={fetchAI} style={S({width:'100%',padding:'8px 0',borderRadius:4,background:'rgba(0,200,255,.07)',border:`1px solid ${BDACC}`,color:CYAN,fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer'})}>Run AI Assessment</button>}
          </>
        ))}

        {/* Situation pod */}
        <div style={S({position:'absolute',bottom:16,right:16,zIndex:600,background:OVERLAY,backdropFilter:'blur(20px)',border:`1px solid ${BD}`,borderRadius:8,minWidth:230,overflow:'hidden'})}>
          <div style={S({padding:'6px 12px',background:'rgba(0,200,255,.04)',borderBottom:`1px solid rgba(0,200,255,.07)`,fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:MUTED,display:'flex',justifyContent:'space-between',alignItems:'center'})}>
            Situation Overview
            <span style={S({fontSize:8,padding:'2px 7px',borderRadius:10,fontWeight:600,color:threats.filter(t=>t.sev==='critical').length>0?RED:AMB,background:threats.filter(t=>t.sev==='critical').length>0?RED+'18':AMB+'18',border:`1px solid ${threats.filter(t=>t.sev==='critical').length>0?RED:AMB}33`})}>{threats.filter(t=>t.sev==='critical').length>0?'CRITICAL':threats.filter(t=>t.sev==='high').length>0?'HIGH':'ELEVATED'}</span>
          </div>
          <div style={S({display:'grid',gridTemplateColumns:'1fr 1fr 1fr'})}>
            {[['Top Threat',threats[0]?.title?.slice(0,18)||'—',TEXT],['Severity',(threats[0]?.sev||'—').toUpperCase(),threats[0]?threatSevColor(threats[0].sev):MUTED],['Confidence','92%',GRN]].map(([l,v,c])=>(
              <div key={l} style={S({padding:'9px 11px',borderRight:`1px solid rgba(0,200,255,.07)`,display:'flex',flexDirection:'column',gap:3})}>
                <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:7,letterSpacing:'0.1em',textTransform:'uppercase',color:MUTED})}>{l}</span>
                <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:c as string})}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Compass */}
        <div style={S({position:'absolute',bottom:16,left:16,zIndex:600,width:52,height:52,background:OVERLAY,border:`1px solid ${BD}`,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(16px)'})}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="16" stroke="rgba(0,200,255,0.2)" strokeWidth="1"/><polygon points="18,4 21,18 18,22 15,18" fill="rgba(240,40,85,0.8)"/><polygon points="18,32 21,18 18,14 15,18" fill="rgba(100,140,160,0.5)"/><circle cx="18" cy="18" r="2" fill="rgba(0,200,255,0.9)"/></svg>
        </div>

        {/* Alert toast */}
        <div style={S({position:'absolute',top:16,right:16,zIndex:2000,background:'rgba(6,2,5,.97)',border:`1px solid rgba(240,40,85,.35)`,borderLeft:`3px solid ${RED}`,borderRadius:8,padding:'12px 16px',maxWidth:320,backdropFilter:'blur(24px)',opacity:toast.show?1:0,transform:toast.show?'none':'translateX(24px)',pointerEvents:toast.show?'auto':'none',transition:'opacity .25s,transform .25s'})}>
          <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,fontWeight:700,letterSpacing:'0.14em',textTransform:'uppercase',color:RED,marginBottom:5})}>Command Alert</div>
          <div style={S({fontSize:11,color:SUB,lineHeight:1.5})}>{toast.msg}</div>
          <span onClick={()=>setToast(t=>({...t,show:false}))} style={S({position:'absolute',top:8,right:8,fontSize:14,color:MUTED,cursor:'pointer'})}>×</span>
        </div>

        {/* Corridor detail panel */}
        <div style={S({position:'absolute',right:0,top:0,height:'100%',width:360,background:OVERLAY,backdropFilter:'blur(32px)',borderLeft:`1px solid ${BD}`,zIndex:750,transform:corridorPanelOpen?'none':'translateX(100%)',transition:'transform .3s cubic-bezier(0.4,0,0.2,1)',display:'flex',flexDirection:'column'})}>
          {selCorr&&<>
            <div style={S({flexShrink:0,padding:'14px 16px 12px',borderBottom:`1px solid rgba(0,200,255,.07)`,display:'flex',alignItems:'center',justifyContent:'space-between'})}>
              <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,fontWeight:600,letterSpacing:'0.18em',textTransform:'uppercase',color:CYAN})}>{selCorr.name}</div>
              <button onClick={()=>setCorridorPanelOpen(false)} style={S({background:RAISED,border:`1px solid ${BD}`,borderRadius:4,color:MUTED,cursor:'pointer',width:22,height:22,fontSize:14})}>×</button>
            </div>
            <div className="gic-scroll" style={S({flex:1,overflowY:'auto',padding:'12px 14px'})}>
              <div style={S({display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10})}>
                <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,fontWeight:600,padding:'2px 8px',borderRadius:10,color:RC[selCorr.risk],background:RC[selCorr.risk]+'18',border:`1px solid ${RC[selCorr.risk]}33`})}>{selCorr.risk.toUpperCase()}</span>
                <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:MUTED})}>{new Date().toUTCString().slice(0,16)}</span>
              </div>
              <div style={S({display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:12})}>
                {[['Health',selCorr.health+'%',selCorr.health>60?GRN:selCorr.health>35?AMB:RED],['Segments',selCorr.segs.length,TEXT],['Severe',selCorr.segs.filter((s:string)=>s==='severe'||s==='heavy').length,RED],['Assets',activeVehicles.filter(v=>v.region===selCorr.region).length,CYAN]].map(([l,v,c])=>(
                  <div key={l} style={S({background:SURF,border:`1px solid ${BD}`,borderRadius:4,padding:'10px'})}>
                    <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:7,letterSpacing:'0.12em',textTransform:'uppercase',color:MUTED,marginBottom:4})}>{l}</div>
                    <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:700,color:c as string})}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={S({marginBottom:12})}>
                <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:MUTED,marginBottom:6})}>Segment Traffic</div>
                <div style={S({display:'flex',gap:2,height:40,alignItems:'flex-end'})}>
                  {selCorr.segs.map((t:string,i:number)=>{
                    const h={free:20,light:40,moderate:60,heavy:80,severe:100}[t]||50
                    return<div key={i} style={S({flex:1,background:TC[t]+'55',border:`1px solid ${TC[t]}`,borderRadius:2,height:h+'%',minWidth:4})}/>
                  })}
                </div>
              </div>
              <div style={S({display:'flex',gap:6})}>
                {([['Escalate','primary',()=>{showToast(`ESCALATED: ${selCorr.name}`)}],['Reroute','secondary',()=>showToast(`Traffic rerouted from ${selCorr.name}`)],['Close','danger',()=>{showToast(`CLOSURE: ${selCorr.name} closed`)}]] as [string,string,()=>void][]).map(([l,cls,fn])=>(
                  <button key={l} onClick={fn} style={S({flex:1,height:28,borderRadius:4,fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:'0.06em',textTransform:'uppercase',fontWeight:600,cursor:'pointer',background:cls==='primary'?CYAN:cls==='danger'?'rgba(240,40,85,.08)':SURF,border:cls==='danger'?`1px solid rgba(240,40,85,.28)`:cls==='secondary'?`1px solid ${BD}`:'none',color:cls==='primary'?V:cls==='danger'?RED:SUB})}>{l}</button>
                ))}
              </div>
            </div>
          </>}
        </div>

        {/* Time machine */}
        {tmOpen&&<div style={S({position:'absolute',bottom:80,left:72,zIndex:600,background:OVERLAY,backdropFilter:'blur(20px)',border:`1px solid ${BD}`,borderRadius:8,padding:'14px 18px',width:280})}>
          <div style={S({display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10})}>
            <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:CYAN})}>⏮ Time Machine</span>
            <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:11,fontWeight:600})}>{tmOffset===0?'Now':`−${tmOffset}h`}</span>
          </div>
          <input type="range" min={0} max={24} value={tmOffset} onChange={e=>setTmOffset(+e.target.value)} style={{width:'100%',marginBottom:10,accentColor:CYAN}}/>
          <div style={S({display:'flex',justifyContent:'space-between',alignItems:'center'})}>
            <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:MUTED})}>{tmOffset===0?'Drag to replay history':`State from ${tmOffset}h ago`}</span>
            <button onClick={()=>setTmOffset(0)} style={S({height:24,padding:'0 10px',borderRadius:4,background:RAISED,border:`1px solid ${BD}`,color:SUB,fontFamily:"'JetBrains Mono',monospace",fontSize:9,textTransform:'uppercase',cursor:'pointer'})}>↩ Live</button>
          </div>
        </div>}

        {/* Command console */}
        {consoleOpen&&<div style={S({position:'absolute',bottom:80,left:'50%',transform:'translateX(-50%)',zIndex:2100,width:460,background:'rgba(1,4,7,.98)',border:`1px solid ${BDACC}`,borderRadius:8,overflow:'hidden'})}>
          <div style={S({padding:'6px 14px',background:'rgba(0,200,255,.07)',borderBottom:`1px solid ${BDACC}`,fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:'0.12em',textTransform:'uppercase',color:CYAN,display:'flex',justifyContent:'space-between',alignItems:'center'})}>
            <span>Command Console · Enter to execute · Esc to close</span>
            <span style={{color:MUTED}}>type "help" for commands</span>
          </div>
          <div className="gic-scroll" style={S({maxHeight:100,overflowY:'auto',padding:'6px 14px',fontFamily:"'JetBrains Mono',monospace",fontSize:10})}>
            {consoleLines.map((l,i)=><div key={i} style={S({padding:'2px 0',borderBottom:`1px solid rgba(0,200,255,.05)`,color:l.c==='ok'?GRN:l.c==='err'?RED:SUB})}>{l.t}</div>)}
          </div>
          <input autoFocus value={consoleInput} onChange={e=>setConsoleInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&consoleInput.trim()){runConsoleCmd(consoleInput.trim());setConsoleInput('')}if(e.key==='Escape')setConsoleOpen(false)}} placeholder="> _" style={S({width:'100%',padding:'10px 14px',background:'transparent',border:'none',outline:'none',color:CYAN,fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:500,borderTop:`1px solid rgba(0,200,255,.07)`})}/>
        </div>}

        {/* Draw mode indicator */}
        {drawMode&&<div style={S({position:'absolute',top:12,left:'50%',transform:'translateX(-50%)',zIndex:900,background:OVERLAY,border:`1px solid ${BDACC}`,borderRadius:6,padding:'6px 14px',fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:CYAN,backdropFilter:'blur(8px)',display:'flex',alignItems:'center',gap:10})}>
          Drawing: {drawMode.toUpperCase()} · {drawPoints.length} points
          <button onClick={finishDraw} style={S({background:CYAN,color:V,border:'none',borderRadius:3,padding:'2px 8px',fontSize:9,cursor:'pointer'})}>Finish</button>
          <button onClick={()=>{setDrawMode(null);setDrawPoints([])}} style={S({background:'none',border:`1px solid ${BD}`,borderRadius:3,padding:'2px 8px',fontSize:9,cursor:'pointer',color:MUTED})}>Cancel</button>
        </div>}
      </div>

      {/* Timeline footer */}
      <footer style={S({flexShrink:0,height:52,display:'flex',alignItems:'stretch',background:SURF,borderTop:`1px solid rgba(0,200,255,.07)`,zIndex:600})}>
        <div style={S({flexShrink:0,display:'flex',alignItems:'center',gap:3,padding:'0 12px',borderRight:`1px solid ${BD}`})}>
          {(['all','critical','high','medium'] as const).map(f=>(
            <button key={f} onClick={()=>setTlFilter(f)} style={S({height:20,padding:'0 9px',borderRadius:10,fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:'0.06em',textTransform:'uppercase',color:tlFilter===f?CYAN:MUTED,border:`1px solid ${tlFilter===f?BDACC:'transparent'}`,background:tlFilter===f?'rgba(0,200,255,.07)':'transparent',cursor:'pointer'})}>{f}</button>
          ))}
        </div>
        <div className="gic-scroll" style={S({flex:1,overflowX:'auto',display:'flex',alignItems:'center',gap:6,padding:'0 12px',overflowY:'hidden'})}>
          {tlEvents.length===0&&<span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:MUTED})}>No events for current filter</span>}
          {tlEvents.map(e=>{
            const col=RC[e.sev]||AMB
            return(
              <div key={e.id} style={S({flexShrink:0,display:'flex',alignItems:'center',gap:7,padding:'5px 12px',borderRadius:20,background:RAISED,border:`1px solid ${BD}`,cursor:'pointer',whiteSpace:'nowrap'})}>
                <div style={S({width:3,height:26,borderRadius:2,background:col,flexShrink:0})}/>
                <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:MUTED})}>{e.time}</span>
                <span style={S({fontSize:10,fontWeight:500,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis'})}>{e.event}</span>
              </div>
            )
          })}
        </div>
      </footer>

      {/* Dashboard overlay */}
      {dashOpen&&<div style={S({position:'fixed',inset:0,zIndex:2200,background:'rgba(0,0,0,.8)',backdropFilter:'blur(12px)',display:'flex',alignItems:'center',justifyContent:'center'})} onClick={e=>{if(e.target===e.currentTarget)setDashOpen(false)}}>
        <div style={S({background:OVERLAY,border:`1px solid ${BD}`,borderRadius:12,padding:28,width:720,maxWidth:'96vw',maxHeight:'90vh',overflowY:'auto'})}>
          <div style={S({display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:22})}>
            <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,letterSpacing:'0.16em',textTransform:'uppercase',color:CYAN,display:'flex',alignItems:'center',gap:10})}>
              <div style={S({width:8,height:8,borderRadius:'50%',background:CYAN,boxShadow:`0 0 12px ${CYAN}`})}/>
              Command Dashboard
            </div>
            <button onClick={()=>setDashOpen(false)} style={S({width:28,height:28,background:RAISED,border:`1px solid ${BD}`,borderRadius:4,color:MUTED,cursor:'pointer',fontSize:14})}>×</button>
          </div>
          <div style={S({display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:22})}>
            {[{l:'Threat Index',v:kpi.threat,c:kpi.threat>70?RED:AMB},{l:'Active Assets',v:kpi.assets,c:CYAN},{l:'High-Risk Corridors',v:corridors.filter(c=>c.risk==='critical'||c.risk==='high').length,c:ORG},{l:'Anomalies',v:kpi.anomalies,c:kpi.anomalies>5?RED:AMB}].map(({l,v,c})=>(
              <div key={l} style={S({background:RAISED,border:`1px solid ${BD}`,borderRadius:8,padding:16,display:'flex',flexDirection:'column',gap:6})}>
                <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:'0.1em',textTransform:'uppercase',color:MUTED})}>{l}</span>
                <span style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:24,fontWeight:700,color:c})}>{v}</span>
              </div>
            ))}
          </div>
          <div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,fontWeight:600,letterSpacing:'0.14em',textTransform:'uppercase',color:MUTED,marginBottom:10,paddingBottom:7,borderBottom:`1px solid ${BD}`})}>Top Active Threats</div>
          {threats.slice(0,5).map(t=>(
            <div key={t.id} style={S({display:'flex',alignItems:'flex-start',gap:10,padding:'9px 10px',borderRadius:4,background:RAISED,border:`1px solid ${BD}`,marginBottom:5})}>
              <div style={S({flexShrink:0,width:3,alignSelf:'stretch',borderRadius:2,background:threatSevColor(t.sev)})}/>
              <div style={S({flex:1})}><div style={S({fontSize:11,fontWeight:500})}>{t.title}</div><div style={S({fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:MUTED,marginTop:2})}>{t.time} · {t.sev.toUpperCase()}</div></div>
            </div>
          ))}
          {threats.length===0&&<div style={S({color:MUTED,fontSize:11,padding:8})}>No active threats.</div>}
          <div style={S({display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'})}>
            <button onClick={()=>setDashOpen(false)} style={S({height:32,padding:'0 18px',borderRadius:4,background:RAISED,border:`1px solid ${BD}`,color:SUB,fontFamily:"'JetBrains Mono',monospace",fontSize:9,textTransform:'uppercase',cursor:'pointer'})}>Close</button>
            <button onClick={()=>{const lines=[`SONALIT INTELLIGENCE REPORT`,`${'='.repeat(40)}`,`Generated: ${new Date().toUTCString()}`,`Region: ${REGIONS[region]?.name}`,`Threat Index: ${kpi.threat}/100`,`Active Assets: ${kpi.assets}`,`Anomalies: ${kpi.anomalies}`,'',...threats.slice(0,10).map(t=>`  [${t.sev.toUpperCase()}] ${t.time} — ${t.title}`),'','CORRIDOR STATUS:',...corridors.map(c=>`  ${c.name}: ${c.risk.toUpperCase()} (Health: ${c.health}%)`)];const blob=new Blob([lines.join('\n')],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`SONALIT_report_${Date.now()}.txt`;a.click()}} style={S({height:32,padding:'0 18px',borderRadius:4,background:CYAN,color:V,fontFamily:"'JetBrains Mono',monospace",fontSize:9,fontWeight:700,textTransform:'uppercase',cursor:'pointer',border:'none'})}>Export Report</button>
          </div>
        </div>
      </div>}
    </div>
  )
}
