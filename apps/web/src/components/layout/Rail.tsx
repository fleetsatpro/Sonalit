import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useAuthStore } from '../../stores/auth.js';

export interface NavItem { path:string; art:string; label:string }
interface NavGroup { label:string; hue:string; items:NavItem[] }

export const NAV_GROUPS:NavGroup[]=[
{label:'Command',hue:'255,178,62',items:[{path:'/command',art:'nav-command',label:'Command Center'},{path:'/gps',art:'nav-gps',label:'GPS Live'},{path:'/gev',art:'nav-globe',label:"God's Eye View"},{path:'/weather-studio',art:'nav-weather',label:'Weather Studio'},{path:'/replay',art:'nav-analytics',label:'Ops Replay'},{path:'/panic-center',art:'nav-beacon',label:'Panic Center'},{path:'/messages',art:'nav-headset',label:'Messages'},{path:'/ai-decisions',art:'nav-command',label:'Sonalit Copilot'}]},
{label:'Security',hue:'255,59,92',items:[{path:'/alerts',art:'nav-beacon',label:'Alerts & Incidents'},{path:'/signal-health',art:'nav-satellite',label:'Signal Integrity'},{path:'/guardian',art:'nav-shield',label:'Guardian AI'},{path:'/optical-recon',art:'nav-camera',label:'Optical Recon'},{path:'/geofences',art:'nav-map',label:'Geofences'},{path:'/corridor',art:'nav-camera',label:'XD Live Surveillance'},{path:'/rules',art:'nav-dossier',label:'Rules'},{path:'/route-analysis',art:'nav-map',label:'Route Safety'},{path:'/identity',art:'nav-shield',label:'Identity & Access'}]},
{label:'Protective Mobility',hue:'76,190,160',items:[{path:'/sjm',art:'nav-aircraft',label:'Secure Journey Management'},{path:'/sjm/field',art:'nav-suv',label:'Field Operations'}]},
{label:'Intelligence Centre',hue:'84,217,255',items:[{path:'/intelligence',art:'nav-analytics',label:'Intelligence Centre'},{path:'/risk-intel',art:'nav-dossier',label:'Legacy Risk Intel'}]},
{label:'Surveillance',hue:'183,157,255',items:[{path:'/surveillance',art:'nav-camera',label:'Covert Captures'},{path:'/surveillance/camera-wall',art:'nav-camera',label:'Camera Wall'},{path:'/incidents',art:'nav-beacon',label:'Incident Replay'},{path:'/drive',art:'nav-globe',label:'3D Drive Replay'},{path:'/guardian',art:'nav-shield',label:'Guardian AI'}]},
{label:'Fleet',hue:'55,230,255',items:[{path:'/convoys',art:'nav-suv',label:'Convoys'},{path:'/handover',art:'nav-dossier',label:'Handover'},{path:'/fleet',art:'nav-sedan',label:'Fleet'},{path:'/drivers',art:'nav-headset',label:'Drivers'},{path:'/field-officers',art:'nav-suv',label:'Field Officers'},{path:'/devices',art:'nav-satellite',label:'Devices'},{path:'/fuel',art:'nav-sedan',label:'Fuel'},{path:'/maintenance',art:'nav-dossier',label:'Maintenance'},{path:'/shifts',art:'nav-headset',label:'Shifts'}]},
{label:'Executive & Reporting',hue:'34,227,154',items:[{path:'/shipments',art:'nav-ship',label:'Shipments'},{path:'/cargo-portal',art:'nav-dossier',label:'Cargo Portal'},{path:'/analytics',art:'nav-analytics',label:'Analytics'},{path:'/reports',art:'nav-dossier',label:'Reports'},{path:'/convoy-reports',art:'nav-dossier',label:'Convoy Reports'},{path:'/finance',art:'nav-analytics',label:'Finance'},{path:'/claims',art:'nav-dossier',label:'Claims'},{path:'/executive',art:'nav-sedan',label:'Executive'},{path:'/communications',art:'nav-headset',label:'Communications'},{path:'/settings',art:'nav-command',label:'Settings'}]},
{label:'Container Management',hue:'255,122,0',items:[{path:'/cds',art:'nav-ship',label:'Container Management'}]},
];

