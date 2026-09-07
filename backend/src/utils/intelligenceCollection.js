const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const { query } = require('../config/database');
const logger = require('./logger');
const telegramMtproto = require('./telegramMtproto');

const xmlParser = new XMLParser({ ignoreAttributes: true });
const HIGH = /attack|ambush|kill|kidnap|abduct|bomb|explos|gunfire|shoot|terroris|insurgen|massacre|raid|fatal/i;
const MEDIUM = /protest|unrest|roadblock|strike|clash|robbery|bandit|checkpoint|tension|militia|curfew|riot|closure/i;
const COUNTRY_NAMES = ['Afghanistan','Bangladesh','Benin','Burkina Faso','Burundi','Cameroon','Central African Republic','Chad','Colombia','Egypt','El Salvador','Ethiopia','Ghana','Guatemala','Haiti','Honduras','India','Iraq','Ivory Coast','Kenya','Lebanon','Libya','Mali','Mexico','Mozambique','Myanmar','Niger','Nigeria','Pakistan','Papua New Guinea','Philippines','Rwanda','Senegal','Somalia','South Sudan','Sri Lanka','Sudan','Syria','Tanzania','Togo','Uganda','Ukraine','Venezuela','Yemen','Zimbabwe'];
const ISO = { Kenya:'KE',Mali:'ML',Niger:'NE',Nigeria:'NG',Somalia:'SO','South Sudan':'SS',Sudan:'SD',Ethiopia:'ET',Tanzania:'TZ',Uganda:'UG',Rwanda:'RW','Burkina Faso':'BF',Burundi:'BI',Cameroon:'CM','Central African Republic':'CF',Chad:'TD',Ghana:'GH',Senegal:'SN',Mozambique:'MZ',Zimbabwe:'ZW',Ukraine:'UA',Yemen:'YE',Syria:'SY',Iraq:'IQ',Lebanon:'LB',Libya:'LY',Egypt:'EG',Colombia:'CO',Mexico:'MX',India:'IN',Pakistan:'PK',Afghanistan:'AF',Bangladesh:'BD',Benin:'BJ','Ivory Coast':'CI',Togo:'TG',Haiti:'HT',Myanmar:'MM',Philippines:'PH','Papua New Guinea':'PG',Venezuela:'VE','El Salvador':'SV',Guatemala:'GT',Honduras:'HN' };
const SOURCE_TTL_MS = 24 * 3600 * 1000;
let running = false;

function hash(s) { return crypto.createHash('sha256').update(String(s || '').trim().toLowerCase()).digest('hex'); }
function level(text) { if (HIGH.test(text)) return 'high'; if (MEDIUM.test(text)) return 'moderate'; return 'low'; }
function countryCode(text) {
  const s = String(text || '');
  const hit = COUNTRY_NAMES.find(c => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(s));
  return hit ? ISO[hit] : null;
}
function parseJsonEnv(name, fallback = []) { try { const v = JSON.parse(process.env[name] || 'null'); return Array.isArray(v) ? v : fallback; } catch (e) { logger.warn(`Intelligence collection: invalid ${name}: ${e.message}`); return fallback; } }
async function boundedFetch(url, options = {}, timeout = 10000) { return fetch(url, { ...options, signal: AbortSignal.timeout(timeout) }); }

