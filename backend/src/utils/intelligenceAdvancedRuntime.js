/* Deterministic second-stage intelligence enrichment. No model is allowed to manufacture facts. */
const { query } = require('../config/database');
const logger = require('./logger');

const COUNTRY_NAMES = {
  KE:'Kenya', ML:'Mali', NE:'Niger', NG:'Nigeria', SO:'Somalia', SS:'South Sudan', SD:'Sudan', ET:'Ethiopia', TZ:'Tanzania', UG:'Uganda', RW:'Rwanda', BF:'Burkina Faso', BI:'Burundi', CM:'Cameroon', CF:'Central African Republic', TD:'Chad', GH:'Ghana', SN:'Senegal', MZ:'Mozambique', ZW:'Zimbabwe', UA:'Ukraine', YE:'Yemen', SY:'Syria', IQ:'Iraq', LB:'Lebanon', LY:'Libya', EG:'Egypt', CO:'Colombia', MX:'Mexico', IN:'India', PK:'Pakistan', AF:'Afghanistan', BD:'Bangladesh', BJ:'Benin', CI:'Ivory Coast', TG:'Togo', HT:'Haiti', MM:'Myanmar', PH:'Philippines', VE:'Venezuela'
};
const RANK={informational:0,low:1,moderate:2,high:3,critical:4};
const ACTOR_WORDS=/\b(militia|insurgent|rebels?|jihadists?|terrorists?|bandits?|armed group|security forces?|police|army|protesters?|demonstrators?)\b/gi;

function norm(v){return String(v||'').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[^a-z0-9\s-]/g,' ').replace(/\s+/g,' ').trim();}
function distanceKm(a,b){if(a.latitude==null||a.longitude==null||b.latitude==null||b.longitude==null)return null;const r=Math.PI/180,lat1=Number(a.latitude)*r,lat2=Number(b.latitude)*r,dLat=(Number(b.latitude)-Number(a.latitude))*r,dLon=(Number(b.longitude)-Number(a.longitude))*r;const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
function warningSeverity(score){if(score>=85)return'critical';if(score>=65)return'high';if(score>=40)return'moderate';return'low';}
function confidence(count, sources){return Math.min(96,Math.round(45+Math.min(25,count*4)+Math.min(25,Math.max(0,sources-1)*8)));}

async function upsertEntity(orgId,type,name,extra={}){
  const canonical=String(name||'').trim().slice(0,240);if(!canonical)return null;
  const {rows}=await query(`INSERT INTO intel_entities (org_id,entity_type,canonical_name,aliases,country_code,latitude,longitude,confidence,last_seen_at,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) ON CONFLICT (org_id,entity_type,canonical_name) DO UPDATE SET last_seen_at=now(),confidence=GREATEST(intel_entities.confidence,EXCLUDED.confidence),aliases=(SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(COALESCE(intel_entities.aliases,'[]'::jsonb)||COALESCE(EXCLUDED.aliases,'[]'::jsonb)) x),country_code=COALESCE(intel_entities.country_code,EXCLUDED.country_code),latitude=COALESCE(intel_entities.latitude,EXCLUDED.latitude),longitude=COALESCE(intel_entities.longitude,EXCLUDED.longitude),metadata=intel_entities.metadata||EXCLUDED.metadata RETURNING id`,[orgId,type,canonical,extra.aliases||[],extra.country_code||null,extra.latitude??null,extra.longitude??null,extra.confidence??60,extra.metadata||{}]);return rows[0]?.id||null;}

async function resolveObservationEntities(orgId, observations){
  let links=0,entities=0;
  for(const o of observations){
    const candidates=[];
    if(o.country_code&&COUNTRY_NAMES[o.country_code])candidates.push(['country',COUNTRY_NAMES[o.country_code],70]);
    const raw=String(o.body||'');
    const actors=[...new Set(raw.match(ACTOR_WORDS)||[])].slice(0,5);
    for(const actor of actors)candidates.push(['group',actor.toLowerCase(),45]);
    const author=o.raw_metadata?.author_id||o.raw_metadata?.page_id;
    if(author)candidates.push([o.provider==='facebook'?'organization':'person',`${o.provider||'source'}:${author}`,40]);
    for(const [type,name,c] of candidates){const id=await upsertEntity(orgId,type,name,{country_code:o.country_code,latitude:o.latitude,longitude:o.longitude,confidence:c,metadata:{resolver:'deterministic-v1'}});if(!id)continue;entities++;await query(`INSERT INTO intel_observation_entities (observation_id,entity_id,role,confidence) VALUES ($1,$2,$3,$4) ON CONFLICT DO UPDATE SET confidence=GREATEST(intel_observation_entities.confidence,EXCLUDED.confidence)`,[o.id,id,type==='country'?'location':'mentioned',c]);links++;}
  }
  return {entities,links};
}

async function linkEvents(orgId, events){let links=0;
  for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++){
    const a=events[i],b=events[j];if(a.country_code!==b.country_code)continue;
    const hours=Math.abs(new Date(a.last_seen_at)-new Date(b.last_seen_at))/3600000;if(hours>36)continue;
    const d=distanceKm(a,b);const titleA=norm(a.title),titleB=norm(b.title);const overlap=titleA&&titleB&&(titleA.includes(titleB.slice(0,45))||titleB.includes(titleA.slice(0,45)));
    let relationship=null,score=0;if(d!=null&&d<=50){relationship='spatial_cluster';score=82-Math.min(30,d/2);}else if(overlap){relationship='same_story';score=78;}else if(hours<=6){relationship='temporal_cluster';score=58;}if(!relationship)continue;
    await query(`INSERT INTO intel_event_links (from_event_id,to_event_id,relationship,distance_km,confidence,evidence) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO UPDATE SET confidence=GREATEST(intel_event_links.confidence,EXCLUDED.confidence),distance_km=COALESCE(EXCLUDED.distance_km,intel_event_links.distance_km)`,[a.id,b.id,relationship,d,Math.round(score),{hours:Math.round(hours*10)/10,country:a.country_code}]);links++;
  }
  return {links};
}

