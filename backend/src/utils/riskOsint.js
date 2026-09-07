// Risk Intel OSINT sweep. External feeds are treated as unreliable dependencies:
// each provider is bounded, rate-aware and isolated so one outage cannot turn
// into a storm of repeated errors or abort the whole sweep.
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const telegramMtproto = require('./telegramMtproto');
const aiClient = require('./aiClient');
const { geocodePlace } = require('./geocode');
const { continentForCountry } = require('./countryContinent');
const { query } = require('../config/database');
const { publish } = require('../realtime/centrifugo');
const logger = require('./logger');

const MODEL = 'claude-sonnet-5';
const HIGH_KEYWORDS = /attack|ambush|kill|kidnap|abduct|bomb|explos|gunfire|shoot|terroris|insurgen|massacre|raid/i;
const MEDIUM_KEYWORDS = /protest|unrest|roadblock|strike|clash|robbery|bandit|checkpoint|tension|militia|curfew/i;

function classifyLevelFromKeywords(text) {
  if (HIGH_KEYWORDS.test(text)) return 'high';
  if (MEDIUM_KEYWORDS.test(text)) return 'medium';
  return 'low';
}

function classifyLevelFromTone(tone) {
  if (!Number.isFinite(tone)) return 'medium';
  if (tone <= -7) return 'high';
  if (tone <= -2) return 'medium';
  return 'low';
}

function extractPlaceTerms(zone) {
  const source = zone.region || zone.name;
  const terms = source
    .split(/[\/,]/)
    .map(s => s.replace(/[()]/g, '').trim())
    .filter(Boolean)
    .slice(0, 4);
  return terms.length ? terms : [zone.name];
}

// GDELT is rate-limited and its public endpoint can transiently timeout.
// A process-local circuit breaker prevents one upstream problem from causing
// dozens of identical requests in the same sweep. The next scheduled sweep
// gets a fresh chance automatically.
let gdeltCooldownUntil = 0;
let gdeltLastRequestAt = 0;
let gdeltTimeouts = 0;
const GDELT_MIN_INTERVAL_MS = 1500;
const GDELT_TIMEOUT_MS = 7000;
const GDELT_429_COOLDOWN_MS = 15 * 60 * 1000;
const GDELT_TIMEOUT_COOLDOWN_MS = 5 * 60 * 1000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchGdeltForZone(zone) {
  if (Date.now() < gdeltCooldownUntil) return [];
  const wait = GDELT_MIN_INTERVAL_MS - (Date.now() - gdeltLastRequestAt);
  if (wait > 0) await sleep(wait);

  const placeClause = '(' + extractPlaceTerms(zone).map(t => `"${t}"`).join(' OR ') + ')';
  const q = `${placeClause} (attack OR conflict OR violence OR kidnap OR ambush OR unrest OR clash OR insurgent OR banditry OR militant OR terrorist)`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=5&timespan=2d&format=json`;
  gdeltLastRequestAt = Date.now();

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(GDELT_TIMEOUT_MS) });
  } catch (error) {
    gdeltTimeouts += 1;
    if (gdeltTimeouts >= 1) gdeltCooldownUntil = Date.now() + GDELT_TIMEOUT_COOLDOWN_MS;
    throw new Error(`GDELT unavailable: ${error.name === 'TimeoutError' ? 'timeout' : error.message}`);
  }

  if (res.status === 429) {
    gdeltCooldownUntil = Date.now() + GDELT_429_COOLDOWN_MS;
    throw new Error('GDELT rate limited (429); circuit opened for 15 minutes');
  }
  if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') || '';
  const body = await res.text();
  if (!contentType.includes('json')) {
    gdeltCooldownUntil = Date.now() + GDELT_TIMEOUT_COOLDOWN_MS;
    throw new Error('GDELT returned a non-JSON response; circuit opened temporarily');
  }

  let data;
  try { data = JSON.parse(body); }
  catch { gdeltCooldownUntil = Date.now() + GDELT_TIMEOUT_COOLDOWN_MS; throw new Error('GDELT returned invalid JSON; circuit opened temporarily'); }

  gdeltTimeouts = 0;
  const articles = Array.isArray(data.articles) ? data.articles : [];
  return articles
    .map(a => ({
      description: (a.title || '').slice(0, 500),
      level: classifyLevelFromTone(parseFloat(a.tone)),
      source: 'osint:gdelt',
      source_url: a.url,
    }))
    .filter(it => it.description && it.source_url);
}

async function fetchReliefWebForZone(zone) {
  // ReliefWeb v1 was decommissioned at the end of Q1 2026. Use the current
  // v2 API and its current result shape. The app name is retained so requests
  // remain attributable to Sonalit Risk Intel.
  const q = zone.region || zone.name;
  const params = new URLSearchParams();
  params.set('appname', 'sonalit-risk-intel');
  params.set('query[value]', q);
  params.set('query[operator]', 'AND');
  params.set('limit', '5');
  params.set('sort[]', 'date.created:desc');
  params.append('fields[include][]', 'title');
  params.append('fields[include][]', 'url');
  params.append('fields[include][]', 'date.created');
  const url = `https://api.reliefweb.int/v2/reports?${params.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`ReliefWeb HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data.data) ? data.data : [];
  const cutoffMs = Date.now() - 4 * 24 * 3600 * 1000;
  return items
    .filter(it => {
      const created = it.fields?.date?.created ? new Date(it.fields.date.created).getTime() : 0;
      return created >= cutoffMs;
    })
    .map(it => ({
      description: (it.fields?.title || '').slice(0, 500),
      level: classifyLevelFromKeywords(it.fields?.title || ''),
      source: 'osint:reliefweb',
      source_url: it.fields?.url || it.href || null,
      external_id: `reliefweb:${it.id}`,
    }))
    .filter(it => it.description && it.source_url);
}