async function sourceId(orgId, name, type, provider, endpoint, metadata = {}) {
  const { rows } = await query(`SELECT id FROM intel_sources WHERE org_id=$1 AND name=$2 LIMIT 1`, [orgId, name]);
  if (rows[0]) return rows[0].id;
  const r = await query(`INSERT INTO intel_sources (org_id,name,source_type,provider,endpoint,reliability,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [orgId,name,type,provider,endpoint,Number(metadata.reliability ?? 55),metadata]);
  return r.rows[0].id;
}

async function storeObservation(orgId, source, item) {
  const title = String(item.title || '').slice(0, 500);
  const body = String(item.body || title).slice(0, 8000);
  const externalId = String(item.external_id || item.url || hash(`${title}|${body}`)).slice(0, 500);
  const contentHash = hash(`${title}|${body}`);
  const published = item.published_at ? new Date(item.published_at) : null;
  const publishedAt = published && Number.isFinite(published.getTime()) ? published.toISOString() : null;
  const cc = item.country_code || countryCode(`${title} ${body}`);
  const { rows } = await query(`INSERT INTO intel_observations (org_id,source_id,external_id,observed_at,published_at,title,body,url,language,country_code,latitude,longitude,content_hash,raw_metadata,credibility,manipulation_score) VALUES ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (org_id,source_id,external_id) DO UPDATE SET observed_at=now(),last_seen_at=now() RETURNING id, (xmax=0) AS inserted`, [orgId,source.id,externalId,publishedAt,title,body,item.url || null,item.language || null,cc,item.latitude ?? null,item.longitude ?? null,contentHash,item.metadata || {},item.credibility ?? 55,item.manipulation_score ?? 0]);
  await query(`UPDATE intel_sources SET last_seen_at=now(),updated_at=now() WHERE id=$1`, [source.id]);
  return { id: rows[0]?.id, inserted: rows[0]?.inserted, country_code: cc, severity: level(`${title} ${body}`) };
}

async function collectGdelt(countries) {
  const out = [];
  for (const cc of countries) {
    const country = Object.entries(ISO).find(([, v]) => v === cc)?.[0];
    if (!country) continue;
    try {
      const q = `"${country}" (attack OR conflict OR violence OR kidnapping OR ambush OR protest OR unrest OR roadblock OR coup)`;
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=20&timespan=24h&format=json`;
      const res = await boundedFetch(url, {}, 8000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      for (const a of (data.articles || [])) out.push({ title:a.title, body:a.title, url:a.url, external_id:a.url, country_code:cc, published_at:a.seendate ? `${a.seendate.slice(0,8)}T${a.seendate.slice(8,10)}:${a.seendate.slice(10,12)}:00Z` : null, metadata:{tone:a.tone,domain:a.domain,source:'gdelt'} });
    } catch (e) { logger.warn(`Intelligence collection: GDELT ${cc} failed: ${e.message}`); }
  }
  return out;
}

async function collectX(countries) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return [];
  const out = [];
  for (const cc of countries) {
    const country = Object.entries(ISO).find(([, v]) => v === cc)?.[0];
    if (!country) continue;
    try {
      const query = `(${country}) (attack OR conflict OR violence OR protest OR kidnapping OR roadblock) -is:retweet lang:en`;
      const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=50&tweet.fields=created_at,lang,author_id&expansions=author_id&user.fields=username`;
      const res = await boundedFetch(url,{headers:{Authorization:`Bearer ${token}`}},10000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      for (const t of (data.data || [])) out.push({ title:`X observation — ${country}`, body:t.text, url:`https://x.com/i/web/status/${t.id}`, external_id:`x:${t.id}`, country_code:cc, language:t.lang, published_at:t.created_at, metadata:{author_id:t.author_id,source:'x'} , credibility:45 });
    } catch (e) { logger.warn(`Intelligence collection: X ${cc} failed: ${e.message}`); }
  }
  return out;
}

async function collectMeta() {
  const token = process.env.META_ACCESS_TOKEN;
  const pages = parseJsonEnv('META_PAGE_IDS');
  if (!token || !pages.length) return [];
  const out=[];
  for (const p of pages) {
    try {
      const id = typeof p === 'string' ? p : p.id;
      const cc = typeof p === 'object' ? p.country_code : null;
      const url=`https://graph.facebook.com/v23.0/${encodeURIComponent(id)}/feed?fields=id,message,created_time,permalink_url&limit=50&access_token=${encodeURIComponent(token)}`;
      const res=await boundedFetch(url,{},10000); if(!res.ok) throw new Error(`HTTP ${res.status}`); const data=await res.json();
      for(const x of (data.data||[])) if(x.message) out.push({title:`Facebook page observation`,body:x.message,url:x.permalink_url,external_id:`facebook:${x.id}`,country_code:cc||countryCode(x.message),published_at:x.created_time,metadata:{page_id:id,source:'facebook'},credibility:50});
    } catch(e){ logger.warn(`Intelligence collection: Facebook page failed: ${e.message}`); }
  }
  return out;
}

