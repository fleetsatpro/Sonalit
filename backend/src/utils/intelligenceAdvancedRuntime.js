/* Deterministic second-stage intelligence enrichment. No model is allowed to manufacture facts. */
const { query } = require('../config/database');
const logger = require('./logger');
const COUNTRY_NAMES = {KE:'Kenya',ML:'Mali',NE:'Niger',NG:'Nigeria',SO:'Somalia',SS:'South Sudan',SD:'Sudan',ET:'Ethiopia',TZ:'Tanzania',UG:'Uganda',RW:'Rwanda',BF:'Burkina Faso',BI:'Burundi',CM:'Cameroon',CF:'Central African Republic',TD:'Chad',GH:'Ghana',SN:'Senegal',MZ:'Mozambique',ZW:'Zimbabwe',UA:'Ukraine',YE:'Yemen',SY:'Syria',IQ:'Iraq',LB:'Lebanon',LY:'Libya',EG:'Egypt',CO:'Colombia',MX:'Mexico',IN:'India',PK:'Pakistan',AF:'Afghanistan',BD:'Bangladesh',BJ:'Benin',CI:'Ivory Coast',TG:'Togo',HT:'Haiti',MM:'Myanmar',PH:'Philippines',VE:'Venezuela'};
const ACTOR_WORDS=/\b(militia|insurgent|rebels?|jihadists?|terrorists?|bandits?|armed group|security forces?|police|army|protesters?|demonstrators?)\b/gi;
function norm(v){return String(v||'').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[^a-z0-9\s-]/g,' ').replace(/\s+/g,' ').trim();}
function warningSeverity(score){if(score>=85)return'critical';if(score>=65)return'high';if(score>=40)return'moderate';return'low';}
function confidence(count,sources){return Math.min(96,Math.round(45+Math.min(25,count*4)+Math.min(25,Math.max(0,sources-1)*8)));}

async function upsertEntity(orgId,type,name,extra={}){
  const canonical=String(name||'').trim().slice(0,240); if(!canonical)return null;
  const aliases=Array.isArray(extra.aliases)?extra.aliases.filter(Boolean):[];
  const metadata=extra.metadata && typeof extra.metadata==='object' && !Array.isArray(extra.metadata)?extra.metadata:{};
  const {rows}=await query(`INSERT INTO intel_entities (org_id,entity_type,canonical_name,aliases,country_code,latitude,longitude,confidence,last_seen_at,metadata)
    VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,now(),$9::jsonb)
    ON CONFLICT (org_id,entity_type,canonical_name) DO UPDATE SET
      last_seen_at=now(), confidence=GREATEST(intel_entities.confidence,EXCLUDED.confidence),
      aliases=CASE WHEN jsonb_typeof(intel_entities.aliases)='array' AND jsonb_typeof(EXCLUDED.aliases)='array'
        THEN (SELECT COALESCE(jsonb_agg(DISTINCT x),'[]'::jsonb) FROM jsonb_array_elements(intel_entities.aliases || EXCLUDED.aliases) x)
        ELSE CASE WHEN jsonb_typeof(EXCLUDED.aliases)='array' THEN EXCLUDED.aliases ELSE '[]'::jsonb END END,
      country_code=COALESCE(intel_entities.country_code,EXCLUDED.country_code),
      latitude=COALESCE(intel_entities.latitude,EXCLUDED.latitude), longitude=COALESCE(intel_entities.longitude,EXCLUDED.longitude),
      metadata=CASE WHEN jsonb_typeof(intel_entities.metadata)='object' AND jsonb_typeof(EXCLUDED.metadata)='object' THEN intel_entities.metadata||EXCLUDED.metadata ELSE EXCLUDED.metadata END
    RETURNING id`,[orgId,type,canonical,JSON.stringify(aliases),extra.country_code||null,extra.latitude??null,extra.longitude??null,extra.confidence??60,JSON.stringify(metadata)]);
  return rows[0]?.id||null;
}

