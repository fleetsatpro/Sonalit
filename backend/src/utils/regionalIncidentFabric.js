const crypto=require('crypto');
const {XMLParser}=require('fast-xml-parser');
const {query}=require('../config/database');
const telegramMtproto=require('./telegramMtproto');
const logger=require('./logger');

const TIMEOUT_MS=15000;
const MAX_ITEMS=100;
const INCIDENT_TERMS=['protest','protests','rally','demonstration','fire','explosion','gunfire','shooting','attack','attacked','ambush','kidnapping','abduction','IED','bomb','accident','crash','collision','traffic','roadblock','unrest','riot','robbery','flooding','flood','landslide','earthquake','storm','curfew','riot','clash'];
const INCIDENT_QUERY=INCIDENT_TERMS.map(v=>`"${v}"`).join(' OR ');

const EA_COUNTRIES={
  KE:{name:'Kenya',terms:['Kenya','Nairobi','Mombasa','Kisumu','Nakuru','Eldoret','Garissa','Mandera','Lamu','Isiolo','Turkana','Marsabit','Kakamega','Kitale'],languages:['en','sw']},
  TZ:{name:'Tanzania',terms:['Tanzania','Dar es Salaam','Dodoma','Arusha','Mwanza','Mbeya','Zanzibar','Tanga','Morogoro'],languages:['en','sw']},
  UG:{name:'Uganda',terms:['Uganda','Kampala','Entebbe','Gulu','Mbarara','Jinja','Fort Portal','Kasese','Busia'],languages:['en']},
  RW:{name:'Rwanda',terms:['Rwanda','Kigali','Rubavu','Rusizi','Musanze','Gisenyi'],languages:['en','fr']},
  BI:{name:'Burundi',terms:['Burundi','Bujumbura','Gitega'],languages:['en','fr']},
  SS:{name:'South Sudan',terms:['South Sudan','Juba','Bor','Malakal','Wau','Nimule'],languages:['en']},
  ET:{name:'Ethiopia',terms:['Ethiopia','Addis Ababa','Dire Dawa','Mekelle','Gondar','Bahir Dar'],languages:['en']},
  SO:{name:'Somalia',terms:['Somalia','Mogadishu','Hargeisa','Kismayo','Baidoa','Garowe'],languages:['en','so']},
  CD:{name:'DR Congo',terms:['DRC','Congo','Democratic Republic of the Congo','Goma','Bukavu','Beni','Lubumbashi'],languages:['en','fr']},
  SD:{name:'Sudan',terms:['Sudan','Khartoum','Darfur','Port Sudan','El Fasher'],languages:['en','ar']}
};
const EA_CODES=Object.keys(EA_COUNTRIES);
const xmlParser=new XMLParser({ignoreAttributes:true});

const DEFAULT_TELEGRAM=[
  {channel:'NairobiNews',country_code:'KE',reliability:42},
  {channel:'KTNbreakingnews',country_code:'KE',reliability:42},
  {channel:'Ugandanewsupdates',country_code:'UG',reliability:35},
  {channel:'TanzaniaKRAlerts',country_code:'TZ',reliability:35},
  {channel:'newtimesrwanda',country_code:'RW',reliability:40}
];

const RSS_FEEDS=[
  {name:'Kenya News Agency',url:'https://www.kenyanews.go.ke/feed',country_code:'KE',reliability:78},
  {name:'Daily Nation Kenya',url:'https://nation.africa/kenya/rss.xml',country_code:'KE',reliability:82},
  {name:'K24 Kenya',url:'https://k24.digital/feed',country_code:'KE',reliability:72},
  {name:'Capital FM Kenya',url:'https://capitalfm.co.ke/news/feed',country_code:'KE',reliability:76},
  {name:'AllAfrica Kenya',url:'https://allafrica.com/tools/headlines/rdf/kenya/headlines.rdf',country_code:'KE',reliability:74},
  {name:'The Citizen Tanzania',url:'https://www.thecitizen.co.tz/tanzania/rss',country_code:'TZ',reliability:78},
  {name:'The EastAfrican Regional',url:'https://theeastafrican.co.ke/tea/news/rss',country_code:null,reliability:80},
  {name:'The New Times Rwanda',url:'https://newtimes.co.rw/rss',country_code:'RW',reliability:76},
  {name:'Daily Monitor Uganda',url:'https://monitor.co.ug/rss',country_code:'UG',reliability:76},
  {name:'TanzaniaInvest',url:'https://tanzaniainvest.com/feed',country_code:'TZ',reliability:65}
];