const COUNTRY_NAMES = [
  'Afghanistan', 'Bangladesh', 'Benin', 'Burkina Faso', 'Burundi', 'Cameroon', 'Central African Republic',
  'Chad', 'Colombia', 'Egypt', 'El Salvador', 'Ethiopia', 'Ghana', 'Guatemala', 'Haiti', 'Honduras',
  'India', 'Iraq', 'Ivory Coast', 'Kenya', 'Lebanon', 'Libya', 'Mali', 'Mexico', 'Mozambique', 'Myanmar',
  'Niger', 'Nigeria', 'Pakistan', 'Papua New Guinea', 'Philippines', 'Rwanda', 'Senegal', 'Somalia',
  'South Sudan', 'Sri Lanka', 'Sudan', 'Syria', 'Tanzania', 'Togo', 'Uganda', 'Ukraine', 'Venezuela',
  'Yemen', 'Zimbabwe',
];

function extractZoneCountries(zone) {
  const haystack = zone.region || zone.name || '';
  return COUNTRY_NAMES.filter(c => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack));
}

const GDACS_ALERT_LEVEL = { Red: 'high', Orange: 'medium', Green: 'low' };
const GDACS_MATCH_RADIUS_KM = 300;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchGdacsEvents() {
  const from = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromdate=${from}&todate=${to}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`GDACS HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.features) ? data.features : [];
}

function matchGdacsToZone(zone, features) {
  const zoneLat = Number(zone.lat);
  const zoneLng = Number(zone.lng);
  const hasCoords = Number.isFinite(zoneLat) && Number.isFinite(zoneLng);
  const zoneCountries = extractZoneCountries(zone).map(c => c.toLowerCase());
  return features.filter(f => {
    const [lon, lat] = f.geometry?.coordinates || [];
    const withinRadius = hasCoords && Number.isFinite(lat) && Number.isFinite(lon) && haversineKm(zoneLat, zoneLng, lat, lon) <= GDACS_MATCH_RADIUS_KM;
    const countryOverlap = zoneCountries.length > 0 && (f.properties?.affectedcountries || []).some(c => zoneCountries.includes(String(c?.countryname || '').toLowerCase()));
    return withinRadius || countryOverlap;
  }).map(f => ({
    description: (f.properties?.name || f.properties?.description || '').slice(0, 500),
    level: GDACS_ALERT_LEVEL[f.properties?.alertlevel] || 'medium',
    source: 'osint:gdacs',
    source_url: f.properties?.url?.report || null,
    external_id: `gdacs:${f.properties?.eventtype}:${f.properties?.eventid}:${f.properties?.episodeid}`,
  })).filter(it => it.description);
}

const ACLED_HIGH_TYPES = new Set(['Battles', 'Violence against civilians', 'Explosions/Remote violence']);
function classifyAcledLevel(item) {
  const fatalities = parseInt(item.fatalities, 10) || 0;
  if (fatalities >= 1 || ACLED_HIGH_TYPES.has(item.event_type)) return 'high';
  if (item.event_type === 'Riots' || item.disorder_type === 'Political violence') return 'medium';
  return 'low';
}
let _acledToken = null;
let _acledTokenExpiresAt = 0;

async function getAcledToken() {
  if (_acledToken && Date.now() < _acledTokenExpiresAt) return _acledToken;
  const username = process.env.ACLED_USERNAME;
  const password = process.env.ACLED_PASSWORD;
  if (!username || !password) return null;
  const res = await fetch('https://acleddata.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, grant_type: 'password', client_id: 'acled', scope: 'authenticated' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ACLED OAuth HTTP ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('ACLED OAuth response missing access_token');
  _acledToken = data.access_token;
  _acledTokenExpiresAt = Date.now() + (Math.max(60, (data.expires_in || 86400) - 300)) * 1000;
  return _acledToken;
}

async function fetchAcledForZone(zone, token) {
  const countries = extractZoneCountries(zone);
  if (!countries.length) return [];
  const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    _format: 'json', country: countries.join('|'), event_date: `${since}|${today}`, event_date_where: 'BETWEEN', limit: '5',
    fields: 'event_id_cnty|event_date|event_type|sub_event_type|disorder_type|country|location|notes|fatalities',
  });
  const res = await fetch(`https://acleddata.com/api/acled/read?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`ACLED HTTP ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data.data) ? data.data : []).filter(it => it.notes && it.event_id_cnty).map(it => ({
    description: `${[it.event_type, it.location].filter(Boolean).join(' — ')}: ${it.notes.slice(0, 400)}`.slice(0, 500),
    level: classifyAcledLevel(it), source: 'osint:acled', external_id: `acled:${it.event_id_cnty}`,
  }));
}

