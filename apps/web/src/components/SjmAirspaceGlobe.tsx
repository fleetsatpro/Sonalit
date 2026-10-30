import { useEffect, useRef, useState } from 'react';
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

const MAP_URL='https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
const FRESHNESS_COLOURS:Record<string,string>={LIVE:'#9ce8d2',DELAYED:'#f3c979',STALE:'#8a98a8',UNAVAILABLE:'#64748b'};
function mapKey(item:SjmAirspaceAircraft):string {
  return item.map_key||`${item.position_provider||item.provider||'opensky_rest'}:${item.id}`;
}
function ellipsoidHeight(altitude_m:number|null|undefined,reference?:string|null):number {
  return reference==='WGS84_ELLIPSOID'&&Number.isFinite(altitude_m)?Math.max(0,altitude_m as number):0;
}

const EAST_AFRICA_VIEW={
  destination:Cesium.Cartesian3.fromDegrees(37.9,0.5,4_200_000),
  orientation:{heading:0,pitch:Cesium.Math.toRadians(-68),roll:0},
};

export default function SjmAirspaceGlobe({aircraft,status,configured,lastPositionAt,bounds,pollIntervalSeconds=null,regionalStatus='NOT_CONFIGURED',regionalRadiusNm=250}:Props) {
  const containerRef=useRef<HTMLDivElement>(null);
  const widgetRef=useRef<Cesium.CesiumWidget|null>(null);
  const entityRef=useRef<Map<string,Cesium.Entity>>(new Map());
  const trailRef=useRef<Map<string,Cesium.Entity>>(new Map());
  const [initFailed,setInitFailed]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);

  useEffect(()=>{
    if(!containerRef.current)return;
    let widget:Cesium.CesiumWidget|undefined;
    let handler:Cesium.ScreenSpaceEventHandler|undefined;
    try{
      const imagery=new Cesium.UrlTemplateImageryProvider({
        url:MAP_URL,
        credit:new Cesium.Credit('© Carto · © OpenStreetMap contributors',false),
        maximumLevel:19,
      });
      widget=new Cesium.CesiumWidget(containerRef.current,{
        baseLayer:new Cesium.ImageryLayer(imagery),
        terrainProvider:new Cesium.EllipsoidTerrainProvider(),
        requestRenderMode:true,
        maximumRenderTimeChange:Number.POSITIVE_INFINITY,
        showRenderLoopErrors:false,
      });
      widget.scene.globe.enableLighting=true;
      widget.scene.globe.baseColor=Cesium.Color.fromCssColorString('#111b27');
      widget.scene.skyAtmosphere.show=true;
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
      const colour=Cesium.Color.fromCssColorString(FRESHNESS_COLOURS[item.freshness]||FRESHNESS_COLOURS.UNAVAILABLE);
      let entity=entityRef.current.get(key);
      if(!entity){
        entity=widget.entities.add({
          id:'sjm-aircraft:'+key,position,
          point:new Cesium.PointGraphics({pixelSize:8,color:colour,outlineColor:Cesium.Color.fromCssColorString('#17212b'),outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY}),
          label:new Cesium.LabelGraphics({
            text:item.ident||item.id,font:'11px Inter, sans-serif',
            fillColor:Cesium.Color.fromCssColorString('#e8eef2'),
            outlineColor:Cesium.Color.fromCssColorString('#0b1119'),outlineWidth:3,
            style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-15),
            distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,2_500_000),
            disableDepthTestDistance:Number.POSITIVE_INFINITY,
          }),
        });
        entityRef.current.set(key,entity);
      }else{
        entity.position=new Cesium.ConstantPositionProperty(position);
        entity.point=new Cesium.PointGraphics({
          pixelSize:8,color:colour,
          outlineColor:Cesium.Color.fromCssColorString('#17212b'),
          outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY,
        });
        if(entity.label)entity.label.text=new Cesium.ConstantProperty(item.ident||item.id);
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
    if(widget&&!widget.isDestroyed())widget.camera.flyTo(EAST_AFRICA_VIEW);
  };
  const zoom=(direction:'in'|'out')=>{
    const widget=widgetRef.current;
    if(!widget||widget.isDestroyed())return;
    if(direction==='in')widget.camera.zoomIn(450_000);
    else widget.camera.zoomOut(450_000);
    widget.scene.requestRender();
  };

  return <div className="overflow-hidden rounded-md border border-white/[0.08] bg-[#080e15]">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] tracking-[.14em] text-slate-400">3D AIRSPACE / EAST AFRICA</span>
        <span className={'rounded-sm border px-2 py-1 font-mono text-[10px] '+(status==='LIVE'?'border-emerald-300/25 text-emerald-200':'border-white/[0.09] text-slate-400')}>{status.replaceAll('_',' ')}</span>
      </div>
      <span className="text-[10px] text-slate-500">{aircraft.length.toLocaleString()} observations · OpenSky {configured?'configured':'off'} · ADSB.lol {regionalStatus.replaceAll('_',' ').toLowerCase()} ({regionalRadiusNm} NM when available) · {configured&&pollIntervalSeconds?pollIntervalSeconds+'s OpenSky snapshots':'OpenSky polling off'}</span>
    </div>
    {initFailed
      ?<div className="grid min-h-[420px] place-items-center p-6 text-center"><div><p className="text-sm font-semibold text-slate-200">3D renderer unavailable</p><p className="mt-1 text-xs text-slate-500">The airspace scene could not be initialised in this browser. No aircraft state has been inferred.</p></div></div>
      :<div className="relative">
        <div ref={containerRef} role="application" aria-label="Three-dimensional airspace globe showing provider-observed aircraft positions" className="h-[420px] w-full sm:h-[560px] xl:h-[650px]"/>
        <div role="group" aria-label="Airspace globe controls" className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-sm border border-white/15 bg-[#07101b]/90 shadow-lg backdrop-blur">
          <button type="button" onClick={()=>zoom('in')} aria-label="Zoom in" title="Zoom in" className="h-9 w-10 border-b border-white/10 text-base text-slate-200 hover:bg-white/10">+</button>
          <button type="button" onClick={()=>zoom('out')} aria-label="Zoom out" title="Zoom out" className="h-9 w-10 border-b border-white/10 text-base text-slate-200 hover:bg-white/10">−</button>
          <button type="button" onClick={resetView} aria-label="Reset airspace view" title="Reset airspace view" className="h-9 w-10 font-mono text-[10px] text-slate-200 hover:bg-white/10">RST</button>
        </div>
      </div>}
    <div className="grid grid-cols-1 gap-0 border-t border-white/[0.07] sm:grid-cols-[1fr_auto]">
      <div className="px-3 py-2.5 text-[10px] leading-5 text-slate-500 sm:px-4">
        <p>Markers are independent provider observations from OpenSky and, when enabled, ADSB.lol. OpenSky uses bounded REST snapshots; ADSB.lol shows an airport-centred radius only. Neither is continuous certified ATC surveillance, and no path is extrapolated between reports.</p>
        <p>Basemap: © Carto · © OpenStreetMap contributors. Aircraft data: source is shown per selected observation; ADSB.lol is published under ODbL 1.0.</p>
        <p>Coverage: {boundsLabel} · Latest reported position: {lastPositionAt?new Date(lastPositionAt).toLocaleTimeString():'none recorded'}</p>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5 text-[10px] text-slate-500 sm:px-4">
        {Object.entries(FRESHNESS_COLOURS).filter(([key])=>key!=='UNAVAILABLE').map(([key,value])=><span key={key} className="inline-flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full" style={{backgroundColor:value}}/>{key}</span>)}
      </div>
    </div>
    {selectedAircraft&&<div className="grid grid-cols-2 gap-3 border-t border-white/[0.07] bg-[#0d151e] px-3 py-3 text-[11px] sm:grid-cols-4 sm:px-4">
      <div><p className="text-slate-500">Callsign / ident</p><p className="mt-1 font-semibold text-slate-100">{selectedAircraft.ident}</p><p className="mt-1 text-[10px] text-slate-500">Source · {selectedAircraft.position_source_label||selectedAircraft.position_provider||selectedAircraft.provider||'OpenSky'}</p></div>
      <div><p className="text-slate-500">Reported altitude</p><p className="mt-1 font-semibold text-slate-100">{selectedAircraft.altitude_m==null?'Not reported':Math.round(selectedAircraft.altitude_m).toLocaleString()+' m · '+(selectedAircraft.altitude_reference==='WGS84_ELLIPSOID'?'GNSS / WGS84 ellipsoid':selectedAircraft.altitude_reference==='GEOMETRIC'?'geometric':selectedAircraft.altitude_reference==='BAROMETRIC_PRESSURE'?'barometric pressure':'reference not supplied')}</p></div>
      <div><p className="text-slate-500">Ground speed</p><p className="mt-1 font-semibold text-slate-100">{selectedAircraft.ground_speed_mps==null?'Not reported':Math.round(selectedAircraft.ground_speed_mps*3.6)+' km/h'}</p></div>
      <div><p className="text-slate-500">Observed</p><p className="mt-1 font-semibold text-slate-100">{new Date(selectedAircraft.observed_at).toLocaleTimeString()} · {selectedAircraft.freshness}</p></div>
    </div>}
  </div>;
}