function sha(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex');}
function clean(v,n=6000){return String(v||'').replace(/\s+/g,' ').trim().slice(0,n);}
function timeoutFetch(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(TIMEOUT_MS)});}
function category(text){const s=String(text||'').toLowerCase();if(/ied|improvised explosive|bomb|explosion/.test(s))return'ied';if(/armed attack|gunfire|shooting|ambush|militia|insurgent/.test(s))return'armed_attack';if(/protest|riot|unrest|demonstration|roadblock|clash/.test(s))return'protest';if(/rally|political rally/.test(s))return'political_rally';if(/fire|blaze|burning/.test(s))return'fire';if(/traffic|congestion|road closed|gridlock/.test(s))return'traffic';if(/accident|crash|collision|overturned/.test(s))return'accident';if(/kidnap|abduct/.test(s))return'kidnapping';if(/flood|landslide|earthquake|storm/.test(s))return'natural_hazard';if(/robbery|carjacking|crime|mugging/.test(s))return'crime';return'other';}
function severity(cat,text){if(['ied','armed_attack','kidnapping'].includes(cat))return'high';if(['protest','political_rally','fire','accident','natural_hazard'].includes(cat))return'medium';return /death|dead|fatal|casualties|multiple injured/i.test(text)?'high':'low';}
function detectCountry(text,fallback=null){const s=String(text||'').toLowerCase();if(fallback&&EA_COUNTRIES[fallback])return fallback;for(const code of EA_CODES){const c=EA_COUNTRIES[code];if(c.terms.some(t=>s.includes(t.toLowerCase())))return code;}return null;}
function parseDate(v){if(!v)return null;try{const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString();}catch{return null;}}

