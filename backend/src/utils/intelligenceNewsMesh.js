// Sonalit News Mesh: redundant public discovery across regional, local and specialist search surfaces.
// This is evidence acquisition, not truth adjudication. Every item is retained with provenance.
const crypto=require('crypto');
const {XMLParser}=require('fast-xml-parser');
const {query}=require('../config/database');
const logger=require('./logger');

const parser=new XMLParser({ignoreAttributes:true});
const TIMEOUT_MS=12000;
const MAX_ITEMS_PER_QUERY=35;
const COUNTRIES=[
  ['KE','Kenya','Swahili'],['SO','Somalia','Somali'],['ET','Ethiopia','Amharic'],['UG','Uganda','English'],
  ['TZ','Tanzania','Swahili'],['RW','Rwanda','Kinyarwanda'],['BI','Burundi','Kirundi'],['SS','South Sudan','English'],
  ['DJ','Djibouti','French'],['ER','Eritrea','English'],['SD','Sudan','Arabic'],['CD','DRC','French']
];
const QUERY_FAMILIES=[
  'security OR attack OR armed OR militant OR terrorism OR kidnapping OR robbery OR protest',
  'border OR road OR highway OR convoy OR cargo OR port OR smuggling OR transport',
  'government OR election OR parliament OR political OR unrest OR strike OR demonstration'
];
const NAMED_LOCAL_SOURCES={
  KE:['nation.africa','citizen.digital','capitalfm.co.ke','standardmedia.co.ke'],
  SO:['garoweonline.com','hiiraan.com','somaliguardian.com'],
  ET:['addisstandard.com','thereporterethiopia.com'],
  UG:['monitor.co.ug','newvision.co.ug'],
  TZ:['thecitizen.co.tz','ippmedia.com'],
  RW:['newtimes.co.rw'],
  SS:['radiotamazuj.org'],
  SD:['sudantribune.com'],
  CD:['actualite.cd','radiookapi.net'],
  BI:['iwacu-burundi.org']
};
let cursor=0;

