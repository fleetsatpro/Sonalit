const crypto=require('crypto');
const {XMLParser}=require('fast-xml-parser');
const {query}=require('../config/database');
const telegramMtproto=require('./telegramMtproto');
const logger=require('./logger');

const TIMEOUT_MS=15000,MAX_ITEMS=100;
const INCIDENT_TERMS=['protest','protests','rally','demonstration','fire','explosion','gunfire','shooting','attack','attacked','ambush','kidnapping','abduction','IED','bomb','accident','crash','collision','traffic','roadblock','unrest','riot','robbery','flooding','flood','landslide','earthquake','storm','curfew','clash','murder','killed','missing','closure','closed','shutdown','outage','derailment','tanker','spill','border','crossing','strike','evacuation','warning','alert'];
const INCIDENT_QUERY=INCIDENT_TERMS.map(v=>`"${v}"`).join(' OR ');

const EA_COUNTRIES={
 KE:{name:'Kenya',terms:['Kenya','Nairobi','Mombasa','Kisumu','Nakuru','Eldoret','Garissa','Mandera','Lamu','Isiolo','Turkana','Marsabit','Kakamega','Kitale','Kericho','Machakos','Narok','Naivasha','Malindi','Kilifi','Kwale'],languages:['en','sw']},
 TZ:{name:'Tanzania',terms:['Tanzania','Dar es Salaam','Dodoma','Arusha','Mwanza','Mbeya','Zanzibar','Tanga','Morogoro','Mtwara','Kigoma','Moshi'],languages:['en','sw']},
 UG:{name:'Uganda',terms:['Uganda','Kampala','Entebbe','Gulu','Mbarara','Jinja','Fort Portal','Kasese','Busia','Mbale','Lira','Arua','Masaka'],languages:['en']},
 RW:{name:'Rwanda',terms:['Rwanda','Kigali','Rubavu','Rusizi','Musanze','Gisenyi','Huye','Nyagatare','Karongi'],languages:['en','fr','rw']},
 BI:{name:'Burundi',terms:['Burundi','Bujumbura','Gitega','Ngozi','Rumonge','Muyinga','Cibitoke'],languages:['en','fr','rn']},
 SS:{name:'South Sudan',terms:['South Sudan','Juba','Bor','Malakal','Wau','Nimule','Yei','Bentiu','Renk'],languages:['en']},
 ET:{name:'Ethiopia',terms:['Ethiopia','Addis Ababa','Dire Dawa','Mekelle','Gondar','Bahir Dar','Jijiga','Adama','Hawassa','Tigray','Amhara','Oromia'],languages:['en']},
 SO:{name:'Somalia',terms:['Somalia','Mogadishu','Hargeisa','Kismayo','Baidoa','Garowe','Bosaso','Beledweyne','Galkayo','Puntland','Somaliland'],languages:['en','so']},
 CD:{name:'DR Congo',terms:['DRC','Congo','Democratic Republic of the Congo','Goma','Bukavu','Beni','Lubumbashi','Kinshasa','Masisi','Ituri','North Kivu','South Kivu'],languages:['en','fr']},
 SD:{name:'Sudan',terms:['Sudan','Khartoum','Darfur','Port Sudan','El Fasher','Omdurman','Gedaref','Kassala','Kordofan'],languages:['en','ar']}
};
const EA_CODES=Object.keys(EA_COUNTRIES);
const xmlParser=new XMLParser({ignoreAttributes:true});

const DEFAULT_TELEGRAM=[
 {channel:'NairobiNews',country_code:'KE',reliability:42},
 {channel:'KTNbreakingnews',country_code:'KE',reliability:42},
 {channel:'citizentvke',country_code:'KE',reliability:45}
];

const X_ACCOUNT_MONITORS={
 KE:['PoliceKE','NPSOfficial_KE','KeNHAKenya','ntsa_kenya','KenyaRailways_','KenyaPower_Care'],
 UG:['PoliceUg'],
 RW:['Rwandapolice','RIB_Rw','RwandaMoD'],
 SO:['Somalia','MoDSomaliya','GenAsadOsman'],
 ET:['PMEthiopia','MFAEthiopia']
};

