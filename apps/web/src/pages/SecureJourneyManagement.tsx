import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { STREET_STYLE, SAT_STYLE } from '../lib/mapStyles.js';
import { toCoordinatePair as mapCoord } from '../lib/coordinatePair.js';
import { localDateTimeInputInTimezone } from '../lib/sjmJourneyTime.js';
import { useAuthStore } from '../stores/auth.js';
import { Activity, AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, CalendarClock, Check, CheckCircle2, ChevronRight, Clock3, Eye, FileBarChart2, FileDown, FileText, Layers3, MapPinned, Maximize2, MessagesSquare, Navigation, Pencil, Plus, RefreshCw, Route, Satellite, Search, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';

type Status='requested'|'planning'|'assessment_pending'|'ready_for_review'|'approved'|'ready_to_depart'|'in_progress'|'paused'|'exception'|'arrival_pending_verification'|'closed'|'cancelled'|'aborted'|'on_hold';
type Point={lat:number;lng:number;name?:string;label?:string};
type Stop={id:string;sequence:number;name:string;stop_type:string;lat?:number|null;lng?:number|null;planned_arrival_at?:string|null;planned_departure_at?:string|null;duration_minutes?:number|null;stop_status:'planned'|'reached'|'skipped';confirmed_at?:string|null;confirmation_source?:string|null;instructions?:string|null};
type EventRow={id:string;event_type:string;summary:string;detail:Record<string,unknown>;source:string;created_at:string};
type Assessment={route_status?:string;safety_gate?:string;overall_risk_score?:number;routing_provider?:string;ai_summary?:string;risk_zone_count?:number;recommended_route?:{blocked?:boolean;distance_km?:number;estimated_duration_minutes?:number;waypoints?:Point[];risk_factors?:string[]}};
type TelemetryDevice={device_id:string;device_name:string;officer_name?:string|null;lat?:number|string|null;lng?:number|string|null;speed_kph?:number|string|null;heading?:number|string|null;accuracy_m?:number|string|null;observed_at?:string|Date|null;source?:string|null;freshness:'LIVE'|'DELAYED'|'STALE'|'UNAVAILABLE'|string;age_seconds?:number|null;freshness_reason?:string|null;evidence_class?:'OBSERVED'|string};
type TelemetrySnapshot={status:'LIVE'|'DELAYED'|'STALE'|'UNAVAILABLE'|string;reason?:string|null;observed_at?:string|Date|null;devices:TelemetryDevice[]};
type ReadinessItem={item:string;status:string;detail:string};
type Journey={id:string;reference:string;title:string;purpose:string;status:Status;service_type?:string;principal_reference?:string|null;airport_code?:string|null;terminal?:string|null;airline?:string|null;flight_number?:string|null;flight_scheduled_at?:string|null;flight_status?:string;flight_status_source?:string;flight_status_observed_at?:string|null;meet_greet_instructions?:string|null;transport_mode:string;client_id?:string|null;client_name?:string|null;convoy_id?:string|null;convoy_name?:string|null;origin_label:string;origin_lat:string|number;origin_lng:string|number;destination_label:string;destination_lat:string|number;destination_lng:string|number;planned_departure_at?:string|null;planned_arrival_at?:string|null;schedule_urgency?:'DEPARTURE_OVERDUE'|'ARRIVAL_OVERDUE'|'DEPARTURE_DUE_30M'|string|null;planned_distance_km?:number|string|null;planned_duration_minutes?:number|null;timezone:string;route_assessment?:Assessment|string|null;planned_route?:Point[]|string;human_review_decision?:string|null;human_review_rationale?:string|null;approved_at?:string|null;started_at?:string|null;completed_at?:string|null;stops?:Stop[];events?:EventRow[];has_route_assessment?:boolean;telemetry_snapshot?:TelemetrySnapshot;readiness_checklist?:ReadinessItem[];duty_roles?:string[];created_at?:string|null;updated_at?:string|null};
type JourneyRegisterResponse={data:Journey[];pagination?:{limit:number;offset:number;total_count:number;has_more:boolean};summary?:{total:number;active:number;queue:number;review:number;awaiting_review:number;arrival_verification:number;overdue?:number;departures_due_30m?:number}};
function lifecycleCheckpointIndex(status:Status,journey:Pick<Journey,'route_assessment'|'approved_at'|'started_at'>):number {
 const direct:Partial<Record<Status,number>>={requested:0,planning:1,assessment_pending:1,ready_for_review:2,approved:4,ready_to_depart:5,in_progress:5,paused:5,exception:5,on_hold:5,arrival_pending_verification:6,closed:8};
 if(direct[status]!==undefined)return direct[status] as number;
 if(status==='cancelled'||status==='aborted')return journey.started_at?6:journey.approved_at?4:journey.route_assessment?2:1;
 return 0;
}
type Client={id:string;name:string;company?:string|null};
type Convoy={id:string;name:string;status:string};
type Profile={client_id:string;report_timezone:string;report_template:{title?:string;sections?:string[]};daily_reports_enabled?:boolean;daily_report_local_time?:string;daily_report_scheduler_available?:boolean;client?:Client};
type Report={data:{id:string;report_type:string;report_date:string;generated_at:string}};
type Participant={id:string;user_id:string;duty_role:string;is_primary:boolean;removed_at?:string|null;user_name:string;account_role:string};
type TeamUser={id:string;name:string;role:string;email:string};
type IntakePickTarget='origin'|'destination'|{stopIndex:number}|null;
type StopDraft={name:string;stop_type:string;lat:string;lng:string;instructions:string;planned_arrival_at?:string|null;planned_departure_at?:string|null;duration_minutes?:number|null};
const META:Record<Status,{label:string;cls:string}>={requested:{label:'Requested',cls:'border-slate-500/30 bg-slate-500/10 text-slate-300'},planning:{label:'Planning',cls:'border-white/[0.08] bg-white/[0.025] text-slate-300'},assessment_pending:{label:'Assessment pending',cls:'border-white/[0.08] bg-white/[0.025] text-slate-300'},ready_for_review:{label:'Ready for review',cls:'border-amber-500/30 bg-amber-500/10 text-amber-200'},approved:{label:'Approved',cls:'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'},ready_to_depart:{label:'Ready to depart',cls:'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'},in_progress:{label:'In progress',cls:'border-orange-500/30 bg-orange-500/10 text-orange-200'},paused:{label:'Paused',cls:'border-amber-500/30 bg-amber-500/10 text-amber-200'},exception:{label:'Exception',cls:'border-red-500/30 bg-red-500/10 text-red-200'},arrival_pending_verification:{label:'Awaiting arrival check',cls:'border-amber-500/30 bg-amber-500/10 text-amber-200'},closed:{label:'Closed',cls:'border-slate-500/30 bg-slate-500/10 text-slate-300'},cancelled:{label:'Cancelled',cls:'border-red-500/30 bg-red-500/10 text-red-200'},aborted:{label:'Aborted',cls:'border-red-500/30 bg-red-500/10 text-red-200'},on_hold:{label:'On hold',cls:'border-slate-500/30 bg-slate-500/10 text-slate-300'}};
const SECTIONS=[{id:'summary',label:'Journey overview'},{id:'itinerary',label:'Planned itinerary'},{id:'stops',label:'Stops and checkpoints'},{id:'route_assessment',label:'Route risk assessment'},{id:'operational_events',label:'Journey activity'},{id:'telemetry_snapshot',label:'Device location evidence'}];
const INTAKE_STEPS=[{label:'Journey details',detail:'Purpose, client and service'},{label:'Route',detail:'Origin, destination and timing'},{label:'Stops',detail:'Checkpoints in travel order'},{label:'Review',detail:'Check the request before saving'}] as const;
const FLIGHT_STATUS_OPTIONS=[{value:'scheduled',label:'Scheduled'},{value:'departed',label:'Departed'},{value:'delayed',label:'Delayed'},{value:'landed',label:'Landed'},{value:'cancelled',label:'Cancelled'},{value:'diverted',label:'Diverted'}] as const;
function flightStatusLabel(value?:string|null){return value==='scheduled'?'Scheduled':value==='departed'?'Departed':value==='delayed'?'Delayed':value==='landed'?'Landed':value==='cancelled'?'Cancelled':value==='diverted'?'Diverted':'Not recorded';}
function routeStatusLabel(value?:string|null){const key=String(value||'').toUpperCase();const known:Record<string,string>={ROUTED:'Routed',BLOCKED:'Blocked',UNROUTED:'Not routed',UNAVAILABLE:'Unavailable'};return known[key]||(value?String(value).replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase()):'Unavailable');}
function safetyGateLabel(value?:string|null){const known:Record<string,string>={GO:'Go',CONDITIONAL:'Conditional',NO_GO:'No-go',HUMAN_REVIEW:'Human review',UNAVAILABLE:'Unavailable'};return known[String(value||'').toUpperCase()]||'Unavailable';}
function eventSourceLabel(value?:string|null){if(value==='system')return 'Sonalit';if(value==='operator')return 'Team member';if(!value)return 'Source unavailable';return String(value).replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());}
function eventTypeLabel(value:string){return value.replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());}
const EMPTY={title:'',purpose:'',client_id:'',convoy_id:'',service_type:'executive_transfer',principal_reference:'',airport_code:'',terminal:'',airline:'',flight_number:'',flight_scheduled_at:'',meet_greet_instructions:'',transport_mode:'road',origin_label:'',origin_lat:'',origin_lng:'',destination_label:'',destination_lat:'',destination_lng:'',planned_departure_at:'',planned_arrival_at:'',timezone:'Africa/Nairobi'};
function assessmentOf(v:Journey['route_assessment']):Assessment|null{if(!v)return null;if(typeof v==='object')return v as Assessment;try{return JSON.parse(v) as Assessment}catch{return null}}
type RegisterSort='priority'|'departure_asc'|'departure_desc'|'updated_desc';
const REGISTER_SORT_OPTIONS:ReadonlyArray<{value:RegisterSort;label:string}>=[
 {value:'priority',label:'Operational priority'},
 {value:'departure_asc',label:'Departure · soonest first'},
 {value:'departure_desc',label:'Departure · latest first'},
 {value:'updated_desc',label:'Recently updated'},
];
const REGISTER_STATUS_PRIORITY:Record<Status,number>={exception:1,paused:2,arrival_pending_verification:3,on_hold:8,in_progress:9,ready_for_review:10,ready_to_depart:11,approved:12,assessment_pending:13,planning:14,requested:15,closed:20,cancelled:21,aborted:22};
function dateOrder(a?:string|null,b?:string|null,direction:'asc'|'desc'='asc'){
 const av=a?Date.parse(a):NaN,bv=b?Date.parse(b):NaN;
 if(!Number.isFinite(av)&&!Number.isFinite(bv))return 0;
 if(!Number.isFinite(av))return 1;
 if(!Number.isFinite(bv))return -1;
 return direction==='asc'?av-bv:bv-av;
}
function registerPriority(journey:Journey,now=Date.now()){
 const status=journey.status,gate=assessmentOf(journey.route_assessment)?.safety_gate;
 const terminal=['closed','cancelled','aborted'].includes(status);
 if(gate==='NO_GO'&&!terminal)return 0;
 if(status==='exception')return 1;
 if(status==='paused')return 2;
 if(status==='arrival_pending_verification')return 3;
 if(gate==='HUMAN_REVIEW'&&!terminal)return 4;
 const departure=journey.planned_departure_at?Date.parse(journey.planned_departure_at):NaN;
 const arrival=journey.planned_arrival_at?Date.parse(journey.planned_arrival_at):NaN;
 if(['approved','ready_to_depart'].includes(status)&&Number.isFinite(departure)&&departure<now)return 5;
 if(status==='in_progress'&&Number.isFinite(arrival)&&arrival<now)return 6;
 if(['approved','ready_to_depart'].includes(status)&&Number.isFinite(departure)&&departure>=now&&departure<=now+30*60*1000)return 7;
 return REGISTER_STATUS_PRIORITY[status]??16;
}
function compareRegisterRows(a:Journey,b:Journey,sort:RegisterSort){
 if(sort==='priority'){
  const pa=registerPriority(a),pb=registerPriority(b);
  if(pa!==pb)return pa-pb;
  const departure=dateOrder(a.planned_departure_at,b.planned_departure_at,'asc');
  if(departure)return departure;
  const updated=dateOrder(a.updated_at,b.updated_at,'desc');
  if(updated)return updated;
 }else if(sort==='departure_asc'||sort==='departure_desc'){
  const departure=dateOrder(a.planned_departure_at,b.planned_departure_at,sort==='departure_asc'?'asc':'desc');
  if(departure)return departure;
  const updated=dateOrder(a.updated_at,b.updated_at,'desc');
  if(updated)return updated;
 }else{
  const updated=dateOrder(a.updated_at,b.updated_at,'desc');
  if(updated)return updated;
  const departure=dateOrder(a.planned_departure_at,b.planned_departure_at,'asc');
  if(departure)return departure;
 }
 return a.reference.localeCompare(b.reference);
}
function routeOf(v:Journey['planned_route']):Point[]{if(Array.isArray(v))return v;if(typeof v==='string'){try{const p=JSON.parse(v);return Array.isArray(p)?p:[]}catch{return []}}return []}
function dateText(v?:string|null){if(!v)return'Not recorded';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'Not recorded'}

function errorText(e:unknown,fallback:string){const x=e as{response?:{data?:{message?:string;error?:string}};message?:string};return x.response?.data?.message||x.response?.data?.error||x.message||fallback}
function Input({label,children,className=''}:{label:string;children:ReactNode;className?:string}){return <label className={'block min-w-0 '+className}><span className="mb-1.5 block text-xs font-medium text-slate-300">{label}</span>{children}</label>}
const field='w-full min-w-0 rounded-md border border-white/10 bg-[#101720] px-3 py-3 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-300/55 focus:ring-2 focus:ring-emerald-300/[0.10]';
function Panel({children,className=''}:{children:ReactNode;className?:string}){return <section className={'sjm-panel '+className}>{children}</section>}
function Kicker({children}:{children:ReactNode}){const label=typeof children==='string'?children.trim().toLowerCase().replace(/^./,c=>c.toUpperCase()).replace(/\bxd\b/g,'XD').replace(/\bsjm\b/g,'SJM').replace(/\bcpo\b/g,'CPO').replace(/\bapi\b/g,'API').replace(/\bgps\b/g,'GPS').replace(/\bsitrep\b/g,'SITREP').replace(/\bnbo\b/g,'NBO'):children;return <p className="sjm-kicker">{label}</p>}
function Btn({children,onClick,disabled=false,tone='neutral'}:{children:ReactNode;onClick:()=>void;disabled?:boolean;tone?:'neutral'|'green'|'red'}){const c=tone==='green'?'border-emerald-300/25 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/15':tone==='red'?'border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/15':'border-white/10 bg-white/[0.035] text-slate-300 hover:bg-white/[0.07] hover:text-white';return <button type="button" onClick={onClick} disabled={disabled} className={'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3.5 py-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9 '+c}>{children}</button>}
function StatusBadge({value}:{value:Status}){return <span className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]  '+META[value].cls}><i className="h-1.5 w-1.5 rounded-full bg-current"/>{META[value].label}</span>}

function EvidenceBadge({value}:{value?:string|null}){
 const v=String(value||'UNAVAILABLE').toUpperCase();
 const ok=['LIVE','RECORDED','COMPLETE','LINKED','GO','RECORDED_WITH_CONTROLS'].includes(v);
 const warn=['DELAYED','STALE','PENDING','INCOMPLETE','CONDITIONAL','HUMAN_REVIEW','NOT_REQUIRED_BY_CURRENT_GATE','NO_STOPS_DEFINED'].includes(v);
 const bad=['BLOCKED','REJECTED','NO_GO'].includes(v);
 const cls=ok?'border-emerald-300/25 bg-emerald-300/[0.07] text-emerald-100':warn?'border-amber-300/25 bg-amber-300/[0.06] text-amber-100':bad?'border-red-300/25 bg-red-400/[0.06] text-red-100':'border-white/[0.10] bg-white/[0.025] text-slate-400';
 return <span className={'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] '+cls}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{v.replaceAll('_',' ')}</span>;
}

function Gate({value}:{value?:string}){const v=String(value||'UNAVAILABLE').toUpperCase();const c=v==='GO'?'border-emerald-300/25 bg-emerald-300/10 text-emerald-100':v==='CONDITIONAL'?'border-amber-300/25 bg-amber-300/10 text-amber-100':v==='HUMAN_REVIEW'?'border-orange-300/25 bg-orange-300/10 text-orange-100':v==='NO_GO'?'border-red-300/25 bg-red-300/10 text-red-100':'border-white/10 bg-white/[0.03] text-slate-500';return <span className={'rounded-md border px-2 py-1 font-mono text-[11px] tracking-wider '+c}>{v.replaceAll('_',' ')}</span>}
function scheduleUrgencyPresentation(value?:string|null):{label:string;className:string;title:string}|null {
 if(value==='DEPARTURE_OVERDUE')return {label:'Departure overdue',className:'border-red-300/25 bg-red-300/[0.045] text-red-200',title:'The planned departure time is in the past. Confirm actual movement with the assigned team; this is not live GPS.'};
 if(value==='ARRIVAL_OVERDUE')return {label:'Arrival overdue',className:'border-red-300/25 bg-red-300/[0.045] text-red-200',title:'The planned arrival time is in the past. Confirm arrival or an exception with the assigned team; no automatic arrival is inferred.'};
 if(value==='DEPARTURE_DUE_30M')return {label:'Departing soon',className:'border-amber-300/25 bg-amber-300/[0.045] text-amber-200',title:'The stored planned departure is within 30 minutes. This is a schedule signal, not live dispatch telemetry.'};
 return null;
}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}