async function detectWarnings(orgId){
  const {rows}=await query(`SELECT country_code,COUNT(*) FILTER(WHERE last_seen_at>=now()-interval '6 hours')::int AS recent,COUNT(*) FILTER(WHERE last_seen_at>=now()-interval '7 days' AND last_seen_at<now()-interval '6 hours')::int AS prior,COUNT(*) FILTER(WHERE last_seen_at>=now()-interval '6 hours' AND severity IN ('high','critical'))::int AS severe,COUNT(DISTINCT source_id) FILTER(WHERE last_seen_at>=now()-interval '6 hours')::int AS sources,ARRAY_AGG(id ORDER BY last_seen_at DESC) FILTER(WHERE last_seen_at>=now()-interval '6 hours') AS evidence FROM intel_events WHERE country_code IS NOT NULL AND last_seen_at>=now()-interval '7 days' GROUP BY country_code`);
  let created=0;
  for(const r of rows){const recent=Number(r.recent),prior=Number(r.prior),baseline=Math.max(1,prior/28),ratio=recent/baseline;const severe=Number(r.severe),sources=Number(r.sources);if(recent<3||ratio<2)continue;let score=Math.min(100,30+Math.min(35,(ratio-2)*15)+Math.min(25,severe*8)+Math.min(10,Math.max(0,sources-1)*3));const severity=warningSeverity(score),confidence=confidence(recent,sources),evidence=(r.evidence||[]).slice(0,20);await query(`INSERT INTO intel_early_warnings (org_id,warning_type,scope_type,scope_key,headline,severity,confidence,signal_score,baseline,evidence,status,first_detected_at,last_detected_at,expires_at) VALUES ($1,'spike','country',$2,$3,$4,$5,$6,$7,$8,'open',now(),now(),now()+interval '24 hours')`,[orgId,r.country_code,`${r.country_code} intelligence activity is accelerating`,severity,confidence,Math.round(score*100)/100,{recent_6h:recent,prior_7d_excluding_6h:prior,expected_6h:Math.round(baseline*100)/100,ratio:Math.round(ratio*100)/100,severe_events:severe,sources},evidence]);created++;}
  }
  return {candidates:rows.length,created};
}

async function enrichOrg(orgId){
  try{const {rows:observations}=await query(`SELECT io.*,s.provider FROM intel_observations io LEFT JOIN intel_sources s ON s.id=io.source_id WHERE io.org_id=$1 AND io.observed_at>=now()-interval '48 hours' ORDER BY io.observed_at DESC LIMIT 3000`,[orgId]);const entityResult=await resolveObservationEntities(orgId,observations);
    const {rows:events}=await query(`SELECT id,country_code,title,latitude,longitude,last_seen_at,severity FROM intel_events WHERE org_id=$1 AND last_seen_at>=now()-interval '48 hours' ORDER BY last_seen_at DESC LIMIT 1000`,[orgId]);
    const linkResult=await linkEvents(orgId,events);const warningResult=await detectWarnings(orgId);return {entities:entityResult,event_links:linkResult,warnings:warningResult};
  }catch(err){logger.warn(`Advanced intelligence enrichment failed for ${orgId}: ${err.message}`);return {error:err.message};}
}

async function getEarlyWarnings(orgId,limit=100){const {rows}=await query(`SELECT * FROM intel_early_warnings WHERE org_id=$1 AND status IN ('open','review','acknowledged') ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END,last_detected_at DESC LIMIT $2`,[orgId,Math.min(200,Math.max(1,Number(limit)||100))]);return rows;}
module.exports={enrichOrg,getEarlyWarnings};
