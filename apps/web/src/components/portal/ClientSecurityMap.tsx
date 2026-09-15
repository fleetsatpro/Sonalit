import React,{useEffect,useMemo,useRef,useState} from 'react';
import Map,{Marker,NavigationControl,Source,Layer,type MapRef} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import {Activity,AlertTriangle,Maximize2,MapPin,Truck} from 'lucide-react';

const API=(import.meta.env['VITE_API_BASE_URL'] as string|undefined)??'/api/v1';
const MAP_STYLE='https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

type Vehicle={vehicle_id:string;registration:string;current_lat:number|null;current_lng:number|null;speed_kmh:number|null;heading_deg:number|null;last_ping_at:string|null;carries_my_cargo:boolean};
type ReplayPoint={lat:number;lng:number;timestamp:string;speed:number|null;vehicle_id:string};

function age(iso:string|null){if(!iso)return'NO FIX';const sec=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/1000));return sec<60?sec+'s':sec<3600?Math.floor(sec/60)+'m':Math.floor(sec/3600)+'h';}

export function ClientSecurityMap({convoyId,alerting,onFullscreen}:{convoyId:string;alerting:boolean;onFullscreen?:()=>void}):React.ReactElement{
 const ref=useRef<MapRef|null>(null); const [vehicles,setVehicles]=useState<Vehicle[]>([]); const [replay,setReplay]=useState<ReplayPoint[]>([]); const [selected,setSelected]=useState<string|null>(null); const [error,setError]=useState('');
 const load=React.useCallback(async()=>{try{
   const [vRes,rRes]=await Promise.all([
    fetch(API+'/portal/convoy/'+encodeURIComponent(convoyId)+'/vehicles',{credentials:'include'}),
    fetch(API+'/portal/convoy/'+encodeURIComponent(convoyId)+'/replay',{credentials:'include'})
   ]);
   if(vRes.status===401||rRes.status===401){setError('Session expired');return;}
   if(!vRes.ok||!rRes.ok)throw new Error('Telemetry unavailable');
   const v=await vRes.json() as {data:Vehicle[]}; const r=await rRes.json() as {data:ReplayPoint[]};
   setVehicles(v.data||[]); setReplay(r.data||[]);
 }catch(e){setError(e instanceof Error?e.message:'Telemetry unavailable');}},[convoyId]);
 useEffect(()=>{void load();const t=window.setInterval(()=>void load(),15000);return()=>window.clearInterval(t)},[load]);
 const points=useMemo(()=>vehicles.filter(v=>v.current_lat!=null&&v.current_lng!=null).map(v=>({id:v.vehicle_id,lat:v.current_lat!,lng:v.current_lng!,label:v.registration,alerting:v.carries_my_cargo&&alerting})),[vehicles,alerting]);
 const geo=useMemo(()=>({type:'Feature' as const,geometry:{type:'LineString' as const,coordinates:replay.map(p=>[p.lng,p.lat])},properties:{}}),[replay]);
 const fit=()=>{const all=[...points,...(replay.length? [ {lat:Math.max(...replay.map(p=>p.lat)),lng:Math.max(...replay.map(p=>p.lng))} ]:[])]; if(!all.length)return;const l=all.map(p=>p.lat),g=all.map(p=>p.lng);ref.current?.fitBounds([[Math.min(...g),Math.min(...l)],[Math.max(...g),Math.max(...l)]],{padding:80,maxZoom:9,duration:650})};
 useEffect(()=>{if(points.length||replay.length)window.setTimeout(fit,200)},[points.length,replay.length]);
 const sel=vehicles.find(v=>v.vehicle_id===selected)||null;
 return <div className="relative overflow-hidden rounded-2xl border border-white/[.08] bg-[#06101a]" style={{height:360}}>
   <Map ref={ref} initialViewState={{longitude:28,latitude:-2,zoom:3}} mapStyle={MAP_STYLE} style={{width:'100%',height:'100%'}} attributionControl={false} onLoad={fit}>
    <NavigationControl position="bottom-right" showCompass showZoom/>
    {replay.length>1&&<Source id="security-replay" type="geojson" data={geo}><Layer id="security-replay-line" type="line" paint={{'line-color':'#f97316','line-width':4,'line-opacity':.82,'line-dasharray':[1.2,1]}}/></Source>}
    {points.map(p=><Marker key={p.id} longitude={p.lng} latitude={p.lat} anchor="center"><button type="button" title={p.label} onClick={()=>setSelected(p.id)} className={"flex h-10 w-10 items-center justify-center rounded-full border-2 bg-[#08131e] shadow-[0_0_0_6px_rgba(249,115,22,.08)] transition hover:scale-110 "+(selected===p.id?'border-white bg-orange-500 text-white':p.alerting?'border-red-300/80 text-red-300':'border-orange-300/70 text-orange-300')}><Truck size={15}/></button></Marker>)}
   </Map>
   <div className="absolute left-3 top-3 rounded-lg border border-white/10 bg-[#071019]/90 px-2.5 py-1.5 backdrop-blur-md"><div className="flex items-center gap-2"><span className={"h-1.5 w-1.5 rounded-full "+(points.length?'bg-emerald-400 animate-pulse':'bg-amber-400')}/><span className="text-[9px] font-bold uppercase tracking-[.16em] text-white/70">SECURITY</span><span className="font-mono text-[9px] text-white/25">{points.length} positioned</span></div></div>
   <div className="absolute right-3 top-3 flex gap-2"><button onClick={fit} disabled={!points.length&&!replay.length} className="rounded-lg border border-white/10 bg-[#071019]/90 p-2 text-white/45 disabled:opacity-30"><MapPin size={14}/></button>{onFullscreen&&<button onClick={onFullscreen} className="rounded-lg border border-white/10 bg-[#071019]/90 p-2 text-white/45"><Maximize2 size={14}/></button>}</div>
   {selected&&sel&&<div className="absolute bottom-3 right-3 w-[210px] rounded-xl border border-white/10 bg-[#071019]/94 p-3 backdrop-blur-md"><div className="flex items-center justify-between"><span className="font-mono text-[11px] text-white/70">{sel.registration}</span><span className={"text-[9px] "+(sel.last_ping_at&&age(sel.last_ping_at).endsWith('s')?'text-emerald-300':'text-white/30')}>{age(sel.last_ping_at)}</span></div><div className="mt-2 flex justify-between text-[9px] text-white/35"><span>{sel.speed_kmh==null?'—':Math.round(sel.speed_kmh)+' km/h'}</span><span>{sel.heading_deg==null?'—':Math.round(sel.heading_deg)+'°'}</span></div></div>}
   {!points.length&&!replay.length&&<div className="absolute inset-0 flex items-center justify-center"><div className="flex items-center gap-2 text-[10px] text-white/30"><Activity size={14}/>{error||'No telemetry available'}</div></div>}
 </div>;
}