const xmlParser = new XMLParser({ ignoreAttributes: true });
async function fetchRssItems(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status} (${url})`);
  const xml = await res.text();
  const items = xmlParser.parse(xml)?.rss?.channel?.item;
  return !items ? [] : (Array.isArray(items) ? items : [items]);
}
function rssItemsToEvents(items, source) {
  const cutoffMs = Date.now() - 2 * 24 * 3600 * 1000;
  return items.filter(it => {
    const title = String(it.title || '');
    return it.link && (new Date(it.pubDate || 0).getTime() >= cutoffMs) && (HIGH_KEYWORDS.test(title) || MEDIUM_KEYWORDS.test(title));
  }).map(it => ({ description: String(it.title).slice(0, 500), level: classifyLevelFromKeywords(String(it.title)), source, source_url: it.link }));
}
async function fetchAllAfricaForZone(zone) {
  if (zone.continent !== 'africa') return [];
  const found = [];
  for (const country of extractZoneCountries(zone)) {
    const slug = country.toLowerCase().replace(/\s+/g, '-');
    try { found.push(...rssItemsToEvents(await fetchRssItems(`https://allafrica.com/tools/headlines/rdf/${slug}/headlines.rdf`), 'osint:allafrica')); }
    catch (e) { logger.warn(`Risk Intel OSINT: AllAfrica feed failed for "${country}": ${e.message}`); }
  }
  return found;
}
function loadExtraRssFeeds() {
  const raw = process.env.RISK_INTEL_EXTRA_RSS_FEEDS;
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter(f => f?.country && f?.url) : []; }
  catch (e) { logger.warn(`Risk Intel OSINT: RISK_INTEL_EXTRA_RSS_FEEDS invalid JSON: ${e.message}`); return []; }
}
async function fetchExtraRssForZone(zone, feeds) {
  const countries = extractZoneCountries(zone).map(c => c.toLowerCase());
  const found = [];
  for (const feed of feeds.filter(f => countries.includes(String(f.country).toLowerCase()))) {
    try { found.push(...rssItemsToEvents(await fetchRssItems(feed.url), 'osint:rss')); }
    catch (e) { logger.warn(`Risk Intel OSINT: extra RSS feed failed for "${feed.country}": ${e.message}`); }
  }
  return found;
}