async function ensureSource(orgId,spec){
  const type=['x','telegram','whatsapp'].includes(spec.provider)?'social':spec.provider==='gdelt'||spec.provider==='rss'?'news':'other';
  const {rows}=await query(`INSERT INTO intel_sources (org_id,name,source_type,provider,endpoint,reliability,metadata,last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW()) ON CONFLICT (org_id,provider,endpoint) WHERE provider IS NOT NULL AND endpoint IS NOT NULL DO UPDATE SET name=EXCLUDED.name,source_type=EXCLUDED.source_type,reliability=EXCLUDED.reliability,metadata=EXCLUDED.metadata,last_seen_at=NOW(),updated_at=NOW() RETURNING *`,[orgId,spec.name,type,spec.provider,spec.endpoint,spec.reliability||60,JSON.stringify(spec.metadata||{})]);
  return rows[0];
}
async function persistObservation(orgId,source,item){
  const text=clean(item.text||item.body||item.title,7000);const title=clean(item.title||item.text||item.body,700);if(!title&&!text)return null;
  const externalId=item.external_id||`${source.provider}:${sha(item.url||`${title}|${item.published_at||''}`)}`;
  const countryCode=detectCountry(`${title} ${text}`,item.country_code)||null;
  const meta={...(item.raw_metadata||{}),incident_category:category(`${title} ${text}`),severity_hint:severity(category(`${title} ${text}`),`${title} ${text}`),regional_scope:countryCode?'EAST_AFRICA':'UNRESOLVED_REGIONAL',collection_layer:'regional-incident-fabric'};
  const {rows}=await query(`INSERT INTO intel_observations (org_id,source_id,external_id,observed_at,published_at,title,body,url,language,country_code,raw_metadata,credibility,manipulation_score) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) ON CONFLICT (org_id,source_id,external_id) DO UPDATE SET last_seen_at=NOW() RETURNING id,title,body,url,observed_at,published_at,country_code,raw_metadata`,[orgId,source.id,externalId,item.observed_at||new Date().toISOString(),item.published_at||null,title||null,text||null,item.url||null,item.language||null,countryCode,JSON.stringify(meta),Number.isFinite(item.credibility)?item.credibility:(source.reliability||60),0]);
  return rows[0]||null;
}
async function materializeAlert(orgId,source,o){
  if(!o?.id)return false;const text=`${o.title||''} ${o.body||''}`;const cat=category(text);const sev=severity(cat,text);
  const existing=await query(`SELECT id FROM intel_alerts WHERE org_id=$1 AND observation_id=$2 LIMIT 1`,[orgId,o.id]);if(existing.rows[0]){await query(`UPDATE intel_alerts SET last_seen_at=NOW(),updated_at=NOW() WHERE id=$1`,[existing.rows[0].id]);return false;}
  await query(`INSERT INTO intel_alerts (org_id,observation_id,source_id,category,title,summary,severity,confidence,verification_state,status,country_code,first_seen_at,last_seen_at,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unverified','open',$9,$10,$10,$11::jsonb)`,[orgId,o.id,source.id,cat,clean(o.title||o.body,500),clean(o.body||o.title,1800),sev,source.provider==='x'?35:source.provider==='telegram'?32:45,o.country_code||null,o.observed_at||new Date().toISOString(),JSON.stringify({source_provider:source.provider,source_reliability:source.reliability,evidence_boundary:'source observation; not independently verified',regional_scope:'EAST_AFRICA'})]);
  return true;
}
async function fetchX(country){
  const token=process.env.X_BEARER_TOKEN||process.env.TWITTER_BEARER_TOKEN;if(!token)return[];const q=`(${country.terms.map(v=>`"${v}"`).join(' OR ')}) (${INCIDENT_QUERY}) -is:retweet`;const p=new URLSearchParams({query:q,max_results:'100',sort_order:'recency','tweet.fields':'created_at,lang,author_id,public_metrics,context_annotations,geo,entities'});const r=await timeoutFetch(`https://api.x.com/2/tweets/search/recent?${p}`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error(`X ${country.name} HTTP ${r.status}`);const d=await r.json();return(d.data||[]).map(t=>({external_id:`x:${t.id}`,text:t.text,title:clean(t.text,700),published_at:t.created_at,observed_at:t.created_at,language:t.lang,country_code:Object.keys(EA_COUNTRIES).find(c=>country===EA_COUNTRIES[c])||null,url:`https://x.com/i/web/status/${t.id}`,credibility:45,raw_metadata:{author_id:t.author_id,public_metrics:t.public_metrics,context_annotations:t.context_annotations,geo:t.geo}}));}
async function fetchGdelt(){
  const q=`(${EA_CODES.map(c=>EA_COUNTRIES[c].terms.slice(0,3).map(v=>`"${v}"`).join(' OR ')).join(' OR ')}) (${INCIDENT_QUERY})`;
  const url=`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=${MAX_ITEMS}&timespan=1h&format=json`;const r=await timeoutFetch(url);if(!r.ok)throw new Error(`GDELT HTTP ${r.status}`);const d=await r.json();return(d.articles||[]).map(a=>({external_id:a.url?`gdelt:${sha(a.url)}`:null,title:a.title,body:a.title,url:a.url,published_at:a.seendate?parseDate(String(a.seendate).replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,'$1-$2-$3T$4:$5:$6Z')):null,language:a.language||null,country_code:detectCountry(`${a.title||''} ${a.domain||''}`),credibility:72,raw_metadata:{domain:a.domain,tone:a.tone,sourcecountry:a.sourcecountry}}));}
