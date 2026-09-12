/*
 * Aggressive Intelligence Agent Mesh
 *
 * Public/authorized collection only. This is intentionally a high-concurrency
 * logical agent mesh: many specialist lanes fan into a small number of bounded
 * network collectors, with retries, timeouts and deduplication at persistence.
 * WhatsApp Channels are supported only through an official/authorized ingestion
 * endpoint configured in INTEL_WHATSAPP_CHANNELS_JSON; the system never attempts
 * to bypass WhatsApp access controls or silently join private channels.
 */
require('dotenv').config();
const crypto = require('crypto');
const { query } = require('../config/database');
const logger = require('./logger');

const TIMEOUT_MS = Math.max(5000, Number(process.env.INTEL_AGENT_TIMEOUT_MS || 15000));
const INTERVAL_MS = Math.max(5, Number(process.env.INTEL_AGENT_INTERVAL_MINUTES || 5)) * 60 * 1000;
const MAX_ITEMS_PER_SOURCE = Math.min(100, Math.max(10, Number(process.env.INTEL_AGENT_MAX_ITEMS || 60)));
const MAX_PARALLEL = Math.min(8, Math.max(1, Number(process.env.INTEL_AGENT_PARALLEL || 4)));
const AGENT_COUNT = 24;
const COUNTRY_NAMES = { KE:'Kenya', SO:'Somalia', ET:'Ethiopia', UG:'Uganda', TZ:'Tanzania', RW:'Rwanda', BI:'Burundi', SS:'South Sudan', DJ:'Djibouti', ER:'Eritrea', SD:'Sudan', CD:'DR Congo' };

const AGENTS = [
  ['KE-BREAKING','Kenya Breaking Alerts',['Kenya','Nairobi','Mombasa','breaking news','security alert']],
  ['KE-CRIME','Kenya Crime & Public Safety',['Kenya crime','robbery','murder','kidnap','police','bandit','shooting']],
  ['KE-ROAD','Kenya Roads & Mobility',['Kenya road closure','traffic','accident','road crash','roadblock','matatu','expressway']],
  ['KE-MARITIME','Kenya Maritime & Port',['Mombasa port','Kenya port','shipping','container','maritime','vessel']],
  ['KE-WEATHER','Kenya Weather & Hazards',['Kenya floods','Kenya heavy rain','Kenya landslide','Kenya fire','Kenya drought','Kenya earthquake']],
  ['KE-POLITICAL','Kenya Political Risk',['Kenya politics','parliament','protest','demonstration','election','political tension']],
  ['KE-TERROR','Kenya Terrorism & Extremism',['Kenya terror','al-Shabaab Kenya','IED Kenya','extremist','militant']],
  ['KE-BORDER','Kenya Border Security',['Kenya border','Mandera','Garissa','Turkana','Busia border','Namanga border']],
  ['KE-BUSINESS','Kenya Business Disruption',['Kenya strike','industrial action','fuel shortage','power outage','supply disruption']],
  ['KE-DIGITAL','Kenya Digital/Social Signals',['Kenya viral','Kenya social media','online threat','WhatsApp Kenya','X Kenya alert']],
  ['EA-REGIONAL','East Africa Regional Watch',['East Africa','regional security','cross-border','EAC','trade corridor']],
  ['SO-SECURITY','Somalia Security',['Somalia attack','Mogadishu','al-Shabaab','Somaliland security','Somalia bomb']],
  ['ET-SECURITY','Ethiopia Security',['Ethiopia conflict','Addis Ababa','Amhara','Tigray','Oromia security']],
  ['UG-SECURITY','Uganda Security',['Uganda security','Kampala','border Uganda','terror Uganda','protest Uganda']],
  ['TZ-SECURITY','Tanzania Security',['Tanzania security','Dar es Salaam','Arusha','border Tanzania','protest Tanzania']],
  ['RW-SECURITY','Rwanda Security',['Rwanda security','Kigali','Rwanda border','Great Lakes']],
  ['BI-SECURITY','Burundi Security',['Burundi security','Bujumbura','Burundi border','Burundi unrest']],
  ['SS-SECURITY','South Sudan Security',['South Sudan conflict','Juba','South Sudan border','militia']],
  ['CD-SECURITY','DR Congo Security',['DR Congo conflict','Goma','Bukavu','North Kivu','South Kivu','M23']],
  ['SD-SECURITY','Sudan Security',['Sudan conflict','Khartoum','Darfur','RSF','SAF']],
  ['HORN-SECURITY','Horn of Africa Strategic Watch',['Horn of Africa','Red Sea security','Ethiopia Somalia','Djibouti security','Eritrea']],
  ['GLOBAL-CONFLICT','Global Conflict & Terror Watch',['global conflict','attack','terrorism','war','missile','drone strike']],
  ['GLOBAL-TRANSPORT','Global Transport Disruption',['shipping disruption','port closure','aviation disruption','supply chain','border closure']],
  ['GLOBAL-HAZARD','Global Natural Hazard Watch',['earthquake','flood','cyclone','wildfire','volcano','tsunami']]
].map(([id,name,terms]) => ({ id, name, terms }));

