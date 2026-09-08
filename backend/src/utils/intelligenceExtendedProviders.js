// Extended intelligence providers for the canonical Collection Fabric.
// Public/authorized APIs only. Every adapter is bounded and independently degradable.
const logger = require('./logger');

const TIMEOUT_MS = 9000;
const MAX_ITEMS = 50;

function clean(v, n = 7000) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, n); }
function timeoutFetch(url, options = {}) { return fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
function parseJsonEnv(name, fallback = []) { try { const v = JSON.parse(process.env[name] || 'null'); return Array.isArray(v) ? v : fallback; } catch { return fallback; } }

const ISO = {
  Afghanistan:'AF', Bangladesh:'BD', Benin:'BJ', 'Burkina Faso':'BF', Burundi:'BI', Cameroon:'CM', 'Central African Republic':'CF', Chad:'TD', Colombia:'CO', Egypt:'EG', 'El Salvador':'SV', Ethiopia:'ET', Ghana:'GH', Guatemala:'GT', Haiti:'HT', Honduras:'HN', India:'IN', Iraq:'IQ', 'Ivory Coast':'CI', Kenya:'KE', Lebanon:'LB', Libya:'LY', Mali:'ML', Mexico:'MX', Mozambique:'MZ', Myanmar:'MM', Niger:'NE', Nigeria:'NG', Pakistan:'PK', 'Papua New Guinea':'PG', Philippines:'PH', Rwanda:'RW', Senegal:'SN', Somalia:'SO', 'South Sudan':'SS', 'Sri Lanka':'LK', Sudan:'SD', Syria:'SY', Tanzania:'TZ', Togo:'TG', Uganda:'UG', Ukraine:'UA', Venezuela:'VE', Yemen:'YE', Zimbabwe:'ZW'
};
const COUNTRY = Object.fromEntries(Object.entries(ISO).map(([name, code]) => [code, name]));

function countriesFromWatchlists(watchlists) {
  // Kenya is Sonalit's primary operating intelligence baseline. An empty
  // configuration must never silently disable country-aware collection.
  const configured = parseJsonEnv('RISK_INTEL_COUNTRIES', []);
  const out = new Set(['KE']);
  for (const v of configured) {
    const raw = String(v || '').trim();
    const upper = raw.toUpperCase();
    if (COUNTRY[upper]) out.add(upper);
    else if (ISO[raw]) out.add(ISO[raw]);
  }
  for (const w of watchlists || []) {
    const t = w.target || {};
    const raw = String(t.country_code || t.country || t.iso2 || '').trim();
    const upper = raw.toUpperCase();
    if (COUNTRY[upper]) out.add(upper);
    else if (ISO[raw]) out.add(ISO[raw]);
  }
  return [...out].slice(0, 30);
}

async function collectReliefWeb(countries) {
  const appname = process.env.RELIEFWEB_APP_NAME;
  if (!appname) return [];
  const out = [];
  for (const cc of countries) {
    try {
      const u = new URL('https://api.reliefweb.int/v2/reports');
      u.searchParams.set('appname', appname);
      u.searchParams.set('query[value]', COUNTRY[cc]);
      u.searchParams.set('limit', String(MAX_ITEMS));
      u.searchParams.append('fields[include][]', 'title');
      u.searchParams.append('fields[include][]', 'url');
      u.searchParams.append('fields[include][]', 'date.created');
      const r = await timeoutFetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      for (const row of d.data || []) {
        const f = row.fields || {};
        out.push({ provider:'reliefweb', external_id:`reliefweb:${row.id}`, title:clean(f.title,700), body:clean(f.title,7000), url:f.url || row.href || null, published_at:f.date?.created || null, country_code:cc, credibility:75, raw_metadata:{source:'reliefweb'} });
      }
    } catch (e) { logger.warn(`Extended intelligence: ReliefWeb ${cc} failed: ${e.message}`); }
  }
  return out.slice(0, MAX_ITEMS);
}

let acledToken = null;
let acledTokenExpiresAt = 0;
async function getAcledToken() {
  if (acledToken && Date.now() < acledTokenExpiresAt) return acledToken;
  const username = process.env.ACLED_USERNAME;
  const password = process.env.ACLED_PASSWORD;
  if (!username || !password) return null;
  const auth = await timeoutFetch('https://acleddata.com/oauth/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({username,password,grant_type:'password',client_id:'acled',scope:'authenticated'})
  });
  if (!auth.ok) throw new Error(`OAuth HTTP ${auth.status}`);
  const data = await auth.json();
  if (!data.access_token) throw new Error('missing access_token');
  acledToken = data.access_token;
  acledTokenExpiresAt = Date.now() + (Math.max(60, Number(data.expires_in) || 86400) - 60) * 1000;
  return acledToken;
}

