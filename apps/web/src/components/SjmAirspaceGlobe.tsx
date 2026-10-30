import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export type SjmAirspaceAircraft = {
  id:string; ident:string; latitude:number; longitude:number;
  altitude_m:number|null; ground_speed_mps:number|null; heading_deg:number|null;
  origin?:string|null; destination?:string|null; observed_at:string;
  age_seconds:number; freshness:string; update_type?:string|null;
  trail?:Array<{latitude:number;longitude:number;altitude_m:number|null;observed_at:string}>;
};
type Props = {
  aircraft:SjmAirspaceAircraft[]; status:string; configured:boolean;
  lastPositionAt?:string|null;
  bounds?:{south:number;west:number;north:number;east:number}|null;
};

const MAP_URL='https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
const FRESHNESS_COLOURS:Record<string,string>={LIVE:'#9ce8d2',DELAYED:'#f3c979',STALE:'#8a98a8',UNAVAILABLE:'#64748b'};

export default function SjmAirspaceGlobe({aircraft,status,configured,lastPositionAt,bounds}:Props) {
  const containerRef=useRef<HTMLDivElement>(null);
  const viewerRef=useRef<Cesium.Viewer|null>(null);
  const entityRef=useRef<Map<string,Cesium.Entity>>(new Map());
  const trailRef=useRef<Map<string,Cesium.Entity>>(new Map());
  const [initFailed,setInitFailed]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);

  useEffect(()=>{
    if(!containerRef.current)return;
    let viewer:Cesium.Viewer|undefined;
    let handler:Cesium.ScreenSpaceEventHandler|undefined;
    try{
      const imagery=new Cesium.UrlTemplateImageryProvider({
        url:MAP_URL,
        credit:new Cesium.Credit('© Carto · © OpenStreetMap contributors',false),
        maximumLevel:19,
      });
      viewer=new Cesium.Viewer(containerRef.current,{
        baseLayer:new Cesium.ImageryLayer(imagery),
        terrainProvider:new Cesium.EllipsoidTerrainProvider(),
        animation:false,baseLayerPicker:false,fullscreenButton:false,
        geocoder:false,homeButton:false,infoBox:false,sceneModePicker:false,
        selectionIndicator:false,timeline:false,navigationHelpButton:false,
        requestRenderMode:true,maximumRenderTimeChange:Number.POSITIVE_INFINITY,
        creditContainer:document.createElement('div'),
      });
      viewer.scene.globe.enableLighting=true;
      viewer.scene.globe.baseColor=Cesium.Color.fromCssColorString('#111b27');
      viewer.scene.skyAtmosphere.show=true;
      viewer.scene.screenSpaceCameraController.minimumZoomDistance=30_000;
      viewer.camera.setView({
        destination:Cesium.Cartesian3.fromDegrees(37.9,0.5,4_200_000),
        orientation:{heading:0,pitch:Cesium.Math.toRadians(-68),roll:0},
      });
      handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((event:Cesium.ScreenSpaceEventHandler.PositionedEvent)=>{
        const picked=viewer!.scene.pick(event.position);
        const entity=Cesium.defined(picked)?picked.id as Cesium.Entity:undefined;
        const key=entity&&typeof entity.id==='string'?entity.id.replace(/^sjm-aircraft:/,''):null;
        setSelected(key&&entityRef.current.has(key)?key:null);
        viewer!.scene.requestRender();
      },Cesium.ScreenSpaceEventType.LEFT_CLICK);
      viewerRef.current=viewer;
    }catch{
      setInitFailed(true);
      return;
    }
    return ()=>{
      handler?.destroy();
      entityRef.current.clear();
      trailRef.current.clear();
      if(viewer&&!viewer.isDestroyed())viewer.destroy();
      viewerRef.current=null;
    };
  },[]);

  useEffect(()=>{
    const viewer=viewerRef.current;
    if(!viewer||viewer.isDestroyed())return;
    const liveIds=new Set(aircraft.map(item=>item.id));
    for(const [id,entity] of entityRef.current){
      if(!liveIds.has(id)){
        viewer.entities.remove(entity);
        entityRef.current.delete(id);
        const trail=trailRef.current.get(id);
        if(trail)viewer.entities.remove(trail);
        trailRef.current.delete(id);
      }
    }
    for(const item of aircraft){
      const position=Cesium.Cartesian3.fromDegrees(item.longitude,item.latitude,Math.max(0,item.altitude_m??0));
      const colour=Cesium.Color.fromCssColorString(FRESHNESS_COLOURS[item.freshness]||FRESHNESS_COLOURS.UNAVAILABLE);
      let entity=entityRef.current.get(item.id);
      if(!entity){
        entity=viewer.entities.add({
          id:'sjm-aircraft:'+item.id,position,
          point:new Cesium.PointGraphics({pixelSize:8,color,outlineColor:Cesium.Color.fromCssColorString('#17212b'),outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY}),
          label:new Cesium.LabelGraphics({
            text:item.ident||item.id,font:'11px Inter, sans-serif',
            fillColor:Cesium.Color.fromCssColorString('#e8eef2'),
            outlineColor:Cesium.Color.fromCssColorString('#0b1119'),outlineWidth:3,
            style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-15),
            distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,2_500_000),
            disableDepthTestDistance:Number.POSITIVE_INFINITY,
          }),
        });
        entityRef.current.set(item.id,entity);
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
      if(track.length>1){
        const positions=track.map(p=>Cesium.Cartesian3.fromDegrees(p.longitude,p.latitude,Math.max(0,p.altitude_m??0)));
        let trail=trailRef.current.get(item.id);
        if(!trail){
          trail=viewer.entities.add({id:'sjm-aircraft-trail:'+item.id,polyline:new Cesium.PolylineGraphics({
            positions,width:1.5,material:colour.withAlpha(0.45),arcType:Cesium.ArcType.NONE,
          })});
          trailRef.current.set(item.id,trail);
        }else trail.polyline=new Cesium.PolylineGraphics({positions,width:1.5,material:colour.withAlpha(0.45),arcType:Cesium.ArcType.NONE});
      }
    }
    viewer.scene.requestRender();
  },[aircraft]);

  const selectedAircraft=aircraft.find(item=>item.id===selected)||null;
  const boundsLabel=bounds
    ? bounds.south.toFixed(1)+'° to '+bounds.north.toFixed(1)+'° latitude · '+bounds.west.toFixed(1)+'° to '+bounds.east.toFixed(1)+'° longitude'
    : 'not configured';

  return <div className="overflow-hidden rounded-md border border-white/[0.08] bg-[#080e15]">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] tracking-[.14em] text-slate-400">3D AIRSPACE / EAST AFRICA</span>
        <span className={'rounded-sm border px-2 py-1 font-mono text-[10px] '+(status==='LIVE'?'border-emerald-300/25 text-emerald-200':'border-white/[0.09] text-slate-400')}>{status.replaceAll('_',' ')}</span>
      </div>
      <span className="text-[10px] text-slate-500">{aircraft.length.toLocaleString()} aircraft records · {configured?'provider configured':'provider not configured'}</span>
    </div>
    {initFailed?<div className="grid min-h-[420px] place-items-center p-6 text-center"><div><p className="text-sm font-semibold text-slate-200">3D renderer unavailable</p><p className="mt-1 text-xs text-slate-500">The Cesium globe could not be initialised in this browser.</p></div></div>
      :<div ref={containerRef} role="img" aria-label="Three-dimensional airspace globe showing provider-observed aircraft positions" className="h-[420px] w-full sm:h-[560px] xl:h-[650px]"/>}
    <div className="grid grid-cols-1 gap-0 border-t border-white/[0.07] sm:grid-cols-[1fr_auto]">
      <div className="px-3 py-2.5 text-[10px] leading-5 text-slate-500 sm:px-4">
        <p>Position markers and trails are provider observations. No path is extrapolated between reports.</p>\n        <p>Basemap attribution: © Carto · © OpenStreetMap contributors.</p>
        <p>Coverage: {boundsLabel} · Last position message: {lastPositionAt?new Date(lastPositionAt).toLocaleTimeString():'none recorded'}</p>
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5 text-[10px] text-slate-500 sm:px-4">
        {Object.entries(FRESHNESS_COLOURS).filter(([key])=>key!=='UNAVAILABLE').map(([key,value])=><span key={key} className="inline-flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full" style={{backgroundColor:value}}/>{key}</span>)}
      </div>
    </div>
    {selectedAircraft&&<div className="grid grid-cols-2 gap-3 border-t border-white/[0.07] bg-[#0d151e] px-3 py-3 text-[11px] sm:grid-cols-4 sm:px-4">
      <div><p className="text-slate-500">Callsign / ident</p><p className="mt-1 font-semibold text-slate-100">{selectedAircraft.ident}</p></div>
      <div><p className="text-slate-500">Altitude</p><p className="mt-1 font-semibold text-slate-100">{selectedAircraft.altitude_m==null?'Not reported':Math.round(selectedAircraft.altitude_m).toLocaleString()+' m'}</p></div>
      <div><p className="text-slate-500">Ground speed</p><p className="mt-1 font-semibold text-slate-100">{selectedAircraft.ground_speed_mps==null?'Not reported':Math.round(selectedAircraft.ground_speed_mps*3.6)+' km/h'}</p></div>
      <div><p className="text-slate-500">Observed</p><p className="mt-1 font-semibold text-slate-100">{new Date(selectedAircraft.observed_at).toLocaleTimeString()} · {selectedAircraft.freshness}</p></div>
    </div>}
  </div>;
}