async function collectRss() {
  const feeds=parseJsonEnv('INTEL_RSS_FEEDS'); const out=[]; const cutoff=Date.now()-SOURCE_TTL_MS;
  for(const f of feeds){
    if(!f?.url) continue;
    try { const res=await boundedFetch(f.url,{},10000); if(!res.ok) throw new Error(`HTTP ${res.status}`); const xml=await res.text(); const items=xmlParser.parse(xml)?.rss?.channel?.item || []; for(const raw of (Array.isArray(items)?items:[items])) { const d=new Date(raw.pubDate||0).getTime(); if(d && d<cutoff) continue; out.push({title:String(raw.title||''),body:String(raw.description||raw.title||''),url:raw.link,external_id:raw.guid||raw.link,country_code:f.country_code||countryCode(`${raw.title} ${raw.description}`),language:f.language,published_at:raw.pubDate,metadata:{feed:f.name||f.url,source:'rss'},credibility:f.credibility||55}); } }
    catch(e){ logger.warn(`Intelligence collection: RSS ${f.name||f.url} failed: ${e.message}`); }
  }
  return out;
}

async function collectReliefWeb(countries) {
  const appname=process.env.RELIEFWEB_APP_NAME; if(!appname) return [];
  const out=[];
  for(const cc of countries){ const country=Object.entries(ISO).find(([,v])=>v===cc)?.[0]; if(!country) continue; try { const u=new URL('https://api.reliefweb.int/v2/reports'); u.searchParams.set('appname',appname); u.searchParams.set('query[value]',country); u.searchParams.set('limit','20'); u.searchParams.append('fields[include][]','title');u.searchParams.append('fields[include][]','url');u.searchParams.append('fields[include][]','date.created'); const r=await boundedFetch(u,{},10000); if(!r.ok) throw new Error(`HTTP ${r.status}`); const d=await r.json(); for(const x of (d.data||[])){const f=x.fields||{};out.push({title:f.title,body:f.title,url:f.url||x.href,external_id:`reliefweb:${x.id}`,country_code:cc,published_at:f.date?.created,metadata:{source:'reliefweb'},credibility:75});}} catch(e){logger.warn(`Intelligence collection: ReliefWeb ${cc} failed: ${e.message}`);} }
  return out;
}