function journeyMarkerElement(kind:'origin'|'stop'|'destination'|'observed_live'|'observed_delayed'|'observed_stale'|'observed_unavailable', title:string):HTMLElement {
  const colors={origin:'#22d3ee',stop:'#fb923c',destination:'#4ade80',observed_live:'#39ff88',observed_delayed:'#fbbf24',observed_stale:'#fb923c',observed_unavailable:'#94a3b8'};
  const color=colors[kind];
  const root=document.createElement('div');
  root.setAttribute('role','img');root.setAttribute('aria-label',title);root.title=title;root.style.display='grid';root.style.placeItems='center';root.style.width='17px';root.style.height='17px';root.style.borderRadius='50%';root.style.pointerEvents='auto';root.style.cursor='help';
  const dot=document.createElement('span');
  dot.setAttribute('aria-hidden','true');dot.style.display='block';dot.style.width='11px';dot.style.height='11px';dot.style.borderRadius='50%';dot.style.backgroundColor=color;dot.style.border='2px solid #07111d';dot.style.boxShadow='0 0 0 3px '+color+'44';
  root.append(dot);
  return root;
}
function JourneyMap({journey,stops,geometry,assessment,telemetry}:{journey:Journey;stops:Stop[];geometry:Point[];assessment:Assessment|null;telemetry?:TelemetrySnapshot|null}){
  const containerRef=useRef<HTMLDivElement>(null);
  const mapRef=useRef<maplibregl.Map|null>(null);
  const markersRef=useRef<maplibregl.Marker[]>([]);
  const observedMarkersRef=useRef<maplibregl.Marker[]>([]);
  const [mapReady,setMapReady]=useState(false);
  const [satellite,setSatellite]=useState(false);
  const [showObserved,setShowObserved]=useState(true);
  const origin=useMemo(()=>mapCoord(journey.origin_lat,journey.origin_lng),[journey.origin_lat,journey.origin_lng]);
  const destination=useMemo(()=>mapCoord(journey.destination_lat,journey.destination_lng),[journey.destination_lat,journey.destination_lng]);
  const routeCoords=useMemo(()=>{
    const coords=geometry.map(p=>mapCoord(p.lat,p.lng));
    return coords.length>=2&&coords.every((p)=>p!==null)?coords as [number,number][]:[];
  },[geometry]);
  const hasRoutedGeometry=assessment?.route_status==='routed'&&routeCoords.length>=2;
  const displayRoute=useMemo(()=>hasRoutedGeometry?routeCoords:[],[hasRoutedGeometry,routeCoords]);
  const stopPoints=useMemo(()=>stops.map(stop=>({stop,coord:mapCoord(stop.lat,stop.lng)})).filter((x):x is {stop:Stop;coord:[number,number]}=>x.coord!==null),[stops]);
  const observedPoints=useMemo(()=>((telemetry?.devices)||[]).map(device=>({device,coord:mapCoord(device.lat,device.lng)})).filter((x):x is {device:TelemetryDevice;coord:[number,number]}=>x.coord!==null),[telemetry?.devices]);
  const fitPoints=useMemo(()=>[...(origin?[origin]:[]),...displayRoute,...(destination?[destination]:[]),...stopPoints.map(p=>p.coord)],[origin,destination,displayRoute,stopPoints]);
  useEffect(()=>{
    const container=containerRef.current;
    if(!container||mapRef.current)return;
    const map=new maplibregl.Map({container,style:STREET_STYLE,center:[37.5,-1.3],zoom:5,attributionControl:false,maxPitch:55});
     container.dataset.sjmMapState='loading';
    map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true}),'bottom-right');
    map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-left');
    map.on('load',()=>{container.dataset.sjmMapState='loaded';setMapReady(true)});
    mapRef.current=map;
    const resizeObserver=new ResizeObserver(()=>map.resize());
    resizeObserver.observe(container);
    return ()=>{
      resizeObserver.disconnect();
      markersRef.current.forEach(marker=>marker.remove());
      markersRef.current=[];
      observedMarkersRef.current.forEach(marker=>marker.remove());
      observedMarkersRef.current=[];
      map.remove();
      mapRef.current=null;
      setMapReady(false);
    };
  },[]);
  useEffect(()=>{
    const map=mapRef.current;
    if(!map||!mapReady)return;
    const container=containerRef.current;
     if(!container)return;
     const markFitSettled=()=>{container.dataset.sjmMapState='fitting';map.once('idle',()=>{container.dataset.sjmMapState=map.areTilesLoaded()?'ready':'partial';container.dataset.sjmMapZoom=map.getZoom().toFixed(2)})};
     const routeData:GeoJSON.FeatureCollection={type:'FeatureCollection',features:displayRoute.length>=2?[{type:'Feature',geometry:{type:'LineString',coordinates:displayRoute},properties:{evidence:'ROUTE_SAFETY'}}]:[]};
    const existing=map.getSource('sjm-route') as maplibregl.GeoJSONSource|undefined;
    if(existing){
      existing.setData(routeData);
    }else{
      map.addSource('sjm-route',{type:'geojson',data:routeData});
      map.addLayer({id:'sjm-route-line',type:'line',source:'sjm-route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#6ee7a0','line-width':3,'line-opacity':0.96}});
    }
    markersRef.current.forEach(marker=>marker.remove());
    markersRef.current=[];
    const addMarker=(coord:[number,number]|null,kind:'origin'|'stop'|'destination',title:string)=>{
      if(!coord)return;
      markersRef.current.push(new maplibregl.Marker({element:journeyMarkerElement(kind,title),anchor:'bottom',offset:[0,-7]}).setLngLat(coord).addTo(map));
    };
    addMarker(origin,'origin','Origin · '+journey.origin_label);
    stopPoints.forEach(({stop,coord})=>addMarker(coord,'stop','Stop '+String(stop.sequence).padStart(2,'0')+' · '+stop.name));
    addMarker(destination,'destination','Destination · '+journey.destination_label);
    map.resize();
    markFitSettled();
     if(fitPoints.length>1){
      const bounds=new maplibregl.LngLatBounds();
      fitPoints.forEach(point=>bounds.extend(point));
      map.fitBounds(bounds,{padding:{top:65,bottom:70,left:38,right:52},maxZoom:9,duration:650});
    }else if(fitPoints.length===1){
      map.flyTo({center:fitPoints[0],zoom:6,duration:500});
    }
  },[mapReady,displayRoute,origin,destination,stopPoints,fitPoints,journey.origin_label,journey.destination_label]);
  useEffect(()=>{
    const map=mapRef.current;
    if(!map||!mapReady)return;
    observedMarkersRef.current.forEach(marker=>marker.remove());
    observedMarkersRef.current=[];
    if(!showObserved)return;
    observedPoints.forEach(({device,coord})=>{
      const freshness=String(device.freshness||'UNAVAILABLE').toUpperCase();
      const kind=freshness==='LIVE'?'observed_live':freshness==='DELAYED'?'observed_delayed':freshness==='STALE'?'observed_stale':'observed_unavailable';
      const title='OBSERVED '+freshness+' · '+device.device_name+' · '+dateText(device.observed_at);
      observedMarkersRef.current.push(new maplibregl.Marker({element:journeyMarkerElement(kind,title),anchor:'bottom',offset:[0,-7]}).setLngLat(coord).addTo(map));
    });
  },[mapReady,showObserved,observedPoints]);
  const toggleBasemap=()=>{
    const map=mapRef.current;if(!map)return;
    const next=!satellite;
    setMapReady(false);
    map.setStyle(next?SAT_STYLE:STREET_STYLE);
    map.once('style.load',()=>setMapReady(true));
    setSatellite(next);
  };
  const fitMap=()=>{
    const map=mapRef.current;if(!map||fitPoints.length===0)return;
    map.resize();
    if(fitPoints.length===1){map.flyTo({center:fitPoints[0],zoom:6,duration:500});return;}
    const bounds=new maplibregl.LngLatBounds();fitPoints.forEach(point=>bounds.extend(point));
    map.fitBounds(bounds,{padding:{top:65,bottom:70,left:38,right:52},maxZoom:9,duration:650});
  };
  return <div className="overflow-hidden rounded-lg border border-[#2a3948] bg-[#0b131c]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] bg-black/20 px-3 py-2.5">
      <div><p className="text-xs font-semibold text-slate-200">Route map</p><p className="mt-1 text-[11px] text-slate-500">{hasRoutedGeometry?'Assessed path · '+displayRoute.length+' waypoints':'No assessed route path · planned locations only'}</p></div>
      <div className="flex flex-wrap gap-1.5"><button type="button" onClick={toggleBasemap} className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-2 text-[11px] text-slate-300 hover:bg-white/[0.08]" aria-label={satellite?'Switch to street basemap':'Switch to satellite basemap'}><Satellite size={12}/>{satellite?'Satellite':'Street'}</button><button type="button" onClick={()=>setShowObserved(value=>!value)} disabled={observedPoints.length===0} className={'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 '+(showObserved?'border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100':'border-white/10 bg-white/[0.035] text-slate-300 hover:bg-white/[0.08]')} aria-pressed={showObserved} aria-label={showObserved?'Hide observed device layer':'Show observed device layer'}><Activity size={12}/>{showObserved?'Hide device observations':'Show device observations'} · {observedPoints.length}</button><button type="button" onClick={fitMap} className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-2 text-[11px] text-slate-300 hover:bg-white/[0.08]" aria-label="Fit map to planned route"><Maximize2 size={12}/>Fit route</button></div>
    </div>
    <div ref={containerRef} data-sjm-map="journey" data-sjm-map-state="loading" role="img" aria-label="Map of the selected journey showing planned locations and any assessed route" className="h-[320px] w-full bg-[#07111d] sm:h-[390px] xl:h-[470px] 2xl:h-[520px]"/>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2 text-[11px] font-mono text-slate-500">
      {hasRoutedGeometry&&<span>Geometry source: Route Safety</span>}
      <span className="flex flex-wrap gap-3"><span className="text-slate-300">● Planned origin</span><span className="text-orange-300">● Planned stop</span><span className="text-emerald-200">● Planned destination</span>{showObserved&&observedPoints.length>0&&<span className="text-emerald-300">● Observed device fix ({observedPoints.length})</span>}{!showObserved&&observedPoints.length>0&&<span className="text-slate-500">Observed layer hidden ({observedPoints.length})</span>}</span>
    </div>
  </div>;
}


function IntakeMapPicker({onPick,targetKey}:{onPick:(point:{lat:number;lng:number})=>void;targetKey:string}){
 const containerRef=useRef<HTMLDivElement>(null);
 const mapRef=useRef<maplibregl.Map|null>(null);
 const pickedMarkerRef=useRef<maplibregl.Marker|null>(null);
 const onPickRef=useRef(onPick);
 useEffect(()=>{onPickRef.current=onPick},[onPick]);
 useEffect(()=>{
  const container=containerRef.current;
  if(!container||mapRef.current)return;
  const map=new maplibregl.Map({container,style:STREET_STYLE,center:[37.5,-1.3],zoom:4.7,attributionControl:false,maxPitch:35});
  map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true}),'top-right');
  map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-left');
  map.on('click',(event)=>{
   const point={lat:Number(event.lngLat.lat.toFixed(6)),lng:Number(event.lngLat.lng.toFixed(6))};
   if(pickedMarkerRef.current)pickedMarkerRef.current.setLngLat([point.lng,point.lat]);
   else pickedMarkerRef.current=new maplibregl.Marker({color:'#6ee7a0'}).setLngLat([point.lng,point.lat]).addTo(map);
   onPickRef.current(point);
  });
  mapRef.current=map;
  const resizeObserver=new ResizeObserver(()=>map.resize());
  resizeObserver.observe(container);
  return ()=>{
   resizeObserver.disconnect();
   pickedMarkerRef.current?.remove();
   pickedMarkerRef.current=null;
   map.remove();
   mapRef.current=null;
  };
 },[]);
 useEffect(()=>{
  pickedMarkerRef.current?.remove();
  pickedMarkerRef.current=null;
 },[targetKey]);
 return <div className="overflow-hidden rounded-md border border-emerald-300/15 bg-[#07111d]">
  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] bg-black/20 px-3 py-2.5"><div><p className="font-mono text-[11px] font-semibold  tracking-[.16em] text-emerald-200">Choose coordinates from the map</p><p className="mt-1 text-[11px] text-slate-500">Click the map to set coordinates. Enter the place name separately; coordinates do not create a place name.</p></div><span className="rounded-md border border-white/[0.08] px-2 py-1 font-mono text-[11px] text-slate-500">Choose on map</span></div>
  <div ref={containerRef} className="h-[260px] w-full bg-[#07111d] sm:h-[340px]"/>
  <div className="border-t border-white/[0.06] px-3 py-2 text-[11px] leading-5 text-slate-600">Map clicks capture coordinates only. Enter place names separately, then assess the route before approval.</div>
 </div>;
}

