import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock3, MessageCircle, PlaneLanding, PlaneTakeoff, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { STREET_STYLE } from '../lib/mapStyles.js';
import { toCoordinatePair } from '../lib/coordinatePair.js';
import { useAuthStore } from '../stores/auth.js';
import { useMessages, useSendMessage } from '../features/comms/hooks/useComms.js';
import { useCommsRealtime } from '../features/comms/hooks/useCommsRealtime.js';
import { classifyRosterRevalidation, clearRevokedSjmFieldMissionCache, isFieldMissionRelevantForRosterChange } from '../lib/sjmFieldAccess.js';
type DutyRole='driver'|'backup_driver'|'cpo'|'meet_greet'|'security_escort'|'dispatcher';
type FlightStatus='unknown'|'scheduled'|'delayed'|'landed'|'departed'|'cancelled'|'diverted';
type Mission={id:string;reference:string;title:string;purpose:string;service_type:string;status:string;origin_label:string;origin_lat:number|string;origin_lng:number|string;destination_label:string;destination_lat:number|string;destination_lng:number|string;planned_departure_at?:string|null;planned_arrival_at?:string|null;timezone:string;principal_reference?:string|null;airport_code?:string|null;terminal?:string|null;airline?:string|null;flight_number?:string|null;flight_scheduled_at?:string|null;flight_status:FlightStatus;flight_status_source:string;flight_status_observed_at?:string|null;meet_greet_instructions?:string|null;duty_roles:DutyRole[]};
type FieldPoint={lat:number;lng:number;name?:string;label?:string};
type FieldStop={id:string;sequence:number;name:string;stop_status:'planned'|'reached'|'skipped';lat?:number|string|null;lng?:number|string|null};
type FieldAssessment={route_status?:string;safety_gate?:string};
type MissionDetail=Mission & {planned_route?:FieldPoint[]|string;route_assessment?:FieldAssessment|string|null;stops?:FieldStop[];planned_distance_km?:number|string|null;planned_duration_minutes?:number|null};
type FieldEvent={id:string;event_type:string;summary:string;detail?:{note?:string|null;evidence_class?:string};created_at:string;source:string};
const SERVICES:Record<string,string>={airport_arrival:'Airport arrival',airport_departure:'Airport departure',meet_and_greet:'Meet and greet',close_protection:'Close protection',security_escort:'Security escort',executive_transfer:'Executive transfer',other:'Executive mobility'};
const FLIGHTS:Record<FlightStatus,string>={unknown:'Unknown',scheduled:'Scheduled',delayed:'Delayed',landed:'Landed',departed:'Departed',cancelled:'Cancelled',diverted:'Diverted'};
const ACTIONS:Record<DutyRole,{type:string;label:string}[]>={
 driver:[{type:'driver_en_route',label:'En route'},{type:'driver_at_pickup',label:'At pickup'},{type:'principal_on_board',label:'Passenger on board'},{type:'destination_reached',label:'Destination reached'},{type:'safety_check_in',label:'Safety check-in'},{type:'vehicle_issue',label:'Vehicle issue'},{type:'delay',label:'Delay'}],
 backup_driver:[{type:'driver_en_route',label:'En route'},{type:'driver_at_pickup',label:'At pickup'},{type:'principal_on_board',label:'Passenger on board'},{type:'destination_reached',label:'Destination reached'},{type:'safety_check_in',label:'Safety check-in'},{type:'vehicle_issue',label:'Vehicle issue'},{type:'delay',label:'Delay'}],
 cpo:[{type:'cpo_en_route',label:'CPO en route'},{type:'meet_point_confirmed',label:'Meet point confirmed'},{type:'principal_met',label:'Principal met'},{type:'security_check_in',label:'Safety check-in'},{type:'handover_completed',label:'Handover completed'},{type:'security_concern',label:'Security concern'},{type:'delay',label:'Delay'},{type:'incident',label:'Incident'}],
 meet_greet:[{type:'meet_greet_positioned',label:'Positioned at meet point'},{type:'principal_contact_established',label:'Contact established'},{type:'principal_received',label:'Principal received'},{type:'handover_to_cpo',label:'Hand over to CPO'},{type:'safety_check_in',label:'Safety check-in'},{type:'delay',label:'Delay'},{type:'incident',label:'Incident'}],
 security_escort:[{type:'escort_started',label:'Escort started'},{type:'security_check_in',label:'Safety check-in'},{type:'handover_completed',label:'Handover completed'},{type:'security_concern',label:'Security concern'},{type:'delay',label:'Delay'},{type:'incident',label:'Incident'}],
 dispatcher:[{type:'safety_check_in',label:'Safety check-in'},{type:'delay',label:'Delay'},{type:'incident',label:'Incident'}]
};
const fieldClass='w-full rounded-md border border-white/10 bg-[#08111e] px-3 py-3 text-sm text-slate-100 outline-none focus:border-emerald-300/40';
const fmt=(v?:string|null)=>{if(!v)return'Not scheduled';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'Time unavailable'};
const words=(s:string)=>s.replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase());
const notes=['delay','vehicle_issue','incident','security_concern'];
const tone=(s:string)=>['in_progress','ready_to_depart'].includes(s)?'border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100':['paused','exception','on_hold','arrival_pending_verification'].includes(s)?'border-amber-300/25 bg-amber-300/[0.07] text-amber-100':'border-white/10 bg-white/[0.035] text-slate-300';
function fieldRoutePoints(value:MissionDetail['planned_route']):FieldPoint[]{
 if(Array.isArray(value))return value.filter(point=>point&&Number.isFinite(Number(point.lat))&&Number.isFinite(Number(point.lng)));
 if(typeof value==='string'){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.filter(point=>point&&Number.isFinite(Number(point.lat))&&Number.isFinite(Number(point.lng))):[]}catch{return [];}}
 return [];
}
function fieldAssessmentOf(value:MissionDetail['route_assessment']):FieldAssessment|null{
 if(value&&typeof value==='object')return value as FieldAssessment;
 if(typeof value==='string'){try{return JSON.parse(value) as FieldAssessment}catch{return null;}}
 return null;
}
function fieldMapMarker(letter:string,label:string,fill:string){
 const root=document.createElement('div');
 root.title=label;root.setAttribute('role','img');root.setAttribute('aria-label',label);
 root.style.width='25px';root.style.height='25px';root.style.display='grid';root.style.placeItems='center';
 root.style.borderRadius='50%';root.style.background=fill;root.style.border='2px solid #f1f5f9';
 root.style.color='#07111d';root.style.fontSize='11px';root.style.fontWeight='700';root.style.boxShadow='0 1px 3px rgba(0,0,0,.32)';
 root.textContent=letter;return root;
}
function FieldRouteMap({mission,detail,loading,error}:{mission:Mission;detail?:MissionDetail;loading:boolean;error:boolean}){
 const containerRef=useRef<HTMLDivElement>(null);
 const mapRef=useRef<maplibregl.Map|null>(null);
 const markersRef=useRef<maplibregl.Marker[]>([]);
 const [mapReady,setMapReady]=useState(false);
 const origin=useMemo(()=>toCoordinatePair(mission.origin_lat,mission.origin_lng),[mission.origin_lat,mission.origin_lng]);
 const destination=useMemo(()=>toCoordinatePair(mission.destination_lat,mission.destination_lng),[mission.destination_lat,mission.destination_lng]);
 const assessment=useMemo(()=>fieldAssessmentOf(detail?.route_assessment),[detail?.route_assessment]);
 const routeCoords=useMemo(()=>fieldRoutePoints(detail?.planned_route).map(point=>toCoordinatePair(point.lat,point.lng)),[detail?.planned_route]);
 const drawRoute=assessment?.route_status==='routed'&&routeCoords.length>=2&&routeCoords.every(point=>point!==null);
 const displayRoute=drawRoute?routeCoords as [number,number][]:[];
 const stopPoints=useMemo(()=>[...(detail?.stops||[])].sort((a,b)=>a.sequence-b.sequence).map(stop=>({stop,coord:toCoordinatePair(stop.lat,stop.lng)})).filter((item):item is {stop:FieldStop;coord:[number,number]}=>item.coord!==null),[detail?.stops]);
 const fitPoints=useMemo(()=>[...(origin?[origin]:[]),...displayRoute,...(destination?[destination]:[]),...stopPoints.map(item=>item.coord)],[origin,destination,displayRoute,stopPoints]);
 useEffect(()=>{
  const container=containerRef.current;if(!container||mapRef.current)return;
  const map=new maplibregl.Map({container,style:STREET_STYLE,center:origin||[37.5,-1.3],zoom:5,attributionControl:false});
  map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true}),'bottom-right');
  map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-left');
  map.on('load',()=>setMapReady(true));mapRef.current=map;
  const resizeObserver=new ResizeObserver(()=>map.resize());resizeObserver.observe(container);
  return ()=>{resizeObserver.disconnect();markersRef.current.forEach(marker=>marker.remove());markersRef.current=[];map.remove();mapRef.current=null;setMapReady(false)};
 },[]);
 useEffect(()=>{
  const map=mapRef.current;if(!map||!mapReady)return;
  const data:GeoJSON.FeatureCollection={type:'FeatureCollection',features:displayRoute.length>=2?[{type:'Feature',geometry:{type:'LineString',coordinates:displayRoute},properties:{evidence:'ROUTE_SAFETY_PLANNED_GEOMETRY'}}]:[]};
  const source=map.getSource('sjm-field-planned-route') as maplibregl.GeoJSONSource|undefined;
  const gate=String(assessment?.safety_gate||'').toUpperCase();
  const lineColor=gate==='NO_GO'?'#b91c1c':['HUMAN_REVIEW','CONDITIONAL'].includes(gate)?'#b45309':gate==='GO'?'#047857':'#64748b';
  if(source)source.setData(data);
  else{map.addSource('sjm-field-planned-route',{type:'geojson',data});map.addLayer({id:'sjm-field-planned-route-line',type:'line',source:'sjm-field-planned-route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':lineColor,'line-width':3.5,'line-opacity':0.95}});}
  if(map.getLayer('sjm-field-planned-route-line'))map.setPaintProperty('sjm-field-planned-route-line','line-color',lineColor);
  markersRef.current.forEach(marker=>marker.remove());markersRef.current=[];
  const add=(coord:[number,number]|null,letter:string,label:string,fill:string)=>{if(coord)markersRef.current.push(new maplibregl.Marker({element:fieldMapMarker(letter,label,fill),anchor:'center'}).setLngLat(coord).addTo(map));};
  add(origin,'O','Planned origin · '+mission.origin_label,'#bae6fd');
  stopPoints.forEach(({stop,coord})=>add(coord,String(stop.sequence),String(stop.sequence)+'. '+stop.name+' · '+(stop.stop_status==='reached'?'operator-confirmed reached':stop.stop_status==='skipped'?'operator-confirmed skipped':'planned stop'),stop.stop_status==='reached'?'#bbf7d0':stop.stop_status==='skipped'?'#cbd5e1':'#fde68a'));
  add(destination,'D','Planned destination · '+mission.destination_label,'#a7f3d0');
  map.resize();
  if(fitPoints.length>1){const bounds=new maplibregl.LngLatBounds();fitPoints.forEach(point=>bounds.extend(point));map.fitBounds(bounds,{padding:{top:36,bottom:44,left:34,right:44},maxZoom:13,duration:350});}
  else if(fitPoints.length===1)map.flyTo({center:fitPoints[0],zoom:12,duration:350});
 },[mapReady,displayRoute,origin,destination,stopPoints,fitPoints,assessment?.safety_gate,mission.origin_label,mission.destination_label]);
 const gate=String(assessment?.safety_gate||'UNAVAILABLE').toUpperCase();
 const gateClass=gate==='GO'?'border-emerald-300/25 text-emerald-200':gate==='NO_GO'?'border-red-300/25 text-red-200':['HUMAN_REVIEW','CONDITIONAL'].includes(gate)?'border-amber-300/25 text-amber-200':'border-white/10 text-slate-400';
 const note=loading?'Loading the authorised itinerary…':error?'The detailed itinerary is unavailable. Only the endpoints from the assignment summary are shown; no route line is drawn.':drawRoute?'The line is stored Route Safety planned geometry, not a live GPS track.':assessment?.route_status==='routed'?'The assessment marks this route as routed, but its stored geometry is incomplete; no line is drawn.':'No routed Route Safety geometry is available. The map does not connect endpoints.';
 return <section data-testid="sjm-field-route-map" data-route-evidence={drawRoute?'routed':'unavailable'} aria-label="Journey route map" className="overflow-hidden rounded-md border border-white/[0.09] bg-[#0c121a]">
  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3"><div><h3 className="text-sm font-semibold text-white">Route & checkpoints</h3><p className="mt-1 text-[11px] text-slate-500">Planned locations · no live position inferred</p></div><span className={'rounded-md border px-2.5 py-1.5 text-[11px] font-semibold '+gateClass}>Route Safety · {gate}</span></header>
  <div ref={containerRef} data-testid="sjm-field-map-canvas" className="h-[250px] w-full bg-[#101722] sm:h-[330px]"/>
  <div className="space-y-3 border-t border-white/[0.08] p-3 sm:p-4">
   <p className="text-[11px] leading-5 text-slate-400">{note}</p>
   <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-slate-400"><span><b className="mr-1 text-sky-200">O</b> Origin</span><span><b className="mr-1 text-amber-200">#</b> Planned stop</span><span><b className="mr-1 text-emerald-200">D</b> Destination</span></div>
   {detail?.stops?.length?<ol aria-label="Ordered checkpoints" className="space-y-1.5 border-t border-white/[0.07] pt-3">{[...detail.stops].sort((a,b)=>a.sequence-b.sequence).map(stop=><li key={stop.id} className="flex items-start justify-between gap-3 text-[11px]"><span className="min-w-0 text-slate-300"><span className="mr-2 inline-block font-mono text-slate-500">{String(stop.sequence).padStart(2,'0')}</span>{stop.name}</span><span className={stop.stop_status==='reached'?'shrink-0 text-emerald-200':stop.stop_status==='skipped'?'shrink-0 text-slate-400':'shrink-0 text-amber-200'}>{stop.stop_status==='reached'?'Reached · operator confirmed':stop.stop_status==='skipped'?'Skipped · operator confirmed':'Planned'}</span></li>)}</ol>:<p className="border-t border-white/[0.07] pt-3 text-[11px] text-slate-500">{loading?'Loading checkpoint sequence…':error?'Checkpoint sequence unavailable.':'No intermediate stops are recorded.'}</p>}
  </div>
 </section>;
}