const DEFAULT_TELEGRAM_CHANNELS = [
  'IntelSlava', 'osint613', 'war_monitor', 'osintwarfare', 'Liveuamap', 'AuroraIntel', 'BNONews', 'wartranslated',
  'africaintelligence', 'africansecurity', 'AfricaIntel', 'CrisisGroup', 'KSUcountrywide', 'kenyan_news_panel',
  'sikikaroadsafety', 'citizentvke', 'nbs_television', 'tanzaniaupdates', 'ethiopianmonitor', 'hornobserver',
  'sudanwarupdates', 'azawad_news', 'maliinfos', 'Burkina24', 'Lefaso', 'tripoli_news', 'actualitecd',
  'ActuCameroun', 'TheCableNG', 'JoyNewsOnTV', 'Seneweb', 'Banouto',
];
function loadTelegramChannels() {
  const raw = process.env.RISK_INTEL_TELEGRAM_CHANNELS;
  if (!raw) return DEFAULT_TELEGRAM_CHANNELS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(c => typeof c === 'string' && c);
    if (parsed && typeof parsed === 'object') return [...new Set(Object.values(parsed).flatMap(v => Array.isArray(v) ? v : []).filter(Boolean))];
  } catch (e) { logger.warn(`Risk Intel OSINT: RISK_INTEL_TELEGRAM_CHANNELS invalid JSON: ${e.message}`); }
  return DEFAULT_TELEGRAM_CHANNELS;
}
const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
function decodeHtmlText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') { const cp = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole; }
    return HTML_ENTITIES[code.toLowerCase()] ?? whole;
  }).replace(/\s+/g, ' ').trim();
}
async function fetchTelegramChannelViaScrape(channel, cutoffMs) {
  const res = await fetch(`https://t.me/s/${encodeURIComponent(channel)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status} (${channel})`);
  const html = await res.text();
  const messages = [];
  for (const block of html.split('data-post="').slice(1)) {
    const idMatch = block.match(/^([^"]+)"/);
    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!idMatch || !timeMatch || !textMatch) continue;
    const postedMs = new Date(timeMatch[1]).getTime();
    if (!Number.isFinite(postedMs) || postedMs < cutoffMs) continue;
    const text = decodeHtmlText(textMatch[1]);
    if (text) messages.push({ id: idMatch[1], text });
  }
  return messages;
}
async function fetchTelegramChannelMessages(channel, cutoffMs) {
  if (telegramMtproto.isConfigured()) {
    try { return (await telegramMtproto.fetchChannelMessages(channel, cutoffMs)).map(m => ({ id: m.id, text: m.text })); }
    catch (e) { logger.warn(`Risk Intel OSINT: Telegram MTProto channel "${channel}" failed; using public-preview fallback: ${e.message}`); }
  }
  return fetchTelegramChannelViaScrape(channel, cutoffMs);
}
async function fetchAllTelegramMessages(channels) {
  const cutoffMs = Date.now() - 2 * 24 * 3600 * 1000;
  const candidates = [];
  for (const channel of channels) {
    try {
      const messages = await fetchTelegramChannelMessages(channel, cutoffMs);
      for (const msg of messages) {
        if (!HIGH_KEYWORDS.test(msg.text) && !MEDIUM_KEYWORDS.test(msg.text)) continue;
        candidates.push({ channel, text: msg.text, source_url: `https://t.me/${msg.id}`, external_id: `telegram:${msg.id}` });
      }
    } catch (e) { logger.warn(`Risk Intel OSINT: Telegram channel "${channel}" failed: ${e.message}`); }
  }
  return candidates;
}

const TELEGRAM_REWRITE_MAX_MESSAGES = 40;
async function rewriteAndLocateTelegramMessages(candidates) {
  if (!candidates.length) return [];
  const batch = candidates.slice(0, TELEGRAM_REWRITE_MAX_MESSAGES);
  const list = batch.map((c, i) => `${i}. [channel: ${c.channel}] ${c.text}`).join('\n');
  const response = await aiClient.createMessage({
    model: MODEL, max_tokens: 4000,
    system: 'You are an OSINT security analyst. Respond with raw JSON only — no markdown fences, no commentary.',
    messages: [{ role: 'user', content: `For EACH numbered raw Telegram post: rewrite it as one factual sentence; extract the most specific real place (city/town/region plus country) or null; classify severity high/medium/low. Posts:\n${list}\nReply ONLY with a JSON array of exactly ${batch.length} objects: [{"i":0,"text":"...","place":"City, Country"|null,"level":"high"|"medium"|"low"}]` }],
  });
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(text); } catch { logger.warn(`Risk Intel OSINT: Telegram rewrite response unparseable: ${text.slice(0, 300)}`); return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(item => {
    const src = batch[item?.i];
    if (!src || !item?.text) return null;
    return { ...src, formalText: String(item.text).slice(0, 500), place: item.place || null, level: ['high','medium','low'].includes(item.level) ? item.level : 'medium' };
  }).filter(Boolean);
}

const AUTO_ZONE_MATCH_RADIUS_KM = 150;
const AUTO_ZONE_DEFAULT_RADIUS_KM = 75;
const AUTO_ZONE_DEFAULT_CONFIDENCE = 55;
function slugForZoneCode(place, country) {
  const base = (place || country || 'zone').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'ZNE';
  const hash = crypto.createHash('sha1').update(`${place}|${country}`.toLowerCase()).digest('hex').slice(0, 5).toUpperCase();
  return `AUTO-${base}-${hash}`;
}
async function resolveOrCreateZoneForLocation(orgId, zonesForOrg, { lat, lng, country, continent, place, level }) {
  const existing = zonesForOrg.find(z => Number.isFinite(Number(z.lat)) && Number.isFinite(Number(z.lng)) && haversineKm(lat, lng, Number(z.lat), Number(z.lng)) <= AUTO_ZONE_MATCH_RADIUS_KM);
  if (existing) return existing;
  const zoneCode = slugForZoneCode(place, country);
  const name = place || country;
  const { rows } = await query(`INSERT INTO risk_zones (org_id, zone_code, name, zone_type, continent, level, region, why, when_active, precaution, tags, map_lon, map_lat, confidence, velocity, is_active, active, lat, lng, radius_km, risk_level, level_source) VALUES ($1,$2,$3,'conflict',$4,$5,$6,$7,'Ongoing — auto-detected','Verify independently before route planning.',ARRAY['auto-detected'],$8,$9,$10,'stable',true,true,$11,$12,$13,$5,'auto') ON CONFLICT (zone_code, org_id) DO NOTHING RETURNING *`, [orgId, zoneCode, name, continent, level, country, `Auto-detected from live Telegram OSINT reporting near ${name}.`, lng, lat, AUTO_ZONE_DEFAULT_CONFIDENCE, lat, lng, AUTO_ZONE_DEFAULT_RADIUS_KM]);
  let zone = rows[0];
  if (!zone) {
    const { rows: existingRows } = await query('SELECT * FROM risk_zones WHERE org_id=$1 AND zone_code=$2', [orgId, zoneCode]);
    zone = existingRows[0];
  }
  if (zone) zonesForOrg.push(zone);
  return zone || null;
}

async function fetchClaudeForZones(zones) {
  const zoneList = zones.map(z => `- ${z.id}: ${[z.name, z.region, z.continent].filter(Boolean).join(', ')}`).join('\n');
  const response = await aiClient.createMessage({
    model: MODEL, max_tokens: 6000,
    system: 'You are an OSINT security analyst. Respond with raw JSON only — no markdown fences, no commentary.',
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 20 }],
    messages: [{ role: 'user', content: `For EACH zone below, search the web for credible news from the last 48 hours about security incidents affecting road/fleet travel there. Zones:\n${zoneList}\nReply ONLY with JSON mapping zone id to arrays of {"description":"factual sentence","level":"high"|"medium"|"low","source_url":"..."}.` }],
  }, { allowFallback: false });
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try { const parsed = JSON.parse(text); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch { logger.warn(`Risk Intel OSINT: Claude response unparseable: ${text.slice(0, 300)}`); return {}; }
}