const Rail=React.memo(function Rail({onClose}:{onClose?:()=>void}){
  const user=useAuthStore(s=>s.user);
  const routerState=useRouterState();
  const currentPath=routerState.location.pathname;
  const initials=user?.name?.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)??'OP';
  return <nav style={{display:'flex',flexDirection:'column',width:'var(--d-rail-w)',height:'100vh',background:'var(--d-carbon)',borderRight:'1px solid var(--d-rim2)',position:'fixed',left:0,top:0,zIndex:300,overflowY:'auto',scrollbarWidth:'none'}}>
    <Link to="/home" onClick={onClose} style={{display:'block',textDecoration:'none',padding:'20px 20px 12px',borderBottom:'1px solid var(--d-rim)'}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:32,height:32,background:'linear-gradient(135deg,#ff9040,#f07020)',clipPath:'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)',flexShrink:0}}/>
        <span className="d-rail-wordmark" style={{fontSize:17,background:'linear-gradient(90deg,#ff9040,#f07020)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',letterSpacing:'.1em'}}>SONALIT</span>
      </div>
      <div style={{marginTop:4,fontSize:10,color:'var(--d-t3)',fontFamily:'IBM Plex Mono, monospace',letterSpacing:'.06em'}}>COMMAND CENTER v3</div>
    </Link>
    <div style={{flex:1,padding:'12px 0',overflowY:'auto',scrollbarWidth:'none'}}>
      {NAV_GROUPS.map(group=><div key={group.label} style={{marginBottom:8}}>
        <div style={{padding:'6px 20px 4px',fontSize:9,fontFamily:'IBM Plex Mono, monospace',fontWeight:600,letterSpacing:'.12em',textTransform:'uppercase',color:'rgba('+group.hue+',.75)',display:'flex',alignItems:'center',gap:6}}>
          <span style={{width:3,height:8,borderRadius:2,background:'rgba('+group.hue+',.85)',flexShrink:0}}/>{group.label}
        </div>
        {group.items.map(item=>{
          const active=currentPath===item.path||(item.path!=='/'&&item.path!=='/corridor'&&currentPath.startsWith(item.path));
          return <Link key={item.path+'-'+group.label} to={item.path} onClick={onClose} className={'d-rail-navlabel'+(active?' is-active':'')} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 16px',textDecoration:'none',color:active?'rgb('+group.hue+')':'var(--d-t2)',background:active?'linear-gradient(90deg,rgba('+group.hue+',.10),transparent)':'transparent',borderLeft:active?'3px solid rgb('+group.hue+')':'3px solid transparent',boxShadow:active?'inset 4px 0 12px rgba('+group.hue+',.14)':'none',fontSize:14,transition:'all .15s'}}>
            <span className={'son-rail-icon'+(active?' is-active':'')} style={{color:active?'rgb('+group.hue+')':'rgba('+group.hue+',.7)'}} aria-hidden="true">
              <svg className="son-rail-art" viewBox="0 0 64 64" focusable="false"><use href={'/assets/nav/sonalit-nav-sprite.svg#'+item.art}/></svg>
            </span>
            {item.label}
          </Link>;
        })}
      </div>)}
    </div>
    <div style={{padding:'16px 20px',borderTop:'1px solid var(--d-rim)',display:'flex',alignItems:'center',gap:10}}>
      <div style={{position:'relative',flexShrink:0}}>
        <div style={{width:36,height:36,borderRadius:'50%',background:'linear-gradient(135deg,#f07020,#ff9040)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Orbitron, sans-serif',fontWeight:700,fontSize:12,color:'#fff'}}>{initials}</div>
        <div style={{position:'absolute',inset:-4,borderRadius:'50%',border:'1.5px solid var(--d-orange)',animation:'d-sonar 2.5s ease-out infinite',opacity:0}}/>
      </div>
      <div><div style={{fontSize:13,fontWeight:600,color:'var(--d-t1)'}}>{user?.name??'Operator'}</div><div style={{fontSize:10,color:'var(--d-t3)',textTransform:'uppercase',letterSpacing:'.08em',fontFamily:'IBM Plex Mono, monospace'}}>{user?.role??'operator'}</div></div>
    </div>
  </nav>;
});
export default Rail;