function rssText(v){if(v==null)return'';if(typeof v==='string')return v;if(typeof v==='object')return v['#text']||v['__cdata']||v.value||v.text||'';return String(v);}
function rssLink(v){if(v==null)return null;if(typeof v==='string')return v;if(Array.isArray(v))return rssLink(v[0]);if(typeof v==='object')return v.href||v['#text']||v.url||null;return String(v);}
async function fetchRss(feed){const r=await timeoutFetch(feed.url,{headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.1'}});if(!r.ok)throw new Error(`${feed.name} HTTP ${r.status}`);const x=xmlParser.parse(await r.text());const raw=x?.rss?.channel?.item||x?.feed?.entry||[];const items=Array.isArray(raw)?raw:[raw];return items.slice(0,MAX_ITEMS).map(i=>{const title=clean(rssText(i.title),700),body=clean(rssText(i.description)||rssText(i.summary)||rssText(i.content)||title,7000),link=rssLink(i.link),published=parseDate(rssText(i.pubDate)||rssText(i.published)||rssText(i.updated));return{external_id:i.guid?`rss:${rssText(i.guid)}`:(i.id?`rss:${rssText(i.id)}`:(link?`rss:${sha(link)}`:null)),title,body,text:body,url:link,published_at:published,language:rssText(i.language)||null,country_code:feed.country_code,credibility:feed.reliability,raw_metadata:{feed:feed.name}};}).filter(i=>detectCountry(`${i.title} ${i.body}`,i.country_code));}
async function fetchTelegram(entry,since){let messages=await telegramMtproto.fetchChannelMessages(entry.channel,since);let via='mtproto';if(!messages.length&&!telegramMtproto.isConfigured()){messages=await telegramMtproto.fetchPublicChannelPreview(entry.channel,since);via='public-preview';}return messages.map(m=>({external_id:`telegram:${entry.channel}:${m.id}`,text:m.text,title:clean(m.text,700),published_at:new Date(m.postedAt).toISOString(),observed_at:new Date(m.postedAt).toISOString(),url:`https://t.me/${entry.channel}/${String(m.id).split('/').pop()}`,country_code:entry.country_code,credibility:Number(entry.reliability)||35,raw_metadata:{channel:entry.channel,collection_mode:via}}));}
async function fetchWhatsAppFeeds(){let feeds=[];try{feeds=JSON.parse(process.env.RISK_INTEL_WHATSAPP_FEEDS||'[]')}catch{}const out=[];for(const feed of Array.isArray(feeds)?feeds.slice(0,20):[]){if(!feed?.url)continue;try{const r=await timeoutFetch(feed.url,{headers:{Accept:'application/json, application/rss+xml, application/xml'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const text=await r.text();let payload=null;try{payload=JSON.parse(text)}catch{}if(Array.isArray(payload)){for(const item of payload.slice(0,MAX_ITEMS))out.push({...item,country_code:item.country_code||feed.country_code,credibility:Number(item.credibility)||Number(feed.reliability)||35,raw_metadata:{...(item.raw_metadata||{}),transport:'whatsapp-authorized-feed',feed:feed.name||feed.url}});}else{const x=xmlParser.parse(text);const raw=x?.rss?.channel?.item||x?.feed?.entry||[];for(const i of (Array.isArray(raw)?raw:[raw]))out.push({external_id:i.guid?`whatsapp:${rssText(i.guid)}`:null,title:clean(rssText(i.title),700),body:clean(rssText(i.description)||rssText(i.summary),7000),url:rssLink(i.link),published_at:parseDate(rssText(i.pubDate)||rssText(i.published)||rssText(i.updated)),country_code:feed.country_code,credibility:Number(feed.reliability)||35,raw_metadata:{transport:'whatsapp-authorized-feed',feed:feed.name||feed.url}});}}catch(e){logger.warn(`Regional Incident Fabric: WhatsApp feed ${feed.name||feed.url} failed: ${e.message}`);}}return out.filter(i=>detectCountry(`${i.title||''} ${i.body||i.text||''}`,i.country_code));}

async function collectProvider(orgId,spec,items){const source=await ensureSource(orgId,spec);let inserted=0,alerts=0;for(const item of items.slice(0,MAX_ITEMS)){const o=await persistObservation(orgId,source,item);if(!o)continue;inserted++;if(await materializeAlert(orgId,source,o))alerts++;}return{provider:spec.provider,name:spec.name,seen:items.length,inserted,alerts};}

async function runRegionalIncidentSweep(orgId){
  const results=[];const since=Date.now()-60*60*1000;
  const xToken=process.env.X_BEARER_TOKEN||process.env.TWITTER_BEARER_TOKEN;
  if(xToken){for(const code of EA_CODES){const c=EA_COUNTRIES[code];try{const items=await fetchX(c);results.push(await collectProvider(orgId,{provider:'x',name:`X ${c.name} Incident Monitor`,endpoint:`https://api.x.com/2/tweets/search/recent?country=${code}`,reliability:45,metadata:{country_code:code,query_type:'incident',freshness:'recent-search'}},items));}catch(e){logger.warn(`Regional Incident Fabric: X ${c.name} failed: ${e.message}`);results.push({provider:'x',name:`X ${c.name} Incident Monitor`,status:'failed',error:e.message});}}}
  try{const items=await fetchGdelt();results.push(await collectProvider(orgId,{provider:'gdelt',name:'GDELT East Africa Incident Discovery',endpoint:'https://api.gdeltproject.org/api/v2/doc/doc?scope=east-africa-incidents',reliability:72,metadata:{region:'EAST_AFRICA',query_type:'incident',freshness:'1h'}},items));}catch(e){logger.warn(`Regional Incident Fabric: GDELT failed: ${e.message}`);results.push({provider:'gdelt',status:'failed',error:e.message});}
  for(const feed of RSS_FEEDS){try{const items=await fetchRss(feed);results.push(await collectProvider(orgId,{provider:'rss',name:feed.name,endpoint:feed.url,reliability:feed.reliability,metadata:{country_code:feed.country_code,region:'EAST_AFRICA'}},items));}catch(e){logger.warn(`Regional Incident Fabric: RSS ${feed.name} failed: ${e.message}`);results.push({provider:'rss',name:feed.name,status:'failed',error:e.message});}}
  let channels=[];try{channels=JSON.parse(process.env.RISK_INTEL_TELEGRAM_CHANNELS||'')}catch{}if(!Array.isArray(channels)||!channels.length)channels=DEFAULT_TELEGRAM;
  for(const entry of channels.slice(0,40)){const channel=typeof entry==='string'?entry:entry?.channel;if(!channel)continue;try{const items=await fetchTelegram(typeof entry==='string'?{channel,country_code:null,reliability:35}:entry,since);results.push(await collectProvider(orgId,{provider:'telegram',name:`Telegram ${channel} Incident Monitor`,endpoint:`mtproto://${channel}`,reliability:Number(entry?.reliability)||35,metadata:{channel,country_code:entry?.country_code||null,region:'EAST_AFRICA'}},items));}catch(e){logger.warn(`Regional Incident Fabric: Telegram ${channel} failed: ${e.message}`);results.push({provider:'telegram',name:`Telegram ${channel}`,status:'failed',error:e.message});}}
  const wa=await fetchWhatsAppFeeds();if(wa.length){results.push(await collectProvider(orgId,{provider:'whatsapp',name:'WhatsApp Authorized Incident Feeds',endpoint:'whatsapp://authorized-feeds',reliability:35,metadata:{region:'EAST_AFRICA',mode:'authorized-feed-only'}},wa));}
  return{region:'EAST_AFRICA',results,totalSeen:results.reduce((s,r)=>s+(r.seen||0),0),totalInserted:results.reduce((s,r)=>s+(r.inserted||0),0),totalAlerts:results.reduce((s,r)=>s+(r.alerts||0),0)};
}

module.exports={runRegionalIncidentSweep,EA_CODES,EA_COUNTRIES,category,severity,detectCountry};