async function insertEvents(zone, items) {
  let inserted = 0;
  for (const item of items) {
    if (!item?.description) continue;
    const externalId = item.external_id || (item.source_url ? crypto.createHash('sha1').update(item.source_url).digest('hex') : null);
    if (!externalId) continue;
    const level = ['high','medium','low'].includes(item.level) ? item.level : 'medium';
    const { rowCount } = await query(`INSERT INTO risk_events (org_id, zone_id, description, level, source, external_url, external_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (zone_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`, [zone.org_id, zone.id, item.description.slice(0,500), level, item.source || 'osint', item.source_url || null, externalId]);
    inserted += rowCount;
  }
  return inserted;
}

let sweeping = false;
const isSweeping = () => sweeping;

async function runOsintSweep() {
  if (sweeping) return { skipped: true };
  sweeping = true;
  try {
    const { rows: zones } = await query(`SELECT id, org_id, name, region, continent, level, confidence, velocity, level_source, lat, lng FROM risk_zones WHERE is_active = true`);
    if (!zones.length) return { zonesChecked: 0 };

    const zonesByOrg = new Map();
    for (const z of zones) { if (!zonesByOrg.has(z.org_id)) zonesByOrg.set(z.org_id, []); zonesByOrg.get(z.org_id).push(z); }

    const claudeEnabled = process.env.RISK_INTEL_ENABLE_CLAUDE === 'true';
    let claudeByZone = {};
    if (claudeEnabled && aiClient.hasAnthropic()) {
      try { claudeByZone = await fetchClaudeForZones(zones); }
      catch (e) { logger.warn(`Risk Intel OSINT: Claude web search sweep failed: ${e.message}`); }
    }

    let acledToken = null;
    try { acledToken = await getAcledToken(); }
    catch (e) { logger.warn(`Risk Intel OSINT: ACLED auth failed: ${e.message}`); }

    let gdacsFeatures = [];
    try { gdacsFeatures = await fetchGdacsEvents(); }
    catch (e) { logger.warn(`Risk Intel OSINT: GDACS sweep failed: ${e.message}`); }

    const extraRssFeeds = loadExtraRssFeeds();
    const orgsTouched = new Set();
    let totalInserted = 0;

    const telegramChannels = loadTelegramChannels();
    let telegramCandidates = [];
    try { telegramCandidates = await fetchAllTelegramMessages(telegramChannels); }
    catch (e) { logger.warn(`Risk Intel OSINT: Telegram fetch failed: ${e.message}`); }

    let telegramProcessed = 0;
    let telegramZonesCreated = 0;
    const telegramAIAvailable = aiClient.hasAnthropic() || aiClient.hasGroqFallback();
    if (telegramCandidates.length && telegramAIAvailable) {
      try {
        const located = await rewriteAndLocateTelegramMessages(telegramCandidates);
        for (const item of located) {
          if (!item.place) continue;
          const geo = await geocodePlace(item.place);
          if (!geo) continue;
          const continent = continentForCountry(geo.country);
          if (!continent) continue;
          for (const [orgId, orgZones] of zonesByOrg) {
            const before = orgZones.length;
            const zone = await resolveOrCreateZoneForLocation(orgId, orgZones, { lat: geo.lat, lng: geo.lng, country: geo.country, continent, place: item.place, level: item.level });
            if (!zone) continue;
            if (orgZones.length > before) { zones.push(zone); telegramZonesCreated++; }
            const inserted = await insertEvents(zone, [{ description: item.formalText, level: item.level, source: 'osint:telegram', source_url: item.source_url, external_id: item.external_id }]);
            if (inserted) { orgsTouched.add(orgId); totalInserted += inserted; telegramProcessed++; }
          }
        }
      } catch (e) { logger.warn(`Risk Intel OSINT: Telegram rewrite/geolocation sweep failed: ${e.message}`); }
    }

    for (const zone of zones) {
      const found = [];
      try {
        const gdelt = await fetchGdeltForZone(zone);
        found.push(...gdelt);
      } catch (e) {
        if (Date.now() >= gdeltCooldownUntil) logger.warn(`Risk Intel OSINT: GDELT failed for "${zone.name}": ${e.message}`);
      }
      try { found.push(...await fetchReliefWebForZone(zone)); }
      catch (e) { logger.warn(`Risk Intel OSINT: ReliefWeb failed for "${zone.name}": ${e.message}`); }
      found.push(...matchGdacsToZone(zone, gdacsFeatures));
      if (acledToken) {
        try { found.push(...await fetchAcledForZone(zone, acledToken)); }
        catch (e) { logger.warn(`Risk Intel OSINT: ACLED failed for "${zone.name}": ${e.message}`); }
      }
      try { found.push(...await fetchAllAfricaForZone(zone)); }
      catch (e) { logger.warn(`Risk Intel OSINT: AllAfrica failed for "${zone.name}": ${e.message}`); }
      if (extraRssFeeds.length) {
        try { found.push(...await fetchExtraRssForZone(zone, extraRssFeeds)); }
        catch (e) { logger.warn(`Risk Intel OSINT: extra RSS failed for "${zone.name}": ${e.message}`); }
      }
      found.push(...(claudeByZone[zone.id] || []).map(it => ({ ...it, source: 'osint:claude' })));
      if (found.length) {
        const inserted = await insertEvents(zone, found);
        if (inserted) { orgsTouched.add(zone.org_id); totalInserted += inserted; }
      }
      await sleep(500);
    }

    for (const orgId of orgsTouched) await publish(`risk:updates:${orgId}`, { type: 'event_added', org_id: orgId }).catch(() => {});
    const zonesChanged = await recomputeZoneLevels(zones);
    logger.info(`Risk Intel OSINT sweep complete: ${zones.length} zones checked, ${totalInserted} new events, ${orgsTouched.size} orgs updated, ${zonesChanged} zone levels recomputed, gdelt=${Date.now() < gdeltCooldownUntil ? 'cooldown' : 'available'}, acled=${acledToken ? 'used' : 'skipped'}, telegram=${telegramProcessed ? `used (${telegramProcessed} placed, ${telegramZonesCreated} zones auto-created)` : 'fallback/none'}, mtproto=${telegramMtproto.isConfigured() ? 'on' : 'fallback'}, claude=${claudeEnabled && aiClient.hasAnthropic() ? 'used' : 'skipped'}`);
    return { zonesChecked: zones.length, totalInserted, orgsUpdated: orgsTouched.size, zonesChanged, acledUsed: !!acledToken, telegramUsed: telegramProcessed > 0, telegramZonesCreated, claudeUsed: claudeEnabled && aiClient.hasAnthropic() };
  } finally {
    sweeping = false;
    await telegramMtproto.disconnect();
  }
}