function sha(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex');}
function clean(v,n=6000){return String(v||'').replace(/\s+/g,' ').trim().slice(0,n);}
function rssText(v){if(v==null)return'';if(typeof v==='string')return v;if(typeof v==='object')return v['#text']||v.__cdata||v.value||v.text||'';return String(v);}
function rssLink(v){if(v==null)return null;if(typeof v==='string')return v;if(Array.isArray(v))return rssLink(v[0]);if(typeof v==='object')return v.href||v.url||v['#text']||null;return String(v);}
async function get(url){return fetch(url,{signal:AbortSignal.timeout(TIMEOUT_MS),headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.1','User-Agent':'Sonalit-Intelligence/2.0'}});}

function googleNewsUrl(queryText,country){const gl=country==='SO'?'SO':country==='ET'?'ET':country==='TZ'?'TZ':country==='UG'?'UG':country==='RW'?'RW':country==='SS'?'SS':country==='SD'?'SD':'KE';return`https://news.google.com/rss/search?q=${encodeURIComponent(queryText)}&hl=en-${gl}&gl=${gl}&ceid=${gl}:en`;}
function googleSourceUrl(domain,country){return googleNewsUrl(`site:${domain} ${country==='CD'?'DR Congo':country}`,country);}

async function fetchGoogle(queryText,country){const url=googleNewsUrl(queryText,country);const r=await get(url);if(!r.ok)throw new Error(`Google News RSS HTTP ${r.status}`);const x=parser.parse(await r.text()),raw=x?.rss?.channel?.item||x?.feed?.entry||[],items=Array.isArray(raw)?raw:[raw];return items.slice(0,MAX_ITEMS_PER_QUERY).map(i=>{const source=rssText(i.source);const title=clean(rssText(i.title),900);const link=rssLink(i.link);let publishedAt=null;try{const p=rssText(i.pubDate)||rssText(i.published)||rssText(i.updated);publishedAt=p?new Date(p).toISOString():null}catch{}return{external_id:`newsmesh:${sha(link||`${title}|${publishedAt||''}`)}`,title,body:clean(rssText(i.description)||rssText(i.content)||title,6000),url:link,published_at:publishedAt,language:'en',country_code:country,raw_metadata:{discovery:'google-news-rss',query:queryText,aggregator_source:source||null,local_discovery:true}}});}

async function persist(orgId,items){let inserted=0,duplicates=0;for(const item of items){if(!item.title&&!item.body)continue;const hash=sha(`${item.title}|${item.body}|${item.url||''}`.toLowerCase());const externalId=item.external_id||`newsmesh:${hash}`;const {rowCount}=await query(`INSERT INTO intel_observations (org_id,source_id,external_id,observed_at,published_at,title,body,url,language,country_code,content_hash,raw_metadata,credibility,manipulation_score) SELECT $1,s.id,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,0 FROM intel_sources s WHERE s.org_id=$1 AND s.provider='newsmesh' AND s.endpoint=$12 ON CONFLICT (org_id,source_id,external_id) DO NOTHING`,[orgId,externalId,item.published_at||null,item.title||null,item.body||null,item.url||null,item.language||null,item.country_code,hash,JSON.stringify(item.raw_metadata||{}),Number(item.credibility)||58,item.source_endpoint]);if(rowCount)inserted++;else duplicates++;}return{inserted,duplicates};}

async function ensureSource(orgId,label,endpoint,reliability=58){const {rows}=await query(`INSERT INTO intel_sources (org_id,name,source_type,provider,endpoint,reliability,metadata,last_seen_at) VALUES ($1,$2,'news','newsmesh',$3,$4,$5::jsonb,NOW()) ON CONFLICT (org_id,provider,endpoint) WHERE provider IS NOT NULL AND endpoint IS NOT NULL DO UPDATE SET name=EXCLUDED.name,reliability=EXCLUDED.reliability,metadata=EXCLUDED.metadata,last_seen_at=NOW(),updated_at=NOW() RETURNING id`,[orgId,label,endpoint,reliability,JSON.stringify({mesh:true})]);return rows[0]?.id||null;}

async function collectForOrg(orgId){
  const selected=COUNTRIES.slice(cursor%COUNTRIES.length,(cursor%COUNTRIES.length)+6);cursor=(cursor+6)%COUNTRIES.length;
  const tasks=[];
  for(const [code,name] of selected){
    for(const family of QUERY_FAMILIES.slice(0,2))tasks.push({code,name,q:`${name} (${family})`,url:googleNewsUrl(`${name} ${family}`,code),cred:58});
    for(const domain of (NAMED_LOCAL_SOURCES[code]||[]).slice(0,2))tasks.push({code,name,q:`site:${domain} ${name}`,url:googleSourceUrl(domain,code),cred:64});
  }
  const results=[];
  const concurrency=5;let index=0;
  const worker=async()=>{while(index<tasks.length){const task=tasks[index++];try{const sourceId=await ensureSource(orgId,`News Mesh · ${task.name} · ${task.q}`,task.url,task.cred);const r=await get(task.url);if(!r.ok)throw new Error(`HTTP ${r.status}`);const x=parser.parse(await r.text()),raw=x?.rss?.channel?.item||x?.feed?.entry||[],items=(Array.isArray(raw)?raw:[raw]).slice(0,MAX_ITEMS_PER_QUERY).map(i=>{const title=clean(rssText(i.title),900),body=clean(rssText(i.description)||rssText(i.content)||title,6000),link=rssLink(i.link);let publishedAt=null;try{const p=rssText(i.pubDate)||rssText(i.published)||rssText(i.updated);publishedAt=p?new Date(p).toISOString():null}catch{}return{source_endpoint:task.url,external_id:`newsmesh:${sha(link||`${title}|${publishedAt||''}`)}`,title,body,url:link,published_at:publishedAt,language:'en',country_code:task.code,credibility:task.cred,raw_metadata:{discovery:'google-news-rss',query:task.q,aggregator_source:rssText(i.source)||null,local_discovery:true,focus_country:task.code}}});let inserted=0,duplicates=0;for(const item of items){const {rowCount}=await query(`INSERT INTO intel_observations (org_id,source_id,external_id,observed_at,published_at,title,body,url,language,country_code,content_hash,raw_metadata,credibility,manipulation_score) VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,0) ON CONFLICT (org_id,source_id,external_id) DO NOTHING`,[orgId,sourceId,item.external_id,item.published_at,item.title,item.body,item.url,item.language,item.country_code,sha(`${item.title}|${item.body}|${item.url||''}`.toLowerCase()),JSON.stringify(item.raw_metadata),item.credibility]);if(rowCount)inserted++;else duplicates++;}results.push({country:task.code,query:task.q,source_id:sourceId,seen:items.length,inserted,duplicates,status:'success'});}catch(error){results.push({country:task.code,query:task.q,seen:0,inserted:0,status:'failed',error:error.message});logger.warn(`News Mesh: ${task.name} failed: ${error.message}`);}}};
  await Promise.all(Array.from({length:concurrency},worker));
  return{selectedCountries:selected.map(x=>x[0]),tasks:tasks.length,seen:results.reduce((n,r)=>n+(r.seen||0),0),inserted:results.reduce((n,r)=>n+(r.inserted||0),0),duplicates:results.reduce((n,r)=>n+(r.duplicates||0),0),failed:results.filter(r=>r.status==='failed').length,results};
}

async function runNewsMesh(){const {rows:orgs}=await query(`SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL`);const output=[];for(const {org_id} of orgs){try{output.push({org_id,...await collectForOrg(org_id)})}catch(error){output.push({org_id,failed:1,error:error.message});logger.warn(`News Mesh org=${org_id} failed: ${error.message}`)}}return output;}
module.exports={runNewsMesh,collectForOrg,COUNTRIES,NAMED_LOCAL_SOURCES};