async function resolveObservationEntities(orgId,observations){
  let links=0,entities=0; const cache=new Map();
  for(const o of observations){
    const candidates=[];
    if(o.country_code&&COUNTRY_NAMES[o.country_code])candidates.push(['country',COUNTRY_NAMES[o.country_code],70]);
    const actors=[...new Set(String(o.body||'').match(ACTOR_WORDS)||[])].slice(0,5);
    for(const actor of actors)candidates.push(['group',actor.toLowerCase(),45]);
    const author=o.raw_metadata?.author_id||o.raw_metadata?.page_id;
    if(author)candidates.push([o.provider==='facebook'?'organization':'person',`${o.provider||'source'}:${author}`,40]);
    for(const [type,name,c] of candidates){
      const key=`${type}:${name}`; let id=cache.get(key);
      if(!id){id=await upsertEntity(orgId,type,name,{country_code:o.country_code,latitude:o.latitude,longitude:o.longitude,confidence:c,metadata:{resolver:'deterministic-v2'}});if(id)cache.set(key,id);}
      if(!id)continue; entities++;
      await query(`INSERT INTO intel_observation_entities (observation_id,entity_id,role,confidence) VALUES ($1,$2,$3,$4)
        ON CONFLICT (observation_id,entity_id) DO UPDATE SET confidence=GREATEST(intel_observation_entities.confidence,EXCLUDED.confidence)`,[o.id,id,type==='country'?'location':'mentioned',c]);
      links++;
    }
  }
  return {entities,links};
}