export default function ExecutiveMobility(){
 const user=useAuthStore(s=>s.user),qc=useQueryClient();
 const [selectedId,setSelectedId]=useState(''),[eventType,setEventType]=useState('delay'),[eventNote,setEventNote]=useState(''),[flightStatus,setFlightStatus]=useState<FlightStatus|''>(''),[flightNote,setFlightNote]=useState(''),[draft,setDraft]=useState('');
 const [inaccessibleMissionIds,setInaccessibleMissionIds]=useState<Set<string>>(()=>new Set());
 const [revalidatingMissionIds,setRevalidatingMissionIds]=useState<Set<string>>(()=>new Set());
 const selectedIdRef=useRef(selectedId);selectedIdRef.current=selectedId;
 const rosterRevalidationVersionRef=useRef(new Map<string,number>());
 const rosterRevalidationInFlightRef=useRef(false);

 const [accessNotice,setAccessNotice]=useState(false);
 const identityKey=String(user?.org_id||'')+':'+String(user?.id||'');
 const accessIdentityRef=useRef<string|null>(null);
 const [verifiedIdentityKey,setVerifiedIdentityKey]=useState<string|null>(null);
 const identityCleanupRef=useRef<{identityKey:string;promise:Promise<void>}|null>(null);
 const identityKeyRef=useRef(identityKey);identityKeyRef.current=identityKey;
 const accessIdentityScopeRef=useRef<{orgId:string|undefined;userId:string|undefined}>({orgId:undefined,userId:undefined});
 const identityReady=verifiedIdentityKey===identityKey;
 const previousMissionId=useRef('');
 const missionQ=useQuery<{data:Mission[]}>({queryKey:['sjm-my-assignments',user?.org_id,user?.id],queryFn:async({signal})=>(await api.get('/sjm/my-assignments',{signal})).data,enabled:Boolean(user?.org_id&&user?.id),refetchInterval:30000,staleTime:10000});
 const currentAssignments=identityReady?missionQ.data?.data||[]:[];
 const currentAssignmentIdsRef=useRef<Set<string>>(new Set());currentAssignmentIdsRef.current=new Set(currentAssignments.map(m=>m.id));
 const revalidatingMissionIdsRef=useRef(revalidatingMissionIds);revalidatingMissionIdsRef.current=revalidatingMissionIds;
 const missions=currentAssignments.filter(m=>!inaccessibleMissionIds.has(m.id)&&!revalidatingMissionIds.has(m.id));
 useEffect(()=>{
  if(accessIdentityRef.current===identityKey)return;
  // StrictMode can replay mount effects. Reuse one pending cleanup/refetch per
  // identity so duplicate effect setups cannot race two assignment refreshes.
  if(identityCleanupRef.current?.identityKey===identityKey)return;
  const cleanupScope=async()=>{
   // The initial mount is untrusted: a previous page may have unmounted during
   // logout/login, so keep only assignment query data for this exact identity.
   const staleAssignmentKeys=qc.getQueryCache()
    .findAll({queryKey:['sjm-my-assignments']})
    .map(query=>query.queryKey)
    .filter(queryKey=>queryKey[1]!==user?.org_id||queryKey[2]!==user?.id);
   // Keep identityReady false while private requests are cancelled and caches purged.
   const cancellations=[
    qc.cancelQueries({queryKey:['sjm-field-detail']}),
    qc.cancelQueries({queryKey:['sjm-field-events']}),
    qc.cancelQueries({queryKey:['sjm-mission-channel']}),
    ...staleAssignmentKeys.map(queryKey=>qc.cancelQueries({queryKey,exact:true})),
   ];
   await Promise.all(cancellations).catch(()=>undefined);
   if(identityKeyRef.current!==identityKey)return;
   rosterRevalidationVersionRef.current.clear();
   staleAssignmentKeys.forEach(queryKey=>qc.removeQueries({queryKey,exact:true}));
   qc.removeQueries({queryKey:['sjm-field-detail']});
   qc.removeQueries({queryKey:['sjm-field-events']});
   qc.removeQueries({queryKey:['sjm-mission-channel']});
   accessIdentityScopeRef.current={orgId:user?.org_id,userId:user?.id};
   setInaccessibleMissionIds(new Set());
   setRevalidatingMissionIds(new Set());
   setAccessNotice(false);
   setSelectedId('');
   previousMissionId.current='';
   // A warm cache is not proof assignments survived a roster change while this
   // page was unmounted. Fetch before making the field workspace renderable.
   if(user?.org_id&&user?.id)await missionQ.refetch().catch(()=>undefined);
   if(identityKeyRef.current!==identityKey)return;
   accessIdentityRef.current=identityKey;
   setVerifiedIdentityKey(identityKey);
  };
  const promise=Promise.resolve().then(cleanupScope);
  identityCleanupRef.current={identityKey,promise};
  const release=()=>{if(identityCleanupRef.current?.promise===promise)identityCleanupRef.current=null};
  void promise.then(release,release);
 },[identityKey,qc,user?.org_id,user?.id,missionQ.refetch]);
 useEffect(()=>{if(!identityReady||selectedId&&revalidatingMissionIds.has(selectedId))return;if(!selectedId&&missions.length)setSelectedId(missions[0]!.id);else if(selectedId&&!missions.some(m=>m.id===selectedId))setSelectedId(missions[0]?.id||'')},[identityReady,missions,selectedId,revalidatingMissionIds]);
 const mission=missions.find(m=>m.id===selectedId);
 const detailQ=useQuery<{data:MissionDetail}>({queryKey:['sjm-field-detail',selectedId],queryFn:async({signal})=>(await api.get('/sjm/journeys/'+selectedId,{signal})).data,enabled:Boolean(identityReady&&selectedId&&!revalidatingMissionIds.has(selectedId)),staleTime:10000,refetchInterval:['in_progress','paused','exception','arrival_pending_verification'].includes(mission?.status||'')?30000:false});
 const detailHttpStatus=Number((detailQ.error as {response?:{status?:number}}|null)?.response?.status||0);
 const detailAccessDenied=detailQ.isError&&[403,404].includes(detailHttpStatus);
 const missionDetail=detailAccessDenied?undefined:detailQ.data?.data;
 useEffect(()=>{
  if(!identityReady||!detailAccessDenied||!selectedId||revalidatingMissionIds.has(selectedId))return;
  const revokedId=selectedId;
  setInaccessibleMissionIds(current=>current.has(revokedId)?current:new Set(current).add(revokedId));
  setAccessNotice(true);
  setSelectedId(current=>current===revokedId?'':current);
  void clearRevokedSjmFieldMissionCache(qc,user?.org_id,user?.id,revokedId);
 },[identityReady,detailAccessDenied,selectedId,qc,user?.org_id,user?.id,revalidatingMissionIds]);
 useEffect(()=>{
  if(previousMissionId.current===selectedId)return;
  previousMissionId.current=selectedId;
  setEventType('delay');setEventNote('');setFlightNote('');setDraft('');
  const current=missions.find(m=>m.id===selectedId),knownStatus=current?.flight_status;
  setFlightStatus(knownStatus&&knownStatus!=='unknown'?knownStatus:'');
 },[selectedId,missions]);
 const channelQ=useQuery<{data:{channel_id:string;realtime_channel:string;comms_epoch:number}}>({queryKey:['sjm-mission-channel',selectedId],queryFn:async({signal})=>(await api.get('/sjm/journeys/'+selectedId+'/communications',{signal})).data,enabled:Boolean(identityReady&&selectedId&&!detailAccessDenied&&!revalidatingMissionIds.has(selectedId)),staleTime:15000});
 const channelId=!identityReady||detailAccessDenied||revalidatingMissionIds.has(selectedId)?null:channelQ.data?.data.channel_id||null,messagesQ=useMessages(channelId),sendMessage=useSendMessage(channelId||'');
 const revalidateRosterMissionAccess=useCallback(async(missionId:string,markNewEvent=true)=>{
  const workIdentity=identityKey;
  if(markNewEvent){
   const nextVersion=(rosterRevalidationVersionRef.current.get(missionId)||0)+1;
   rosterRevalidationVersionRef.current.set(missionId,nextVersion);
  }else if(!rosterRevalidationVersionRef.current.has(missionId)){
   rosterRevalidationVersionRef.current.set(missionId,1);
  }
  if(rosterRevalidationInFlightRef.current)return;
  rosterRevalidationInFlightRef.current=true;
  const snapshotChanged=(versions:Map<string,number>)=>rosterRevalidationVersionRef.current.size!==versions.size||[...versions].some(([id,version])=>rosterRevalidationVersionRef.current.get(id)!==version);
  try{
   while(rosterRevalidationVersionRef.current.size&&identityKeyRef.current===workIdentity){
    const versions=new Map(rosterRevalidationVersionRef.current);
    const missionIds=[...versions.keys()];
    await Promise.all(missionIds.map(id=>clearRevokedSjmFieldMissionCache(qc,user?.org_id,user?.id,id,false)));
    if(identityKeyRef.current!==workIdentity)return;
    if(snapshotChanged(versions))continue;
    const refreshed=await missionQ.refetch({throwOnError:true}).catch(()=>null);
    if(identityKeyRef.current!==workIdentity)return;
    if(snapshotChanged(versions))continue;
    if(!refreshed||!refreshed.isSuccess||!refreshed.data?.data)throw new Error('Current mission assignments could not be confirmed.');
    const classified=classifyRosterRevalidation(missionIds,refreshed.data.data);
    setRevalidatingMissionIds(current=>{const next=new Set(current);missionIds.forEach(id=>next.delete(id));return next});
    setInaccessibleMissionIds(current=>{
     const next=new Set(current);
     classified.stillAssigned.forEach(id=>next.delete(id));
     classified.revoked.forEach(id=>next.add(id));
     return next;
    });
    if(selectedIdRef.current&&classified.stillAssigned.includes(selectedIdRef.current))setAccessNotice(false);
    missionIds.forEach(id=>rosterRevalidationVersionRef.current.delete(id));
   }
  }catch{
   // Fail closed for every pending mission. The retry path starts a new authorised read.
  }finally{
   rosterRevalidationInFlightRef.current=false;
  }
 },[missionQ.refetch,qc,user?.org_id,user?.id,identityKey]);

 const handleFieldRosterRevocation=useCallback((revokedChannelId:string,revokedJourneyId?:string)=>{
  if(!identityReady)return;
  const currentChannelId=channelQ.data?.data.channel_id;
  const missionId=revokedJourneyId||(selectedIdRef.current&&currentChannelId===revokedChannelId?selectedIdRef.current:null);
  if(!missionId)return;
  const hasPrivateCache=
   qc.getQueryData(['sjm-field-detail',missionId])!==undefined||
   qc.getQueryData(['sjm-field-events',missionId])!==undefined||
   qc.getQueryData(['sjm-mission-channel',missionId])!==undefined;
  if(!isFieldMissionRelevantForRosterChange(
   missionId,selectedIdRef.current,currentAssignmentIdsRef.current,revalidatingMissionIdsRef.current,hasPrivateCache
  ))return;
  setRevalidatingMissionIds(current=>new Set(current).add(missionId));
  if(selectedIdRef.current===missionId)setAccessNotice(true);
  // Process inactive missions whose assignment or private cache is known, but
  // ignore unrelated journey events to avoid per-event tenant-wide REST fan-out.
  void revalidateRosterMissionAccess(missionId,true);
 },[channelQ.data?.data.channel_id,revalidateRosterMissionAccess,identityReady,qc]);
 useCommsRealtime(user?.org_id,channelId,user?.id,detailAccessDenied?undefined:channelQ.data?.data.realtime_channel,selectedId,handleFieldRosterRevocation);
 const eventsQ=useQuery<{data:FieldEvent[]}>({queryKey:['sjm-field-events',selectedId],queryFn:async({signal})=>(await api.get('/sjm/journeys/'+selectedId+'/field-events',{signal})).data,enabled:Boolean(identityReady&&selectedId&&!detailAccessDenied&&!revalidatingMissionIds.has(selectedId)),refetchInterval:30000});
 const actions=useMemo(()=>{const map=new Map<string,{type:string;label:string}>();for(const r of mission?.duty_roles||[])for(const a of ACTIONS[r]||[])map.set(a.type,a);return [...map.values()]},[mission?.duty_roles]);
 const routineActions=useMemo(()=>actions.filter(a=>!notes.includes(a.type)),[actions]);
 const nextRoutineAction=useMemo(()=>eventsQ.isSuccess?routineActions.find(a=>!(eventsQ.data?.data||[]).some(e=>e.event_type===a.type)):undefined,[routineActions,eventsQ.data,eventsQ.isSuccess]);
 const reportQ=useMutation({mutationFn:async(p:{event_type:string;note?:string})=>(await api.post('/sjm/journeys/'+selectedId+'/field-events',p)).data,onSuccess:async()=>{setEventNote('');await qc.invalidateQueries({queryKey:['sjm-field-events',selectedId]})}});
 const flightQ=useMutation({mutationFn:async()=>(await api.patch('/sjm/journeys/'+selectedId+'/flight-status',{flight_status:flightStatus,note:flightNote.trim()||undefined})).data,onSuccess:async()=>{setFlightNote('');await qc.invalidateQueries({queryKey:['sjm-my-assignments',user?.org_id,user?.id]})}});
 const canFlight=Boolean(mission?.flight_number&&((mission.duty_roles||[]).some(r=>['cpo','meet_greet','dispatcher'].includes(r))||['admin','dispatcher'].includes(String(user?.role||'').toLowerCase())));
 const send=()=>{const body=draft.trim();if(body&&channelId)sendMessage.mutate({text:body},{onSuccess:()=>setDraft('')})};
 const report=(type:string)=>{if(notes.includes(type)&&eventNote.trim().length<5)return;reportQ.mutate({event_type:type,note:eventNote.trim()||undefined})};
 if(!identityReady)return <main className="sjm-field-console min-h-screen bg-[#080c12] p-5 text-slate-300">Refreshing authorised mission scope…</main>;
 if(missionQ.isLoading)return <main className="sjm-field-console min-h-screen bg-[#080c12] p-5 text-slate-300">Loading assigned missions…</main>;
 if(missionQ.isError)return <main className="sjm-field-console min-h-screen bg-[#080c12] p-5 text-slate-300"><section className="mx-auto max-w-2xl rounded-md border border-red-300/20 p-6"><h1 className="text-xl text-white">Mission service unavailable</h1><p className="mt-2 text-sm text-slate-400">No sample assignment is shown. Check the connection before retrying.</p><button className="mt-4 rounded-md border border-white/10 px-4 py-3" onClick={()=>{if(revalidatingMissionIds.size)void Promise.all([...revalidatingMissionIds].map(id=>revalidateRosterMissionAccess(id,false)));else void missionQ.refetch().catch(()=>undefined)}}>Retry</button></section></main>;
 return <main className="sjm-field-console min-h-screen bg-[#080c12] text-slate-100"><header className="border-b border-white/[0.08] bg-[#0b1118] px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3"><div><p className="text-[11px] font-semibold tracking-[.05em] text-emerald-300">Sonalit / Field operations</p><h1 className="mt-1 text-xl font-semibold">Executive Mobility</h1><p className="mt-1 text-[11px] text-slate-500">Assigned missions · auditable check-ins · no fabricated live state</p></div><Link to="/corridor/journeys" className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs"><ArrowLeft size={13}/>SJM desk</Link></div></header>
  <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6">{(accessNotice||revalidatingMissionIds.size>0)&&<div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300/20 bg-amber-300/[0.035] px-4 py-3 text-xs leading-5 text-amber-100"><span>{revalidatingMissionIds.size>0?'A mission team changed. Sensitive details are hidden while Sonalit rechecks authorised assignments.':'A mission is no longer in your authorised assignment list. Its sensitive details have been removed.'}</span>{revalidatingMissionIds.size>0&&<button type="button" className="rounded-md border border-amber-200/20 px-3 py-2 font-semibold" onClick={()=>void Promise.all([...revalidatingMissionIds].map(id=>revalidateRosterMissionAccess(id,false)))}>Retry access checks</button>}</div>}{selectedId&&revalidatingMissionIds.has(selectedId)?<section role="status" className="mx-auto max-w-2xl rounded-md border border-amber-300/20 p-6"><h2 className="text-lg font-semibold text-white">Rechecking mission assignment</h2><p className="mt-2 text-sm leading-6 text-slate-400">The mission team changed. Sensitive itinerary, principal details and private communications remain hidden until the server confirms your current assignment.</p></section>:detailAccessDenied?<section role="alert" className="mx-auto max-w-2xl rounded-md border border-amber-300/20 p-6"><h2 className="text-lg font-semibold text-white">Mission access no longer available</h2><p className="mt-2 text-sm leading-6 text-slate-400">The server could not confirm your current assignment. Principal instructions, route details and private communications are hidden. Refresh assignments or ask dispatch to confirm the roster.</p><button type="button" className="mt-4 rounded-md border border-white/10 px-4 py-3 text-sm" onClick={()=>{setAccessNotice(true);setSelectedId('');void missionQ.refetch()}}>Return to authorised assignments</button></section>:!missions.length?<section className="rounded-md border border-dashed border-white/15 p-8 text-center sm:p-14"><Users size={28} className="mx-auto text-slate-600"/><h2 className="mt-4 text-xl font-semibold">No mission assignments</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">Dispatch has not assigned a mission to you. No placeholder journeys or other officers’ itineraries are shown.</p><Link to="/corridor/journeys" className="mt-5 inline-flex rounded-md border border-emerald-300/25 px-4 py-3 text-sm">Return to SJM desk</Link></section>:<div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
   <section className="min-w-0 space-y-4">
    <div className="rounded-md border border-white/[0.09] bg-[#0c121a] p-4 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[11px]  tracking-[.12em] text-slate-500">Assigned mission</p><h2 className="mt-2 text-xl font-semibold sm:text-2xl">{mission?.title}</h2><p className="mt-1 font-mono text-[11px] text-slate-500">{mission?.reference}</p></div><span className={'rounded-full border px-3 py-1.5 font-mono text-[11px]  '+tone(mission?.status||'')}>{words(mission?.status||'')}</span></div>
     {missions.length>1&&<label className="mt-4 block"><span className="mb-1.5 block text-[11px] text-slate-500">Switch mission</span><select className={fieldClass} value={selectedId} onChange={e=>{setSelectedId(e.target.value);setEventNote('');setAccessNotice(false)}}>{missions.map(m=><option key={m.id} value={m.id}>{m.reference+' · '+m.title}</option>)}</select></label>}
     {mission&&<FieldRouteMap key={mission.id} mission={mission} detail={missionDetail} loading={detailQ.isLoading} error={detailQ.isError}/>}
     <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="rounded-md border border-white/[0.07] p-4"><p className="text-[11px]  tracking-[.16em] text-slate-500">Pickup / origin</p><p className="mt-2 font-semibold">{mission?.origin_label}</p><p className="mt-1 font-mono text-[11px] text-slate-500">{mission?.origin_lat}, {mission?.origin_lng}</p><p className="mt-3 text-[11px] text-slate-400">Departure · {fmt(mission?.planned_departure_at)}</p></div><div className="rounded-md border border-white/[0.07] p-4"><p className="text-[11px]  tracking-[.16em] text-slate-500">Destination</p><p className="mt-2 font-semibold">{mission?.destination_label}</p><p className="mt-1 font-mono text-[11px] text-slate-500">{mission?.destination_lat}, {mission?.destination_lng}</p><p className="mt-3 text-[11px] text-slate-400">Arrival · {fmt(mission?.planned_arrival_at)}</p></div></div>
     <div className="mt-3 flex flex-wrap gap-2"><span className="rounded-md border border-white/[0.11] px-3 py-2 text-xs">{SERVICES[mission?.service_type||'']||'Executive mobility'}</span>{(mission?.duty_roles||[]).map(r=><span key={r} className="rounded-md border border-white/[0.08] px-3 py-2 text-xs">{words(r)}</span>)}</div>
     <div className="mt-4 rounded-md border border-white/[0.07] bg-black/15 p-4"><h3 className="text-xs font-semibold">Mission instructions</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{mission?.purpose}</p>{mission?.principal_reference&&<p className="mt-3 text-[11px] text-slate-500">Principal / booking reference: {mission.principal_reference}</p>}{mission?.meet_greet_instructions&&<p className="mt-3 whitespace-pre-wrap border-t border-white/[0.06] pt-3 text-sm leading-6">{mission.meet_greet_instructions}</p>}<p className="mt-3 text-[11px] text-slate-600">Confirm discrepancies with dispatch. This is stored mission data, not live safety clearance.</p></div>
     {mission?.flight_number&&<div className="mt-4 rounded-md border border-white/[0.08] bg-white/[0.025] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-[11px]  tracking-[.16em] text-slate-300">Airport coordination</p><h3 className="mt-1 text-lg font-semibold">{mission.airline||'Airline not recorded'} · {mission.flight_number}</h3><p className="mt-1 text-xs text-slate-400">{mission.airport_code||'Airport not recorded'}{mission.terminal?' · '+mission.terminal:''} · Scheduled {fmt(mission.flight_scheduled_at)}</p></div><span className="rounded-md border border-white/[0.08] px-3 py-2 text-xs">{FLIGHTS[mission.flight_status]||'Unknown'}</span></div><p className="mt-3 text-[11px] text-amber-200/80">{mission.flight_status_source==='operator_entered'?'Operator-entered · '+fmt(mission.flight_status_observed_at):'No operator observation recorded'}. No connected airline feed.</p></div>}
    </div>
    <section aria-label="Private mission channel" className="rounded-md border border-white/[0.11] bg-[#0c121a] p-4 sm:p-5"><div className="flex items-center gap-2"><MessageCircle size={15} className="text-emerald-200"/><h3 className="text-base font-semibold">Private mission channel</h3></div><p className="mt-2 text-[11px] leading-5 text-slate-500">Messages are limited to the current mission team. Dispatch roster changes control who can access this conversation.</p><div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto">{channelQ.isLoading?<p className="text-xs text-slate-500">Opening secured channel…</p>:channelQ.isError?<p role="status" className="text-xs text-amber-200">Mission channel unavailable; field check-ins remain available.</p>:messagesQ.isLoading?<p role="status" className="text-xs text-slate-500">Loading message history…</p>:messagesQ.isError?<div role="status" className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200"><span>Message history could not be loaded. No empty-state assumption is made.</span><button type="button" onClick={()=>void messagesQ.refetch()} className="min-h-10 rounded-md border border-white/15 px-3 py-2 text-slate-200">Retry history</button></div>:(messagesQ.data?.data||[]).length===0?<p className="text-xs text-slate-500">No messages recorded in this mission channel.</p>:(messagesQ.data?.data||[]).map(m=><article key={m.id} className="rounded-md border border-white/[0.06] bg-white/[0.025] p-3"><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold text-emerald-100">{m.author_name||m.author_role||'Team member'}</span><time className="font-mono text-[11px] text-slate-600">{fmt(m.created_at)}</time></div><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">{m.deleted?'Message deleted':m.body}</p></article>)}</div><form onSubmit={e=>{e.preventDefault();send()}} className="mt-3 space-y-2"><textarea className={fieldClass} rows={3} maxLength={4000} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Message assigned mission team…"/><button type="submit" disabled={!channelId||sendMessage.isPending||!draft.trim()} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-300 px-4 py-3 text-sm font-semibold text-[#04100b] disabled:opacity-40"><MessageCircle size={14}/>Send message <ArrowRight size={14}/></button>{sendMessage.isError&&<p className="text-xs text-red-200">Message not sent; check membership and connection.</p>}</form></section>
    <div className="rounded-md border border-white/[0.09] bg-[#0c121a] p-4 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[11px]  tracking-[.12em] text-emerald-200">01 / Field check-in</p><h3 className="mt-1 text-lg font-semibold">Mission milestones</h3><p className="mt-1 text-xs text-slate-500">These reports do not prove GPS presence or alter lifecycle state.</p></div><Activity size={17} className="text-emerald-200"/></div><div className="mt-4"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-semibold text-slate-200">Routine check-ins</p><p className="text-[11px] text-slate-500">Record only after the milestone occurs</p></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{routineActions.map(a=>{const isNext=eventsQ.isSuccess&&nextRoutineAction?.type===a.type;return <button type="button" key={a.type} disabled={reportQ.isPending} onClick={()=>report(a.type)} className={isNext?'min-h-[68px] rounded-md border border-emerald-300/30 bg-emerald-300/[0.07] p-3 text-left text-sm text-slate-100 disabled:opacity-50':'min-h-[68px] rounded-md border border-white/[0.10] bg-white/[0.02] p-3 text-left text-sm text-slate-200 hover:bg-white/[0.04] disabled:opacity-50'}><span className="flex items-center gap-2"><span className={'h-2 w-2 shrink-0 rounded-full '+(isNext?'bg-emerald-300':'bg-slate-500')}/>{a.label}</span>{isNext&&<span className="mt-2 block text-[11px] text-emerald-300">Next unrecorded check-in</span>}</button>})}</div>{eventsQ.isSuccess&&routineActions.length>0&&!nextRoutineAction&&<p className="mt-3 text-[11px] leading-5 text-slate-500">Every listed check-in has been recorded at least once. Entries remain available for repeat confirmation when required.</p>}</div><div className="mt-4 rounded-md border border-white/[0.07] bg-black/15 p-4"><label className="block"><span className="mb-1.5 block text-[11px] text-slate-400">Delay, issue or incident report</span><select className={fieldClass} value={eventType} onChange={e=>setEventType(e.target.value)}>{actions.filter(a=>notes.includes(a.type)).map(a=><option key={a.type} value={a.type}>{a.label}</option>)}</select></label><textarea className={fieldClass+' mt-2'} rows={3} maxLength={1200} value={eventNote} onChange={e=>setEventNote(e.target.value)} placeholder="What happened, who was notified, operational impact…"/><button type="button" disabled={reportQ.isPending||eventNote.trim().length<5||!actions.some(a=>a.type===eventType)} onClick={()=>report(eventType)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100 disabled:opacity-40"><AlertTriangle size={14}/>Record field report</button>{reportQ.isError&&<p className="mt-2 text-xs text-red-200">Server rejected this report; delivery is not assumed.</p>}{reportQ.isSuccess&&<p className="mt-2 text-xs text-emerald-200">Field report accepted by the server.</p>}</div></div>
    {canFlight&&<div className="rounded-md border border-white/[0.08] bg-[#0c121a] p-4 sm:p-6"><div className="flex items-center gap-2"><PlaneLanding size={16} className="text-slate-300"/><h3 className="text-lg font-semibold">Flight-status observation</h3></div><p className="mt-2 text-xs leading-5 text-slate-400">Enter what you saw on an authorised airport/airline display or direct operational contact. Sonalit has not independently verified it.</p><div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-[11px] text-slate-400">Status</span><select className={fieldClass} value={flightStatus} onChange={e=>setFlightStatus(e.target.value as FlightStatus|'')}><option value="">Choose observed status…</option>{(['scheduled','delayed','landed','departed','cancelled','diverted'] as FlightStatus[]).map(f=><option key={f} value={f}>{FLIGHTS[f]}</option>)}</select></label><label><span className="mb-1.5 block text-[11px] text-slate-400">Note (required for delay/cancel/divert)</span><input className={fieldClass} maxLength={1200} value={flightNote} onChange={e=>setFlightNote(e.target.value)} placeholder="Source and context"/></label></div><button type="button" disabled={flightQ.isPending||!flightStatus||(['delayed','cancelled','diverted'].includes(flightStatus)&&flightNote.trim().length<5)} onClick={()=>flightQ.mutate()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-sm text-slate-300 disabled:opacity-40"><PlaneTakeoff size={14}/>Save operator observation</button>{flightQ.isError&&<p className="mt-2 text-xs text-red-200">Flight status not saved. Refresh and verify the assigned mission.</p>}{flightQ.isSuccess&&<p className="mt-2 text-xs text-emerald-200">Operator-entered status saved with server timestamp.</p>}</div>}
    <div className="rounded-md border border-white/[0.08] bg-[#0c121a] p-4 sm:p-6"><div className="flex items-center justify-between gap-3"><div><p className="font-mono text-[11px]  tracking-[.12em] text-slate-500">02 / Mission history</p><h3 className="mt-1 text-lg font-semibold">Recent field reports</h3></div><button type="button" onClick={()=>void eventsQ.refetch()} className="rounded-md border border-white/10 p-2" aria-label="Refresh field history"><RefreshCw size={13}/></button></div>{(eventsQ.data?.data||[]).length===0?<p className="mt-4 text-sm text-slate-500">No field reports recorded yet.</p>:<div className="mt-4 space-y-3">{(eventsQ.data?.data||[]).map(e=><article key={e.id} className="border-l border-emerald-300/25 pl-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium">{e.summary}</p><time className="font-mono text-[11px] text-slate-600">{fmt(e.created_at)}</time></div>{e.detail?.note&&<p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-400">{e.detail.note}</p>}<p className="mt-1 font-mono text-[11px] text-slate-600">{e.detail?.evidence_class||'OPERATOR-REPORTED'} · {e.source}</p></article>)}</div>}</div>
   </section>
   <aside className="min-w-0 space-y-4"><section className="rounded-md border border-white/[0.08] bg-[#0c121a] p-4 sm:p-5"><div className="flex items-center gap-2"><ShieldCheck size={15} className="text-slate-300"/><h3 className="text-base font-semibold">Operational guardrails</h3></div><div className="mt-3 space-y-3 text-xs leading-5 text-slate-400"><p>Check-ins append audit events; they do not change approval or departure lifecycle.</p><p>Flight statuses are manually entered, timestamped and unverified.</p><p>Principal notes remain internal; client reports exclude INTERNAL_OPERATIONS events.</p></div></section></aside>
  </div>}</div></main>;
}