const DIRECT_SOURCES = [
  { id:'tuko', name:'TUKO.co.ke', url:'https://www.tuko.co.ke/', reliability:70, keywords:['Kenya','crime','security','police','traffic','weather','breaking','world'] },
  { id:'citizen-digital', name:'Citizen Digital', url:'https://citizen.digital/', reliability:78, keywords:['Kenya','security','crime','police','traffic','weather','breaking','world'] },
  { id:'mutembei', name:'Mutembei TV', url:'https://mutembeitv.com/', reliability:52, keywords:['Kenya','security','crime','politics','county','breaking'] },
  { id:'sga', name:'SGA Security', url:'https://www.sgasecurity.co.ke/news', reliability:62, keywords:['security','Kenya','East Africa','crime','threat'] }
];

function clean(v, n = 6000) { return String(v || '').replace(/\s+/g,' ').trim().slice(0,n); }
function sha(v) { return crypto.createHash('sha256').update(String(v || '')).digest('hex'); }
function timeoutFetch(url, options = {}) { return fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent':'Sonalit-Intelligence/1.0 (+https://sonalit.com)', ...(options.headers || {}) } }); }
function severityHint(v) {
  const t = String(v || '').toLowerCase();
  if (/massacre|terror|bomb|explosion|ambush|kidnap|abduct|gunfire|shooting|fatal|killed|attack/.test(t)) return 'high';
  if (/protest|unrest|clash|roadblock|strike|fire|flood|landslide|robbery|accident|closure|threat/.test(t)) return 'medium';
  return 'low';
}
function escapeRegex(v) { return String(v || '').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function stripHtml(v) { return clean(String(v || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')); }

function extractHtmlItems(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const jsonLd = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of jsonLd) {
    try {
      const parsed = JSON.parse(m[1]);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr.flatMap(x => x?.itemListElement ? x.itemListElement : [x])) {
        const obj = item?.item || item;
        const title = clean(obj?.headline || obj?.name, 500);
        const url = obj?.url || obj?.mainEntityOfPage?.['@id'] || null;
        if (!title || !url || seen.has(url)) continue;
        seen.add(url); out.push({ title, url, body: clean(obj?.description || '', 2500), published_at: obj?.datePublished || obj?.dateCreated || null });
      }
    } catch (_) {}
  }
  const anchors = [...String(html || '').matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of anchors) {
    const href = m[1];
    const title = stripHtml(m[2]);
    if (!title || title.length < 24 || title.length > 260) continue;
    let url; try { url = new URL(href, baseUrl).href; } catch (_) { continue; }
    if (!/^https?:/i.test(url) || seen.has(url) || /\/tag\/|\/author\/|\/category\/|#/.test(url)) continue;
    if (!/(news|breaking|crime|security|politic|traffic|weather|africa|kenya|alert|story|article|2026)/i.test(url + ' ' + title)) continue;
    seen.add(url); out.push({ title: clean(title, 500), url, body:'', published_at:null });
    if (out.length >= MAX_ITEMS_PER_SOURCE) break;
  }
  return out.slice(0, MAX_ITEMS_PER_SOURCE);
}

async function fetchDirectSource(src) {
  const response = await timeoutFetch(src.url);
  if (!response.ok) throw new Error(`${src.name} HTTP ${response.status}`);
  const html = await response.text();
  const items = extractHtmlItems(html, src.url);
  return items.filter(x => src.keywords.some(k => new RegExp(escapeRegex(k),'i').test(`${x.title} ${x.body}`)) || src.id === 'citizen-digital').slice(0, MAX_ITEMS_PER_SOURCE);
}

async function ensureSource(orgId, spec) {
  const { rows } = await query(`INSERT INTO intel_sources (org_id,name,source_type,provider,endpoint,reliability,metadata,last_seen_at) VALUES ($1,$2,'other',$3,$4,$5,$6::jsonb,NOW()) ON CONFLICT (org_id,provider,endpoint) WHERE provider IS NOT NULL AND endpoint IS NOT NULL DO UPDATE SET name=EXCLUDED.name,reliability=EXCLUDED.reliability,metadata=EXCLUDED.metadata,last_seen_at=NOW(),updated_at=NOW() RETURNING *`, [orgId,spec.name,spec.provider,spec.endpoint,spec.reliability||60,JSON.stringify(spec.metadata||{})]);
  return rows[0];
}
async function persist(orgId, source, items, agentId) {
  let inserted=0, duplicate=0;
  for (const item of items.slice(0,MAX_ITEMS_PER_SOURCE)) {
    const title = clean(item.title,700); const body = clean(item.body || item.description,7000); const url=item.url||null;
    if (!title && !body) continue;
    const externalId=item.external_id || (url ? `${source.provider}:${sha(url)}` : `${source.provider}:${sha(title+'|'+(item.published_at||''))}`);
    const metadata={ ...(item.raw_metadata||{}), severity_hint:severityHint(`${title} ${body}`), collector_agent:agentId, collection_mesh:'aggressive-multi-player', source_family:source.name };
    const r=await query(`INSERT INTO intel_observations (org_id,source_id,external_id,observed_at,published_at,title,body,url,language,country_code,latitude,longitude,content_hash,raw_metadata,credibility,manipulation_score) VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15) ON CONFLICT (org_id,source_id,external_id) DO NOTHING`, [orgId,source.id,externalId,item.published_at||null,title,body,url,item.language||null,item.country_code||guessCountry(`${title} ${body}`),item.latitude??null,item.longitude??null,sha(`${title}|${body}|${url||''}`.toLowerCase()),JSON.stringify(metadata),source.reliability||60,0]);
    if(r.rowCount)inserted++; else duplicate++;
  }
  return {inserted,duplicate};
}
function guessCountry(text) {
  const t=String(text||'').toLowerCase();
  for(const [code,name] of Object.entries(COUNTRY_NAMES)) if(new RegExp(`\\b${escapeRegex(name.toLowerCase())}\\b`,'i').test(t)) return code;
  return /nairobi|mombasa|kenya/i.test(t) ? 'KE' : null;
}
async function runWithLimit(tasks, limit=MAX_PARALLEL) {
  const out=[]; let cursor=0;
  async function worker() { while (true) { const i=cursor++; if(i>=tasks.length)return; try{out[i]={status:'fulfilled',value:await tasks[i]()};}catch(error){out[i]={status:'rejected',reason:error};} } }
  await Promise.all(Array.from({length:Math.min(limit,tasks.length)},()=>worker())); return out;
}

async function fetchGdelt(queryText) {
  const url=`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(queryText)}&mode=artlist&maxrecords=${MAX_ITEMS_PER_SOURCE}&timespan=15min&format=json`;
  const response=await timeoutFetch(url); if(!response.ok) throw new Error(`GDELT HTTP ${response.status}`);
  const data=await response.json(); return (data.articles||[]).map(a=>({external_id:`gdelt:${sha(a.url||a.title)}`,title:a.title,body:a.title,url:a.url,published_at:a.seendate ? `${a.seendate.slice(0,4)}-${a.seendate.slice(4,6)}-${a.seendate.slice(6,8)}T${a.seendate.slice(8,10)}:${a.seendate.slice(10,12)}:${a.seendate.slice(12,14)}Z` : null,raw_metadata:{domain:a.domain,sourcecountry:a.sourcecountry,tone:a.tone}}));
}

function defaultWhatsappChannels() {
  try {
    const parsed=JSON.parse(process.env.INTEL_WHATSAPP_CHANNELS_JSON||'[]');
    return Array.isArray(parsed)?parsed.filter(x=>x&&x.endpoint):[];
  } catch (_) { return []; }
}
async function fetchAuthorizedWhatsapp(channel) {
  const response=await timeoutFetch(channel.endpoint,{headers: channel.token ? {Authorization:`Bearer ${channel.token}`} : {}});
  if(!response.ok) throw new Error(`WhatsApp authorized feed HTTP ${response.status}`);
  const payload=await response.json(); const messages=Array.isArray(payload)?payload:(payload.messages||payload.data||[]);
  return messages.slice(0,MAX_ITEMS_PER_SOURCE).map(m=>({external_id:`whatsapp:${m.id||sha(m.timestamp+'|'+m.text)}`,title:clean(m.title||m.text||m.message,700),body:clean(m.text||m.message||m.body,5000),url:m.url||null,published_at:m.timestamp||m.published_at||null,raw_metadata:{channel_id:channel.channel_id,channel_name:channel.name,authorized_ingest:true}}));
}

async function sweepOrg(orgId) {
  const agentQueries = AGENTS.map(a => `(${a.terms.map(t=>`\"${t.replace(/\"/g,'')}\"`).join(' OR ')})`).join(' OR ');
  const tasks=[];
  for(const src of DIRECT_SOURCES) tasks.push(async()=>{const items=await fetchDirectSource(src);const source=await ensureSource(orgId,{name:src.name,provider:'web',endpoint:src.url,reliability:src.reliability,metadata:{agents:AGENTS.filter(a=>a.terms.some(t=>src.keywords.includes(t))).map(a=>a.id),cadence:'5m'}});const p=await persist(orgId,source,items,'WEB-MESH');return{name:src.name,seen:items.length,...p};});
  for(const agent of AGENTS) tasks.push(async()=>{const q=agent.terms.map(t=>`\"${t.replace(/\"/g,'')}\"`).join(' OR ');const items=await fetchGdelt(q);const source=await ensureSource(orgId,{name:`GDELT · ${agent.name}`,provider:'gdelt',endpoint:'https://api.gdeltproject.org/api/v2/doc/doc',reliability:68,metadata:{agent_id:agent.id,query:q}});const p=await persist(orgId,source,items,agent.id);return{name:agent.name,agent_id:agent.id,seen:items.length,...p};});
  for(const channel of defaultWhatsappChannels()) tasks.push(async()=>{const items=await fetchAuthorizedWhatsapp(channel);const source=await ensureSource(orgId,{name:channel.name||`WhatsApp Channel ${channel.channel_id||''}`,provider:'whatsapp',endpoint:channel.endpoint,reliability:Number(channel.reliability)||55,metadata:{channel_id:channel.channel_id,authorized:true}});const p=await persist(orgId,source,items,`WA-${channel.channel_id||'CHANNEL'}`);return{name:source.name,seen:items.length,...p};});
  const results=await runWithLimit(tasks,MAX_PARALLEL);
  const ok=results.filter(r=>r.status==='fulfilled').map(r=>r.value), failed=results.filter(r=>r.status==='rejected');
  return { agents:AGENT_COUNT, collectors:DIRECT_SOURCES.length+AGENTS.length+defaultWhatsappChannels().length, parallelism:MAX_PARALLEL, configured_whatsapp_channels:defaultWhatsappChannels().length, successful_collectors:ok.length, failed_collectors:failed.length, seen:ok.reduce((n,r)=>n+Number(r.seen||0),0), inserted:ok.reduce((n,r)=>n+Number(r.inserted||0),0), duplicates:ok.reduce((n,r)=>n+Number(r.duplicate||0),0), results:ok.slice(0,80), generated_at:new Date().toISOString() };
}

async function runAggressiveMesh() {
  const {rows:orgs}=await query(`SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL`);
  const output=[];
  for(const {org_id} of orgs){ try{output.push({org_id,...await sweepOrg(org_id)});}catch(error){logger.warn(`Aggressive Intelligence Mesh org=${org_id} failed: ${error.message}`);output.push({org_id,status:'failed',error:error.message});} }
  return output;
}

if (process.env.NODE_ENV!=='test' && !global.__sonalitAggressiveIntelligenceMesh) {
  global.__sonalitAggressiveIntelligenceMesh=true;
  runAggressiveMesh().catch(e=>logger.warn(`Aggressive Intelligence Mesh startup failed: ${e.message}`));
  setInterval(()=>runAggressiveMesh().catch(e=>logger.warn(`Aggressive Intelligence Mesh sweep failed: ${e.message}`)), INTERVAL_MS);
  logger.info(`Aggressive Intelligence Mesh enabled: ${AGENT_COUNT} specialist agents, ${MAX_PARALLEL} concurrent collectors, interval=${INTERVAL_MS/60000}m`);
}

module.exports={AGENTS,runAggressiveMesh,sweepOrg};