const GOOGLE_RSS=(q,gl='KE',hl='en-KE')=>`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:1d`)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}&ceid=${encodeURIComponent(`${gl}:${hl.split('-')[0]}`)}`;
const RSS_FEEDS=[
 {name:'KNA Kenya',url:'https://www.kenyanews.go.ke/feed',country_code:'KE',reliability:78},
 {name:'Nation Kenya',url:GOOGLE_RSS('site:nation.africa Kenya security OR accident OR protest'),country_code:'KE',reliability:82},
 {name:'Standard Kenya',url:'https://www.standardmedia.co.ke/rss/kenya.php',country_code:'KE',reliability:80},
 {name:'KBC Kenya',url:'https://kbc.co.ke/feed',country_code:'KE',reliability:80},
 {name:'K24 Kenya',url:'https://k24.digital/feed',country_code:'KE',reliability:72},
 {name:'Capital FM Kenya',url:'https://capitalfm.co.ke/news/feed',country_code:'KE',reliability:76},
 {name:'Tuko Kenya',url:'https://www.tuko.co.ke/?service=rss',country_code:'KE',reliability:68},
 {name:'Citizen Digital Kenya',url:GOOGLE_RSS('site:citizen.digital Kenya incident OR police OR accident OR protest'),country_code:'KE',reliability:74},
 {name:'Kenyans.co.ke',url:GOOGLE_RSS('site:kenyans.co.ke Kenya security OR incident OR protest'),country_code:'KE',reliability:70},
 {name:'Business Daily Africa',url:GOOGLE_RSS('site:businessdailyafrica.com Kenya transport OR port OR border OR disruption'),country_code:'KE',reliability:78},
 {name:'The Star Kenya',url:GOOGLE_RSS('site:the-star.co.ke Kenya security OR crime OR accident'),country_code:'KE',reliability:72},
 {name:'NTV Kenya',url:GOOGLE_RSS('site:ntvkenya.co.ke Kenya breaking news'),country_code:'KE',reliability:70},
 {name:'NPS Kenya',url:GOOGLE_RSS('site:nationalpolice.go.ke Kenya police'),country_code:'KE',reliability:92},
 {name:'Kenya Interior',url:GOOGLE_RSS('site:interior.go.ke Kenya security'),country_code:'KE',reliability:88},
 {name:'Kenya Ports Authority',url:GOOGLE_RSS('site:kpa.co.ke Mombasa port notice OR accident OR closure'),country_code:'KE',reliability:90},
 {name:'Kenya Maritime Authority',url:GOOGLE_RSS('site:kma.go.ke Kenya maritime notice OR safety'),country_code:'KE',reliability:90},
 {name:'Kenya Meteorological Department',url:GOOGLE_RSS('site:meteo.go.ke Kenya weather warning OR heavy rain OR wind'),country_code:'KE',reliability:92},
 {name:'Kenya Railways',url:GOOGLE_RSS('site:krc.co.ke Kenya railway incident OR service'),country_code:'KE',reliability:82},
 {name:'KeNHA',url:GOOGLE_RSS('site:kenha.co.ke Kenya road closure OR traffic OR accident'),country_code:'KE',reliability:90},
 {name:'EastAfrican Regional',url:GOOGLE_RSS('site:theeastafrican.co.ke Kenya OR Uganda OR Tanzania OR Rwanda OR Somalia OR Ethiopia incident OR security'),country_code:null,reliability:80},
 {name:'AllAfrica East Africa',url:GOOGLE_RSS('(Kenya OR Uganda OR Tanzania OR Rwanda OR Burundi OR Somalia OR Ethiopia OR South Sudan OR DRC) security OR incident'),country_code:null,reliability:74},
 {name:'Crisis Group East Africa',url:GOOGLE_RSS('site:crisisgroup.org East Africa Kenya Uganda Tanzania Rwanda Ethiopia Somalia Sudan'),country_code:null,reliability:86},
 {name:'ISS Africa East Africa',url:GOOGLE_RSS('site:issafrica.org East Africa security Kenya Uganda Tanzania Ethiopia Somalia'),country_code:null,reliability:84},
 {name:'Africa Center East Africa',url:GOOGLE_RSS('site:africacenter.org East Africa security'),country_code:null,reliability:82},

 {name:'New Vision Uganda',url:GOOGLE_RSS('site:newvision.co.ug Uganda crime OR security OR accident'),country_code:'UG',reliability:78},
 {name:'Daily Monitor Uganda',url:GOOGLE_RSS('site:monitor.co.ug Uganda crime OR security OR accident OR protest'),country_code:'UG',reliability:78},
 {name:'NTV Uganda',url:GOOGLE_RSS('site:ntv.co.ug Uganda breaking news'),country_code:'UG',reliability:72},
 {name:'Nile Post Uganda',url:GOOGLE_RSS('site:nilepost.co.ug Uganda incident OR police'),country_code:'UG',reliability:68},
 {name:'Uganda Police',url:GOOGLE_RSS('site:upf.go.ug Uganda police'),country_code:'UG',reliability:90},

 {name:'Mwananchi Tanzania',url:GOOGLE_RSS('site:mwananchi.co.tz Tanzania security OR accident OR protest'),country_code:'TZ',reliability:80,gl:'TZ',hl:'en-TZ'},
 {name:'The Citizen Tanzania',url:GOOGLE_RSS('site:thecitizen.co.tz Tanzania security OR accident OR protest','TZ','en-TZ'),country_code:'TZ',reliability:80},
 {name:'Daily News Tanzania',url:GOOGLE_RSS('site:dailynews.co.tz Tanzania incident OR security','TZ','en-TZ'),country_code:'TZ',reliability:76},
 {name:'IPP Media Tanzania',url:GOOGLE_RSS('site:ippmedia.com Tanzania incident OR security','TZ','en-TZ'),country_code:'TZ',reliability:72},
 {name:'TanzaniaInvest',url:'https://tanzaniainvest.com/feed',country_code:'TZ',reliability:65},

 {name:'New Times Rwanda',url:GOOGLE_RSS('site:newtimes.co.rw Rwanda police OR security OR accident','RW','en-RW'),country_code:'RW',reliability:80},
 {name:'Kigali Today Rwanda',url:GOOGLE_RSS('site:kigalitoday.com Rwanda incident OR police','RW','en-RW'),country_code:'RW',reliability:76},
 {name:'Taarifa Rwanda',url:GOOGLE_RSS('site:taarifa.rw Rwanda security OR accident','RW','en-RW'),country_code:'RW',reliability:70},
 {name:'Rwanda Today',url:GOOGLE_RSS('site:rwandatoday.africa Rwanda incident OR security','RW','en-RW'),country_code:'RW',reliability:68},
 {name:'Rwanda National Police',url:GOOGLE_RSS('site:police.gov.rw Rwanda police OR road safety OR crime','RW','en-RW'),country_code:'RW',reliability:92},

 {name:'IWACU Burundi',url:GOOGLE_RSS('site:iwacu-burundi.org Burundi security OR incident','BI','fr'),country_code:'BI',reliability:76},
 {name:'Radio Isanganiro Burundi',url:'https://isanganiro.org/feed',country_code:'BI',reliability:68},
 {name:'Burundi Eco',url:'https://burundi-eco.com/feed',country_code:'BI',reliability:66},
 {name:'RPA Burundi',url:GOOGLE_RSS('site:rpa.bi Burundi security OR incident','BI','fr'),country_code:'BI',reliability:72},
 {name:'Yaga Burundi',url:GOOGLE_RSS('site:yaga-burundi.com Burundi security OR society','BI','fr'),country_code:'BI',reliability:62},

 {name:'Eye Radio South Sudan',url:'https://eyeradio.org/feed',country_code:'SS',reliability:82},
 {name:'Radio Tamazuj',url:'https://www.radiotamazuj.org/en/feed',country_code:'SS',reliability:82},
 {name:'South Sudan News Now',url:GOOGLE_RSS('site:ssnewsnow.com South Sudan security OR fighting'),country_code:'SS',reliability:65},
 {name:'Hot in Juba',url:'https://hotinjuba.com/feed',country_code:'SS',reliability:60},

 {name:'Shabelle Somalia',url:'https://shabellemedia.com/feed',country_code:'SO',reliability:78},
 {name:'SONNA Somalia',url:'https://sonna.so/en/feed',country_code:'SO',reliability:80},
 {name:'Hiiraan Online',url:GOOGLE_RSS('site:hiiraan.com Somalia security OR attack OR accident','SO','en-SO'),country_code:'SO',reliability:78},
 {name:'Garowe Online',url:GOOGLE_RSS('site:garoweonline.com Somalia security OR Puntland OR incident','SO','en-SO'),country_code:'SO',reliability:78},
 {name:'Puntland Post',url:'https://puntlandpost.net/feed',country_code:'SO',reliability:68},

 {name:'ENA Ethiopia',url:GOOGLE_RSS('site:ena.et Ethiopia security OR conflict OR accident','ET','en-ET'),country_code:'ET',reliability:82},
 {name:'Addis Standard',url:'https://addisstandard.com/feed',country_code:'ET',reliability:78},
 {name:'Ethiopia Insight',url:'https://www.ethiopia-insight.com/feed',country_code:'ET',reliability:72},
 {name:'The Reporter Ethiopia',url:'https://www.thereporterethiopia.com/feed',country_code:'ET',reliability:74},
 {name:'Zehabesha Ethiopia',url:'https://zehabesha.com/feed',country_code:'ET',reliability:62},

 {name:'Actualite.cd DRC',url:'https://actualite.cd/feed',country_code:'CD',reliability:78},
 {name:'Radio Okapi DRC',url:'https://www.radiookapi.net/feed',country_code:'CD',reliability:84},
 {name:'Kivu Times DRC',url:GOOGLE_RSS('site:theeastafrican.co.ke DRC Goma Bukavu conflict','CD','en-KE'),country_code:'CD',reliability:68},

 {name:'Radio Dabanga Sudan',url:'https://www.dabangasudan.org/en/feed',country_code:'SD',reliability:82},
 {name:'Sudan Tribune',url:'https://sudantribune.com/feed',country_code:'SD',reliability:76},
 {name:'Sudan War Monitor',url:GOOGLE_RSS('Sudan conflict security Darfur Khartoum','SD','en-SD'),country_code:'SD',reliability:68}
];

function sha(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex');}
function clean(v,n=6000){return String(v||'').replace(/\s+/g,' ').trim().slice(0,n);}
function timeoutFetch(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(TIMEOUT_MS)});}
function category(text){const s=String(text||'').toLowerCase();if(/ied|improvised explosive|bomb|explosion/.test(s))return'ied';if(/armed attack|gunfire|shooting|ambush|militia|insurgent/.test(s))return'armed_attack';if(/protest|riot|unrest|demonstration|roadblock|clash/.test(s))return'protest';if(/rally|political rally/.test(s))return'political_rally';if(/fire|blaze|burning/.test(s))return'fire';if(/traffic|congestion|road closed|gridlock|closure/.test(s))return'traffic';if(/accident|crash|collision|overturned|derailment/.test(s))return'accident';if(/kidnap|abduct/.test(s))return'kidnapping';if(/flood|landslide|earthquake|storm|weather warning|heavy rain|wind warning/.test(s))return'natural_hazard';if(/robbery|carjacking|crime|mugging|murder/.test(s))return'crime';return'other';}
function severity(cat,text){if(['ied','armed_attack','kidnapping'].includes(cat))return'high';if(['protest','political_rally','fire','accident','natural_hazard'].includes(cat))return'medium';return /death|dead|fatal|casualties|multiple injured|killed/i.test(text)?'high':'low';}
function detectCountry(text,fallback=null){const s=String(text||'').toLowerCase();if(fallback&&EA_COUNTRIES[fallback])return fallback;for(const code of EA_CODES){if(EA_COUNTRIES[code].terms.some(t=>s.includes(t.toLowerCase())))return code;}return null;}
function parseDate(v){if(!v)return null;try{const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString();}catch{return null;}}
async function ensureSource(orgId,spec){const type=['x','telegram','whatsapp'].includes(spec.provider)?'social':spec.provider==='gdelt'||spec.provider==='rss'?'news':'other';const{rows}=await query(`INSERT INTO intel_sources (org_id,name,source_type,provider,endpoint,reliability,metadata,last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW()) ON CONFLICT (org_id,provider,endpoint) WHERE provider IS NOT NULL AND endpoint IS NOT NULL DO UPDATE SET name=EXCLUDED.name,source_type=EXCLUDED.source_type,reliability=EXCLUDED.reliability,metadata=EXCLUDED.metadata,last_seen_at=NOW(),updated_at=NOW() RETURNING *`,[orgId,spec.name,type,spec.provider,spec.endpoint,spec.reliability||60,JSON.stringify(spec.metadata||{})]);return rows[0];}
async function persistObservation(orgId,source,item){const title=clean(item.title||item.text||item.body,700),body=clean(item.text||item.body||item.title,7000);if(!title&&!body)return null;const externalId=item.external_id||`${source.provider}:${sha(item.url||`${title}|${item.published_at||''}`)}`;const countryCode=detectCountry(`${title} ${body}`,item.country_code)||null;const meta={...(item.raw_metadata||{}),incident_category:category(`${title} ${body}`),severity_hint:severity(category(`${title} ${body}`),`${title} ${body}`),regional_scope:countryCode?'EAST_AFRICA':'UNRESOLVED_REGIONAL',collection_layer:'regional-incident-fabric'};const{rows}=await query(`INSERT INTO intel_observations (org_id,source_id,external_id,observed_at,published_at,title,body,url,language,country_code,raw_metadata,credibility,manipulation_score) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) ON CONFLICT (org_id,source_id,external_id) DO UPDATE SET last_seen_at=NOW() RETURNING id,title,body,url,observed_at,published_at,country_code,raw_metadata`,[orgId,source.id,externalId,item.observed_at||new Date().toISOString(),item.published_at||null,title||null,body||null,item.url||null,item.language||null,countryCode,JSON.stringify(meta),Number.isFinite(item.credibility)?item.credibility:(source.reliability||60),0]);return rows[0]||null;}
async function materializeAlert(orgId,source,o){if(!o?.id)return false;const text=`${o.title||''} ${o.body||''}`,cat=category(text),sev=severity(cat,text);const existing=await query(`SELECT id FROM intel_alerts WHERE org_id=$1 AND observation_id=$2 LIMIT 1`,[orgId,o.id]);if(existing.rows[0]){await query(`UPDATE intel_alerts SET last_seen_at=NOW(),updated_at=NOW() WHERE id=$1`,[existing.rows[0].id]);return false;}await query(`INSERT INTO intel_alerts (org_id,observation_id,source_id,category,title,summary,severity,confidence,verification_state,status,country_code,first_seen_at,last_seen_at,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unverified','open',$9,$10,$10,$11::jsonb)`,[orgId,o.id,source.id,cat,clean(o.title||o.body,500),clean(o.body||o.title,1800),sev,source.provider==='x'?35:source.provider==='telegram'?32:45,o.country_code||null,o.observed_at||new Date().toISOString(),JSON.stringify({source_provider:source.provider,source_reliability:source.reliability,evidence_boundary:'source observation; not independently verified',regional_scope:'EAST_AFRICA'})]);return true;}

function xQueryForCountry(code){const country=EA_COUNTRIES[code];const geo=country.terms.map(v=>`"${v}"`).join(' OR ');const accounts=(X_ACCOUNT_MONITORS[code]||[]).map(a=>`from:${a}`).join(' OR ');return accounts?`((${geo}) OR (${accounts})) (${INCIDENT_QUERY}) -is:retweet`:`(${geo}) (${INCIDENT_QUERY}) -is:retweet`;}
async function fetchX(code){const token=process.env.X_BEARER_TOKEN||process.env.TWITTER_BEARER_TOKEN;if(!token)return[];const q=xQueryForCountry(code),p=new URLSearchParams({query:q,max_results:'100',sort_order:'recency','tweet.fields':'created_at,lang,author_id,public_metrics,context_annotations,geo,entities'});const r=await timeoutFetch(`https://api.x.com/2/tweets/search/recent?${p}`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error(`X ${EA_COUNTRIES[code].name} HTTP ${r.status}`);const d=await r.json();return(d.data||[]).map(t=>({external_id:`x:${t.id}`,text:t.text,title:clean(t.text,700),published_at:t.created_at,observed_at:t.created_at,language:t.lang,country_code:code,url:`https://x.com/i/web/status/${t.id}`,credibility:45,raw_metadata:{author_id:t.author_id,public_metrics:t.public_metrics,context_annotations:t.context_annotations,geo:t.geo}}));}
async function fetchGdelt(){const q=`(${EA_CODES.map(c=>EA_COUNTRIES[c].terms.slice(0,5).map(v=>`"${v}"`).join(' OR ')).join(' OR ')}) (${INCIDENT_QUERY})`;const url=`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=${MAX_ITEMS}&timespan=1h&format=json`;const r=await timeoutFetch(url);if(!r.ok)throw new Error(`GDELT HTTP ${r.status}`);const d=await r.json();return(d.articles||[]).map(a=>({external_id:a.url?`gdelt:${sha(a.url)}`:null,title:a.title,body:a.title,url:a.url,published_at:a.seendate?parseDate(String(a.seendate).replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,'$1-$2-$3T$4:$5:$6Z')):null,language:a.language||null,country_code:detectCountry(`${a.title||''} ${a.domain||''}`),credibility:72,raw_metadata:{domain:a.domain,tone:a.tone,sourcecountry:a.sourcecountry}}));}
function rssText(v){if(v==null)return'';if(typeof v==='string')return v;if(typeof v==='object')return v['#text']||v['__cdata']||v.value||v.text||'';return String(v);}
function rssLink(v){if(v==null)return null;if(typeof v==='string')return v;if(Array.isArray(v))return rssLink(v[0]);if(typeof v==='object')return v.href||v['#text']||v.url||null;return String(v);}
async function fetchRss(feed){const r=await timeoutFetch(feed.url,{headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.1'}});if(!r.ok)throw new Error(`${feed.name} HTTP ${r.status}`);const x=xmlParser.parse(await r.text()),raw=x?.rss?.channel?.item||x?.feed?.entry||[],items=Array.isArray(raw)?raw:[raw];return items.slice(0,MAX_ITEMS).map(i=>{const title=clean(rssText(i.title),700),body=clean(rssText(i.description)||rssText(i.summary)||rssText(i.content)||title,7000),link=rssLink(i.link),published=parseDate(rssText(i.pubDate)||rssText(i.published)||rssText(i.updated));return{external_id:i.guid?`rss:${rssText(i.guid)}`:(i.id?`rss:${rssText(i.id)}`:(link?`rss:${sha(link)}`:null)),title,body,text:body,url:link,published_at:published,language:rssText(i.language)||null,country_code:feed.country_code,credibility:feed.reliability,raw_metadata:{feed:feed.name,feed_url:feed.url}};}).filter(i=>{const c=detectCountry(`${i.title} ${i.body}`,i.country_code);return c!==null;});}
async function fetchTelegram(entry,since){let messages=await telegramMtproto.fetchChannelMessages(entry.channel,since),via='mtproto';if(!messages.length&&!telegramMtproto.isConfigured()){messages=await telegramMtproto.fetchPublicChannelPreview(entry.channel,since);via='public-preview';}return messages.map(m=>({external_id:`telegram:${entry.channel}:${m.id}`,text:m.text,title:clean(m.text,700),published_at:new Date(m.postedAt).toISOString(),observed_at:new Date(m.postedAt).toISOString(),url:`https://t.me/${entry.channel}/${String(m.id).split('/').pop()}`,country_code:entry.country_code,credibility:Number(entry.reliability)||35,raw_metadata:{channel:entry.channel,collection_mode:via}}));}
async function fetchWhatsAppFeeds(){let feeds=[];try{feeds=JSON.parse(process.env.RISK_INTEL_WHATSAPP_FEEDS||'[]')}catch{}const out=[];for(const feed of Array.isArray(feeds)?feeds.slice(0,30):[]){if(!feed?.url)continue;try{const r=await timeoutFetch(feed.url,{headers:{Accept:'application/json, application/rss+xml, application/xml'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const text=await r.text();let payload=null;try{payload=JSON.parse(text)}catch{}if(Array.isArray(payload))for(const item of payload.slice(0,MAX_ITEMS))out.push({...item,country_code:item.country_code||feed.country_code,credibility:Number(item.credibility)||Number(feed.reliability)||35,raw_metadata:{...(item.raw_metadata||{}),transport:'whatsapp-authorized-feed',feed:feed.name||feed.url}});else{const x=xmlParser.parse(text),raw=x?.rss?.channel?.item||x?.feed?.entry||[],items=Array.isArray(raw)?raw:[raw];for(const i of items.slice(0,MAX_ITEMS))out.push({external_id:i.guid?`whatsapp:${rssText(i.guid)}`:null,title:clean(rssText(i.title),700),body:clean(rssText(i.description)||rssText(i.summary)||rssText(i.content),7000),url:rssLink(i.link),published_at:parseDate(rssText(i.pubDate)||rssText(i.published)||rssText(i.updated)),country_code:feed.country_code,credibility:Number(feed.reliability)||35,raw_metadata:{transport:'whatsapp-authorized-feed',feed:feed.name||feed.url}});}}catch(e){logger.warn(`Regional Incident Fabric: WhatsApp feed ${feed.name||feed.url} failed: ${e.message}`);}}return out.filter(i=>detectCountry(`${i.title||''} ${i.body||i.text||''}`,i.country_code));}
async function collectProvider(orgId,spec,items){const source=await ensureSource(orgId,spec);let inserted=0,alerts=0;for(const item of items.slice(0,MAX_ITEMS)){const o=await persistObservation(orgId,source,item);if(!o)continue;inserted++;if(await materializeAlert(orgId,source,o))alerts++;}return{provider:spec.provider,name:spec.name,seen:items.length,inserted,alerts,status:'success'};}
async function runLimited(tasks,limit=6){const results=[];let cursor=0;async function worker(){while(cursor<tasks.length){const idx=cursor++;try{results[idx]=await tasks[idx]();}catch(e){results[idx]={status:'failed',error:e.message};}}}await Promise.all(Array.from({length:Math.min(limit,tasks.length)},()=>worker()));return results;}
async function runRegionalIncidentSweep(orgId){const started=Date.now(),results=[],since=Date.now()-90*60*1000,xToken=process.env.X_BEARER_TOKEN||process.env.TWITTER_BEARER_TOKEN;
 if(xToken){const xTasks=EA_CODES.map(code=>async()=>{try{const items=await fetchX(code);return collectProvider(orgId,{provider:'x',name:`X ${EA_COUNTRIES[code].name} Incident Monitor`,endpoint:`https://api.x.com/2/tweets/search/recent?country=${code}`,reliability:45,metadata:{country_code:code,query_type:'incident',freshness:'recent-search',accounts:X_ACCOUNT_MONITORS[code]||[]}},items);}catch(e){logger.warn(`Regional Incident Fabric: X ${EA_COUNTRIES[code].name} failed: ${e.message}`);return{provider:'x',name:`X ${EA_COUNTRIES[code].name}`,status:'failed',error:e.message};}});results.push(...await runLimited(xTasks,5));}
 try{const items=await fetchGdelt();results.push(await collectProvider(orgId,{provider:'gdelt',name:'GDELT East Africa Incident Discovery',endpoint:'https://api.gdeltproject.org/api/v2/doc/doc?scope=east-africa-incidents',reliability:72,metadata:{region:'EAST_AFRICA',query_type:'incident',freshness:'1h'}},items));}catch(e){logger.warn(`Regional Incident Fabric: GDELT failed: ${e.message}`);results.push({provider:'gdelt',status:'failed',error:e.message});}
 const feedTasks=RSS_FEEDS.map(feed=>async()=>{try{const items=await fetchRss(feed);return collectProvider(orgId,{provider:'rss',name:feed.name,endpoint:feed.url,reliability:feed.reliability,metadata:{country_code:feed.country_code,region:'EAST_AFRICA',collection:'regional-news-matrix'}},items);}catch(e){logger.warn(`Regional Incident Fabric: RSS ${feed.name} failed: ${e.message}`);return{provider:'rss',name:feed.name,status:'failed',error:e.message};}});results.push(...await runLimited(feedTasks,8));
 let channels=[];try{channels=JSON.parse(process.env.RISK_INTEL_TELEGRAM_CHANNELS||'')}catch{}if(!Array.isArray(channels)||!channels.length)channels=DEFAULT_TELEGRAM;const tgTasks=channels.slice(0,40).map(raw=>async()=>{const entry=typeof raw==='string'?{channel:raw,country_code:null,reliability:35}:raw;if(!entry?.channel)return{provider:'telegram',status:'skipped'};try{const items=await fetchTelegram(entry,since);return collectProvider(orgId,{provider:'telegram',name:`Telegram ${entry.channel} Incident Monitor`,endpoint:`mtproto://${entry.channel}`,reliability:Number(entry.reliability)||35,metadata:{channel:entry.channel,country_code:entry.country_code||null,region:'EAST_AFRICA'}},items);}catch(e){logger.warn(`Regional Incident Fabric: Telegram ${entry.channel} failed: ${e.message}`);return{provider:'telegram',name:`Telegram ${entry.channel}`,status:'failed',error:e.message};}});results.push(...await runLimited(tgTasks,6));
 const wa=await fetchWhatsAppFeeds();if(wa.length)results.push(await collectProvider(orgId,{provider:'whatsapp',name:'WhatsApp Authorized Incident Feeds',endpoint:'whatsapp://authorized-feeds',reliability:35,metadata:{region:'EAST_AFRICA',mode:'authorized-feed-only'}},wa));
 return{region:'EAST_AFRICA',duration_ms:Date.now()-started,results,totalSeen:results.reduce((s,r)=>s+(r.seen||0),0),totalInserted:results.reduce((s,r)=>s+(r.inserted||0),0),totalAlerts:results.reduce((s,r)=>s+(r.alerts||0),0)};
}
async function runRegionalIncidentSweepAll(){const{rows:orgs}=await query(`SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL`);const results=[];for(const{org_id}of orgs){try{results.push(await runRegionalIncidentSweep(org_id));}catch(e){logger.warn(`Regional Incident Fabric: org=${org_id} failed: ${e.message}`);results.push({region:'EAST_AFRICA',status:'failed',error:e.message});}}return results;}
module.exports={runRegionalIncidentSweep,runRegionalIncidentSweepAll,EA_CODES,EA_COUNTRIES,X_ACCOUNT_MONITORS,RSS_FEEDS,DEFAULT_TELEGRAM,category,severity,detectCountry};