export default function SecureJourneyManagement(){
 const qc=useQueryClient();
 const currentUser=useAuthStore(s=>s.user);
 const isSupervisor=['admin','dispatcher'].includes(String(currentUser?.role||'').toLowerCase());
 const [selectedId,setSelectedId]=useState('');
 const selectedIdRef=useRef('');
 useEffect(()=>{selectedIdRef.current=selectedId},[selectedId]);
 const [showCreate,setShowCreate]=useState(false);
 const [intakeMode,setIntakeMode]=useState<'create'|'edit'>('create');
 const [editAcknowledged,setEditAcknowledged]=useState(false);
 const [editBaseline,setEditBaseline]=useState<{journeyId:string;timezone:string;departureInput:string;departureAt:string|null;arrivalInput:string;arrivalAt:string|null}|null>(null);
 const [workspaceTab,setWorkspaceTab]=useState<'overview'|'command'|'itinerary'|'evidence'|'reports'>('overview');
 const [reportType,setReportType]=useState('daily');
 const [lastGeneratedReport,setLastGeneratedReport]=useState<{id:string;report_date:string;report_type:string}|null>(null);
 const [reportDownloadError,setReportDownloadError]=useState('');
 const [form,setForm]=useState({...EMPTY});
 const [stopDrafts,setStopDrafts]=useState<StopDraft[]>([]);
 const [intakeStep,setIntakeStep]=useState<0|1|2|3>(0);
 const [intakePickTarget,setIntakePickTarget]=useState<IntakePickTarget>(null);
 const [filter,setFilter]=useState('all');const [search,setSearch]=useState('');const [registerSearch,setRegisterSearch]=useState('');const [registerPage,setRegisterPage]=useState(0);const [registerSort,setRegisterSort]=useState<RegisterSort>('priority');
 const [ack,setAck]=useState('');const [departureNote,setDepartureNote]=useState('');const [arrivalNote,setArrivalNote]=useState('');const [transitionReason,setTransitionReason]=useState('');const [reviewChoice,setReviewChoice]=useState('approve_with_controls');const [reviewNote,setReviewNote]=useState('');const [cancelNote,setCancelNote]=useState('');
 const [eventType,setEventType]=useState('operator_note');const [eventTitle,setEventTitle]=useState('');const [eventDetail,setEventDetail]=useState('');const [eventSeverity,setEventSeverity]=useState('medium');
  const [showFlightStatusForm,setShowFlightStatusForm]=useState(false);
  const [flightStatusDraft,setFlightStatusDraft]=useState('scheduled');
  const [flightStatusNote,setFlightStatusNote]=useState('');

 const intakeStepIssue=useMemo(()=>{
  if(intakeStep===3&&intakeMode==='edit'&&!editAcknowledged)return 'Acknowledge that this revision invalidates the prior route assessment and release authorisations.';
  if(intakeStep===0){
   if(!form.title.trim())return 'Add a clear journey title.';
   if(!form.purpose.trim())return 'Record the operational purpose and constraints.';
   try{new Intl.DateTimeFormat('en',{timeZone:form.timezone}).format(new Date())}catch{return 'Choose a valid IANA reporting timezone, for example Africa/Nairobi.'}
   return null;
  }
  if(intakeStep===1){
   if(!form.origin_label.trim()||!form.destination_label.trim())return 'Name both the origin and destination.';
   if(!mapCoord(form.origin_lat,form.origin_lng))return 'Set a valid origin latitude/longitude pair. The map picker can capture it.';
   if(!mapCoord(form.destination_lat,form.destination_lng))return 'Set a valid destination latitude/longitude pair. The map picker can capture it.';
   try{
    const departure=localDateTimeInTimezone(form.planned_departure_at,form.timezone);
    const arrival=localDateTimeInTimezone(form.planned_arrival_at,form.timezone);
    if(!departure||!arrival)return 'Set both planned departure and planned arrival times.';
    if(Date.parse(arrival)<=Date.parse(departure))return 'Planned arrival must be after planned departure.';
   }catch(error){return errorText(error,'Check the selected timezone and movement window.')}
   return null;
  }
  if(intakeStep===2){
   const incomplete=stopDrafts.findIndex(s=>!s.name.trim()||!mapCoord(s.lat,s.lng));
   if(incomplete>=0)return 'Complete the name and a valid coordinate pair for stop '+(incomplete+1)+', or remove that draft.';
   return null;
  }
  return null;
 },[intakeStep,form,stopDrafts,intakeMode,editAcknowledged]);
 const applyIntakeMapPoint=(point:{lat:number;lng:number})=>{
  const lat=point.lat.toFixed(6),lng=point.lng.toFixed(6);
  if(intakePickTarget==='origin')setForm(prev=>({...prev,origin_lat:lat,origin_lng:lng}));
  else if(intakePickTarget==='destination')setForm(prev=>({...prev,destination_lat:lat,destination_lng:lng}));
  else if(intakePickTarget&&typeof intakePickTarget==='object')setStopDrafts(prev=>prev.map((stop,index)=>index===intakePickTarget.stopIndex?{...stop,lat,lng}:stop));
 };
 const intakePickLabel=intakePickTarget==='origin'?'Origin':intakePickTarget==='destination'?'Destination':intakePickTarget&&typeof intakePickTarget==='object'?'Stop '+(intakePickTarget.stopIndex+1):'No map target selected';

 const [editingProfile,setEditingProfile]=useState(false);const [profileTimezone,setProfileTimezone]=useState('Africa/Nairobi');const [profileTitle,setProfileTitle]=useState('Secure Journey Management Report');const [profileSections,setProfileSections]=useState(SECTIONS.map(s=>s.id));const [dailyReportsEnabled,setDailyReportsEnabled]=useState(false);const [dailyReportTime,setDailyReportTime]=useState('18:00');

 const clientsQ=useQuery<{data:Client[]}>({queryKey:['sjm-clients'],queryFn:async()=>(await api.get('/sjm/clients')).data,enabled:isSupervisor});
 const convoysQ=useQuery<{data:Convoy[]}>({queryKey:['sjm-convoys'],queryFn:async()=>(await api.get('/sjm/convoys')).data,enabled:isSupervisor});
 useEffect(()=>{const timer=window.setTimeout(()=>{setRegisterSearch(search.trim());setRegisterPage(0)},250);return ()=>window.clearTimeout(timer)},[search]);
 const registerQ=useQuery<JourneyRegisterResponse>({queryKey:['sjm-journeys',registerPage,filter,registerSearch,registerSort],queryFn:async()=>(await api.get('/sjm/journeys',{params:{limit:100,offset:registerPage*100,filter,search:registerSearch,sort:registerSort}})).data,refetchInterval:30000,placeholderData:previous=>previous});
 const journeys=registerQ.data?.data||[],clients=clientsQ.data?.data||[],convoys=convoysQ.data?.data||[];
 useEffect(()=>{if(!registerQ.isSuccess||registerQ.isPlaceholderData)return;if(journeys.length===0){if(selectedId)setSelectedId('');return;}if(!journeys.some(j=>j.id===selectedId))setSelectedId(journeys[0].id)},[registerQ.isSuccess,registerQ.isPlaceholderData,journeys,selectedId]);
 const selectedSummary=journeys.find(j=>j.id===selectedId);
 const detailQ=useQuery<{data:Journey}>({queryKey:['sjm-journey',selectedId],enabled:Boolean(selectedId),queryFn:async()=>(await api.get('/sjm/journeys/'+selectedId)).data,refetchInterval:['in_progress','paused','exception','arrival_pending_verification'].includes(selectedSummary?.status||'')?30000:false});
 const journey=detailQ.data?.data||selectedSummary;
 const assess=assessmentOf(journey?.route_assessment),geometry=routeOf(journey?.planned_route),stops=journey?.stops||[],events=journey?.events||[];
 const canConfirmStops=isSupervisor||(journey?.duty_roles||[]).some(role=>['driver','backup_driver'].includes(role));
 const canOperateLifecycle=isSupervisor||(journey?.duty_roles||[]).some(role=>['driver','backup_driver','cpo','security_escort','dispatcher'].includes(role));
  const canRecordFlightStatus=isSupervisor||(journey?.duty_roles||[]).some(role=>['cpo','meet_greet','dispatcher'].includes(role));
  const hasFlightContext=Boolean(journey&&(journey.flight_number||journey.airline||journey.airport_code||['airport_arrival','airport_departure','meet_and_greet'].includes(journey.service_type||'')));
 const canStartMovement=isSupervisor||(journey?.duty_roles||[]).some(role=>['driver','backup_driver'].includes(role));
 const profileQ=useQuery<{data:Profile}>({queryKey:['sjm-client-profile',journey?.client_id],enabled:Boolean(journey?.client_id&&isSupervisor),queryFn:async()=>(await api.get('/sjm/client-profiles/'+journey?.client_id)).data});
 const teamUsersQ=useQuery<{data:TeamUser[]}>({queryKey:['sjm-team-users',currentUser?.org_id],queryFn:async()=>(await api.get('/messages/org-users')).data,enabled:isSupervisor,staleTime:300000});
 const participantsQ=useQuery<{data:Participant[]}>({queryKey:['sjm-participants',selectedId],queryFn:async()=>(await api.get('/sjm/journeys/'+selectedId+'/participants')).data,enabled:Boolean(selectedId&&isSupervisor)});
 const [teamDraft,setTeamDraft]=useState<{user_id:string;duty_role:string;is_primary:boolean;user_name:string;account_role:string}[]>([]);
 const [teamUserId,setTeamUserId]=useState(''),[teamRole,setTeamRole]=useState('driver');
 useEffect(()=>{if(participantsQ.isSuccess)setTeamDraft((participantsQ.data?.data||[]).filter(p=>!p.removed_at).map(p=>({user_id:p.user_id,duty_role:p.duty_role,is_primary:p.is_primary,user_name:p.user_name,account_role:p.account_role})))},[participantsQ.data,participantsQ.isSuccess,selectedId]);
 const saveTeam=useMutation({mutationFn:async()=>{if(!journey)throw new Error('Select a journey first.');return (await api.put('/sjm/journeys/'+journey.id+'/participants',{participants:teamDraft.map(({user_id,duty_role,is_primary})=>({user_id,duty_role,is_primary}))})).data},onSuccess:async()=>{await qc.invalidateQueries({queryKey:['sjm-participants',selectedId]});await qc.invalidateQueries({queryKey:['sjm-journeys']});await qc.invalidateQueries({queryKey:['sjm-journey',selectedId]})}});
 const profile=profileQ.data?.data;
 const hasRegisterContract=Boolean(registerQ.data?.pagination&&registerQ.data?.summary);
 const stats=registerQ.data?.summary;
 const legacyVisible=journeys.filter(j=>{
  const now=Date.now();
  const departure=j.planned_departure_at?Date.parse(j.planned_departure_at):NaN;
  const arrival=j.planned_arrival_at?Date.parse(j.planned_arrival_at):NaN;
  const departureStatuses=['approved','ready_to_depart'].includes(j.status);
  const arrivalStatuses=['in_progress','paused','exception'].includes(j.status);
  const overdue=(departureStatuses&&Number.isFinite(departure)&&departure<now)||(arrivalStatuses&&Number.isFinite(arrival)&&arrival<now);
  const departureDue=departureStatuses&&Number.isFinite(departure)&&departure>=now&&departure<=now+30*60*1000;
  const active=['in_progress','paused','exception','arrival_pending_verification'].includes(j.status);
  const attention=['paused','exception','on_hold','arrival_pending_verification'].includes(j.status)||['HUMAN_REVIEW','NO_GO'].includes(assessmentOf(j.route_assessment)?.safety_gate||'');
  const matchesFilter=filter==='all'||(filter==='active'&&active)||(filter==='attention'&&attention)||(filter==='review'&&j.status==='ready_for_review')||(filter==='planning'&&['requested','planning','assessment_pending'].includes(j.status))||(filter==='overdue'&&overdue)||(filter==='departure_due_30m'&&departureDue)||(filter==='closed'&&['closed','cancelled','aborted'].includes(j.status))||j.status===filter;
  return matchesFilter&&(registerSearch.trim()===''||[j.reference,j.title,j.client_name,j.origin_label,j.destination_label,j.convoy_name].some(value=>String(value||'').toLowerCase().includes(registerSearch.toLowerCase())));
 }).slice().sort((a,b)=>compareRegisterRows(a,b,registerSort));
 const visible=hasRegisterContract?journeys:legacyVisible;
 const refresh=async()=>{await qc.invalidateQueries({queryKey:['sjm-journeys']});if(selectedId)await qc.invalidateQueries({queryKey:['sjm-journey',selectedId]})};
 const downloadReportArtifact=async(id:string,date:string,type:string,format:'PDF'|'CSV')=>{setReportDownloadError('');try{const b=await api.get('/sjm/reports/'+id+'/download',{params:{format},responseType:'blob'});download(b.data as Blob,'sonalit-sjm-'+type+'-'+date+'.'+format.toLowerCase())}catch(error){setReportDownloadError(type.replaceAll('_',' ')+' report is saved, but '+format+' export failed: '+errorText(error,'Download request failed.')+' You can retry the export below.')}};

 const buildJourneyPayload=()=>{
  const baselineMatches=intakeMode==='edit'&&editBaseline?.journeyId===journey?.id&&editBaseline.timezone===form.timezone;
  return {...form,
   origin_lat:Number(form.origin_lat),origin_lng:Number(form.origin_lng),
   destination_lat:Number(form.destination_lat),destination_lng:Number(form.destination_lng),
   planned_departure_at:baselineMatches&&form.planned_departure_at===editBaseline?.departureInput?editBaseline.departureAt:localDateTimeInTimezone(form.planned_departure_at,form.timezone),
   planned_arrival_at:baselineMatches&&form.planned_arrival_at===editBaseline?.arrivalInput?editBaseline.arrivalAt:localDateTimeInTimezone(form.planned_arrival_at,form.timezone),
   client_id:form.client_id||null,convoy_id:form.convoy_id||null,
   flight_scheduled_at:form.flight_scheduled_at?localDateTimeInTimezone(form.flight_scheduled_at,form.timezone):null,airport_code:form.airport_code.trim().toUpperCase()||null,flight_number:form.flight_number.trim().toUpperCase()||null,principal_reference:form.principal_reference.trim()||null,terminal:form.terminal.trim()||null,airline:form.airline.trim()||null,meet_greet_instructions:form.meet_greet_instructions.trim()||null,
   stops:stopDrafts.map(s=>({name:s.name,stop_type:s.stop_type,lat:s.lat===''?null:Number(s.lat),lng:s.lng===''?null:Number(s.lng),instructions:s.instructions||null,planned_arrival_at:s.planned_arrival_at||null,planned_departure_at:s.planned_departure_at||null,duration_minutes:s.duration_minutes??null})),
   ...(intakeMode==='edit'?{acknowledge_route_authorization_invalidation:editAcknowledged}:{})
  };
 };
 const create=useMutation({mutationFn:async()=> (await api.post('/sjm/journeys',buildJourneyPayload())).data.data as Journey,onSuccess:async j=>{setShowCreate(false);setIntakeMode('create');setEditAcknowledged(false);setEditBaseline(null);setIntakeStep(0);setIntakePickTarget(null);setForm({...EMPTY});setStopDrafts([]);setSelectedId(j.id);await qc.invalidateQueries({queryKey:['sjm-journeys']});await qc.invalidateQueries({queryKey:['sjm-journey',j.id]})}});
 const updateJourney=useMutation({mutationFn:async()=>{
  const source=detailQ.data?.data;
  if(!journey||!source)throw new Error('Reload the journey details before editing.');
  if(!isSupervisor)throw new Error('Only admin/dispatcher roles may revise a journey.');
  if(!['requested','planning'].includes(source.status))throw new Error('This journey is no longer editable. Refresh its current status.');
  return (await api.patch('/sjm/journeys/'+source.id,buildJourneyPayload())).data.data as Journey;
 },onSuccess:async j=>{setShowCreate(false);setIntakeMode('create');setEditAcknowledged(false);setEditBaseline(null);setIntakeStep(0);setIntakePickTarget(null);setForm({...EMPTY});setStopDrafts([]);setSelectedId(j.id);await qc.invalidateQueries({queryKey:['sjm-journeys']});await qc.invalidateQueries({queryKey:['sjm-journey',j.id]})}});
 const resetIntake=()=>{
  setShowCreate(false);setIntakeMode('create');setEditAcknowledged(false);setEditBaseline(null);setIntakeStep(0);setIntakePickTarget(null);setForm({...EMPTY});setStopDrafts([]);create.reset();updateJourney.reset();
 };
 const openCreate=()=>{
  setIntakeMode('create');setEditAcknowledged(false);setEditBaseline(null);setIntakeStep(0);setIntakePickTarget(null);setForm({...EMPTY});setStopDrafts([]);create.reset();updateJourney.reset();setShowCreate(true);
 };
 const startEdit=()=>{
  const source=detailQ.data?.data;
  if(!source||!isSupervisor||!['requested','planning'].includes(source.status))return;
  const timezone=source.timezone||'Africa/Nairobi';
  const departureInput=localDateTimeInputInTimezone(source.planned_departure_at,timezone);
  const arrivalInput=localDateTimeInputInTimezone(source.planned_arrival_at,timezone);
  setIntakeMode('edit');setEditAcknowledged(false);setIntakeStep(0);setIntakePickTarget(null);
  setEditBaseline({journeyId:source.id,timezone,departureInput,departureAt:source.planned_departure_at||null,arrivalInput,arrivalAt:source.planned_arrival_at||null});
  setForm({title:source.title||'',purpose:source.purpose||'',client_id:source.client_id||'',convoy_id:source.convoy_id||'',service_type:source.service_type||'executive_transfer',principal_reference:source.principal_reference||'',airport_code:source.airport_code||'',terminal:source.terminal||'',airline:source.airline||'',flight_number:source.flight_number||'',flight_scheduled_at:localDateTimeInputInTimezone(source.flight_scheduled_at,timezone),meet_greet_instructions:source.meet_greet_instructions||'',transport_mode:source.transport_mode||'road',origin_label:source.origin_label||'',origin_lat:String(source.origin_lat??''),origin_lng:String(source.origin_lng??''),destination_label:source.destination_label||'',destination_lat:String(source.destination_lat??''),destination_lng:String(source.destination_lng??''),planned_departure_at:departureInput,planned_arrival_at:arrivalInput,timezone});
  setStopDrafts((source.stops||[]).map(s=>({name:s.name,stop_type:s.stop_type,lat:s.lat==null?'':String(s.lat),lng:s.lng==null?'':String(s.lng),instructions:s.instructions||'',planned_arrival_at:s.planned_arrival_at||null,planned_departure_at:s.planned_departure_at||null,duration_minutes:s.duration_minutes??null})));
  create.reset();updateJourney.reset();setShowCreate(true);
 };
 const act=useMutation({mutationFn:async({kind,body={}}:{kind:'plan'|'review'|'approve'|'lifecycle'|'report'|'event'|'stop'|'management_summary';body?:Record<string,unknown>})=>{
  if(kind==='management_summary')return(await api.post('/sjm/management-summary',body)).data;
  if(!journey)throw new Error('Select a journey first.');
  if(kind==='plan')return(await api.post('/sjm/journeys/'+journey.id+'/plan',body)).data;
  if(kind==='review')return(await api.post('/sjm/journeys/'+journey.id+'/review',body)).data;
  if(kind==='approve')return(await api.post('/sjm/journeys/'+journey.id+'/approve',body)).data;
  if(kind==='lifecycle')return(await api.post('/sjm/journeys/'+journey.id+'/lifecycle',body)).data;
  if(kind==='event')return(await api.post('/sjm/journeys/'+journey.id+'/events',body)).data;
  if(kind==='stop')return(await api.patch('/sjm/journeys/'+journey.id+'/stops/'+String(body.stop_id)+'/status',{status:body.status})).data;
  return(await api.post('/sjm/journeys/'+journey.id+'/reports',body)).data as Report;
 },onSuccess:async(result,vars)=>{if(vars.kind==='report'||vars.kind==='management_summary'){const r=result as {data:{id:string;report_date:string;report_type:string}};setLastGeneratedReport({id:r.data.id,report_date:r.data.report_date,report_type:r.data.report_type});await downloadReportArtifact(r.data.id,r.data.report_date,r.data.report_type,'PDF')}if(vars.kind==='event'){setEventTitle('');setEventDetail('')}if(vars.kind==='review')setReviewNote('');await refresh()},onError:async()=>{await refresh()}});
 const saveProfile=useMutation({mutationFn:async()=>{if(!journey?.client_id)throw new Error('Link this journey to a real client first.');return(await api.put('/sjm/client-profiles/'+journey.client_id,{report_timezone:profileTimezone,report_template:{title:profileTitle,sections:profileSections},daily_reports_enabled:dailyReportsEnabled,daily_report_local_time:dailyReportTime})).data},onSuccess:async()=>{setEditingProfile(false);await qc.invalidateQueries({queryKey:['sjm-client-profile',journey?.client_id]})}});
 const openMissionComms=useMutation({
  mutationFn:async()=>{
   if(!journey)throw new Error('Select a journey first.');
   const response=await api.get<{data:{channel_id:string}}>('/sjm/journeys/'+journey.id+'/communications');
   const channelId=response.data?.data?.channel_id;
   if(typeof channelId!=='string'||!/^[0-9a-f-]{36}$/i.test(channelId))throw new Error('Sonalit did not return a secure channel for this journey.');
   return channelId;
  },
  onSuccess:(channelId)=>window.location.assign('/messages?channelId='+encodeURIComponent(channelId))
 });
 const recordFlightStatus=useMutation({
  mutationFn:async(submission:{journeyId:string;flightNumber:string;flightStatus:string;note:string})=>{
   if(!submission.journeyId)throw new Error('Select a journey first.');
   if(!submission.flightNumber.trim())throw new Error('Add a flight number before recording status.');
   return (await api.patch('/sjm/journeys/'+submission.journeyId+'/flight-status',{flight_status:submission.flightStatus,note:submission.note.trim()||null})).data as {data:{id:string;flight_status:string};provenance:{source:string;evidence_class:string;provider_feed_connected:boolean}};
  },
  onSuccess:async(result,submission)=>{
   await Promise.all([
    qc.invalidateQueries({queryKey:['sjm-journeys']}),
    qc.invalidateQueries({queryKey:['sjm-journey',submission.journeyId]})
   ]);
   if(selectedIdRef.current!==submission.journeyId)return;
   setFlightStatusDraft(result.data.flight_status||submission.flightStatus);
   setShowFlightStatusForm(false);
   setFlightStatusNote('');
  }
 });
 const flightStatusSavePending=Boolean(journey&&recordFlightStatus.isPending&&recordFlightStatus.variables?.journeyId===journey.id);
 const flightStatusSaveError=Boolean(journey&&recordFlightStatus.isError&&recordFlightStatus.variables?.journeyId===journey.id);
 const choose=(id:string)=>{
  const selectionChanged=id!==selectedId;
  selectedIdRef.current=id;
  if(selectionChanged){
   setShowFlightStatusForm(false);
   setFlightStatusDraft('scheduled');
   setFlightStatusNote('');
   recordFlightStatus.reset();
  }
  setSelectedId(id);setAck('');setReviewNote('');setCancelNote('');setEditingProfile(false);setWorkspaceTab('overview');
  // The mission workspace precedes the register below xl on purpose. When an
  // operator selects a different row from that lower register, return the
  // selected dossier/map to view and move focus to its heading. Do not affect
  // desktop dispatch or filter/page actions.
  if(selectionChanged&&typeof window!=='undefined'&&window.matchMedia('(max-width: 1279px)').matches){
   const behavior:ScrollBehavior=window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
   window.requestAnimationFrame(()=>{
    document.getElementById('sjm-mission-workspace')?.scrollIntoView({behavior,block:'start'});
    document.getElementById('sjm-selected-mission-title')?.focus({preventScroll:true});
   });
  }
 };
 const configureProfile=()=>{setProfileTimezone(profile?.report_timezone||'Africa/Nairobi');setProfileTitle(profile?.report_template?.title||'Secure Journey Management Report');setProfileSections(profile?.report_template?.sections||SECTIONS.map(s=>s.id));setDailyReportsEnabled(profile?.daily_reports_enabled===true);setDailyReportTime(String(profile?.daily_report_local_time||'18:00').slice(0,5));setEditingProfile(true)};
 const report=(report_type:string)=>act.mutate({kind:'report',body:{report_type}});
 const isTerminal=Boolean(journey&&['closed','cancelled','aborted'].includes(journey.status));

return (
  <main className="sjm-console relative min-h-full overflow-y-auto bg-[#080c12] text-slate-100 antialiased">
   <div className="relative mx-auto max-w-[1760px] space-y-5 p-3 sm:p-5 lg:p-7">
    <header className="rounded-lg border border-[#283544] bg-[#101720] p-4 sm:p-6 xl:p-7">
     <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="max-w-3xl">
       <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-semibold tracking-[.04em] text-emerald-300">XD Live Surveillance</span>
        <span className="text-slate-600">/</span>
        <span className="text-slate-400">Operations</span>
       </div>
       <h1 className="text-[clamp(1.5rem,2.2vw,2.2rem)] font-semibold leading-tight tracking-tight text-white">Secure Journey Management</h1>
       <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Plan and coordinate executive journeys, from route assessment through verified closeout.</p>
       <div className="mt-3 hidden flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400 sm:flex">
        <span className="inline-flex items-center gap-2"><ShieldCheck size={13} className="text-emerald-300"/>Organisation-scoped records</span>
        <span className="inline-flex items-center gap-2"><Route size={13} className="text-slate-300"/>Route Safety review</span>
        <span className="inline-flex items-center gap-2"><Activity size={13} className="text-slate-300"/>Recorded decisions</span>
       </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 xl:min-w-[420px] xl:items-end">
       <div className="flex w-full flex-wrap items-center gap-2 xl:justify-end">
        <div className="inline-flex min-h-[38px] items-center gap-2 rounded-md border border-white/[0.09] bg-black/25 px-3 py-2">
         <span className={'h-2 w-2 rounded-full '+(registerQ.isError?'bg-red-400':registerQ.isFetching?'animate-pulse bg-amber-300':'bg-emerald-300')}/>
         <span className="font-mono text-[11px] font-semibold  tracking-[.15em] text-slate-300">{registerQ.isError?(registerQ.data?'Update failed · showing saved data':'Journey list unavailable'):registerQ.isFetching?'Updating journey list':registerQ.isSuccess?'Journey list ready':'Waiting for data'}</span>
         <span className="hidden border-l border-white/10 pl-2 text-[11px] text-slate-500 sm:inline">Auto-refresh · 30 sec</span>
        </div>
        <div className="hidden flex-1 text-[11px] text-slate-500 sm:block sm:flex-none xl:text-right">
         <span className="block font-mono  tracking-[.14em] text-slate-600">Last updated</span>
         <span className="mt-1 block text-slate-300">{registerQ.dataUpdatedAt?new Date(registerQ.dataUpdatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Waiting for first update'}</span>
        </div>
       </div>
       <div className="flex flex-wrap gap-2 xl:justify-end">
        <Link to="/corridor/missions" className="hidden items-center gap-2 rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 text-[11px] font-semibold text-slate-200 sm:inline-flex">Field team app <ArrowUpRight size={13}/></Link>
        <Btn onClick={()=>{void refresh();void qc.invalidateQueries({queryKey:['sjm-clients']});void qc.invalidateQueries({queryKey:['sjm-convoys']})}} disabled={registerQ.isFetching}><RefreshCw size={13} className={registerQ.isFetching?'animate-spin':''}/>Refresh</Btn>
        {isSupervisor&&<div className="hidden sm:block"><Btn disabled={act.isPending} onClick={()=>act.mutate({kind:'management_summary'})}><FileBarChart2 size={13}/>Portfolio summary</Btn></div>}
        {isSupervisor&&<Btn tone="green" onClick={openCreate}><Plus size={14}/>New journey</Btn>}
       </div>
      </div>
     </div>
    </header>

    {hasRegisterContract&&Number(stats?.departures_due_30m||0)>0&&<div role="status" className="border-l-2 border-amber-300/70 bg-amber-300/[0.035] px-3 py-2.5 text-[11px] leading-5 text-amber-100/90"><span className="font-semibold tabular-nums">{stats?.departures_due_30m}</span> scheduled departures are due within the next 30 minutes. Confirm readiness before recording release; this count reflects planned times, not live dispatch telemetry.</div>}
    <section className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(280px,330px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(270px,310px)_minmax(0,1fr)_minmax(270px,330px)]">
     <Panel className="order-2 overflow-hidden xl:order-1">
      <div className="border-b border-white/[0.075] p-4">
       <div className="flex items-center justify-between gap-2"><div><Kicker>Register</Kicker><h2 className="mt-1 text-base font-semibold tracking-tight text-white">Journey register</h2></div><span className="font-mono text-[11px] text-slate-400">{registerQ.isError&&!registerQ.data?"Unavailable":registerQ.data?.pagination?registerQ.data.pagination.total_count.toLocaleString()+" matches":registerQ.data?journeys.length+" loaded":"—"}</span></div>
       <div className="relative mt-3"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input aria-label="Search journeys" className={field+' pl-9'} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Reference, client or route…"/></div>
       <div className="mt-3 flex flex-wrap gap-1.5">
        {[['all','All'],['active','In operation'],['attention','Attention'],['review','Awaiting review'],['planning','Planning'],['overdue','Overdue'],['departure_due_30m','Departing soon'],['closed','Closed']].map(([value,label])=><button key={value} type="button" onClick={()=>{setFilter(value);setRegisterPage(0)}} className={'rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition '+(filter===value?'border-emerald-300/30 bg-emerald-300/[0.09] text-emerald-100':'border-white/[0.07] bg-white/[0.015] text-slate-500 hover:text-slate-200')}>{label}</button>)}
       </div>
       <label className="mt-3 flex items-center justify-between gap-3 text-[11px] text-slate-400"><span>Sort journeys</span><select aria-label="Sort journeys" value={registerSort} onChange={event=>{setRegisterSort(event.target.value as RegisterSort);setRegisterPage(0)}} className="min-w-0 max-w-[72%] rounded-md border border-white/[0.10] bg-[#080c12] px-2.5 py-2 text-[11px] text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">{REGISTER_SORT_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      <div className="max-h-[780px] min-h-[280px] overflow-y-auto">
       {registerQ.isLoading?<div className="p-8 text-center text-xs text-slate-500"><RefreshCw size={17} className="mx-auto mb-3 animate-spin"/>Loading journeys…</div>:registerQ.isError?<div role="alert" className="m-2 rounded-md border border-red-400/20 bg-red-500/[0.05] p-4 text-xs leading-5 text-red-200">The journey list could not be loaded. {errorText(registerQ.error,'API request failed.')}</div>:visible.length===0?<div className="m-2 rounded-md border border-dashed border-white/[0.10] p-5 text-center"><Route size={22} className="mx-auto mb-3 text-slate-600"/><p className="text-sm font-medium text-slate-300">{registerQ.data?.pagination?.total_count?'No records on this page':(filter!=='all'||registerSearch)?'No matching journeys':'No journey records in your authorised scope'}</p><p className="mt-2 text-[11px] leading-5 text-slate-600">{registerQ.data?.pagination?.total_count?'Move to another page.':(filter!=='all'||registerSearch)?'Change the filter or search term.':'Create a journey to start an operational record for your organisation.'}</p>{!journeys.length&&<button type="button" onClick={()=>{setIntakeStep(0);setIntakePickTarget(null);setShowCreate(true)}} className="mt-3 inline-flex items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/[0.08] px-3 py-2 text-[11px] font-semibold text-emerald-100"><Plus size={13}/>New journey</button>}</div>:visible.map(j=>{
        const a=assessmentOf(j.route_assessment);
        const isSelected=j.id===journey?.id;
        return <button key={j.id} type="button" onClick={()=>choose(j.id)} aria-pressed={isSelected} className={'group relative w-full border-b border-white/[0.08] border-l-2 px-3 py-3 text-left transition '+(isSelected?'border-l-emerald-300 bg-emerald-300/[0.045]':'border-l-transparent bg-transparent hover:bg-white/[0.025]')}>
         <div className="flex items-start justify-between gap-2"><span className="font-mono text-[11px] font-semibold tracking-[.08em] text-emerald-200">{j.reference}</span><StatusBadge value={j.status}/></div>
         <p className="mt-2 line-clamp-2 text-[13px] font-semibold leading-5 text-slate-100">{j.title}</p>
         <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400"><span className="max-w-[44%] truncate">{j.origin_label}</span><ArrowRight size={12} className="shrink-0 text-slate-600"/><span className="max-w-[44%] truncate">{j.destination_label}</span></div>
         <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.055] pt-2.5"><span className="min-w-0 truncate text-[11px] text-slate-500">{j.client_name||'Unlinked client'}{j.convoy_name?' · '+j.convoy_name:''}</span>{a?<Gate value={a.safety_gate}/>:<span className="font-mono text-[11px] text-slate-600">No assessment gate</span>}</div>
         <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600"><span className="inline-flex items-center gap-1.5"><CalendarClock size={11}/>{dateText(j.planned_departure_at)}</span>{scheduleUrgencyPresentation(j.schedule_urgency)&&<span title={scheduleUrgencyPresentation(j.schedule_urgency)!.title} className={'inline-flex items-center rounded border px-1.5 py-1 font-semibold '+scheduleUrgencyPresentation(j.schedule_urgency)!.className}>{scheduleUrgencyPresentation(j.schedule_urgency)!.label}</span>}<ChevronRight size={13} className={'transition '+(isSelected?'translate-x-0.5 text-emerald-200':'text-slate-700 group-hover:translate-x-0.5 group-hover:text-slate-300')}/></div>
        </button>;
       })}
      </div>
      {registerQ.data?.pagination&&<div className="border-t border-white/[0.07] px-3 py-3"><div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400"><span>{registerQ.data.pagination.total_count===0?'0 matching journeys':`Showing ${registerQ.data.pagination.offset+1}–${Math.min(registerQ.data.pagination.offset+journeys.length,registerQ.data.pagination.total_count)} of ${registerQ.data.pagination.total_count}`}</span><span>Page {registerPage+1}</span></div><div className="mt-3 flex items-center justify-between gap-2"><button type="button" aria-label="Previous register page" disabled={registerPage===0||registerQ.isFetching} onClick={()=>setRegisterPage(page=>Math.max(0,page-1))} className="rounded-md border border-white/[0.10] px-3 py-2 text-[11px] font-medium text-slate-300 disabled:cursor-not-allowed disabled:opacity-35"><ArrowLeft size={12} className="mr-1 inline"/>Previous</button><button type="button" aria-label="Next register page" disabled={!registerQ.data.pagination.has_more||registerQ.isFetching} onClick={()=>setRegisterPage(page=>page+1)} className="rounded-md border border-white/[0.10] px-3 py-2 text-[11px] font-medium text-slate-300 disabled:cursor-not-allowed disabled:opacity-35">Next<ArrowRight size={12} className="ml-1 inline"/></button></div>{registerQ.isFetching&&<p role="status" className="mt-2 text-[11px] text-slate-500">Updating journey list…</p>}</div>}
     </Panel>

     <div id="sjm-mission-workspace" className="order-1 min-w-0 space-y-3 scroll-mt-16 xl:order-2">
      {!journey?<Panel className="p-5 sm:p-8"><div className="mx-auto max-w-lg py-10 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-md border border-emerald-300/15 bg-emerald-300/[0.05]"><MapPinned size={25} className="text-emerald-200"/></span><Kicker>JOURNEY WORKSPACE</Kicker><h2 className="mt-3 text-xl font-semibold text-white">Select a journey</h2><p className="mt-2 text-sm leading-6 text-slate-500">Choose a journey to review its route, approvals, assigned team and evidence.</p>{isSupervisor&&<Btn tone="green" onClick={openCreate}><Plus size={13}/>New journey</Btn>}</div></Panel>:<>
       <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-white/[0.07] p-4 sm:p-5 xl:flex-row xl:items-start xl:justify-between">
         <div className="min-w-0 xl:flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] font-semibold tracking-[.13em] text-emerald-200">{journey.reference}</span><StatusBadge value={journey.status}/><span className="rounded-md border border-white/[0.07] px-2 py-1 font-mono text-[11px]  tracking-[.12em] text-slate-500">{journey.transport_mode.replaceAll('_',' ')}</span></div><h2 id="sjm-selected-mission-title" tabIndex={-1} className="mt-2 text-xl font-semibold leading-tight tracking-tight text-white outline-none sm:text-2xl">{journey.title}</h2><p className="mt-1.5 max-w-3xl text-xs leading-5 text-slate-400">{journey.purpose}</p></div>
         <div className="flex flex-wrap items-center gap-2 xl:justify-end"><Gate value={assess?.safety_gate}/><Btn tone="green" onClick={()=>openMissionComms.mutate()} disabled={openMissionComms.isPending}><MessagesSquare size={12}/>{openMissionComms.isPending?'Opening secure channel…':'Open secure channel'}</Btn>{isSupervisor&&['requested','planning'].includes(journey.status)&&<Btn onClick={startEdit} disabled={detailQ.isLoading||updateJourney.isPending||!detailQ.data?.data}><Pencil size={12}/>Edit journey</Btn>}<Btn onClick={()=>void refresh()} disabled={detailQ.isFetching}><RefreshCw size={12} className={detailQ.isFetching?'animate-spin':''}/>Refresh journey</Btn></div>
        </div>
        {openMissionComms.isError&&<p role="alert" className="border-b border-amber-300/15 bg-amber-300/[0.025] px-4 py-2 text-[11px] leading-5 text-amber-100">{errorText(openMissionComms.error,'The secure channel could not be opened.')}</p>}
        <div className="p-2 sm:p-3"><JourneyMap journey={journey} stops={stops} geometry={geometry} assessment={assess} telemetry={journey.telemetry_snapshot}/></div>
        <div className="grid grid-cols-2 border-t border-white/[0.07] bg-black/15 md:grid-cols-4">
         {[
          {label:'Planned distance',value:journey.planned_distance_km==null?'Not assessed':Number(journey.planned_distance_km).toLocaleString(undefined,{maximumFractionDigits:1})+' km'},
          {label:'Route duration',value:journey.planned_duration_minutes==null?'Not assessed':Math.floor(journey.planned_duration_minutes/60)+'h '+(journey.planned_duration_minutes%60)+'m'},
          {label:'Stops',value:String(stops.length)+' stops · '+String(stops.filter(s=>s.stop_status==='reached').length)+' reached'},
          {label:'Movement window',value:journey.planned_departure_at?dateText(journey.planned_departure_at):'Not scheduled'}
         ].map((item,i)=><div key={item.label} className={'min-w-0 p-3 sm:p-3.5 '+(i%2===1?'md:border-l md:border-white/[0.05]':'')+(i<2?' border-b border-white/[0.05] md:border-b-0':'')}><p className="text-[11px] font-medium  tracking-[.13em] text-slate-600">{item.label}</p><p className="mt-1.5 truncate text-[12px] font-semibold text-slate-200">{item.value}</p></div>)}
        </div>
       </Panel>

               <section aria-label="Journey progress" data-testid="sjm-journey-progress" className="rounded-lg border border-[#263442] bg-[#101720] px-4 py-4 sm:px-5">
         <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-slate-200">Journey progress</h3>
          <span className="text-xs font-medium tabular-nums text-slate-400">{['cancelled','aborted'].includes(journey.status)?META[journey.status].label:journey.status==='closed'?'Complete':`Stage ${Math.min(lifecycleCheckpointIndex(journey.status,journey)+1,8)} of 8`}</span>
         </div>
         <ol aria-label="Journey stages" className="grid grid-cols-4 gap-x-3 gap-y-3 xl:grid-cols-8">
          {['Request','Route','Review','Approval','Readiness','Movement','Arrival','Closeout'].map((label,i)=>{const idx=lifecycleCheckpointIndex(journey.status,journey);const completed=journey.status==='closed'||idx>i;const terminal=['cancelled','aborted'].includes(journey.status);const current=idx===i&&!terminal&&journey.status!=='closed';const attention=current&&['paused','exception','on_hold'].includes(journey.status);const labelState=completed?'completed':attention?'needs attention':current?'current':'upcoming';return <li key={label} aria-label={'Overview '+label+' '+labelState} aria-current={current?'step':undefined} className="min-w-0"><div className="flex min-w-0 items-center gap-1.5"><span className={'grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold '+(completed?'border-emerald-300/35 bg-emerald-300/[0.10] text-emerald-200':attention?'border-amber-300/35 bg-amber-300/[0.08] text-amber-100':current?'border-slate-300/35 bg-white/[0.07] text-slate-100':'border-white/[0.12] text-slate-500')}>{completed?<Check size={11}/>:String(i+1).padStart(2,'0')}</span><span title={label} className={'truncate text-xs '+(completed?'text-slate-200':attention?'text-amber-100':current?'font-semibold text-white':'text-slate-400')}>{label}</span></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"><span className={'block h-full rounded-full '+(completed?'bg-emerald-300':attention?'bg-amber-300':current?'bg-slate-300':'bg-transparent')} /></div></li>})}
         </ol>
        </section>
<Panel className="overflow-hidden">
        <div className="border-b border-white/[0.07] px-4 pt-4 sm:px-5">
         <div className="flex flex-wrap items-center justify-between gap-3"><div><Kicker>JOURNEY WORKSPACE</Kicker><h3 className="mt-1 text-sm font-semibold text-white">Journey record</h3></div><span className="font-mono text-[11px] text-slate-600">{events.length} loaded events · {stops.length} stops</span></div>
         <div className="mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Journey workspace views">
          {[
           {value:'overview',label:'Overview',Icon:Activity},
           {value:'command',label:'Command & release',Icon:ShieldCheck},
           {value:'itinerary',label:'Itinerary',Icon:Route},
           {value:'evidence',label:'Evidence',Icon:Layers3},
           {value:'reports',label:'Reports',Icon:FileText}
          ].map(({value,label,Icon})=><button type="button" role="tab" aria-selected={workspaceTab===value} key={value} onClick={()=>setWorkspaceTab(value as typeof workspaceTab)} className={'inline-flex shrink-0 items-center gap-2 rounded-t-md border-b-2 px-3 py-3 text-xs font-semibold transition '+(workspaceTab===value?'border-emerald-300 bg-emerald-300/[0.06] text-emerald-100':'border-transparent text-slate-400 hover:bg-white/[0.025] hover:text-slate-100')}><Icon size={13}/>{label}</button>)}
         </div>
        </div>
        <div className="p-3 sm:p-5">
         {workspaceTab==='overview'&&<div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
                 <Panel className="overflow-hidden"><div className="border-b border-white/[0.07] p-4"><div className="flex items-center justify-between gap-3"><div><Kicker>ROUTE REVIEW</Kicker><h3 className="mt-1 text-sm font-semibold">Route & risk assessment</h3></div><Gate value={assess?.safety_gate}/></div></div><div className="space-y-4 p-4">
       {!assess?<div className="rounded-md border border-dashed border-white/10 p-4"><div className="flex gap-3"><Route size={17} className="mt-0.5 text-slate-300"/><div><p className="text-[12px] font-semibold">Route has not been assessed</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Assess the full corridor before approval. A line between the origin and destination is not an assessed route.</p></div></div>{isSupervisor&&['requested','planning'].includes(journey.status)&&<div className="mt-3"><Btn tone="green" disabled={act.isPending} onClick={()=>act.mutate({kind:'plan'})}><Route size={12}/>Assess route and plan</Btn></div>}</div>:<>
       <div className="grid grid-cols-3 gap-2"><div className="rounded-md border border-white/[0.06] bg-black/20 p-3"><p className="text-[11px]  tracking-wider text-slate-600">Risk score</p><p className="mt-1 text-xl font-semibold">{assess.overall_risk_score==null?'—':Number(assess.overall_risk_score).toFixed(0)}<span className="ml-1 text-[11px] font-normal text-slate-600">/100</span></p></div><div className="rounded-md border border-white/[0.06] bg-black/20 p-3"><p className="text-[11px]  tracking-wider text-slate-600">Risk zones</p><p className="mt-1 text-xl font-semibold">{assess.risk_zone_count??'—'}</p></div><div className="rounded-md border border-white/[0.06] bg-black/20 p-3"><p className="text-[11px]  tracking-wider text-slate-600">Routing provider</p><p className="mt-2 truncate text-[11px] font-semibold">{assess.routing_provider||'Not returned'}</p></div></div>
       <div className={'rounded-md border p-3 '+(assess.route_status==='blocked'||assess.safety_gate==='NO_GO'?'border-red-400/25 bg-red-500/[0.055]':assess.safety_gate==='HUMAN_REVIEW'?'border-orange-400/25 bg-orange-500/[0.045]':'border-white/[0.07] bg-black/20')}><div className="flex items-start gap-2"><ShieldAlert size={15} className="mt-0.5 text-orange-200"/><div><p className="text-[11px] font-semibold">Route Safety assessment</p><p className="mt-1 text-[11px] leading-5 text-slate-400">{assess.ai_summary||'No assessment summary was provided.'}</p><p className="mt-2 text-xs text-slate-400">Route status: {routeStatusLabel(assess.route_status)} · Safety gate: {safetyGateLabel(assess.safety_gate)}</p></div></div></div>
       <div className="rounded-md border border-white/[0.06] p-3"><p className="mb-2 text-[11px] font-semibold  tracking-wider text-slate-500">Route details</p>{geometry.length===0?<p className="text-[11px] text-slate-600">No assessed route is available. The map shows the planned origin and destination only.</p>:<><div className="flex items-center justify-between gap-3"><span className="text-[12px] text-slate-300">{geometry.length} points in the assessed route</span><span className="font-mono text-[11px] text-slate-500">Source: Route Safety</span></div><div className="mt-3 flex items-center gap-1">{geometry.slice(0,48).map((p,i)=><span key={i} title={(p.name||p.label||'Route waypoint')+' '+p.lat+', '+p.lng} className="h-1.5 flex-1 rounded-full bg-emerald-300/70"/>)}</div><div className="mt-2 flex justify-between font-mono text-[11px] text-slate-600"><span>{geometry[0]?.lat?.toFixed(4)}, {geometry[0]?.lng?.toFixed(4)}</span><span>{geometry[geometry.length-1]?.lat?.toFixed(4)}, {geometry[geometry.length-1]?.lng?.toFixed(4)}</span></div></>}</div>
       {assess.recommended_route?.risk_factors?.length?<div className="flex flex-wrap gap-1.5">{assess.recommended_route.risk_factors.map(x=><span key={x} className="rounded-md border border-amber-400/15 bg-amber-400/[0.045] px-2 py-1 text-[11px] text-amber-200">{x.replaceAll('_',' ')}</span>)}</div>:null}
       </>}
       {isSupervisor&&journey.status==='ready_for_review'&&assess?.safety_gate==='HUMAN_REVIEW'&&assess.route_status!=='blocked'&&assess.recommended_route?.blocked!==true&&<div className="space-y-2 rounded-md border border-orange-400/20 bg-orange-500/[0.035] p-3"><p className="text-[11px] font-semibold text-orange-100">Supervisor review required</p><Input label="Route review rationale"><textarea className={field} rows={3} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder="Explain route concerns, mitigations and any controls required."/></Input><p className="text-[11px] leading-5 text-slate-500">Add enough detail to support the decision and any conditions (at least 30 characters).</p><div className="flex flex-wrap gap-2"><select className={field+' max-w-[220px]'} value={reviewChoice} onChange={e=>setReviewChoice(e.target.value)}><option value="approve_with_controls">Accept with controls</option><option value="reject">Reject route assessment</option></select><Btn tone="green" disabled={act.isPending||reviewNote.trim().length<30} onClick={()=>act.mutate({kind:'review',body:{decision:reviewChoice,rationale:reviewNote}})}>{reviewChoice==='reject'?'Record rejection':'Record reviewed controls'}</Btn></div></div>}
       {journey.human_review_decision&&<div className="rounded-md border border-orange-400/20 bg-orange-400/[0.045] p-3 text-[11px]"><p className="font-semibold text-orange-100">Human review: {journey.human_review_decision.replaceAll('_',' ')}</p><p className="mt-1 leading-5 text-slate-400">{journey.human_review_rationale||'No rationale recorded.'}</p></div>}
      </div></Panel>
           <div className="space-y-4">
            <section className="rounded-md border border-white/[0.075] bg-black/15 p-4">
             <div className="flex items-center justify-between gap-3"><div><Kicker>JOURNEY SUMMARY</Kicker><h4 className="mt-1 text-sm font-semibold">Route and ownership</h4></div><MapPinned size={16} className="text-slate-300"/></div>
             <dl className="mt-4 space-y-3">
              {[
               ['Client account',journey.client_name||'No client linked'],
               ['Operational convoy',journey.convoy_name||'No convoy linked'],
               ['Origin',journey.origin_label],
               ['Destination',journey.destination_label],
               ['Planned arrival',dateText(journey.planned_arrival_at)],
               ['Reporting time zone',journey.timezone||'Not recorded']
              ].map(([label,value])=><div key={label} className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.05] pb-2.5 last:border-0 last:pb-0"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="max-w-[65%] break-words text-right text-[11px] font-medium text-slate-200">{value}</dd></div>)}
             </dl>
            </section>
            <section className="rounded-md border border-[#263442] bg-[#0f1720] p-4">
              <div className="flex items-center justify-between gap-3"><div><Kicker>NEXT STEP</Kicker><h4 className="mt-1 text-sm font-semibold text-white">What needs attention</h4></div><StatusBadge value={journey.status}/></div>
              <p className="mt-4 text-sm font-semibold text-slate-100">{(['requested','planning'].includes(journey.status))?(assess?'Review route assessment':'Assess the route'):journey.status==='assessment_pending'?'Route assessment in progress':journey.status==='ready_for_review'?'Review the release decision':journey.status==='approved'?'Confirm departure readiness':journey.status==='ready_to_depart'?'Start the approved journey':journey.status==='in_progress'?'Monitor the journey':journey.status==='paused'?'Review before resuming':journey.status==='exception'?'Resolve the recorded exception':journey.status==='on_hold'?'Review the hold':journey.status==='arrival_pending_verification'?'Verify arrival before closeout':journey.status==='closed'?'Review the closeout report':journey.status==='cancelled'?'Review cancellation record':'Review the journey record'}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{(['requested','planning'].includes(journey.status))?'Run Route Safety and review its findings before seeking approval.':journey.status==='assessment_pending'?'Wait for the saved assessment result before making a release decision.':journey.status==='ready_for_review'?'Check the stored assessment, controls and rationale before recording a decision.':journey.status==='approved'?'Complete the dispatch readiness checks; approval alone does not start movement.':journey.status==='ready_to_depart'?'Confirm dispatch readiness, then record movement through the authorised control.':journey.status==='in_progress'?'Review device observations, stops and event history. Scheduled times are not live position evidence.':journey.status==='paused'?'Review the latest event and current route evidence before resuming or replanning.':journey.status==='exception'?'Review the exception and record an authorised recovery or replan decision.':journey.status==='on_hold'?'Confirm why the journey is held and whether a new route assessment is required.':journey.status==='arrival_pending_verification'?'A supervisor must record the arrival decision before closeout.':journey.status==='closed'?'Review the stored evidence and available final reports.':journey.status==='cancelled'||journey.status==='aborted'?'Review the recorded reason and audit history.':'Review the saved journey record and latest event history.'}</p>
              {['paused','exception','on_hold','cancelled','aborted'].includes(journey.status)&&<p className="mt-3 rounded-md border border-amber-300/15 bg-amber-300/[0.035] p-3 text-xs leading-5 text-amber-100">This journey’s usual progression is interrupted. Review recorded events before resuming, replanning or closing it.</p>}
              <div className="mt-4 flex flex-wrap gap-2"><Btn tone="green" onClick={()=>setWorkspaceTab(isTerminal?'reports':'command')}>{isTerminal?'Open reports':'Open release controls'}<ArrowRight size={13}/></Btn></div>
             </section>
              {hasFlightContext&&<section className="rounded-md border border-[#263442] bg-[#0f1720] p-4" aria-label="Flight status">
               <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><Kicker>Flight information</Kicker><h4 className="mt-1 text-sm font-semibold text-white">Flight status</h4><p className="mt-1 text-xs leading-5 text-slate-400">{journey.flight_number?[(journey.airline||null),journey.flight_number].filter(Boolean).join(' · '):'No flight number recorded'}{journey.airport_code?' · '+journey.airport_code:''}{journey.terminal?' · '+journey.terminal:''}</p></div>
                <span data-testid="sjm-flight-status-value" className={'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold '+(['delayed','cancelled','diverted'].includes(journey.flight_status||'')?'border-amber-300/25 bg-amber-300/[0.06] text-amber-100':'border-white/[0.12] bg-white/[0.025] text-slate-200')}>{flightStatusLabel(journey.flight_status)}</span>
               </div>
               <dl className="mt-3 grid grid-cols-1 gap-2 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
                <div><dt className="text-xs text-slate-400">Source</dt><dd className="mt-1 text-xs font-medium text-slate-200">{journey.flight_status_source==='operator_entered'?'Operator-entered':'No observation recorded'}</dd></div>
                <div><dt className="text-xs text-slate-400">Last observation</dt><dd className="mt-1 text-xs font-medium text-slate-200">{journey.flight_status_source==='operator_entered'?dateText(journey.flight_status_observed_at):'Not recorded'}</dd></div>
               </dl>
               {journey.flight_status_note&&<p className="mt-3 rounded-md border border-white/[0.06] bg-black/15 p-3 text-xs leading-5 text-slate-300"><span className="font-semibold text-slate-200">Team note:</span> {journey.flight_status_note}</p>}
               <p className="mt-3 text-xs leading-5 text-slate-400">Entered by your team; this status is not from a live airline feed or independently verified.</p>
               {canRecordFlightStatus&&journey.flight_number&&!['closed','cancelled','aborted'].includes(journey.status)&&<div className="mt-3">
                <Btn onClick={()=>{setFlightStatusDraft(FLIGHT_STATUS_OPTIONS.some(option=>option.value===journey.flight_status)?journey.flight_status||'scheduled':'scheduled');setFlightStatusNote(journey.flight_status_note||'');setShowFlightStatusForm(value=>!value);recordFlightStatus.reset()}} disabled={flightStatusSavePending}><Activity size={13}/>{showFlightStatusForm?'Close form':'Record flight status'}</Btn>
               </div>}
               {!journey.flight_number&&canRecordFlightStatus&&<p className="mt-3 text-xs text-slate-400">A flight number is required. Ask a dispatcher to add it before recording status.</p>}
               {showFlightStatusForm&&canRecordFlightStatus&&journey.flight_number&&<form className="mt-4 space-y-3 border-t border-white/[0.06] pt-4" onSubmit={event=>{event.preventDefault();if(!flightStatusSavePending)recordFlightStatus.mutate({journeyId:journey.id,flightNumber:String(journey.flight_number||''),flightStatus:flightStatusDraft,note:flightStatusNote})}}>
                <Input label="Flight status"><select aria-label="Flight status" className={field} value={flightStatusDraft} onChange={event=>setFlightStatusDraft(event.target.value)}>{FLIGHT_STATUS_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></Input>
                <Input label="Observation note"><textarea aria-label="Observation note" className={field} rows={2} maxLength={1200} value={flightStatusNote} onChange={event=>setFlightStatusNote(event.target.value)} placeholder="What did the airline or airport team report?"/></Input>
                {['delayed','cancelled','diverted'].includes(flightStatusDraft)&&<p className="text-xs leading-5 text-amber-100">A delay, cancellation or diversion needs an explanatory note of at least five characters.</p>}
                {flightStatusSaveError&&<p role="alert" className="text-xs leading-5 text-red-200">{errorText(recordFlightStatus.error,'Flight status could not be saved.')}</p>}
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-400">Sonalit records this update in the journey event log.</p><Btn tone="green" disabled={flightStatusSavePending||(['delayed','cancelled','diverted'].includes(flightStatusDraft)&&flightStatusNote.trim().length<5)} onClick={()=>recordFlightStatus.mutate({journeyId:journey.id,flightNumber:String(journey.flight_number||''),flightStatus:flightStatusDraft,note:flightStatusNote})}><CheckCircle2 size={13}/>{flightStatusSavePending?'Saving observation…':'Save flight observation'}</Btn></div>
               </form>}
              </section>}
           </div>
          </div>
                    <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] p-4">
              <div><Kicker>READINESS EVIDENCE</Kicker><h4 className="mt-1 text-sm font-semibold">Readiness checks</h4><p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">These checks use the saved route assessment, approvals, convoy link, device timestamps and stop records. A single readiness score is not inferred.</p></div>
              <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-slate-400">{journey.readiness_checklist?.length||0} checks provided</span>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {(journey.readiness_checklist||[]).map((item,i)=><div key={item.item} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(150px,.7fr)_auto_minmax(0,1.4fr)] sm:items-start">
                <div className="flex items-start gap-2"><span className="mt-0.5 font-mono text-[11px] text-slate-600">{String(i+1).padStart(2,'0')}</span><p className="text-[11px] font-medium text-slate-200">{item.item}</p></div>
                <EvidenceBadge value={item.status}/>
                <p className="break-words text-[11px] leading-5 text-slate-500">{item.detail||'No detail was provided for this check.'}</p>
              </div>)}
              {(!journey.readiness_checklist||journey.readiness_checklist.length===0)&&<div className="p-4 text-[11px] leading-5 text-slate-500">Readiness checks are unavailable for this journey. This does not mean the journey is cleared.</div>}
            </div>
            <div className="border-t border-white/[0.06] bg-black/15 px-4 py-3 text-[11px] leading-5 text-slate-600">Important: confirming a stop is not GPS proof; a linked convoy does not prove live tracking; and an assessed route may not reflect current road conditions. Refresh before authorising departure.</div>
          </Panel>
<section className="rounded-md border border-white/[0.075] bg-black/15 p-4">
           <div className="flex items-center justify-between gap-3"><div><Kicker>JOURNEY ACTIVITY</Kicker><h4 className="mt-1 text-sm font-semibold">Recent events</h4></div><button type="button" onClick={()=>setWorkspaceTab('evidence')} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 hover:text-slate-300">Open evidence ledger <ArrowUpRight size={12}/></button></div>
           {detailQ.isLoading?<p className="mt-4 text-xs text-slate-500">Loading journey detail…</p>:events.length===0?<p className="mt-4 rounded-md border border-dashed border-white/[0.08] p-4 text-xs text-slate-500">No journey activity has been recorded in Sonalit yet. Updates managed elsewhere may not appear here.</p>:<div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">{events.slice(0,4).map(e=><div key={e.id} className="flex min-w-0 gap-3 rounded-md border border-white/[0.055] bg-white/[0.012] p-3"><span className={'mt-1.5 h-2 w-2 shrink-0 rounded-full '+(e.source==='system'?'bg-slate-400':'bg-emerald-300')}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-semibold text-slate-200">{e.summary}</p><span className="font-mono text-[8px]  tracking-wider text-slate-600">{eventSourceLabel(e.source)}</span></div><p className="mt-1 text-[11px] text-slate-600">{dateText(e.created_at)} · {eventTypeLabel(e.event_type)}</p></div></div>)}</div>}
          </section>
         </div>}

         {workspaceTab==='command'&&<div className="space-y-4">
          <div className="flex flex-col gap-2 rounded-md border border-white/[0.08] bg-white/[0.025] p-4 sm:flex-row sm:items-start sm:justify-between"><div><Kicker>CURRENT STATUS</Kicker><h4 className="mt-1 text-base font-semibold text-white">Journey controls</h4><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">Changes to approval, departure and closeout are recorded and confirmed by Sonalit before the workspace shows them as complete.</p></div><StatusBadge value={journey.status}/></div>
                <Panel className="overflow-hidden"><div className="border-b border-white/[0.07] p-4"><Kicker>APPROVALS AND MOVEMENT</Kicker><h3 className="mt-1 text-sm font-semibold">Approval and movement controls</h3></div><div className="space-y-3 p-4">
       <div className="space-y-2">{[{n:1,label:'Journey created',done:Boolean(journey.id)},{n:2,label:'Route assessment stored',done:Boolean(journey.route_assessment)},{n:3,label:'Authorised approval',done:Boolean(journey.approved_at)},{n:4,label:'Movement underway',done:Boolean(journey.started_at)}].map(s=><div key={s.n} className="flex items-center gap-2 text-[11px]"><span className={'grid h-6 w-6 place-items-center rounded-full border '+(s.done?'border-emerald-300/20 bg-emerald-300/10 text-emerald-100':'border-white/10 text-slate-600')}>{s.n}</span><span className="flex-1">{s.label}</span><span className="font-mono text-[11px] text-slate-600">{s.done?'RECORDED':'PENDING'}</span></div>)}</div>
       {journey.status==='requested'&&<p className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3 text-[11px] leading-5 text-slate-500">Assess the route before approval. Unrouted fallback and unavailable evidence are not approval-ready. The lifecycle keeps planning, review, departure readiness, movement and arrival verification separate.</p>}
       {isSupervisor&&journey.status==='ready_for_review'&&['GO','CONDITIONAL'].includes(assess?.safety_gate||'')&&assess?.route_status==='routed'&&<><Input label="Risk controls and mitigations"><textarea className={field} rows={3} value={ack} onChange={e=>setAck(e.target.value)} placeholder="Record dispatch checks, route constraints and agreed mitigations."/></Input>{assess?.safety_gate==='CONDITIONAL'&&<p className="text-[11px] leading-5 text-slate-500">A conditional assessment needs a written acknowledgement before approval.</p>}<Btn tone="green" disabled={act.isPending||(assess?.safety_gate==='CONDITIONAL'&&ack.trim().length<15)} onClick={()=>act.mutate({kind:'approve',body:{risk_acknowledgement:ack}})}><ShieldCheck size={13}/>Authorise journey</Btn></>}
       {isSupervisor&&journey.status==='ready_for_review'&&assess?.safety_gate==='HUMAN_REVIEW'&&journey.human_review_decision==='approve_with_controls'&&<><Input label="Final controls acknowledgement"><textarea className={field} rows={2} value={ack} onChange={e=>setAck(e.target.value)} placeholder="Confirm the reviewed controls will be implemented."/></Input><Btn tone="green" disabled={act.isPending||ack.trim().length<15} onClick={()=>act.mutate({kind:'approve',body:{risk_acknowledgement:ack}})}><ShieldCheck size={13}/>Approve with reviewed controls</Btn></>}
       {isSupervisor&&journey.status==='approved'&&<div className="space-y-2"><Input label="Dispatch readiness confirmation"><textarea className={field} rows={2} value={departureNote} onChange={e=>setDepartureNote(e.target.value)} placeholder="Confirm dispatch readiness, route brief and required check-ins."/></Input><p className="text-[11px] leading-5 text-slate-500">Include the route brief, required check-ins and dispatch checks completed.</p><Btn tone="green" disabled={act.isPending||departureNote.trim().length<15} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'ready_to_depart',readiness_acknowledgement:departureNote}})}><ShieldCheck size={13}/>Confirm ready to depart</Btn></div>}{journey.status==='ready_to_depart'&&canStartMovement&&<Btn tone="green" disabled={act.isPending} onClick={()=>{if(window.confirm('Start this approved and departure-ready journey?'))act.mutate({kind:'lifecycle',body:{action:'start'}})}}><Navigation size={13}/>Start movement</Btn>}
       {journey.status==='in_progress'&&<div className="space-y-2"><Input label="Reason for pause, exception or hold"><textarea className={field} rows={2} value={transitionReason} onChange={e=>setTransitionReason(e.target.value)} placeholder="Describe what changed and the immediate control."/></Input><div className="flex flex-wrap gap-2">{canOperateLifecycle&&<Btn disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'pause',reason:transitionReason}})}><Clock3 size={12}/>Pause movement</Btn>}{canOperateLifecycle&&<Btn tone="red" disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'raise_exception',reason:transitionReason}})}><AlertTriangle size={12}/>Raise exception</Btn>}{canOperateLifecycle&&<Btn tone="green" disabled={act.isPending} onClick={()=>{const pending=stops.filter(s=>s.stop_status==='planned').length;const prompt=pending?pending+' stops are unresolved. Request arrival verification without closing those stops?':'Request arrival verification at the destination?';if(window.confirm(prompt))act.mutate({kind:'lifecycle',body:{action:'arrive',confirm_outstanding_stops:pending>0}})}}><CheckCircle2 size={12}/>Request arrival verification</Btn>}{isSupervisor&&<Btn disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'hold',reason:transitionReason}})}><Clock3 size={12}/>Place on hold</Btn>}{canOperateLifecycle&&<Btn tone="red" disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'abort',reason:transitionReason}})}><XCircle size={12}/>Abort journey</Btn>}</div></div>}{journey.status==='paused'&&<><Input label="Reason for recovery or replan"><textarea className={field} rows={2} value={transitionReason} onChange={e=>setTransitionReason(e.target.value)} placeholder="Describe the current condition and the next safe step."/></Input><div className="flex flex-wrap gap-2">{canOperateLifecycle&&<Btn tone="green" disabled={act.isPending} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'resume'}})}><Navigation size={12}/>Resume movement</Btn>}{isSupervisor&&<Btn disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'replan',reason:transitionReason}})}><Route size={12}/>Replan route</Btn>}{canOperateLifecycle&&<Btn tone="red" disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'abort',reason:transitionReason}})}><XCircle size={12}/>Abort journey</Btn>}</div></>}{['exception','on_hold'].includes(journey.status)&&<div className="space-y-2"><Input label="Replan rationale"><textarea className={field} rows={2} value={transitionReason} onChange={e=>setTransitionReason(e.target.value)} placeholder="Explain why the current plan no longer applies and what needs reassessment."/></Input><div className="flex flex-wrap gap-2">{isSupervisor&&<Btn tone="green" disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'replan',reason:transitionReason}})}><Route size={12}/>Return to planning</Btn>}{journey.status==='exception'&&canOperateLifecycle&&<Btn tone="red" disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'abort',reason:transitionReason}})}><XCircle size={12}/>Abort journey</Btn>}</div></div>}{journey.status==='arrival_pending_verification'&&<div className="space-y-2 rounded-md border border-white/[0.08] bg-white/[0.025] p-3"><p className="text-[11px] font-semibold text-slate-300">Arrival needs supervisor verification</p><p className="text-[11px] leading-5 text-slate-500">Closing records the supervisor’s confirmation; it does not claim GPS proof. Device observations remain separate in the report.</p><Input label="Reason for abort (only if the journey cannot be completed)"><textarea className={field} rows={2} value={transitionReason} onChange={e=>setTransitionReason(e.target.value)} placeholder="Explain why the journey cannot be completed."/></Input>{canOperateLifecycle&&<Btn tone="red" disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'abort',reason:transitionReason}})}><XCircle size={12}/>Abort journey</Btn>}<Input label="Arrival verification notes"><textarea className={field} rows={3} value={arrivalNote} onChange={e=>setArrivalNote(e.target.value)} placeholder="Describe how arrival was confirmed, who confirmed it and what evidence was reviewed."/></Input><Btn tone="green" disabled={act.isPending||arrivalNote.trim().length<30||!isSupervisor} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'close',reason:arrivalNote}})}><CheckCircle2 size={12}/>Close with supervisor attestation</Btn>{!isSupervisor&&<p className="text-[11px] text-amber-200/80">Supervisor attestation is available to admin/dispatcher roles only.</p>}</div>}
       {isSupervisor&&['requested','planning','assessment_pending','ready_for_review','approved','ready_to_depart'].includes(journey.status)&&<div className="space-y-2 border-t border-white/[0.06] pt-3"><Input label="Reason to hold or replan"><textarea className={field} rows={2} value={transitionReason} onChange={e=>setTransitionReason(e.target.value)} placeholder="Explain what needs to pause or change before the journey proceeds."/></Input><div className="flex flex-wrap gap-2">{isSupervisor&&<Btn disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'hold',reason:transitionReason}})}><Clock3 size={12}/>Place on hold</Btn>}{isSupervisor&&<Btn disabled={act.isPending||transitionReason.trim().length<10} onClick={()=>act.mutate({kind:'lifecycle',body:{action:'replan',reason:transitionReason}})}><Route size={12}/>Invalidate route and replan</Btn>}</div></div>}{isSupervisor&&['requested','planning','assessment_pending','ready_for_review','approved','ready_to_depart','on_hold'].includes(journey.status)&&<div className="border-t border-white/[0.06] pt-3"><Input label="Cancellation reason"><input className={field} value={cancelNote} onChange={e=>setCancelNote(e.target.value)} placeholder="Explain why this journey must be cancelled."/></Input><div className="mt-2">{isSupervisor&&<Btn tone="red" disabled={act.isPending||cancelNote.trim().length<10} onClick={()=>{if(window.confirm('Cancel this journey and record the reason?'))act.mutate({kind:'lifecycle',body:{action:'cancel',reason:cancelNote}})}}><XCircle size={13}/>Cancel journey</Btn>}</div></div>}
      </div></Panel>
         </div>}

         {workspaceTab==='itinerary'&&<div className="space-y-4">
          <div className="rounded-md border border-orange-300/15 bg-orange-300/[0.025] p-4"><div className="flex items-start gap-3"><Route size={17} className="mt-0.5 text-orange-200"/><div><h4 className="text-sm font-semibold text-white">Stop confirmations</h4><p className="mt-1 text-xs leading-5 text-slate-400">Stops remain planned until a team member confirms them. Device locations are shown separately; a manual confirmation is not GPS proof.</p></div></div></div>
               <Panel className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] p-4"><div><Kicker>ROUTE STOPS</Kicker><h3 className="mt-1 text-sm font-semibold">Itinerary & checkpoints</h3></div><span className="font-mono text-[11px] text-slate-600">{stops.length} stops</span></div><div className="p-4">{stops.length===0?<div className="rounded-md border border-dashed border-white/10 p-4 text-[11px] text-slate-600">No stops added yet. Add meeting points, border crossings, planned breaks or overnight stops where needed.</div>:<ol className="space-y-0">{stops.map((s,i)=><li key={s.id} className="relative flex gap-3 pb-4 last:pb-0"><div className="relative flex w-7 shrink-0 flex-col items-center"><span className={'z-10 grid h-7 w-7 place-items-center rounded-full border font-mono text-[11px] '+(s.stop_status==='reached'?'border-emerald-300/30 bg-emerald-300/10 text-emerald-200':s.stop_status==='skipped'?'border-red-300/20 bg-red-400/[0.05] text-red-200':'border-white/10 bg-black/20 text-slate-500')}>{String(s.sequence).padStart(2,'0')}</span>{i<stops.length-1&&<span className="absolute top-7 h-full w-px bg-white/[0.08]"/>}</div><div className="min-w-0 flex-1 rounded-md border border-white/[0.06] bg-black/15 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[12px] font-semibold">{s.name}</p><p className="mt-1 font-mono text-[11px]  tracking-widest text-slate-600">{s.stop_type.replaceAll('_',' ')}{s.lat!=null&&s.lng!=null?' · '+Number(s.lat).toFixed(4)+', '+Number(s.lng).toFixed(4):''}</p></div><span className={'rounded-md border px-2 py-1 font-mono text-[11px] '+(s.stop_status==='reached'?'border-emerald-300/20 text-emerald-200':s.stop_status==='skipped'?'border-red-300/20 text-red-200':'border-white/10 text-slate-500')}>{s.stop_status.toUpperCase()}</span></div>{s.instructions&&<p className="mt-2 text-[11px] text-slate-500">{s.instructions}</p>}{s.confirmed_at&&<p className="mt-2 text-[11px] text-slate-500">Operator confirmation · {dateText(s.confirmed_at)} · {s.confirmation_source||'source not recorded'}</p>}{canConfirmStops&&['in_progress','paused','arrival_pending_verification'].includes(journey.status)&&s.stop_status==='planned'&&<div className="mt-3 flex flex-wrap gap-2"><Btn tone="green" disabled={act.isPending} onClick={()=>act.mutate({kind:'stop',body:{stop_id:s.id,status:'reached'}})}><Check size={12}/>Confirm stop reached</Btn><Btn tone="red" disabled={act.isPending} onClick={()=>act.mutate({kind:'stop',body:{stop_id:s.id,status:'skipped'}})}><XCircle size={12}/>Mark skipped</Btn></div>}{s.stop_status==='planned'&&<p className="mt-2 text-[11px] text-slate-600">Team confirmation only; GPS arrival is not verified here.</p>}</div></li>)}</ol>}</div></Panel>
         </div>}

         {workspaceTab==='evidence'&&<div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
           {[
            {label:'Route assessment',value:assess?routeStatusLabel(assess.route_status):'Not assessed',note:assess?'Latest Route Safety result':'No route assessment has been recorded.',icon:Route},
            {label:'Team and Sonalit events',value:String(events.length)+' events',note:'Events recorded for this journey',icon:Activity},
            {label:'Manual stop confirmations',value:String(stops.filter(s=>s.confirmation_source==='operator_confirmed'||s.confirmed_at).length)+' recorded',note:'A manual confirmation does not prove GPS arrival.',icon:MapPinned}
           ].map(item=><div key={item.label} className="rounded-md border border-white/[0.075] bg-black/15 p-3.5"><item.icon size={15} className="text-slate-300"/><p className="mt-3 text-[11px] text-slate-500">{item.label}</p><p className="mt-1 text-sm font-semibold capitalize text-slate-100">{item.value}</p><p className="mt-1 text-[11px] leading-4 text-slate-600">{item.note}</p></div>)}
          </div>
                <Panel className="overflow-hidden"><div className="border-b border-white/[0.07] p-4"><Kicker>ACTIVITY LOG</Kicker><h3 className="mt-1 text-sm font-semibold">Journey events</h3><p className="mt-1 text-[11px] text-slate-500">Team-entered updates and device observations are shown separately.</p></div><div className="space-y-3 p-4">{isSupervisor&&!['closed','cancelled','aborted'].includes(journey.status)&&<div className="space-y-2 rounded-md border border-white/[0.06] bg-black/20 p-3"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Input label="Event category"><select className={field} value={eventType} onChange={e=>setEventType(e.target.value)}>{['operator_note','security_update','client_update','delay','incident','other'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></Input><Input label="Severity"><select className={field} value={eventSeverity} onChange={e=>setEventSeverity(e.target.value)}>{['low','medium','high','critical'].map(x=><option key={x}>{x}</option>)}</select></Input></div><Input label="Event summary"><input className={field} maxLength={500} value={eventTitle} onChange={e=>setEventTitle(e.target.value)} placeholder="Short operational update"/></Input><Input label="Details / actions"><textarea className={field} rows={2} value={eventDetail} onChange={e=>setEventDetail(e.target.value)} placeholder="What was observed, who was informed and any follow-up"/></Input><Btn tone="green" disabled={act.isPending||eventTitle.trim().length<4} onClick={()=>act.mutate({kind:'event',body:{event_type:eventType,summary:eventTitle,detail:eventDetail,severity:eventSeverity}})}><Plus size={12}/>Append event</Btn></div>}
       {events.length===0?<p className="text-[11px] text-slate-600">No journey activity recorded yet.</p>:<ol className="max-h-[410px] space-y-3 overflow-y-auto">{events.map(e=><li key={e.id} className="flex gap-3"><span className={'mt-1.5 h-2 w-2 shrink-0 rounded-full '+(e.source==='system'?'bg-white/[0.025]':'bg-emerald-300/70')}/><div className="min-w-0 flex-1 border-b border-white/[0.05] pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-semibold">{e.summary}</p><span className="font-mono text-[8px]  tracking-wider text-slate-600">{eventSourceLabel(e.source)}</span></div><p className="mt-1 text-[11px] text-slate-600">{dateText(e.created_at)} · {eventTypeLabel(e.event_type)}</p>{typeof e.detail?.note==='string'&&e.detail.note&&<p className="mt-2 text-[11px] leading-5 text-slate-500">{e.detail.note}</p>}{typeof e.detail?.rationale==='string'&&<p className="mt-2 text-[11px] leading-5 text-slate-500">{e.detail.rationale}</p>}</div></li>)}</ol>}
      </div></Panel>
         </div>}

         {workspaceTab==='reports'&&<div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(300px,.85fr)_minmax(0,1.15fr)]">
           <section className="rounded-md border border-white/[0.075] bg-black/15 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3"><div><Kicker>REPORTS</Kicker><h4 className="mt-1 text-base font-semibold text-white">Generate report</h4><p className="mt-1 text-xs leading-5 text-slate-500">Reports are built from the saved journey record and can be downloaded once generated.</p></div><FileBarChart2 size={18} className="text-slate-300"/></div>
            <div className="mt-5 space-y-4">
             <Input label="Report type"><select aria-label="Report type" className={field} value={reportType} onChange={e=>setReportType(e.target.value)}><option value="itinerary">Journey itinerary</option><option value="pre_trip_brief">Pre-trip brief</option><option value="daily">Daily travel report</option><option value="sitrep">Situation report (SITREP)</option><option value="change_notice">Change notice</option><option value="closeout" disabled={journey.status!=='closed'}>Closeout (after the journey is closed)</option><option value="final">Final report</option></select></Input>
             <div className="rounded-md border border-white/[0.06] bg-white/[0.015] p-3"><p className="text-[11px] font-semibold  tracking-[.12em] text-slate-400">Evidence handling</p><p className="mt-1.5 text-[11px] leading-5 text-slate-500">Optional sections follow the client template. Route assessments, stop confirmations, device locations and event history keep their own sources.</p></div>
             <Btn tone="green" disabled={act.isPending||(reportType==='closeout'&&journey.status!=='closed')} onClick={()=>report(reportType)}><FileText size={13}/>{act.isPending?'Working…':'Generate & download PDF'}</Btn>
            </div>
            {lastGeneratedReport&&<div className="mt-4 rounded-md border border-emerald-300/20 bg-emerald-300/[0.035] p-3"><p className="text-[11px] font-semibold text-emerald-100">Report saved</p><p className="mt-1 text-[11px] text-slate-500">{lastGeneratedReport.report_type.replaceAll('_',' ')} · {lastGeneratedReport.report_date}</p><div className="mt-3 flex flex-wrap gap-2"><Btn onClick={()=>void downloadReportArtifact(lastGeneratedReport.id,lastGeneratedReport.report_date,lastGeneratedReport.report_type,'PDF')}><FileDown size={12}/>Download PDF</Btn><Btn onClick={()=>void downloadReportArtifact(lastGeneratedReport.id,lastGeneratedReport.report_date,lastGeneratedReport.report_type,'CSV')}><FileDown size={12}/>Download CSV</Btn></div></div>}
            {reportDownloadError&&<p role="alert" className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/[0.035] p-3 text-[11px] leading-5 text-amber-100">{reportDownloadError}</p>}
            <p className="mt-4 text-[11px] leading-5 text-slate-600">Reports are downloaded here. Client delivery is not enabled from this screen.</p>
           </section>
                 <Panel className="overflow-hidden"><div className="border-b border-white/[0.07] p-4"><Kicker>REPORT SETTINGS</Kicker><h3 className="mt-1 text-sm font-semibold">Report template</h3><p className="mt-1 text-[11px] text-slate-600">Settings are saved to the linked client. Until a profile exists, the default template is used.</p></div><div className="space-y-3 p-4">{!journey.client_id?<p className="rounded-md border border-dashed border-white/10 p-3 text-[11px] text-slate-600">Link this journey to a client account to configure its report profile.</p>:profileQ.isLoading?<p className="text-[11px] text-slate-500">Loading client profile…</p>:profileQ.isError?<p className="text-[11px] text-red-200">Client profile unavailable: {errorText(profileQ.error,'Request failed.')}</p>:<><div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-semibold">{profile?.client?.name||journey.client_name||'Client report profile'}</p><p className="mt-1 text-[11px] text-slate-500">Confirm any client-specific reporting requirements against the saved client profile.</p></div>{isSupervisor&&<Btn onClick={()=>{if(!editingProfile){setProfileTimezone(profile?.report_timezone||'Africa/Nairobi');setProfileTitle(profile?.report_template?.title||'Secure Journey Management Report');setProfileSections(profile?.report_template?.sections||SECTIONS.map(s=>s.id));setDailyReportsEnabled(profile?.daily_reports_enabled===true);setDailyReportTime(String(profile?.daily_report_local_time||'18:00').slice(0,5));}setEditingProfile(v=>!v)}}>{editingProfile?'Close editor':'Configure profile'}</Btn>}</div>{!editingProfile&&profile&&<div className="rounded-md border border-white/[0.06] bg-black/20 p-3"><p className="text-[11px] text-slate-500">Template</p><p className="mt-1 text-[12px] font-medium">{profile.report_template?.title||'Secure Journey Management Report'}</p><p className="mt-1 text-[11px] text-slate-500">Timezone: {profile.report_timezone} · {profile.report_template?.sections?.length||SECTIONS.length} sections</p><p className="mt-1 text-[11px] text-slate-500">Daily generation: {profile.daily_reports_enabled?"enabled after "+String(profile.daily_report_local_time||"18:00").slice(0,5)+" local time":"disabled"} · Generation only, no external delivery</p><div className="mt-3 flex flex-wrap gap-2"><Btn disabled={act.isPending} onClick={()=>report('itinerary')}><Route size={12}/>Itinerary report</Btn><Btn disabled={act.isPending} onClick={()=>report('final')}><FileText size={12}/>Final report</Btn></div></div>}{isSupervisor&&editingProfile&&<div className="space-y-3 rounded-md border border-emerald-300/15 bg-emerald-300/[0.025] p-3"><Input label="Report title"><input className={field} value={profileTitle} onChange={e=>setProfileTitle(e.target.value)}/></Input><Input label="Time zone"><input className={field} value={profileTimezone} onChange={e=>setProfileTimezone(e.target.value)}/></Input><div className="rounded-md border border-white/[0.06] bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold text-slate-200">Automatic daily report generation</p><p className="mt-1 text-[11px] text-slate-500">Creates a tenant-scoped, persisted PDF/CSV-ready snapshot after the chosen client-local time. Nothing is emailed or sent externally.</p></div><input aria-label="Enable automatic daily report generation" type="checkbox" checked={dailyReportsEnabled} disabled={!profile?.daily_report_scheduler_available} onChange={e=>setDailyReportsEnabled(e.target.checked)} className="accent-emerald-300"/></div><div className="mt-3 max-w-[220px]"><Input label="Client-local generation time"><input type="time" className={field} value={dailyReportTime} disabled={!profile?.daily_report_scheduler_available} onChange={e=>setDailyReportTime(e.target.value)}/></Input></div>{!profile?.daily_report_scheduler_available&&<p role="status" className="mt-2 text-[11px] leading-5 text-amber-200/80">Scheduling is not configured for this organisation on the current runtime. The scheduler fails closed until a platform operator explicitly allowlists this organisation; report delivery is not enabled.</p>}</div><div><p className="mb-2 text-[11px] text-slate-400">Included report sections</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{SECTIONS.map(s=><label key={s.id} className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={profileSections.includes(s.id)} onChange={e=>setProfileSections(prev=>e.target.checked?[...prev,s.id]:prev.filter(v=>v!==s.id))} className="accent-emerald-300"/>{s.label}</label>)}</div><p className="mt-2 text-[11px] text-slate-600">Route safety and data provenance remain in the stored snapshot.</p></div>{saveProfile.isError&&<p role="alert" className="text-[11px] text-red-200">{errorText(saveProfile.error,'Could not save profile.')}</p>}<div className="flex gap-2"><Btn tone="green" disabled={saveProfile.isPending} onClick={()=>saveProfile.mutate()}>{saveProfile.isPending?'Saving…':'Save report profile'}</Btn><Btn onClick={()=>setEditingProfile(false)}>Cancel</Btn></div></div>}</>}</div></Panel>
          </div>
         </div>}
        </div>
       </Panel>
      </>}
     </div>

     {journey&&<aside className="order-3 space-y-3 xl:col-span-2 2xl:col-span-1">
      <Panel className="overflow-hidden">
       <div className="border-b border-white/[0.07] p-4"><Kicker>Release readiness</Kicker><div className="mt-1 flex items-center justify-between gap-2"><h3 className="text-base font-semibold text-white">Route assessment</h3><Gate value={assess?.safety_gate}/></div></div>
       <div className="space-y-4 p-4">
        <div className={'rounded-md border p-3.5 '+(assess?.safety_gate==='NO_GO'||assess?.route_status==='blocked'?'border-red-400/25 bg-red-500/[0.045]':assess?.safety_gate==='CONDITIONAL'||assess?.safety_gate==='HUMAN_REVIEW'?'border-amber-300/20 bg-amber-300/[0.035]':assess?.safety_gate==='GO'&&assess?.route_status==='routed'?'border-emerald-300/20 bg-emerald-300/[0.035]':'border-white/[0.075] bg-white/[0.015]')}>
         <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-black/20"><ShieldAlert size={16} className={assess?.safety_gate==='NO_GO'||assess?.route_status==='blocked'?'text-red-200':assess?.safety_gate==='GO'&&assess?.route_status==='routed'?'text-emerald-200':'text-amber-200'}/></span><div className="min-w-0"><p className="text-[12px] font-semibold">{!assess?'Assessment unavailable':assess.route_status==='blocked'||assess.safety_gate==='NO_GO'?'Movement blocked by Route Safety':assess.safety_gate==='HUMAN_REVIEW'?'Authorised human review required':assess.safety_gate==='CONDITIONAL'?'Conditional release only':assess.safety_gate==='GO'&&assess.route_status==='routed'?'Route evidence available':'Assessment is not release-ready'}</p><p className="mt-1.5 text-[11px] leading-5 text-slate-500">{!assess?'No stored assessment is available. Assess the route before seeking approval.':assess.ai_summary||'Route Safety returned no narrative summary.'}</p></div></div>
         <div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-md border border-white/[0.06] bg-black/15 p-2.5"><p className="text-[11px]  tracking-[.12em] text-slate-600">Risk score</p><p className="mt-1 text-lg font-semibold text-slate-100">{assess?.overall_risk_score==null?'Not returned':Number(assess.overall_risk_score).toFixed(0)+' / 100'}</p></div><div className="rounded-md border border-white/[0.06] bg-black/15 p-2.5"><p className="text-[11px]  tracking-[.12em] text-slate-600">Routed points</p><p className="mt-1 text-lg font-semibold text-slate-100">{assess?.route_status==='routed'?geometry.length:'Not routed'}</p></div></div>
        </div>
        <div><p className="font-mono text-[11px]  tracking-[.14em] text-slate-600">Next step</p>
         <div className="mt-2">
          {!assess&&['requested','planning'].includes(journey.status)?<div><p className="text-sm font-semibold text-white">Assess the corridor</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Assess the route before requesting approval.</p>{isSupervisor&&<Btn tone="green" disabled={act.isPending} onClick={()=>act.mutate({kind:'plan'})}><Route size={13}/>Run Route Safety</Btn>}</div>:
           journey.status==='ready_for_review'?<div><p className="text-sm font-semibold text-white">Review release decision</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Record the decision, rationale and controls. Route gates remain enforced by the service.</p><Btn tone="green" onClick={()=>setWorkspaceTab('command')}><ShieldCheck size={13}/>Open release controls</Btn></div>:
           journey.status==='approved'?<div><p className="text-sm font-semibold text-white">Record departure readiness</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Approval is not movement. Complete the explicit dispatch-readiness acknowledgement.</p><Btn tone="green" onClick={()=>setWorkspaceTab('command')}><CheckCircle2 size={13}/>Open dispatch controls</Btn></div>:
           journey.status==='ready_to_depart'?<div><p className="text-sm font-semibold text-white">Departure readiness recorded</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Starting the movement is a consequential transition and will be confirmed by the API.</p>{canStartMovement&&<Btn tone="green" disabled={act.isPending} onClick={()=>{if(window.confirm('Start this approved and departure-ready journey?'))act.mutate({kind:'lifecycle',body:{action:'start'}})}}><Navigation size={13}/>Start movement</Btn>}</div>:
           ['in_progress','paused','exception','on_hold','arrival_pending_verification'].includes(journey.status)?<div><p className="text-sm font-semibold text-white">{journey.status==='in_progress'?'Movement in progress':journey.status==='arrival_pending_verification'?'Awaiting arrival check outstanding':'Review exception'}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Review outstanding stops and the event ledger before changing the operational state.</p><Btn onClick={()=>setWorkspaceTab('command')}><Activity size={13}/>Open control actions</Btn></div>:
           isTerminal?<div><p className="text-sm font-semibold text-white">Journey is {META[journey.status].label.toLowerCase()}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Review the stored history and generate the relevant closeout or final report.</p><Btn onClick={()=>setWorkspaceTab('reports')}><FileText size={13}/>Open reporting</Btn></div>:
           <div><p className="text-sm font-semibold text-white">Review route evidence</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Confirm that the current assessment matches the current itinerary and stop sequence.</p><Btn onClick={()=>setWorkspaceTab('overview')}><Eye size={13}/>Inspect assessment</Btn></div>}
         </div>
        </div>
        <div className="border-t border-white/[0.06] pt-3">
         <p className="font-mono text-[11px]  tracking-[.14em] text-slate-600">Journey milestones</p>
         <div className="mt-2 space-y-2.5">
          {[
           ['Authorised approval',journey.approved_at?dateText(journey.approved_at):'Not recorded',Boolean(journey.approved_at)],
           ['Started at',journey.started_at?dateText(journey.started_at):'Not recorded',Boolean(journey.started_at)],
           ['Stops manually reached',String(stops.filter(s=>s.stop_status==='reached').length)+' / '+stops.length,stops.length>0&&stops.every(s=>s.stop_status!=='planned')],
           ['Loaded event history',String(events.length)+' event records',events.length>0]
          ].map(([label,value,done])=><div key={String(label)} className="flex items-start gap-2"><span className={'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border '+(done?'border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-200':'border-white/[0.09] text-slate-700')}>{done?<Check size={10}/>:<span className="h-1 w-1 rounded-full bg-current"/>}</span><div className="min-w-0 flex-1"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-0.5 break-words text-[11px] font-medium text-slate-300">{String(value)}</p></div></div>)}
         </div>
        </div>
       </div>
      </Panel>

      <Panel className="overflow-hidden">
       <div className="border-b border-white/[0.07] p-4"><Kicker>Telemetry</Kicker><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold text-white">Latest device observations</h3><EvidenceBadge value={journey.telemetry_snapshot?.status||'UNAVAILABLE'}/></div><p className="mt-1 text-[11px] leading-5 text-slate-500">Most recent location fixes from devices linked to this convoy. They show device observations—not route predictions or confirmed arrivals.</p></div>
       <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2"><div className="rounded-md border border-white/[0.07] bg-black/15 p-3"><p className="text-[11px]  tracking-[.13em] text-slate-600">Latest observation</p><p className="mt-1.5 text-[11px] font-semibold text-slate-200">{dateText(journey.telemetry_snapshot?.observed_at as string|null|undefined)}</p></div><div className="rounded-md border border-white/[0.07] bg-black/15 p-3"><p className="text-[11px]  tracking-[.13em] text-slate-600">Linked devices</p><p className="mt-1.5 text-xl font-semibold tabular-nums text-white">{journey.telemetry_snapshot?.devices?.length||0}</p></div></div>
        {!journey.telemetry_snapshot||journey.telemetry_snapshot.devices.length===0?<div className="rounded-md border border-dashed border-white/[0.09] p-4"><p className="text-[11px] font-semibold text-slate-300">No usable location data</p><p className="mt-1.5 text-[11px] leading-5 text-slate-500">{journey.telemetry_snapshot?.reason||'Location data was not returned. No position or freshness status is inferred.'}</p></div>:<div className="space-y-2">{journey.telemetry_snapshot.devices.map(device=>{const coord=mapCoord(device.lat,device.lng);const age=device.age_seconds;const ageLabel=age==null?'Age unavailable':age<60?age+'s ago':Math.floor(age/60)+'m '+(age%60)+'s ago';return <div key={device.device_id} className="rounded-md border border-white/[0.07] bg-black/15 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-[11px] font-semibold text-white">{device.device_name||'Unnamed device'}</p><p className="mt-1 text-[11px] text-slate-500">{device.officer_name||'No assigned officer returned'}</p></div><EvidenceBadge value={device.freshness}/></div><div className="mt-3 grid grid-cols-2 gap-2"><div><p className="text-[11px]  tracking-[.1em] text-slate-600">Last reported fix</p><p className="mt-1 text-[11px] text-slate-300">{ageLabel}</p></div><div><p className="text-[11px]  tracking-[.1em] text-slate-600">Reported speed</p><p className="mt-1 text-[11px] text-slate-300">{device.speed_kph==null?'Not reported':Number(device.speed_kph).toFixed(0)+' km/h'}</p></div><div className="col-span-2"><p className="text-[11px]  tracking-[.1em] text-slate-600">Observed coordinate</p><p className="mt-1 font-mono text-[11px] text-slate-300">{coord?coord[1].toFixed(5)+', '+coord[0].toFixed(5):'No valid coordinates in latest fix'}</p></div></div><p className="mt-2 break-words text-[11px] leading-4 text-slate-600">Source: {device.source||'not returned'} · Observed: {dateText(device.observed_at as string|null|undefined)}{device.accuracy_m==null?'':' · Accuracy '+Number(device.accuracy_m).toFixed(0)+' m'}{device.heading==null?'':' · Heading '+Number(device.heading).toFixed(0)+'°'}</p>{device.freshness_reason&&<p className="mt-2 rounded-md border border-amber-300/10 bg-amber-300/[0.025] px-2 py-1.5 text-[11px] text-amber-100/80">Freshness exception: {device.freshness_reason.replaceAll('_',' ')}</p>}</div>})}</div>}
        <p className="border-t border-white/[0.06] pt-3 text-[11px] leading-5 text-slate-600">Freshness: Live ≤45 seconds; delayed ≤5 minutes; stale is older; unavailable means no acceptable timestamp or linked fix. Map markers show the same status.</p>
       </div>
      </Panel>
      <Panel className="overflow-hidden">
       <div className="border-b border-white/[0.07] p-4"><Kicker>READINESS</Kicker><h3 className="mt-1 text-base font-semibold text-white">Readiness checklist</h3><p className="mt-1 text-[11px] leading-5 text-slate-500">Checks reflect the saved route assessment, approvals, convoy link, device observations and stop records.</p></div>
       <div className="space-y-2 p-3">{(journey.readiness_checklist||[]).map((item,index)=><div key={item.item} className="rounded-md border border-white/[0.06] bg-black/15 p-3"><div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-start gap-2"><span className="mt-0.5 font-mono text-[11px] text-slate-600">{String(index+1).padStart(2,'0')}</span><p className="text-[11px] font-medium text-slate-200">{item.item}</p></div><EvidenceBadge value={item.status}/></div><p className="mt-2 pl-5 text-[11px] leading-5 text-slate-500">{item.detail}</p></div>)}
        {(!journey.readiness_checklist||journey.readiness_checklist.length===0)&&<p className="rounded-md border border-dashed border-white/[0.09] p-4 text-[11px] leading-5 text-slate-500">Readiness evidence was not returned by the journey service.</p>}
       </div>
      </Panel>

      <Panel className="p-4">
       <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.025]"><Layers3 size={16} className="text-slate-300"/></span><div><p className="text-[11px] font-semibold text-slate-200">Evidence sources remain distinct</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Planned geometry, Route Safety analysis, team confirmations and device locations are separate records. One does not prove another.</p></div></div>
      </Panel>
     </aside>}
    </section>

    <section aria-label="Operations overview" className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-white/[0.10] py-3 lg:grid-cols-5 lg:gap-0">
     {[
      {label:'Active journeys',value:stats?.active,detail:'In progress, paused or in exception handling',icon:Activity,tone:'text-emerald-200'},
      {label:'Awaiting approval',value:stats?.awaiting_review,detail:'Human decision still required',icon:ShieldCheck,tone:'text-amber-200'},
      {label:'Schedule overdue',value:stats?.overdue,detail:'Missed departure or planned arrival',icon:AlertTriangle,tone:'text-red-200'},
      {label:'Needs attention',value:stats?.review,detail:'Exception or restrictive safety gate',icon:AlertTriangle,tone:'text-orange-200'},
      {label:'Awaiting arrival check',value:stats?.arrival_verification,detail:'A supervisor must confirm arrival before closure',icon:CheckCircle2,tone:'text-slate-300'}
     ].map((card,index)=><div key={card.label} className={'min-w-0 py-1 '+(index>0?'lg:border-l lg:border-white/[0.08] lg:pl-4':'lg:pr-4')}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[11px] font-medium leading-4 text-slate-400">{card.label}</p><p className={'mt-1.5 text-2xl font-semibold tabular-nums tracking-tight '+card.tone}>{registerQ.isError?'Unavailable':card.value==null?'—':String(card.value)}</p></div><card.icon size={16} className={card.tone+' mt-1 shrink-0 opacity-80'}/></div>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">{card.detail}</p>
     </div>)}
    </section>
    {hasRegisterContract?<p className="text-[11px] leading-5 text-slate-500">Register summary: {stats?.total==null?"authorised journeys":String(stats.total)+" journeys"}; filters apply to the journey register.</p>:registerQ.data&&<div role="status" className="border-l-2 border-amber-300/50 bg-amber-300/[0.04] px-3 py-2.5 text-[11px] leading-5 text-amber-100/90">The service returned a limited list of {journeys.length} journeys. Filters apply to this list; portfolio totals and page navigation are unavailable.</div>}

      {isSupervisor&&journey&&<details className="sjm-team-admin mb-4" aria-label="Journey team assignments"><summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3"><span className="min-w-0"><span className="sjm-kicker">Journey team</span><h2 className="mt-1 block text-sm font-semibold text-white">Assigned drivers, CPOs and meet-and-greet staff</h2><span className="mt-1 block text-[11px] text-slate-400">Assign the people responsible for this journey and its private team channel.</span></span><span className="shrink-0 font-mono text-[11px] text-slate-400">{teamDraft.length} active assignment{teamDraft.length===1?'':'s'}</span></summary><div className="sjm-team-admin__content"><p className="mb-3 text-[11px] leading-5 text-slate-500">Only active users in this organisation can be assigned. Changes are recorded and update access to the journey’s private channel.</p>
       <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]"><label><span className="mb-1 block text-[11px] text-slate-400">Team member</span><select className={field} value={teamUserId} onChange={e=>setTeamUserId(e.target.value)}><option value="">Choose a team member…</option>{(teamUsersQ.data?.data||[]).map(u=><option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</select></label><label><span className="mb-1 block text-[11px] text-slate-400">Duty role</span><select className={field} value={teamRole} onChange={e=>setTeamRole(e.target.value)}>{[['driver','Driver'],['backup_driver','Backup driver'],['cpo','Close protection officer'],['meet_greet','Meet and greet'],['security_escort','Security escort'],['dispatcher','Dispatcher']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><button type="button" disabled={!teamUserId||teamDraft.some(p=>p.user_id===teamUserId&&p.duty_role===teamRole)||!teamUsersQ.isSuccess} onClick={()=>{const u=(teamUsersQ.data?.data||[]).find(x=>x.id===teamUserId);if(!u)return;setTeamDraft(prev=>[...prev,{user_id:u.id,duty_role:teamRole,is_primary:false,user_name:u.name,account_role:u.role}]);setTeamUserId('')}} className="self-end rounded-md border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-xs font-semibold text-slate-300 disabled:opacity-40">Add to journey</button></div>
       {participantsQ.isError&&<p className="mt-3 text-xs text-amber-200">Team assignments could not be loaded. Saving is disabled until current assignments are confirmed.</p>}
       {teamDraft.length===0?<p className="mt-4 rounded-md border border-dashed border-white/10 p-4 text-xs text-slate-500">No team members assigned. Add a driver, CPO or meet-and-greet colleague to give them access in the field app.</p>:<div className="mt-3 space-y-2">{teamDraft.map(p=><div key={p.user_id+'|'+p.duty_role} className="flex flex-wrap items-center gap-3 rounded-md border border-white/[0.07] bg-black/15 p-3"><div className="min-w-[130px] flex-1"><p className="text-xs font-semibold text-slate-200">{p.user_name}</p><p className="mt-1 text-[11px] text-slate-500">{p.account_role} account · {p.duty_role.replaceAll('_',' ')}</p></div><label className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={p.is_primary} onChange={e=>setTeamDraft(prev=>prev.map(q=>q.duty_role===p.duty_role?{...q,is_primary:q.user_id===p.user_id&&e.target.checked}:q))}/>Primary for role</label><button type="button" onClick={()=>setTeamDraft(prev=>prev.filter(q=>!(q.user_id===p.user_id&&q.duty_role===p.duty_role)))} className="rounded-md border border-red-300/15 px-3 py-2 text-[11px] text-red-200">Remove</button></div>)}</div>}
       <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-slate-600">Changes are recorded. Removing a member revokes private-channel access during the next channel sync.</p><button type="button" disabled={!participantsQ.isSuccess||saveTeam.isPending} onClick={()=>saveTeam.mutate()} className="rounded-md bg-emerald-300 px-4 py-3 text-xs font-semibold text-[#10091b] disabled:opacity-40">{saveTeam.isPending?'Saving team…':'Save team'}</button></div>{saveTeam.isError&&<p className="mt-3 text-xs text-red-200">Team could not be saved. Verify the selected users and refresh before retrying.</p>}{saveTeam.isSuccess&&<p className="mt-3 text-xs text-emerald-200">Team roster saved to Sonalit.</p>}
      </div></details>}
      {showCreate&&<div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#02050b]/80 p-2 backdrop-blur-md sm:p-5"><div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-[28px] "><Panel className="p-4 md:p-6"><div className="mb-4 flex items-start justify-between gap-3"><div><Kicker>{intakeMode==='edit'?'JOURNEY REVISION':'NEW JOURNEY'}</Kicker><h2 className="mt-1 text-lg font-semibold">{intakeMode==='edit'?'Edit journey details':'Create journey request'}</h2><p className="mt-1 text-[11px] text-slate-500">{intakeMode==='edit'?'Only requested or planning journeys can be edited. Saving clears the route assessment and release approvals; the journey returns to Requested and must be assessed again.':'Enter locations and planned times. For road journeys, Route Safety assesses the route through every ordered stop. Other transport modes remain unapproved until a suitable routing provider is configured.'}</p></div><Btn onClick={resetIntake}><XCircle size={13}/>Close</Btn></div>

   <form onSubmit={e=>{e.preventDefault();if(intakeStep===3&&!intakeStepIssue){if(intakeMode==='edit')updateJourney.mutate();else create.mutate()}}} className="space-y-4">
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="Journey request steps">
     {INTAKE_STEPS.map((step,index)=><button type="button" key={step.label} onClick={()=>{if(index<=intakeStep||(index===intakeStep+1&&!intakeStepIssue)){setIntakePickTarget(null);setIntakeStep(index as 0|1|2|3)}}} className={'relative rounded-md border p-3 text-left transition '+(intakeStep===index?'border-emerald-300/30 bg-emerald-300/[0.075]':'border-white/[0.07] bg-black/15 hover:border-white/[0.14]')}><span className={'font-mono text-[11px] '+(intakeStep===index?'text-emerald-200':'text-slate-600')}>STEP {String(index+1).padStart(2,'0')}</span><span className={'mt-1 block text-[11px] font-semibold '+(intakeStep===index?'text-white':'text-slate-300')}>{step.label}</span><span className="mt-1 hidden text-[11px] leading-4 text-slate-600 sm:block">{step.detail}</span></button>)}
    </div>
    <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-emerald-300 transition-all" style={{width:((intakeStep+1)/INTAKE_STEPS.length*100)+'%'}}/></div>

    {intakeStep===0&&<div className="space-y-4">
     <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3"><Kicker>JOURNEY DETAILS</Kicker><p className="mt-1 text-[11px] leading-5 text-slate-400">Set the journey purpose, client, service and operating mode. Saving creates a request only. It does not assess the route, approve it or authorise movement.</p></div>
     <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Input label="Journey title"><input required maxLength={180} className={field} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Client movement reference"/></Input>
      <Input label="Client account"><select className={field} value={form.client_id} onChange={e=>setForm({...form,client_id:e.target.value})}><option value="">No client linked</option>{clients.map(cl=><option key={cl.id} value={cl.id}>{cl.name}{cl.company?' · '+cl.company:''}</option>)}</select></Input>
      <Input label="Operational convoy"><select className={field} value={form.convoy_id} onChange={e=>setForm({...form,convoy_id:e.target.value})}><option value="">No convoy linked yet</option>{convoys.map(cv=><option key={cv.id} value={cv.id}>{cv.name} · {cv.status}</option>)}</select></Input>
      <Input label="Journey purpose and constraints" className="lg:col-span-3"><textarea required maxLength={1200} rows={3} className={field} value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})} placeholder="Operational objective, client constraints, support requirements, cargo sensitivity and movement context"/></Input>
     </div>
     <div className="grid grid-cols-1 gap-3 rounded-md border border-white/[0.07] bg-black/15 p-3 sm:grid-cols-2">
      <Input label="Transport mode"><select className={field} value={form.transport_mode} onChange={e=>setForm({...form,transport_mode:e.target.value})}><option value="road">Road / convoy</option><option value="air">Air</option><option value="rail">Rail</option><option value="sea">Sea</option><option value="multimodal">Multimodal</option><option value="other">Other</option></select></Input>
      <Input label="Time zone"><input required className={field} value={form.timezone} onChange={e=>setForm({...form,timezone:e.target.value})} placeholder="Africa/Nairobi"/></Input>
     </div>
     <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3"><Kicker>AIRPORT & EXECUTIVE SERVICES</Kicker><p className="mt-1 text-[11px] leading-5 text-slate-400">Add a flight number before saving. An authorised team member can record updates afterwards; Sonalit is not connected to a live airline feed.</p><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Input label="Service type"><select className={field} value={form.service_type} onChange={e=>setForm({...form,service_type:e.target.value})}>{[['airport_arrival','Airport arrival'],['airport_departure','Airport departure'],['meet_and_greet','Meet and greet'],['close_protection','Close protection'],['security_escort','Security escort'],['executive_transfer','Executive transfer'],['other','Other']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Input>
      <Input label="Principal / booking reference (avoid full name)"><input maxLength={120} className={field} value={form.principal_reference} onChange={e=>setForm({...form,principal_reference:e.target.value})} placeholder="Protected reference or booking code"/></Input>
      <Input label="Airport code (IATA / ICAO)"><input maxLength={4} className={field} value={form.airport_code} onChange={e=>setForm({...form,airport_code:e.target.value.toUpperCase()})} placeholder="NBO"/></Input>
      <Input label="Terminal"><input maxLength={80} className={field} value={form.terminal} onChange={e=>setForm({...form,terminal:e.target.value})} placeholder="Terminal / meeting point"/></Input>
      <Input label="Airline"><input maxLength={100} className={field} value={form.airline} onChange={e=>setForm({...form,airline:e.target.value})} placeholder="Airline name"/></Input>
      <Input label="Flight number"><input maxLength={24} className={field} value={form.flight_number} onChange={e=>setForm({...form,flight_number:e.target.value.toUpperCase()})} placeholder="KQ 100"/></Input>
      <Input label="Scheduled flight time · journey timezone"><input type="datetime-local" className={field} value={form.flight_scheduled_at} onChange={e=>setForm({...form,flight_scheduled_at:e.target.value})}/></Input>
      <Input label="Meet-and-greet / team instructions" className="sm:col-span-2"><textarea maxLength={2000} rows={2} className={field} value={form.meet_greet_instructions} onChange={e=>setForm({...form,meet_greet_instructions:e.target.value})} placeholder="Internal instructions shown to the assigned team"/></Input>
     </div></div>
    </div>}

    {intakeStep===1&&<div className="space-y-4">
     <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3"><Kicker>02 / CORRIDOR & MOVEMENT WINDOW</Kicker><p className="mt-1 text-[11px] leading-5 text-slate-400">Choose coordinates from the map or enter them directly. Selecting a point captures coordinates only; it does not geocode the place name or certify a traversable route.</p></div>
     <div className="grid grid-cols-1 gap-3 rounded-md border border-white/[0.07] bg-black/15 p-3 md:grid-cols-2">
      <div className="space-y-3"><div className="flex items-center justify-between gap-2"><Kicker>01 / ORIGIN</Kicker><Btn onClick={()=>setIntakePickTarget('origin')} tone="green"><MapPinned size={12}/>Pick on map</Btn></div><Input label="Origin / departure point name"><input required className={field} value={form.origin_label} onChange={e=>setForm({...form,origin_label:e.target.value})} placeholder="Named yard, terminal or agreed meeting point"/></Input><Input label="Planned departure · local time"><input required type="datetime-local" className={field} value={form.planned_departure_at} onChange={e=>setForm({...form,planned_departure_at:e.target.value})}/></Input><div className="grid grid-cols-2 gap-2"><Input label="Latitude"><input required type="number" step="any" min="-90" max="90" className={field} value={form.origin_lat} onChange={e=>setForm({...form,origin_lat:e.target.value})} placeholder="-1.2864"/></Input><Input label="Longitude"><input required type="number" step="any" min="-180" max="180" className={field} value={form.origin_lng} onChange={e=>setForm({...form,origin_lng:e.target.value})} placeholder="36.8172"/></Input></div></div>
      <div className="space-y-3"><div className="flex items-center justify-between gap-2"><Kicker>02 / DESTINATION</Kicker><Btn onClick={()=>setIntakePickTarget('destination')} tone="green"><MapPinned size={12}/>Pick on map</Btn></div><Input label="Destination / arrival point name"><input required className={field} value={form.destination_label} onChange={e=>setForm({...form,destination_label:e.target.value})} placeholder="Named delivery, port or handover point"/></Input><Input label="Planned arrival · local time"><input required type="datetime-local" className={field} value={form.planned_arrival_at} onChange={e=>setForm({...form,planned_arrival_at:e.target.value})}/></Input><div className="grid grid-cols-2 gap-2"><Input label="Latitude"><input required type="number" step="any" min="-90" max="90" className={field} value={form.destination_lat} onChange={e=>setForm({...form,destination_lat:e.target.value})} placeholder="-4.0435"/></Input><Input label="Longitude"><input required type="number" step="any" min="-180" max="180" className={field} value={form.destination_lng} onChange={e=>setForm({...form,destination_lng:e.target.value})} placeholder="39.6682"/></Input></div></div>
     </div>
     {intakePickTarget&&<div className="space-y-2 rounded-md border border-emerald-300/15 bg-emerald-300/[0.02] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[11px] font-semibold text-emerald-100">Selecting: {intakePickLabel}</p><p className="mt-1 text-[11px] text-slate-500">Pan and zoom to the intended point, then click once. The selected coordinate will fill the matching fields.</p></div><Btn onClick={()=>setIntakePickTarget(null)}><Check size={12}/>Done picking</Btn></div><IntakeMapPicker key={intakePickLabel} targetKey={intakePickLabel} onPick={applyIntakeMapPoint}/></div>}
     {!intakePickTarget&&<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-white/[0.09] p-3"><p className="text-[11px] text-slate-500">Map-assisted point capture is optional; the coordinate fields remain editable.</p><Btn onClick={()=>setIntakePickTarget('origin')}><MapPinned size={12}/>Open coordinate map</Btn></div>}
    </div>}

    {intakeStep===2&&<div className="space-y-3">
     <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-orange-300/15 bg-orange-300/[0.025] p-3"><div><Kicker>ROUTE STOPS</Kicker><p className="mt-1 text-[11px] leading-5 text-slate-400">Add checkpoints in travel order. Route Safety assesses the itinerary using stop coordinates. These are planned stops, not live tracking.</p></div><Btn disabled={stopDrafts.length>=23} onClick={()=>setStopDrafts([...stopDrafts,{name:'',stop_type:'checkpoint',lat:'',lng:'',instructions:''}])}><Plus size={12}/>Add stop</Btn></div>
     {stopDrafts.length===0?<div className="rounded-md border border-dashed border-white/[0.09] p-6 text-center"><Route size={20} className="mx-auto mb-2 text-slate-600"/><p className="text-[12px] font-medium text-slate-300">No stops added</p><p className="mt-1 text-[11px] text-slate-600">For road routing, add any border, rest, refuelling, meeting or delivery checkpoint that should be included in the route assessment.</p></div>:<div className="space-y-2">{stopDrafts.map((s,i)=><div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-white/[0.06] bg-black/15 p-3 sm:grid-cols-[1.2fr_.9fr_1fr_1fr_auto]"><Input label={'Stop '+String(i+1).padStart(2,'0')+' · Name'}><input required className={field} value={s.name} onChange={e=>setStopDrafts(stopDrafts.map((x,k)=>k===i?{...x,name:e.target.value}:x))} placeholder="Named checkpoint"/></Input><Input label="Type"><select className={field} value={s.stop_type} onChange={e=>setStopDrafts(stopDrafts.map((x,k)=>k===i?{...x,stop_type:e.target.value}:x))}>{['checkpoint','border','rest','refuelling','meeting','overnight','destination','other'].map(t=><option key={t} value={t}>{t.replaceAll('_',' ')}</option>)}</select></Input><Input label="Latitude"><input required type="number" min="-90" max="90" step="any" className={field} value={s.lat} onChange={e=>setStopDrafts(stopDrafts.map((x,k)=>k===i?{...x,lat:e.target.value}:x))} placeholder="Latitude"/></Input><Input label="Longitude"><input required type="number" min="-180" max="180" step="any" className={field} value={s.lng} onChange={e=>setStopDrafts(stopDrafts.map((x,k)=>k===i?{...x,lng:e.target.value}:x))} placeholder="Longitude"/></Input><div className="flex items-end gap-1"><Btn onClick={()=>setIntakePickTarget({stopIndex:i})}><MapPinned size={12}/></Btn><Btn tone="red" onClick={()=>setStopDrafts(stopDrafts.filter((_,k)=>k!==i))}><XCircle size={13}/></Btn></div><Input label="Stop instructions and constraints" className="sm:col-span-5"><input className={field} value={s.instructions} onChange={e=>setStopDrafts(stopDrafts.map((x,k)=>k===i?{...x,instructions:e.target.value}:x))} placeholder="Optional stop-specific instructions, entry notes or client constraints"/></Input></div>)}</div>}
     {intakePickTarget&&typeof intakePickTarget==='object'&&<div className="space-y-2 rounded-md border border-emerald-300/15 bg-emerald-300/[0.02] p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-[11px] font-semibold text-emerald-100">Selecting: {intakePickLabel}</p><p className="mt-1 text-[11px] text-slate-500">Click the intended point to fill that stop's coordinate pair.</p></div><Btn onClick={()=>setIntakePickTarget(null)}><Check size={12}/>Done picking</Btn></div><IntakeMapPicker key={intakePickLabel} targetKey={intakePickLabel} onPick={applyIntakeMapPoint}/></div>}
    </div>}

    {intakeStep===3&&<div className="space-y-4">
     <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3"><Kicker>{intakeMode==='edit'?'REVISION REVIEW':'REQUEST REVIEW'}</Kicker><p className="mt-1 text-[11px] leading-5 text-slate-400">{intakeMode==='edit'?'Saving this revision keeps the journey reference and audit history, but clears the previous route assessment and release decisions. The journey returns to Requested and must be assessed and approved again.':'This creates a request only. Route assessment, approval and dispatch readiness are separate steps.'}</p></div>
     <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <section className="rounded-md border border-white/[0.075] bg-black/15 p-4"><Kicker>JOURNEY SUMMARY</Kicker><h3 className="mt-2 text-base font-semibold text-white">{form.title||'Untitled journey'}</h3><p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-slate-400">{form.purpose||'Purpose not recorded'}</p><dl className="mt-4 space-y-2">{[['Client account',clients.find(cl=>cl.id===form.client_id)?.name||'Not linked'],['Operational convoy',convoys.find(cv=>cv.id===form.convoy_id)?.name||'Not linked'],['Transport mode',form.transport_mode.toUpperCase()],['Reporting time zone',form.timezone]].map(([label,value])=><div key={label} className="flex justify-between gap-3 border-b border-white/[0.05] pb-2 last:border-0"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="break-words text-right text-[11px] font-medium text-slate-200">{value}</dd></div>)}</dl></section>
      <section className="rounded-md border border-white/[0.075] bg-black/15 p-4"><Kicker>ROUTE PLAN</Kicker><div className="mt-3 space-y-3"><div className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-white/[0.025]"/><div className="min-w-0"><p className="text-[11px] font-semibold text-white">{form.origin_label}</p><p className="mt-1 font-mono text-[11px] text-slate-500">{form.origin_lat}, {form.origin_lng}</p><p className="mt-1 text-[11px] text-slate-600">Departure · {form.planned_departure_at||'Not scheduled'}</p></div></div><div className="ml-1 h-6 border-l border-dashed border-white/20"/><div className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-orange-200"/><div className="min-w-0"><p className="text-[11px] font-semibold text-white">{stopDrafts.length} ordered intermediate stops</p><p className="mt-1 text-[11px] text-slate-600">Route assessment requires a configured provider for the selected mode. Unsupported modes remain unapproved.</p></div></div><div className="ml-1 h-6 border-l border-dashed border-white/20"/><div className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-200"/><div className="min-w-0"><p className="text-[11px] font-semibold text-white">{form.destination_label}</p><p className="mt-1 font-mono text-[11px] text-slate-500">{form.destination_lat}, {form.destination_lng}</p><p className="mt-1 text-[11px] text-slate-600">Arrival · {form.planned_arrival_at||'Not scheduled'}</p></div></div></div></section>
     </div>
     <div className="rounded-md border border-amber-300/15 bg-amber-300/[0.025] p-3"><div className="flex gap-3"><ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-200"/><div><p className="text-[11px] font-semibold text-amber-100">{intakeMode==='edit'?'Revision invalidates prior release evidence':'Request is not a release decision'}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{intakeMode==='edit'?'Saving clears the prior route assessment, review decision, approval and dispatch-readiness confirmation. The journey returns to Requested and must be assessed and approved again.':'This journey starts as a request. Route assessment, human approval and departure readiness are separate steps.'}</p></div></div></div>{intakeMode==='edit'&&<label className="mt-3 flex cursor-pointer items-start gap-3 rounded-md border border-amber-300/20 bg-amber-300/[0.035] p-3"><input type="checkbox" className="mt-0.5 accent-emerald-300" checked={editAcknowledged} onChange={e=>setEditAcknowledged(e.target.checked)}/><span className="text-[11px] leading-5 text-amber-100/90">I understand that this revision clears the existing route assessment and release approvals. The journey returns to Requested and must be assessed and approved again.</span></label>}
    </div>}

    {((intakeMode==='edit'&&updateJourney.isError)||(intakeMode==='create'&&create.isError))&&<p role="alert" className="rounded-md border border-red-400/20 bg-red-500/[0.06] p-3 text-[11px] text-red-200">{errorText(intakeMode==='edit'?updateJourney.error:create.error,intakeMode==='edit'?'Journey revision failed.':'Journey creation failed.')}</p>}
    {intakeStepIssue&&<p role="status" className="rounded-md border border-amber-300/15 bg-amber-300/[0.025] px-3 py-2.5 text-[11px] leading-5 text-amber-100/90">Before continuing: {intakeStepIssue}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-4"><Btn onClick={resetIntake}>Cancel</Btn><div className="flex flex-wrap items-center gap-2">{intakeStep>0&&<Btn onClick={()=>{setIntakePickTarget(null);setIntakeStep((intakeStep-1) as 0|1|2|3)}}><ArrowLeft size={12}/>Back</Btn>}{intakeStep<3?<Btn tone="green" disabled={Boolean(intakeStepIssue)} onClick={()=>{setIntakePickTarget(null);setIntakeStep((intakeStep+1) as 0|1|2|3)}}>Continue to {INTAKE_STEPS[(intakeStep+1) as 1|2|3].label}<ArrowRight size={12}/></Btn>:<button type="submit" disabled={create.isPending||updateJourney.isPending||Boolean(intakeStepIssue)} className="inline-flex items-center gap-2 rounded-md border border-emerald-300/30 bg-emerald-300/15 px-4 py-2.5 text-[11px] font-semibold text-emerald-100 disabled:opacity-40"><Check size={13}/>{intakeMode==='edit'?(updateJourney.isPending?'Saving revision…':'Save revision & restart assessment'):create.isPending?'Saving request…':'Create journey request'}</button>}</div></div>
   </form>

  </Panel></div></div>}

    {act.isError&&<div role="alert" className="relative rounded-md border border-red-400/20 bg-red-500/[0.06] p-4 text-xs text-red-200"><div className="flex items-start gap-3"><AlertTriangle size={15} className="mt-0.5 shrink-0"/><div><p className="font-semibold">Sonalit did not confirm this action</p><p className="mt-1 leading-5 text-red-200/80">{errorText(act.error,'The action could not be completed.')}</p></div></div><button type="button" onClick={()=>act.reset()} className="absolute right-3 top-3 text-red-200/70" aria-label="Dismiss action error"><XCircle size={14}/></button></div>}

    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] py-3 text-[11px] text-slate-600"><span>SONALIT · XD LIVE SURVEILLANCE · SECURE JOURNEY MANAGEMENT</span><span className="inline-flex items-center gap-1.5 font-mono"><ShieldCheck size={11} className="text-emerald-300/70"/>Planned routes are not live locations. Modelled risk is not observed evidence.</span></footer>
   </div>
  </main>
 );

}