async function collectTelegram() {
  const channels=parseJsonEnv('INTEL_TELEGRAM_CHANNELS'); if(!channels.length) return [];
  const out=[]; const cutoff=Date.now()-SOURCE_TTL_MS;
  for(const raw of channels){ const channel=typeof raw==='string'?raw:raw.channel; const cc=typeof raw==='object'?raw.country_code:null; if(!channel) continue; try { let msgs=[]; if(telegramMtproto.isConfigured()){ try { msgs=await telegramMtproto.fetchChannelMessages(channel,cutoff); } catch(_){} } if(!msgs.length){ const r=await boundedFetch(`https://t.me/s/${encodeURIComponent(channel)}`,{headers:{'User-Agent':'Mozilla/5.0'}},10000); if(!r.ok) throw new Error(`HTTP ${r.status}`); const html=await r.text(); for(const block of html.split('data-post="').slice(1)){const id=(block.match(/^([^"]+)"/)||[])[1];const tm=(block.match(/<time[^>]*datetime="([^"]+)"/)||[])[1];const tx=(block.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/)||[])[1];if(id&&tm&&tx){const dt=new Date(tm).getTime();if(dt>=cutoff){const text=tx.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();msgs.push({id,text,created_at:tm});}}}} for(const m of msgs){const text=m.text||'';if(!HIGH.test(text)&&!MEDIUM.test(text))continue;out.push({title:`Telegram ${channel}`,body:text,url:`https://t.me/${String(m.id).split('/').pop()}`,external_id:`telegram:${m.id}`,country_code:cc||countryCode(text),published_at:m.created_at,metadata:{channel,source:'telegram'},credibility:45});}} catch(e){logger.warn(`Intelligence collection: Telegram ${channel} failed: ${e.message}`);} }
  return out;
}

async function collectForOrg(orgId, countries) {
  const results=[];
  const providers=[['gdelt','news','GDELT',collectGdelt],['x','social','X',collectX],['facebook','social','Facebook',collectMeta],['rss','rss','RSS',collectRss],['reliefweb','humanitarian','ReliefWeb',collectReliefWeb],['telegram','social','Telegram',collectTelegram]];
  for(const [key,type,name,fn] of providers){
    try { const items=key==='gdelt'||key==='x'||key==='reliefweb'?await fn(countries):await fn(); const sid=await sourceId(orgId,name,type,key,null,{reliability:key==='reliefweb'?75:key==='gdelt'?65:50}); let inserted=0; for(const item of items){const r=await storeObservation(orgId,{id:sid},item); if(r.inserted) inserted++;} results.push({provider:key,received:items.length,inserted}); }
    catch(e){results.push({provider:key,error:e.message});logger.warn(`Intelligence collection: ${name} failed for org ${orgId}: ${e.message}`);}
  }
  return results;
}

async function fuseOrg(orgId) {
  const {rows}=await query(`SELECT io.*,s.reliability FROM intel_observations io LEFT JOIN intel_sources s ON s.id=io.source_id WHERE io.org_id=$1 AND io.observed_at>=now()-interval '48 hours' ORDER BY io.observed_at DESC LIMIT 3000`,[orgId]);
  let created=0,linked=0;
  for(const o of rows){ if(!o.country_code) continue; const sev=level(`${o.title||''} ${o.body||''}`); const severity=sev==='high'?'high':sev==='moderate'?'moderate':'low'; const title=(o.title||o.body||'Observation').slice(0,240); const {rows:existing}=await query(`SELECT id FROM intel_events WHERE org_id=$1 AND country_code=$2 AND title=$3 AND last_seen_at>=now()-interval '48 hours' ORDER BY last_seen_at DESC LIMIT 1`,[orgId,o.country_code,title]); let eventId=existing[0]?.id;
    if(!eventId){const r=await query(`INSERT INTO intel_events (org_id,event_type,title,summary,status,severity,confidence,country_code,first_seen_at,last_seen_at,indicators) VALUES ($1,'security_observation',$2,$3,'discovered',$4,$5,$6,$7,$7,$8) RETURNING id`,[orgId,title,(o.body||title).slice(0,2000),severity,Math.min(95,Math.max(25,Number(o.credibility||50))),o.country_code,o.observed_at,JSON.stringify([{source:o.source_id,observation:o.id}])]);eventId=r.rows[0].id;created++;} const rel=await query(`INSERT INTO intel_event_observations(event_id,observation_id,relationship,weight) VALUES($1,$2,'supports',$3) ON CONFLICT DO NOTHING`,[eventId,o.id,Math.min(100,Number(o.credibility||50))]);linked+=rel.rowCount;
  }
  return {events_created:created,links_created:linked};
}

async function collectOnce() {
  if(running)return {skipped:true}; running=true;
  try { const {rows:orgs}=await query(`SELECT DISTINCT org_id FROM intel_watchlists WHERE active=true UNION SELECT DISTINCT org_id FROM risk_zones WHERE active=true`); const reports=[]; for(const o of orgs){ const {rows:w}=await query(`SELECT target FROM intel_watchlists WHERE org_id=$1 AND active=true`,[o.org_id]); const countries=[...new Set(w.flatMap(x=>[x.target?.country_code,x.target?.country]).filter(Boolean).map(x=>String(x).toUpperCase()))]; if(!countries.length){const {rows:z}=await query(`SELECT DISTINCT upper(substring(region from '([A-Za-z][A-Za-z ]+)$')) AS country FROM risk_zones WHERE org_id=$1 AND active=true`,[o.org_id]); for(const x of z) {const cc=countryCode(x.country||''); if(cc)countries.push(cc);} } const collection=await collectForOrg(o.org_id,[...new Set(countries)]); const fusion=await fuseOrg(o.org_id); reports.push({org_id:o.org_id,collection,fusion}); } return {skipped:false,reports,completed_at:new Date().toISOString()}; }
  finally {running=false;}
}

function schedule() { if(process.env.NODE_ENV==='test'||process.env.GENERATE_OPENAPI)return; if(global.__sonalitIntelCollectionScheduled)return; global.__sonalitIntelCollectionScheduled=true; const cron=require('node-cron'); cron.schedule(process.env.INTEL_COLLECTION_CRON||'*/30 * * * *',()=>collectOnce().catch(e=>logger.error(`Intelligence collection error: ${e.message}`))); setTimeout(()=>collectOnce().catch(e=>logger.warn(`Intelligence startup collection error: ${e.message}`)),15000); logger.info(`Intelligence Collection Fabric scheduled (${process.env.INTEL_COLLECTION_CRON||'every 30 minutes'})`); }

schedule();
module.exports={collectOnce};