async function collectAcled(countries) {
  if (!countries.length) return [];
  try {
    const token = await getAcledToken();
    if (!token) return [];
    const out = [];
    const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString().slice(0,10);
    const today = new Date().toISOString().slice(0,10);
    for (const cc of countries) {
      try {
        const u = new URL('https://acleddata.com/api/acled/read');
        u.searchParams.set('_format','json'); u.searchParams.set('country',COUNTRY[cc]);
        u.searchParams.set('event_date',`${since}|${today}`); u.searchParams.set('event_date_where','BETWEEN');
        u.searchParams.set('limit',String(MAX_ITEMS));
        u.searchParams.set('fields','event_id_cnty|event_date|event_type|sub_event_type|country|location|latitude|longitude|notes|fatalities');
        const r = await timeoutFetch(u,{headers:{Authorization:`Bearer ${token}`}});
        if (r.status === 401) { acledToken = null; acledTokenExpiresAt = 0; throw new Error('HTTP 401; token invalidated'); }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        for (const x of d.data || []) {
          const body = clean(`${x.event_type || 'Event'} — ${x.location || COUNTRY[cc]}: ${x.notes || ''}`);
          out.push({provider:'acled',external_id:`acled:${x.event_id_cnty}`,title:`ACLED ${x.event_type || 'event'} — ${x.location || COUNTRY[cc]}`,body,country_code:cc,latitude:x.latitude,longitude:x.longitude,published_at:x.event_date,credibility:Number(x.fatalities)>0?90:85,raw_metadata:{event_type:x.event_type,sub_event_type:x.sub_event_type,fatalities:x.fatalities,source:'acled'}});
        }
      } catch (e) { logger.warn(`Extended intelligence: ACLED ${cc} failed: ${e.message}`); }
    }
    return out.slice(0, MAX_ITEMS);
  } catch (e) { logger.warn(`Extended intelligence: ACLED authentication failed: ${e.message}`); return []; }
}

async function collectGdacs(countries) {
  if (!countries.length) return [];
  try {
    const from = new Date(Date.now() - 5 * 86400000).toISOString().slice(0,10);
    const to = new Date().toISOString().slice(0,10);
    const r = await timeoutFetch(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromdate=${from}&todate=${to}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json(); const out=[];
    for (const f of d.features || []) {
      const p=f.properties || {};
      const affected=(p.affectedcountries || []).map(x => String(x.countrycode || x.iso2 || x.iso3 || x.countryname || '').trim().toUpperCase());
      const cc=countries.find(c => affected.includes(c) || affected.some(a => a === c || a.includes(c) || a === ISO[COUNTRY[c]]));
      if (!cc) continue;
      const coords=f.geometry?.coordinates || []; const lng=coords[0] ?? null, lat=coords[1] ?? null;
      out.push({provider:'gdacs',external_id:`gdacs:${p.eventtype}:${p.eventid}:${p.episodeid}`,title:clean(p.name || p.description || 'GDACS hazard',700),body:clean(p.description || p.name || 'Hazard event'),url:p.url?.report || null,country_code:cc,latitude:lat,longitude:lng,published_at:p.datemodified || p.dateevent || null,credibility:85,raw_metadata:{event_type:p.eventtype,alert_level:p.alertlevel,source:'gdacs'}});
    }
    return out.slice(0,MAX_ITEMS);
  } catch (e) { logger.warn(`Extended intelligence: GDACS failed: ${e.message}`); return []; }
}

function buildExtendedAdapters(watchlists) {
  const countries=countriesFromWatchlists(watchlists);
  return [
    {provider:'reliefweb',name:'ReliefWeb Humanitarian Reports',endpoint:'https://api.reliefweb.int/v2/reports',reliability:75,run:()=>collectReliefWeb(countries)},
    {provider:'acled',name:'ACLED Political Violence Events',endpoint:'https://acleddata.com/api/acled/read',reliability:88,run:()=>collectAcled(countries)},
    {provider:'gdacs',name:'GDACS Global Disaster Alerts',endpoint:'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH',reliability:85,run:()=>collectGdacs(countries)}
  ];
}

module.exports={buildExtendedAdapters,countriesFromWatchlists};