function computeZoneRisk(events) {
  const weight = lvl => (lvl === 'high' ? 3 : lvl === 'medium' ? 2 : 1);
  const hoursAgo = e => (Date.now() - new Date(e.occurred_at).getTime()) / 3600000;
  const last72h = events.filter(e => hoursAgo(e) <= 72);
  const highCount72h = last72h.filter(e => e.level === 'high').length;
  const mediumCount72h = last72h.filter(e => e.level === 'medium').length;
  let level = 'low';
  if (highCount72h >= 1 || mediumCount72h >= 3) level = 'high';
  else if (events.some(e => e.level === 'medium') || last72h.length >= 2) level = 'medium';
  const score7d = events.reduce((s,e) => s + weight(e.level), 0);
  const confidence = Math.max(40, Math.min(95, 40 + score7d * 8));
  const recentScore = last72h.reduce((s,e) => s + weight(e.level), 0);
  const priorScore = events.filter(e => hoursAgo(e) > 72).reduce((s,e) => s + weight(e.level), 0);
  let velocity = 'stable';
  if (recentScore > 0 && recentScore > priorScore * 1.3) velocity = 'rising';
  else if (recentScore < priorScore * 0.7) velocity = 'falling';
  return { level, confidence, velocity };
}
const LEVEL_RANK = { low: 1, medium: 2, high: 3 };
async function recomputeZoneLevels(zones) {
  const zoneIds = zones.map(z => z.id);
  if (!zoneIds.length) return 0;
  const { rows } = await query(`SELECT zone_id, level, occurred_at FROM risk_events WHERE zone_id = ANY($1::uuid[]) AND occurred_at >= now() - interval '7 days'`, [zoneIds]);
  const byZone = new Map();
  for (const r of rows) { if (!byZone.has(r.zone_id)) byZone.set(r.zone_id, []); byZone.get(r.zone_id).push(r); }
  const orgsTouched = new Set();
  let changed = 0;
  for (const zone of zones) {
    const computed = computeZoneRisk(byZone.get(zone.id) || []);
    let levelSource = zone.level_source;
    if (zone.level_source === 'manual' && LEVEL_RANK[computed.level] < LEVEL_RANK[zone.level]) computed.level = zone.level;
    else if (LEVEL_RANK[computed.level] > LEVEL_RANK[zone.level]) levelSource = 'auto';
    if (computed.level === zone.level && computed.confidence === zone.confidence && computed.velocity === zone.velocity && levelSource === zone.level_source) continue;
    await query(`UPDATE risk_zones SET level=$1, confidence=$2, velocity=$3, level_source=$4, updated_at=NOW() WHERE id=$5`, [computed.level, computed.confidence, computed.velocity, levelSource, zone.id]);
    orgsTouched.add(zone.org_id); changed++;
  }
  for (const orgId of orgsTouched) await publish(`risk:updates:${orgId}`, { type: 'zone_updated', org_id: orgId }).catch(() => {});
  return changed;
}

module.exports = { runOsintSweep, isSweeping };
