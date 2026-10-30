import { useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from '@cesium/engine';
import '@cesium/engine/Source/Widget/CesiumWidget.css';

export type SjmAirspaceAircraft = {
  id:string; map_key?:string; provider?:string; position_provider?:'opensky_rest'|'adsb_lol'; position_source_label?:string|null; ident:string; latitude:number; longitude:number;
  altitude_m:number|null; altitude_reference?:'WGS84_ELLIPSOID'|'GEOMETRIC'|'BAROMETRIC_PRESSURE'|null;
  ground_speed_mps:number|null; heading_deg:number|null;
  origin?:string|null; destination?:string|null; observed_at:string;
  age_seconds:number; freshness:string; update_type?:string|null;
  trail?:Array<{latitude:number;longitude:number;altitude_m:number|null;altitude_reference?:'WGS84_ELLIPSOID'|'GEOMETRIC'|'BAROMETRIC_PRESSURE'|null;observed_at:string}>;
};
type Props = {
  aircraft:SjmAirspaceAircraft[]; status:string; configured:boolean;
  lastPositionAt?:string|null;
  bounds?:{south:number;west:number;north:number;east:number}|null;
  pollIntervalSeconds?:number|null;
  regionalStatus?:string;
  regionalRadiusNm?:number;
};

type ProviderFilter='all'|'opensky_rest'|'adsb_lol';
type FreshnessFilter='all'|'LIVE'|'DELAYED'|'STALE'|'UNAVAILABLE';

const MAP_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const FRESHNESS_COLOURS:Record<string,string>={LIVE:'#9ce8d2',DELAYED:'#f3c979',STALE:'#8a98a8',UNAVAILABLE:'#64748b'};
const AIRCRAFT_SYMBOL_SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M24 2.8 29.2 20l15.2 8.5v4.2l-15.2-4.2v11.2l5.6 4.2v2.8L24 43.2 13.2 46.7v-2.8l5.6-4.2V28.5L3.6 32.7v-4.2L18.8 20 24 2.8Z" fill="#f7fbff" stroke="#07111b" stroke-width="2.2" stroke-linejoin="round"/></svg>';
const AIRCRAFT_SYMBOL='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(AIRCRAFT_SYMBOL_SVG);
function mapKey(item:SjmAirspaceAircraft):string {
  return item.map_key||`${item.position_provider||item.provider||'opensky_rest'}:${item.id}`;
}
function ellipsoidHeight(altitude_m:number|null|undefined,reference?:string|null):number {
  return reference==='WGS84_ELLIPSOID'&&Number.isFinite(altitude_m)?Math.max(0,altitude_m as number):0;
}
function sourceLabel(item:SjmAirspaceAircraft):string {
  if(item.position_source_label)return item.position_source_label;
  if(item.position_provider==='adsb_lol')return 'ADSB.lol';
  if(item.position_provider==='opensky_rest')return 'OpenSky Network';
  return item.provider||'Source unavailable';
}
function observedLabel(value?:string|null):string {
  if(!value)return 'Timestamp unavailable';
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleString([],{dateStyle:'medium',timeStyle:'medium',timeZone:'UTC'})+' UTC':'Timestamp unavailable';
}
function ageLabel(value?:number|null):string {
  return Number.isFinite(value)&&Number(value)>=0?Math.round(Number(value))+'s old':'Age unavailable';
}
function altitudeReferenceLabel(value?:string|null):string {
  if(value==='WGS84_ELLIPSOID')return 'GNSS / WGS84 ellipsoid';
  if(value==='GEOMETRIC')return 'Geometric';
  if(value==='BAROMETRIC_PRESSURE')return 'Barometric pressure';
  return 'Reference not supplied';
}

const EAST_AFRICA_VIEW={
  destination:Cesium.Cartesian3.fromDegrees(38.0,-0.5,6_200_000),
  orientation:{heading:0,pitch:Cesium.Math.toRadians(-90),roll:0},
};
function aircraftFocusView(item:SjmAirspaceAircraft):Cesium.CameraFlyToOptions {
  return {
    destination:Cesium.Cartesian3.fromDegrees(item.longitude,item.latitude,1_150_000),
    orientation:{heading:0,pitch:Cesium.Math.toRadians(-84),roll:0},
    duration:1.15,
  };
}

export default function SjmAirspaceGlobe({aircraft,status,configured,lastPositionAt,bounds,pollIntervalSeconds=null,regionalStatus='NOT_CONFIGURED',regionalRadiusNm=250}:Props) {
  const containerRef=useRef<HTMLDivElement>(null);
  const widgetRef=useRef<Cesium.CesiumWidget|null>(null);
  const entityRef=useRef<Map<string,Cesium.Entity>>(new Map());
  const trailRef=useRef<Map<string,Cesium.Entity>>(new Map());
  const [initFailed,setInitFailed]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const [providerFilter,setProviderFilter]=useState<ProviderFilter>('all');
  const [freshnessFilter,setFreshnessFilter]=useState<FreshnessFilter>('all');

  const filteredAircraft=useMemo(()=>{
    const query=search.trim().toLowerCase();
    return aircraft.filter(item=>{
      const provider=item.position_provider||'';
      const freshness=String(item.freshness||'UNAVAILABLE').toUpperCase();
      if(providerFilter!=='all'&&provider!==providerFilter)return false;
      if(freshnessFilter!=='all'&&freshness!==freshnessFilter)return false;
      if(!query)return true;
      return [item.ident,item.id,item.position_source_label,item.origin,item.destination]
        .some(value=>String(value||'').toLowerCase().includes(query));
    }).sort((a,b)=>{
      const at=Date.parse(a.observed_at),bt=Date.parse(b.observed_at);
      if(!Number.isFinite(at))return Number.isFinite(bt)?1:0;
      if(!Number.isFinite(bt))return -1;
      return bt-at;
    });
  },[aircraft,search,providerFilter,freshnessFilter]);

  useEffect(()=>{
    if(!containerRef.current)return;
    let widget:Cesium.CesiumWidget|undefined;
    let handler:Cesium.ScreenSpaceEventHandler|undefined;
    try{
      const imagery=new Cesium.UrlTemplateImageryProvider({
        url:MAP_URL,
        credit:new Cesium.Credit('© OpenStreetMap contributors',false),
        maximumLevel:19,
      });
      const imageryLayer=new Cesium.ImageryLayer(imagery);
      imageryLayer.brightness=0.72;
      imageryLayer.contrast=1.08;
      imageryLayer.saturation=0.38;
      widget=new Cesium.CesiumWidget(containerRef.current,{
        baseLayer:imageryLayer,
        terrainProvider:new Cesium.EllipsoidTerrainProvider(),
        requestRenderMode:true,
        maximumRenderTimeChange:Number.POSITIVE_INFINITY,
        showRenderLoopErrors:false,
      });
      widget.scene.backgroundColor=Cesium.Color.fromCssColorString('#050b12');
      widget.scene.globe.enableLighting=true;
      widget.scene.globe.showGroundAtmosphere=true;
      widget.scene.globe.baseColor=Cesium.Color.fromCssColorString('#111b27');
      widget.scene.skyAtmosphere.show=true;
      widget.scene.screenSpaceCameraController.enableCollisionDetection=true;
      widget.scene.screenSpaceCameraController.minimumZoomDistance=30_000;
      widget.camera.setView(EAST_AFRICA_VIEW);
      handler=new Cesium.ScreenSpaceEventHandler(widget.scene.canvas);
      handler.setInputAction((event:Cesium.ScreenSpaceEventHandler.PositionedEvent)=>{
        if(!widget||widget.isDestroyed())return;
        const picked=widget.scene.pick(event.position);
        const entity=Cesium.defined(picked)?picked.id as Cesium.Entity:undefined;
        const key=entity&&typeof entity.id==='string'?entity.id.replace(/^sjm-aircraft:/,''):null;
        setSelected(key&&entityRef.current.has(key)?key:null);
        widget.scene.requestRender();
      },Cesium.ScreenSpaceEventType.LEFT_CLICK);
      widgetRef.current=widget;
    }catch{
      handler?.destroy();
      if(widget&&!widget.isDestroyed())widget.destroy();
      setInitFailed(true);
      return;
    }
    return ()=>{
      handler?.destroy();
      entityRef.current.clear();
      trailRef.current.clear();
      if(widget&&!widget.isDestroyed())widget.destroy();
      widgetRef.current=null;
    };
  },[]);

  useEffect(()=>{
    const widget=widgetRef.current;
    if(!widget||widget.isDestroyed())return;
    const liveIds=new Set(aircraft.map(mapKey));
    for(const [id,entity] of entityRef.current){
      if(!liveIds.has(id)){
        widget.entities.remove(entity);
        entityRef.current.delete(id);
        const trail=trailRef.current.get(id);
        if(trail)widget.entities.remove(trail);
        trailRef.current.delete(id);
      }
    }
    for(const item of aircraft){
      const key=mapKey(item);
      const position=Cesium.Cartesian3.fromDegrees(item.longitude,item.latitude,ellipsoidHeight(item.altitude_m,item.altitude_reference));
      const surfaceUp=Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(position,new Cesium.Cartesian3());
      const colour=Cesium.Color.fromCssColorString(FRESHNESS_COLOURS[String(item.freshness||'UNAVAILABLE').toUpperCase()]||FRESHNESS_COLOURS.UNAVAILABLE);
      let entity=entityRef.current.get(key);
      if(!entity){
        entity=widget.entities.add({
          id:'sjm-aircraft:'+key,position,
          point:new Cesium.PointGraphics({pixelSize:key===selected?9:5,color:colour,outlineColor:Cesium.Color.fromCssColorString('#17212b'),outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY}),
          billboard:new Cesium.BillboardGraphics({
            image:AIRCRAFT_SYMBOL,width:25,height:25,color:colour,
            rotation:item.heading_deg==null?0:Cesium.Math.toRadians(-item.heading_deg),
            horizontalOrigin:Cesium.HorizontalOrigin.CENTER,verticalOrigin:Cesium.VerticalOrigin.CENTER,
            alignedAxis:surfaceUp,
            scaleByDistance:new Cesium.NearFarScalar(150_000,1.12,12_000_000,.58),
            disableDepthTestDistance:Number.POSITIVE_INFINITY,
          }),
          label:new Cesium.LabelGraphics({
            text:item.ident||item.id,show:key===selected,font:'11px Inter, sans-serif',
            fillColor:Cesium.Color.fromCssColorString('#e8eef2'),
            outlineColor:Cesium.Color.fromCssColorString('#0b1119'),outlineWidth:3,
            style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-18),
            distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,10_000_000),
            disableDepthTestDistance:Number.POSITIVE_INFINITY,
          }),
        });
        entityRef.current.set(key,entity);
      }else{
        entity.position=new Cesium.ConstantPositionProperty(position);
        entity.point=new Cesium.PointGraphics({
          pixelSize:key===selected?9:5,color:colour,
          outlineColor:Cesium.Color.fromCssColorString('#17212b'),
          outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY,
        });
        entity.billboard=new Cesium.BillboardGraphics({
          image:AIRCRAFT_SYMBOL,width:25,height:25,color:colour,
          rotation:item.heading_deg==null?0:Cesium.Math.toRadians(-item.heading_deg),
          horizontalOrigin:Cesium.HorizontalOrigin.CENTER,verticalOrigin:Cesium.VerticalOrigin.CENTER,
          alignedAxis:surfaceUp,
          scaleByDistance:new Cesium.NearFarScalar(150_000,1.12,12_000_000,.58),
          disableDepthTestDistance:Number.POSITIVE_INFINITY,
        });
        if(entity.label){
          entity.label.text=new Cesium.ConstantProperty(item.ident||item.id);
          entity.label.show=new Cesium.ConstantProperty(key===selected);
        }
      }
      const track=(item.trail||[]).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
      let trail=trailRef.current.get(key);
      if(track.length>1){
        const positions=track.map(p=>Cesium.Cartesian3.fromDegrees(p.longitude,p.latitude,ellipsoidHeight(p.altitude_m,p.altitude_reference)));
        if(!trail){
          trail=widget.entities.add({id:'sjm-aircraft-trail:'+key,polyline:new Cesium.PolylineGraphics({
            positions,width:1.5,material:colour.withAlpha(0.45),arcType:Cesium.ArcType.NONE,
          })});
          trailRef.current.set(key,trail);
        }else trail.polyline=new Cesium.PolylineGraphics({positions,width:1.5,material:colour.withAlpha(0.45),arcType:Cesium.ArcType.NONE});
      }else if(trail){
        widget.entities.remove(trail);
        trailRef.current.delete(key);
      }
    }
    if(selected&&!liveIds.has(selected))setSelected(null);
    widget.scene.requestRender();
  },[aircraft,selected]);

  const selectedAircraft=aircraft.find(item=>mapKey(item)===selected)||null;
  const boundsLabel=bounds
    ? bounds.south.toFixed(1)+'° to '+bounds.north.toFixed(1)+'° latitude · '+bounds.west.toFixed(1)+'° to '+bounds.east.toFixed(1)+'° longitude'
    : 'not configured';
  const resetView=()=>{
    const widget=widgetRef.current;
    if(widget&&!widget.isDestroyed())widget.camera.flyTo({...EAST_AFRICA_VIEW,duration:1.15});
  };
  const focusAircraft=(item:SjmAirspaceAircraft)=>{
    const widget=widgetRef.current;
    if(widget&&!widget.isDestroyed())widget.camera.flyTo(aircraftFocusView(item));
  };
  const zoom=(direction:'in'|'out')=>{
    const widget=widgetRef.current;
    if(!widget||widget.isDestroyed())return;
    if(direction==='in')widget.camera.zoomIn(450_000);
    else widget.camera.zoomOut(450_000);
    widget.scene.requestRender();
  };

  return <section aria-label="Three-dimensional airspace display" data-testid="sjm-airspace-display" className="overflow-hidden rounded-lg border border-[#2a3948] bg-[#080e15]">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-[#0c141d] px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] font-semibold tracking-[.12em] text-slate-300">AIRSPACE / EAST AFRICA</span>
        <span className={'rounded-sm border px-2 py-1 font-mono text-[10px] '+(status==='LIVE'?'border-emerald-300/25 bg-emerald-300/[0.06] text-emerald-200':'border-white/[0.09] text-slate-400')}>{status.replaceAll('_',' ')}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
        <span className="tabular-nums">{aircraft.length.toLocaleString()} observations</span>
        <span>OpenSky {configured?'configured':'off'}</span>
        <span>ADSB.lol {regionalStatus.replaceAll('_',' ').toLowerCase()}</span>
        <span>{configured&&pollIntervalSeconds?pollIntervalSeconds+'s snapshots':'OpenSky polling off'}</span>
      </div>
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative min-w-0 border-b border-white/[0.07] xl:border-b-0 xl:border-r">
        {initFailed
          ?<div role="status" className="grid min-h-[420px] place-items-center p-6 text-center"><div><p className="text-sm font-semibold text-slate-200">3D renderer unavailable</p><p className="mt-1 max-w-md text-xs leading-5 text-slate-400">The airspace scene could not be initialised in this browser. Aircraft data remains available in the observation index where supplied.</p></div></div>
          :<div className="relative">
            <div ref={containerRef} role="application" aria-label="Three-dimensional airspace globe showing provider-observed aircraft positions" data-testid="sjm-airspace-globe" data-basemap-provider="openstreetmap" className="h-[420px] w-full sm:h-[560px] xl:h-[650px]"/>
            <div role="group" aria-label="Airspace globe controls" className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-md border border-white/15 bg-[#07101b]/90 shadow-lg backdrop-blur">
              <button type="button" onClick={()=>zoom('in')} aria-label="Zoom in" title="Zoom in" className="h-10 w-10 border-b border-white/10 text-base text-slate-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">+</button>
              <button type="button" onClick={()=>zoom('out')} aria-label="Zoom out" title="Zoom out" className="h-10 w-10 border-b border-white/10 text-base text-slate-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">−</button>
              <button type="button" onClick={resetView} aria-label="Reset airspace view" title="Reset airspace view" className="h-10 w-10 font-mono text-[10px] text-slate-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">RST</button>
            </div>
            {aircraft.length===0&&<div role="status" className="absolute bottom-3 left-3 max-w-[min(420px,calc(100%-24px))] rounded-md border border-white/10 bg-[#07101b]/90 px-3 py-2 text-[11px] leading-5 text-slate-300 shadow-lg">No provider aircraft observations in this snapshot. This does not establish that the airspace is empty.</div>}
          </div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] bg-[#0b131c] px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-400">
            {Object.entries(FRESHNESS_COLOURS).filter(([key])=>key!=='UNAVAILABLE').map(([key,value])=><span key={key} className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-2 w-2 rounded-full" style={{backgroundColor:value}}/>{key.toLowerCase()}</span>)}
          </div>
          <span className="text-[10px] tabular-nums text-slate-500">{lastPositionAt?'Latest position '+new Date(lastPositionAt).toLocaleTimeString():'No position timestamp'}</span>
        </div>
      </div>
      <aside aria-label="Aircraft inspection" className="flex min-w-0 flex-col bg-[#0b131c]">
        <div className="border-b border-white/[0.07] px-3 py-3 sm:px-4">
          <div className="flex items-baseline justify-between gap-2">
            <div><p className="text-[10px] font-semibold tracking-[.12em] text-slate-400">OBSERVATION INDEX</p><h5 className="mt-1 text-sm font-semibold text-white">Aircraft observations</h5></div>
            <span className="font-mono text-[10px] tabular-nums text-slate-400">{filteredAircraft.length} / {aircraft.length}</span>
          </div>
          <label className="mt-3 block">
            <span className="sr-only">Search aircraft observations</span>
            <input type="search" aria-label="Search aircraft observations" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Callsign, ICAO24 or route" className="w-full rounded-md border border-white/10 bg-[#080e15] px-3 py-2.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-300/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"/>
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="min-w-0"><span className="sr-only">Filter aircraft provider</span><select aria-label="Filter aircraft provider" value={providerFilter} onChange={event=>setProviderFilter(event.target.value as ProviderFilter)} className="w-full rounded-md border border-white/10 bg-[#080e15] px-2 py-2 text-[11px] text-slate-300 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"><option value="all">All sources</option><option value="opensky_rest">OpenSky</option><option value="adsb_lol">ADSB.lol</option></select></label>
            <label className="min-w-0"><span className="sr-only">Filter aircraft freshness</span><select aria-label="Filter aircraft freshness" value={freshnessFilter} onChange={event=>setFreshnessFilter(event.target.value as FreshnessFilter)} className="w-full rounded-md border border-white/10 bg-[#080e15] px-2 py-2 text-[11px] text-slate-300 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"><option value="all">All freshness</option><option value="LIVE">Live</option><option value="DELAYED">Delayed</option><option value="STALE">Stale</option><option value="UNAVAILABLE">Unavailable</option></select></label>
          </div>
        </div>
        {selectedAircraft&&<section aria-label="Selected aircraft observation" data-testid="sjm-selected-aircraft" aria-live="polite" className="border-b border-white/[0.07] bg-[#101a24] px-3 py-3 sm:px-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="text-[10px] font-semibold tracking-[.1em] text-slate-400">SELECTED OBSERVATION</p><h6 className="mt-1 truncate text-base font-semibold text-white">{selectedAircraft.ident||selectedAircraft.id}</h6><p className="mt-1 text-[10px] text-slate-400">{sourceLabel(selectedAircraft)} · {String(selectedAircraft.freshness).toLowerCase()}</p></div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button type="button" data-testid="sjm-aircraft-focus" onClick={()=>focusAircraft(selectedAircraft)} aria-label={`Focus ${selectedAircraft.ident||selectedAircraft.id} on globe`} className="rounded-md border border-sky-300/20 bg-sky-300/[0.06] px-2 py-1.5 text-[10px] font-semibold text-sky-100 hover:bg-sky-300/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">Focus</button>
              <button type="button" onClick={()=>setSelected(null)} aria-label="Clear aircraft selection" className="rounded-md border border-white/10 px-2 py-1.5 text-[10px] text-slate-300 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">Clear</button>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            <div><dt className="text-[10px] text-slate-500">Altitude reported</dt><dd className="mt-0.5 text-[11px] font-semibold text-slate-200">{selectedAircraft.altitude_m==null?'Not reported':Math.round(selectedAircraft.altitude_m).toLocaleString()+' m'}</dd></div>
            <div><dt className="text-[10px] text-slate-500">Ground speed</dt><dd className="mt-0.5 text-[11px] font-semibold text-slate-200">{selectedAircraft.ground_speed_mps==null?'Not reported':Math.round(selectedAircraft.ground_speed_mps*3.6).toLocaleString()+' km/h'}</dd></div>
            <div><dt className="text-[10px] text-slate-500">Heading</dt><dd className="mt-0.5 text-[11px] font-semibold text-slate-200">{selectedAircraft.heading_deg==null?'Not reported':Math.round(selectedAircraft.heading_deg)+'°'}</dd></div>
            <div><dt className="text-[10px] text-slate-500">ICAO24</dt><dd className="mt-0.5 break-all font-mono text-[10px] font-semibold text-slate-200">{selectedAircraft.id.toUpperCase()}</dd></div>
            <div className="col-span-2"><dt className="text-[10px] text-slate-500">Reported altitude reference</dt><dd className="mt-0.5 text-[11px] font-medium text-slate-200">{altitudeReferenceLabel(selectedAircraft.altitude_reference)}</dd></div>
            <div className="col-span-2"><dt className="text-[10px] text-slate-500">3D elevation treatment</dt><dd className="mt-0.5 text-[11px] leading-4 text-slate-300">{selectedAircraft.altitude_m==null?'Not resolved; marker remains at the reference surface.':selectedAircraft.altitude_reference==='WGS84_ELLIPSOID'?'Plotted using the reported WGS84 ellipsoid height.':'Not converted or plotted vertically; marker remains at the reference surface.'}</dd></div>
            <div className="col-span-2"><dt className="text-[10px] text-slate-500">Last observed</dt><dd className="mt-0.5 text-[11px] leading-4 text-slate-300">{observedLabel(selectedAircraft.observed_at)} · {ageLabel(selectedAircraft.age_seconds)}</dd></div>
            {(selectedAircraft.origin||selectedAircraft.destination)&&<div className="col-span-2"><dt className="text-[10px] text-slate-500">Provider-reported route</dt><dd className="mt-0.5 text-[11px] text-slate-300">{selectedAircraft.origin||'Origin not supplied'} → {selectedAircraft.destination||'Destination not supplied'}</dd></div>}
            <div className="col-span-2"><dt className="text-[10px] text-slate-500">Reported coordinates</dt><dd className="mt-0.5 font-mono text-[10px] text-slate-300">{selectedAircraft.latitude.toFixed(4)}, {selectedAircraft.longitude.toFixed(4)}</dd></div>
          </dl>
        </section>}
        <div className="flex min-h-[180px] flex-1 flex-col">
          {filteredAircraft.length===0
            ?<div role="status" className="grid min-h-[180px] flex-1 place-items-center px-4 py-8 text-center"><div><p className="text-xs font-semibold text-slate-200">{aircraft.length===0?'No aircraft observations available':'No observations match these filters'}</p><p className="mt-1 max-w-[250px] text-[10px] leading-5 text-slate-500">{aircraft.length===0?'A missing observation is not evidence of an empty airspace. Check provider availability and coverage.':'Change the search or source/freshness filters to see other observations.'}</p></div></div>
            :<ul aria-label="Aircraft observation list" data-testid="sjm-aircraft-observation-list" className="max-h-[360px] flex-1 divide-y divide-white/[0.055] overflow-y-auto xl:max-h-[520px]">
              {filteredAircraft.map(item=>{
                const key=mapKey(item),active=selected===key;
                const colour=FRESHNESS_COLOURS[String(item.freshness||'UNAVAILABLE').toUpperCase()]||FRESHNESS_COLOURS.UNAVAILABLE;
                return <li key={key}>
                  <button type="button" onClick={()=>setSelected(key)} aria-pressed={active} className={'w-full border-l-2 px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-emerald-300 '+(active?'border-l-emerald-300 bg-emerald-300/[0.055]':'border-l-transparent hover:bg-white/[0.035]')}>
                    <div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate text-xs font-semibold text-slate-100">{item.ident||'Unknown callsign'}</span><span className="shrink-0 inline-flex items-center gap-1.5 text-[10px] text-slate-300"><i aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{backgroundColor:colour}}/>{String(item.freshness||'UNAVAILABLE').toLowerCase()}</span></div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500"><span className="truncate">{sourceLabel(item)}</span><span className="shrink-0 font-mono tabular-nums">{ageLabel(item.age_seconds)}</span></div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400"><span>{item.altitude_m==null?'Altitude not reported':Math.round(item.altitude_m).toLocaleString()+' m'}</span><span className="font-mono">{Number(item.latitude).toFixed(2)}°, {Number(item.longitude).toFixed(2)}°</span></div>
                  </button>
                </li>;
              })}
            </ul>}
        </div>
      </aside>
    </div>
    <div className="grid grid-cols-1 gap-0 border-t border-white/[0.07] sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="space-y-1 px-3 py-3 text-[10px] leading-5 text-slate-400 sm:px-4">
        <p>Aircraft markers are provider observations. OpenSky uses bounded REST snapshots; ADSB.lol shows an airport-centred radius only. Neither is continuous certified ATC surveillance, and no path is extrapolated between reports.</p>
        <p>Only WGS84 ellipsoid-referenced heights are used for 3D elevation. Other altitude references are shown as reported but are not converted or inferred.</p>
        <p>Coverage: {boundsLabel} · Latest reported position: {lastPositionAt?observedLabel(lastPositionAt):'none recorded'}.</p>
        <p>Basemap: © OpenStreetMap contributors. Public raster tiles are best-effort; production-scale service needs a dedicated tile host. Aircraft data: source is shown per observation; ADSB.lol is published under ODbL 1.0.</p>
      </div>
      <div className="flex items-center gap-3 border-t border-white/[0.05] px-3 py-3 text-[10px] text-slate-500 sm:border-l sm:border-t-0 sm:px-4">
        <span>Map controls</span><span>Drag to rotate</span><span>Scroll to zoom</span>
      </div>
    </div>
  </section>;
}