async function linkEvents(orgId){
  const {rows}=await query(`WITH candidates AS (
    SELECT a.id AS a_id,b.id AS b_id,a.country_code,a.latitude AS a_lat,a.longitude AS a_lon,b.latitude AS b_lat,b.longitude AS b_lon,
      a.last_seen_at AS a_time,b.last_seen_at AS b_time,a.title AS a_title,b.title AS b_title
    FROM intel_events a JOIN intel_events b ON a.org_id=b.org_id AND a.id<b.id AND a.country_code=b.country_code
      AND a.last_seen_at>=now()-interval '48 hours' AND b.last_seen_at>=now()-interval '48 hours'
      AND ABS(EXTRACT(EPOCH FROM (a.last_seen_at-b.last_seen_at)))<=129600
    WHERE a.org_id=$1 AND ((a.latitude IS NOT NULL AND a.longitude IS NOT NULL AND b.latitude IS NOT NULL AND b.longitude IS NOT NULL)
      OR lower(a.title) LIKE '%'||lower(left(b.title,45))||'%' OR lower(b.title) LIKE '%'||lower(left(a.title,45))||'%')
  ), scored AS (
    SELECT *,6371*2*asin(sqrt(power(sin(radians(b_lat-a_lat)/2),2)+cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians(b_lon-a_lon)/2),2))) AS distance_km FROM candidates
  ) SELECT * FROM scored WHERE distance_km<=50 OR lower(a_title) LIKE '%'||lower(left(b_title,45))||'%' OR lower(b_title) LIKE '%'||lower(left(a_title,45))||'%' LIMIT 1000`,[orgId]);
  if(!rows.length)return {candidates:0,links:0};
  const values=[]; const params=[]; let p=1;
  for(const c of rows){
    const hours=Math.abs(new Date(c.a_time)-new Date(c.b_time))/3600000;
    const sameStory=norm(c.a_title)&&norm(c.b_title)&&(norm(c.a_title).includes(norm(c.b_title).slice(0,45))||norm(c.b_title).includes(norm(c.a_title).slice(0,45)));
    const relationship=c.distance_km<=50?'spatial_cluster':sameStory?'same_story':hours<=6?'temporal_cluster':null;
    if(!relationship)continue;
    const score=relationship==='spatial_cluster'?Math.max(52,Math.round(82-Math.min(30,c.distance_km/2))):relationship==='same_story'?78:58;
    values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::jsonb)`);
    params.push(c.a_id,c.b_id,relationship,Number.isFinite(c.distance_km)?c.distance_km:null,score,JSON.stringify({hours:Math.round(hours*10)/10,country:c.country_code}));
  }
  if(!values.length)return {candidates:rows.length,links:0};
  await query(`INSERT INTO intel_event_links (from_event_id,to_event_id,relationship,distance_km,confidence,evidence) VALUES ${values.join(',')}
    ON CONFLICT (from_event_id,to_event_id,relationship) DO UPDATE SET confidence=GREATEST(intel_event_links.confidence,EXCLUDED.confidence),distance_km=COALESCE(EXCLUDED.distance_km,intel_event_links.distance_km)`,params);
  return {candidates:rows.length,links:values.length};
}

async function detectWarnings(orgId){
  const {rows}=await query(`SELECT country_code,COUNT(*) FILTER(WHERE last_seen_at>=now()-interval '6 hours')::int AS recent,
    COUNT(*) FILTER(WHERE last_seen_at>=now()-interval '7 days' AND last_seen_at<now()-interval '6 hours')::int AS prior,
    COUNT(*) FILTER(WHERE last_seen_at>=now()-interval '6 hours' AND severity IN ('high','critical'))::int AS severe,
    COUNT(DISTINCT source_id) FILTER(WHERE last_seen_at>=now()-interval '6 hours')::int AS sources,
    ARRAY_AGG(id ORDER BY last_seen_at DESC) FILTER(WHERE last_seen_at>=now()-interval '6 hours') AS evidence
    FROM intel_events WHERE org_id=$1 AND country_code IS NOT NULL AND last_seen_at>=now()-interval '7 days' GROUP BY country_code`,[orgId]);
  let created=0,updated=0;
  for(const r of rows){const recent=Number(r.recent),prior=Number(r.prior),baseline=Math.max(1,prior/28),ratio=recent/baseline,severe=Number(r.severe),sources=Number(r.sources);if(recent<3||ratio<2)continue;
    const score=Math.min(100,30+Math.min(35,(ratio-2)*15)+Math.min(25,severe*8)+Math.min(10,Math.max(0,sources-1)*3)),severity=warningSeverity(score),conf=confidence(recent,sources),evidence=(r.evidence||[]).slice(0,20),base={recent_6h:recent,prior_7d_excluding_6h:prior,expected_6h:Math.round(baseline*100)/100,ratio:Math.round(ratio*100)/100,severe_events:severe,sources};
    const {rows:existing}=await query(`SELECT id FROM intel_early_warnings WHERE org_id=$1 AND warning_type='spike' AND scope_type='country' AND scope_key=$2 AND status IN ('open','review','acknowledged') AND last_detected_at>=now()-interval '24 hours' ORDER BY last_detected_at DESC LIMIT 1`,[orgId,r.country_code]);
    if(existing[0]){await query(`UPDATE intel_early_warnings SET severity=$2,confidence=$3,signal_score=$4,baseline=$5,evidence=$6,last_detected_at=now(),expires_at=now()+interval '24 hours' WHERE id=$1`,[existing[0].id,severity,conf,score,base,evidence]);updated++;}
    else{await query(`INSERT INTO intel_early_warnings (org_id,warning_type,scope_type,scope_key,headline,severity,confidence,signal_score,baseline,evidence,status,first_detected_at,last_detected_at,expires_at) VALUES ($1,'spike','country',$2,$3,$4,$5,$6,$7,$8,'open',now(),now(),now()+interval '24 hours')`,[orgId,r.country_code,`${r.country_code} intelligence activity is accelerating`,severity,conf,Math.round(score*100)/100,base,evidence]);created++;}
  }
  return {candidates:rows.length,created,updated};
}

async function enrichOrg(orgId){
  try{
    // Bound enrichment work. The previous 3,000-row N+1 pass could create thousands of DB round trips per sweep.
    const {rows:observations}=await query(`SELECT io.*,s.provider FROM intel_observations io LEFT JOIN intel_sources s ON s.id=io.source_id WHERE io.org_id=$1 AND io.observed_at>=now()-interval '48 hours' ORDER BY io.observed_at DESC LIMIT 800`,[orgId]);
    const entityResult=await resolveObservationEntities(orgId,observations); const linkResult=await linkEvents(orgId); const warningResult=await detectWarnings(orgId);
    return {entities:entityResult,event_links:linkResult,warnings:warningResult};
  }catch(err){logger.warn(`Advanced intelligence enrichment failed for ${orgId}: ${err.message}`);return {error:err.message};}
}
async function getEarlyWarnings(orgId,limit=100){const {rows}=await query(`SELECT * FROM intel_early_warnings WHERE org_id=$1 AND status IN ('open','review','acknowledged') ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END,last_detected_at DESC LIMIT $2`,[orgId,Math.min(200,Math.max(1,Number(limit)||100))]);return rows;}
module.exports={enrichOrg,getEarlyWarnings};