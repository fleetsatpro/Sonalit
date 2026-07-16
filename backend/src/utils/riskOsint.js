// Risk Intel OSINT sweep: pulls real-world security incidents from seven
// sources and inserts them as risk_events so zone activity reflects live
// ground coverage instead of only manual admin entries.
//   - GDELT (free, no key): global news-monitoring index, geo/keyword search.
//   - ReliefWeb (free, no key): humanitarian/conflict situation reports.
//   - GDACS (free, no key): real-time natural-hazard alerts (floods,
//     cyclones, quakes) matched to zones by distance, not keyword — this is
//     the only source here that isn't conflict/violence-focused.
//   - ACLED (needs ACLED_USERNAME/ACLED_PASSWORD, free myACLED registration):
//     event-coded political violence/protest data at village/road level —
//     catches incidents too small to make wire-service news, which is
//     exactly what GDELT/ReliefWeb (both built on published articles) miss.
//   - AllAfrica RSS (free, no key, Africa zones only): aggregates local
//     African outlets GDELT's international-wire bias tends to miss, plus
//     any extra feeds an org configures via RISK_INTEL_EXTRA_RSS_FEEDS for
//     other regions.
//   - Telegram public channels (verified starter list built in, override via
//     RISK_INTEL_TELEGRAM_CHANNELS): the fastest-moving grassroots layer in
//     a lot of these corridors, but only as trustworthy as the channels
//     behind it — treat the default as a baseline to curate further.
//   - Claude web search (needs ANTHROPIC_API_KEY): broader synthesis across
//     the open web, covering breaking coverage the structured feeds miss.
// Every inserted row carries a stable external_id (URL hash, or the
// source's own event/message id) so re-runs don't duplicate the same item
// (see risk_events_zone_external_uniq).
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { XMLParser } = require('fast-xml-parser');
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

// zone.name is a curated descriptive label ("Mokambo Crossing Banditry Zone",
// "Sahel Corridor (Mali-Niger)") that essentially never appears verbatim in
// news text — quoting the whole thing as one exact phrase (the previous
// query) reliably matched zero articles, for every zone, forever, regardless
// of whether anything newsworthy was happening there. zone.region holds a
// real place descriptor ("Northern Mali / Western Niger", "KPK Province,
// Pakistan") — split that into its individual place names and OR them
// together so GDELT has terms an actual article could plausibly contain.
function extractPlaceTerms(zone) {
  const source = zone.region || zone.name;
  const terms = source
    .split(/[\/,]/)
    .map(s => s.replace(/[()]/g, '').trim())
    .filter(Boolean)
    .slice(0, 4);
  return terms.length ? terms : [zone.name];
}

async function fetchGdeltForZone(zone) {
  const placeClause = '(' + extractPlaceTerms(zone).map(t => `"${t}"`).join(' OR ') + ')';
  const q = `${placeClause} (attack OR conflict OR violence OR kidnap OR ambush OR unrest OR clash OR insurgent OR banditry OR militant OR terrorist)`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=5&timespan=2d&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
  const data = await res.json();
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
  const q = zone.region || zone.name;
  const url = `https://api.reliefweb.int/v1/reports?appname=sonalit-risk-intel&query[value]=${encodeURIComponent(q)}` +
    `&query[operator]=AND&limit=5&sort[]=date.created:desc&fields[include][]=title&fields[include][]=url&fields[include][]=date.created`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`ReliefWeb HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data.data) ? data.data : [];
  const cutoffMs = Date.now() - 4 * 24 * 3600 * 1000; // situation reports post less often than news
  return items
    .filter(it => {
      const created = it.fields?.date?.created ? new Date(it.fields.date.created).getTime() : 0;
      return created >= cutoffMs;
    })
    .map(it => ({
      description: (it.fields?.title || '').slice(0, 500),
      level: classifyLevelFromKeywords(it.fields?.title || ''),
      source: 'osint:reliefweb',
      source_url: it.fields?.url,
    }))
    .filter(it => it.description && it.source_url);
}

// Several sources below (ACLED, AllAfrica RSS, Telegram) need an exact
// country match rather than GDELT's tolerant free-text keyword search —
// zone.region is free text ("Northern Mali / Western Niger", "KPK Province,
// Pakistan"), so pull out whichever known country name(s) appear in it,
// same idea as extractPlaceTerms() but matched against a fixed vocabulary
// instead of split on punctuation.
const COUNTRY_NAMES = [
  'Afghanistan', 'Bangladesh', 'Burkina Faso', 'Burundi', 'Cameroon', 'Central African Republic',
  'Chad', 'Colombia', 'Democratic Republic of Congo', 'Egypt', 'El Salvador', 'Ethiopia',
  'Ghana', 'Guatemala', 'Haiti', 'Honduras', 'India', 'Iraq', 'Kenya', 'Lebanon', 'Libya',
  'Mali', 'Mexico', 'Mozambique', 'Myanmar', 'Niger', 'Nigeria', 'Pakistan',
  'Papua New Guinea', 'Philippines', 'Rwanda', 'Senegal', 'Somalia', 'South Sudan', 'Sri Lanka',
  'Sudan', 'Syria', 'Tanzania', 'Uganda', 'Ukraine', 'Venezuela', 'Yemen', 'Zimbabwe',
];

function extractZoneCountries(zone) {
  // Word-boundary match, not plain substring — "Somalia" contains "Mali" and
  // "Nigeria" contains "Niger", so a naive .includes() misidentifies almost
  // every Nigeria/Somalia zone as also being in Mali/Niger. Prefer the
  // structured region field over the free-label name — "Niger Delta" is a
  // real place inside Nigeria, and matching zone.name too would misread it
  // as also naming the country Niger.
  const haystack = zone.region || zone.name || '';
  return COUNTRY_NAMES.filter(c => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack));
}

// GDACS matches by distance, not keyword — a flood/cyclone doesn't announce
// itself in a headline naming the zone. Fetched once per sweep as a global
// list rather than once per zone, since GDACS has no query-by-location.
const GDACS_ALERT_LEVEL = { Red: 'high', Orange: 'medium', Green: 'low' };

// GDACS events (floods, cyclones) span a much wider area than a single road
// corridor's own radius_km — 300km keeps this a "does this zone sit inside
// the affected region" check rather than a precise-radius one.
const GDACS_MATCH_RADIUS_KM = 300;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
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

  return features
    .filter(f => {
      const [lon, lat] = f.geometry?.coordinates || [];
      const withinRadius = hasCoords && Number.isFinite(lat) && Number.isFinite(lon)
        && haversineKm(zoneLat, zoneLng, lat, lon) <= GDACS_MATCH_RADIUS_KM;
      // A point/centroid distance check works for localised events (a quake
      // epicenter, one country's flood) but a multi-country drought's
      // "centroid" can land hundreds of km from any one affected zone even
      // though the zone's own country is squarely in the affected list —
      // so also match on GDACS's own affectedcountries, which is reliably
      // populated for every event type.
      const countryOverlap = zoneCountries.length > 0 && (f.properties?.affectedcountries || [])
        .some(c => zoneCountries.includes(String(c?.countryname || '').toLowerCase()));
      return withinRadius || countryOverlap;
    })
    .map(f => ({
      description: (f.properties?.name || f.properties?.description || '').slice(0, 500),
      level: GDACS_ALERT_LEVEL[f.properties?.alertlevel] || 'medium',
      source: 'osint:gdacs',
      source_url: f.properties?.url?.report,
      external_id: `gdacs:${f.properties?.eventtype}:${f.properties?.eventid}:${f.properties?.episodeid}`,
    }))
    .filter(it => it.description);
}

const ACLED_HIGH_TYPES = new Set(['Battles', 'Violence against civilians', 'Explosions/Remote violence']);

function classifyAcledLevel(item) {
  const fatalities = parseInt(item.fatalities, 10) || 0;
  if (fatalities >= 1 || ACLED_HIGH_TYPES.has(item.event_type)) return 'high';
  if (item.event_type === 'Riots' || item.disorder_type === 'Political violence') return 'medium';
  return 'low';
}

// Access token is memory-only and re-requested (not refreshed) each time it's
// stale — the sweep runs at most once per 2h, so re-authenticating well
// under the 24h token lifetime costs one extra request per cycle at most.
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
    body: new URLSearchParams({
      username, password, grant_type: 'password', client_id: 'acled', scope: 'authenticated',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ACLED OAuth HTTP ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('ACLED OAuth response missing access_token');

  _acledToken = data.access_token;
  // Renew 5 minutes early rather than racing the exact expiry.
  _acledTokenExpiresAt = Date.now() + (Math.max(60, (data.expires_in || 86400) - 300)) * 1000;
  return _acledToken;
}

async function fetchAcledForZone(zone, token) {
  const countries = extractZoneCountries(zone);
  if (!countries.length) return [];

  const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    _format: 'json',
    country: countries.join('|'),
    event_date: `${since}|${today}`,
    event_date_where: 'BETWEEN',
    limit: '5',
    fields: 'event_id_cnty|event_date|event_type|sub_event_type|disorder_type|country|location|notes|fatalities',
  });
  const url = `https://acleddata.com/api/acled/read?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`ACLED HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data.data) ? data.data : [];

  return items
    .filter(it => it.notes && it.event_id_cnty)
    .map(it => ({
      description: `${[it.event_type, it.location].filter(Boolean).join(' — ')}: ${it.notes.slice(0, 400)}`.slice(0, 500),
      level: classifyAcledLevel(it),
      source: 'osint:acled',
      external_id: `acled:${it.event_id_cnty}`,
    }));
}

// ─── RSS: AllAfrica (default, Africa zones) + org-configured extra feeds ─────
const xmlParser = new XMLParser({ ignoreAttributes: true });

async function fetchRssItems(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status} (${url})`);
  const xml = await res.text();
  const items = xmlParser.parse(xml)?.rss?.channel?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// AllAfrica/GDELT-style feeds are general country news, not pre-filtered to
// security incidents the way GDELT's query is — keep only items whose title
// actually trips the same keyword lists the other sources classify with,
// so a country's ordinary news doesn't flood risk_events.
function rssItemsToEvents(items, source) {
  const cutoffMs = Date.now() - 2 * 24 * 3600 * 1000;
  return items
    .filter(it => {
      const title = String(it.title || '');
      const pub = it.pubDate ? new Date(it.pubDate).getTime() : 0;
      return it.link && pub >= cutoffMs && (HIGH_KEYWORDS.test(title) || MEDIUM_KEYWORDS.test(title));
    })
    .map(it => ({
      description: String(it.title).slice(0, 500),
      level: classifyLevelFromKeywords(String(it.title)),
      source,
      source_url: it.link,
    }));
}

// AllAfrica publishes one feed per country at a predictable slug. This only
// covers Africa zones (continent field) and only the countries whose slug
// is just the lowercased name with spaces hyphenated — an unrecognised or
// wrong slug 404s and is skipped for that zone rather than failing the sweep.
async function fetchAllAfricaForZone(zone) {
  if (zone.continent !== 'africa') return [];
  const countries = extractZoneCountries(zone);
  if (!countries.length) return [];

  const found = [];
  for (const country of countries) {
    const slug = country.toLowerCase().replace(/\s+/g, '-');
    try {
      const items = await fetchRssItems(`https://allafrica.com/tools/headlines/rdf/${slug}/headlines.rdf`);
      found.push(...rssItemsToEvents(items, 'osint:allafrica'));
    } catch (e) {
      logger.warn(`Risk Intel OSINT: AllAfrica feed failed for "${country}": ${e.message}`);
    }
  }
  return found;
}

// Orgs can point at any additional region-specific outlet RSS feeds beyond
// AllAfrica's Africa coverage, e.g.:
//   RISK_INTEL_EXTRA_RSS_FEEDS=[{"country":"Pakistan","url":"https://..."}]
// Nothing is fetched unless explicitly configured — hyperlocal/regional
// outlets aren't something safe to guess and hardcode into every deploy.
function loadExtraRssFeeds() {
  const raw = process.env.RISK_INTEL_EXTRA_RSS_FEEDS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(f => f?.country && f?.url) : [];
  } catch (e) {
    logger.warn(`Risk Intel OSINT: RISK_INTEL_EXTRA_RSS_FEEDS is not valid JSON: ${e.message}`);
    return [];
  }
}

async function fetchExtraRssForZone(zone, feeds) {
  if (!feeds.length) return [];
  const countries = extractZoneCountries(zone).map(c => c.toLowerCase());
  const matching = feeds.filter(f => countries.includes(String(f.country).toLowerCase()));

  const found = [];
  for (const feed of matching) {
    try {
      const items = await fetchRssItems(feed.url);
      found.push(...rssItemsToEvents(items, 'osint:rss'));
    } catch (e) {
      logger.warn(`Risk Intel OSINT: extra RSS feed failed for "${feed.country}" (${feed.url}): ${e.message}`);
    }
  }
  return found;
}

// ─── Telegram public channels (org-curated) ──────────────────────────────────
// Scrapes the public https://t.me/s/<channel> preview page — no bot/API key
// needed, works for any channel with public preview enabled.
//
// DEFAULT_TELEGRAM_CHANNELS below ships a starter list, each handle checked
// against the live preview before being added (several plausible-looking
// guesses resolved to the wrong channel — a squatted/for-sale username, an
// unrelated channel, an apparent impersonator — and were deliberately left
// out; see conversation/PR history for the full verification pass). Keys are
// lowercased country names (matched via extractZoneCountries), plus two
// special keys:
//   '*'      — applies to every zone regardless of country/continent
//   'africa' — applies to every zone on that continent
// Set RISK_INTEL_TELEGRAM_CHANNELS (same shape) to replace this default
// entirely with your own list — a channel is only as trustworthy as
// whoever picked it, so treat the starter list as a baseline to curate
// further, not a finished one.
const DEFAULT_TELEGRAM_CHANNELS = {
  '*': ['IntelSlava', 'osint613'],
  africa: ['africaintelligence', 'africansecurity'],
  kenya: ['KSUcountrywide', 'kenyan_news_panel', 'sikikaroadsafety'],
  uganda: ['nbs_television'],
  tanzania: ['tanzaniaupdates'],
  ethiopia: ['ethiopianmonitor'],
  somalia: ['hornobserver'],
  sudan: ['sudanwarupdates'],
  mali: ['azawad_news', 'maliinfos'],
  'burkina faso': ['Burkina24'],
  libya: ['tripoli_news'],
};

function loadTelegramChannels() {
  const raw = process.env.RISK_INTEL_TELEGRAM_CHANNELS;
  if (!raw) return DEFAULT_TELEGRAM_CHANNELS;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const normalised = {};
    for (const [key, channels] of Object.entries(parsed)) {
      if (Array.isArray(channels)) normalised[key === '*' ? '*' : key.toLowerCase()] = channels;
    }
    return normalised;
  } catch (e) {
    logger.warn(`Risk Intel OSINT: RISK_INTEL_TELEGRAM_CHANNELS is not valid JSON: ${e.message}`);
    return DEFAULT_TELEGRAM_CHANNELS;
  }
}

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', "#39": "'", apos: "'", nbsp: ' ' };

function decodeHtmlText(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === '#') {
        const cp = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
      }
      return HTML_ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// The public preview page has no JSON API — each message is bounded by its
// own data-post="channel/id" marker, so split on that to get one block per
// message rather than parsing full HTML/DOM. A message that itself embeds a
// reply-preview referencing another data-post can truncate early; acceptable
// for a supplementary, org-curated source rather than the sweep's primary one.
async function fetchTelegramChannel(channel) {
  const res = await fetch(`https://t.me/s/${encodeURIComponent(channel)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status} (${channel})`);
  const html = await res.text();
  const cutoffMs = Date.now() - 2 * 24 * 3600 * 1000;

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

async function fetchTelegramForZone(zone, channelsByCountry) {
  const countries = extractZoneCountries(zone).map(c => c.toLowerCase());
  const channels = new Set();
  for (const ch of channelsByCountry['*'] || []) channels.add(ch);
  if (zone.continent) {
    for (const ch of channelsByCountry[zone.continent.toLowerCase()] || []) channels.add(ch);
  }
  for (const country of countries) {
    for (const ch of channelsByCountry[country] || []) channels.add(ch);
  }
  if (!channels.size) return [];

  const found = [];
  for (const channel of channels) {
    try {
      const messages = await fetchTelegramChannel(channel);
      for (const msg of messages) {
        if (!HIGH_KEYWORDS.test(msg.text) && !MEDIUM_KEYWORDS.test(msg.text)) continue;
        found.push({
          description: msg.text.slice(0, 500),
          level: classifyLevelFromKeywords(msg.text),
          source: 'osint:telegram',
          source_url: `https://t.me/${msg.id}`,
          external_id: `telegram:${msg.id}`,
        });
      }
    } catch (e) {
      logger.warn(`Risk Intel OSINT: Telegram channel "${channel}" failed: ${e.message}`);
    }
  }
  return found;
}

async function createMessageWithRetry(client, params, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      const isOverloaded = err?.status === 529 || (err?.message || '').includes('Overloaded');
      if (isOverloaded && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
        continue;
      }
      throw err;
    }
  }
}

// One batched call covering every zone, rather than one call per zone —
// keeps the web-search tool budget (and Anthropic API cost) bounded
// regardless of how many risk zones exist.
async function fetchClaudeForZones(client, zones) {
  const zoneList = zones.map(z => `- ${z.id}: ${[z.name, z.region, z.continent].filter(Boolean).join(', ')}`).join('\n');

  const response = await createMessageWithRetry(client, {
    model: MODEL,
    max_tokens: 6000,
    system: 'You are an OSINT security analyst. Respond with raw JSON only — no markdown fences, no commentary before or after.',
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 20 }],
    messages: [{
      role: 'user',
      content: `For EACH zone below, search the web for credible news from the last 48 hours about security incidents affecting road/fleet travel there: armed conflict, banditry, kidnapping, roadblocks, protests/unrest, terrorism, ambushes.

Zones (id: name, region):
${zoneList}

Reply with ONLY a JSON object mapping zone id -> array of up to 3 items found (omit ids with nothing credible from the last 48h). Each item: {"description": "one factual sentence, no speculation", "level": "high"|"medium"|"low", "source_url": "..."}`,
    }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const cleaned = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    logger.warn(`Risk Intel OSINT: Claude response unparseable: ${cleaned.slice(0, 300)}`);
    return {};
  }
}

async function insertEvents(zone, items) {
  let inserted = 0;
  for (const item of items) {
    if (!item?.description) continue;
    // Most sources dedupe off a hash of their article URL; ACLED has no
    // stable per-event public URL, so it supplies its own external_id
    // (namespaced 'acled:...') directly instead.
    const externalId = item.external_id
      || (item.source_url ? crypto.createHash('sha1').update(item.source_url).digest('hex') : null);
    if (!externalId) continue;
    const level = ['high', 'medium', 'low'].includes(item.level) ? item.level : 'medium';
    const { rowCount } = await query(
      `INSERT INTO risk_events (org_id, zone_id, description, level, source, external_url, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (zone_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
      [zone.org_id, zone.id, item.description.slice(0, 500), level, item.source || 'osint', item.source_url || null, externalId]
    );
    inserted += rowCount;
  }
  return inserted;
}

// Guards against an admin-triggered manual refresh overlapping with the
// scheduled cron sweep (or another manual click) — both call runOsintSweep().
let sweeping = false;
const isSweeping = () => sweeping;

async function runOsintSweep() {
  if (sweeping) {
    logger.warn('Risk Intel OSINT sweep already in progress — skipping this trigger');
    return { skipped: true };
  }
  sweeping = true;
  try {
    const { rows: zones } = await query(
      `SELECT id, org_id, name, region, continent, level, confidence, velocity, level_source, lat, lng FROM risk_zones WHERE is_active = true`
    );
    if (!zones.length) return { zonesChecked: 0 };

    // Claude web search is a supplementary third source, not the sweep's
    // load-bearing one — GDELT + ReliefWeb need no key/subscription and run
    // unconditionally below. This step used to run every cycle by default
    // (every 2h via cron, plus every manual "Refresh Intel" click) purely
    // because a key happened to be configured, silently burning Anthropic
    // usage even though the free sources cover the same ground. Opt in
    // explicitly via RISK_INTEL_ENABLE_CLAUDE=true if the broader synthesis
    // is worth the cost for your org.
    const claudeEnabled = process.env.RISK_INTEL_ENABLE_CLAUDE === 'true';
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const client = (claudeEnabled && apiKey && apiKey.length >= 20) ? new Anthropic({ apiKey }) : null;
    if (claudeEnabled && !client) logger.warn('Risk Intel OSINT: skipping Claude web search — ANTHROPIC_API_KEY not configured');

    let claudeByZone = {};
    if (client) {
      try {
        claudeByZone = await fetchClaudeForZones(client, zones);
      } catch (e) {
        logger.warn(`Risk Intel OSINT: Claude web search sweep failed: ${e.message}`);
      }
    }

    // ACLED needs a myACLED account (ACLED_USERNAME/ACLED_PASSWORD) — like
    // Claude, it's an optional add-on source, not required for the sweep to
    // run. One token covers every zone this cycle.
    let acledToken = null;
    try {
      acledToken = await getAcledToken();
      if (!acledToken) logger.warn('Risk Intel OSINT: skipping ACLED — ACLED_USERNAME/ACLED_PASSWORD not configured');
    } catch (e) {
      logger.warn(`Risk Intel OSINT: ACLED auth failed: ${e.message}`);
    }

    // GDACS needs no key/subscription, same tier as GDELT/ReliefWeb — one
    // global fetch, then matched to each zone by distance below.
    let gdacsFeatures = [];
    try {
      gdacsFeatures = await fetchGdacsEvents();
    } catch (e) {
      logger.warn(`Risk Intel OSINT: GDACS sweep failed: ${e.message}`);
    }

    const extraRssFeeds = loadExtraRssFeeds();
    const telegramChannels = loadTelegramChannels();
    const telegramConfigured = Object.keys(telegramChannels).length > 0;

    const orgsTouched = new Set();
    let totalInserted = 0;

    for (const zone of zones) {
      const found = [];
      try { found.push(...await fetchGdeltForZone(zone)); }
      catch (e) { logger.warn(`Risk Intel OSINT: GDELT failed for "${zone.name}": ${e.message}`); }

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

      if (telegramConfigured) {
        try { found.push(...await fetchTelegramForZone(zone, telegramChannels)); }
        catch (e) { logger.warn(`Risk Intel OSINT: Telegram failed for "${zone.name}": ${e.message}`); }
      }

      found.push(...(claudeByZone[zone.id] || []).map(it => ({ ...it, source: 'osint:claude' })));

      if (found.length) {
        const inserted = await insertEvents(zone, found);
        if (inserted > 0) { orgsTouched.add(zone.org_id); totalInserted += inserted; }
      }
      await new Promise(r => setTimeout(r, 500)); // stay polite to the free public APIs
    }

    for (const orgId of orgsTouched) {
      await publish(`risk:updates:${orgId}`, { type: 'event_added', org_id: orgId }).catch(() => {});
    }

    const zonesChanged = await recomputeZoneLevels(zones);

    logger.info(`Risk Intel OSINT sweep complete: ${zones.length} zones checked, ${totalInserted} new events, ${orgsTouched.size} orgs updated, ${zonesChanged} zone levels recomputed, gdacs=${gdacsFeatures.length ? 'used' : 'skipped'}, acled=${acledToken ? 'used' : 'skipped'}, telegram=${telegramConfigured ? 'used' : 'skipped'}, claude=${client ? 'used' : 'skipped'}`);
    return {
      zonesChecked: zones.length, totalInserted, orgsUpdated: orgsTouched.size, zonesChanged,
      acledUsed: !!acledToken, telegramUsed: telegramConfigured, claudeUsed: !!client,
    };
  } finally {
    sweeping = false;
  }
}

// Derives a zone's level/confidence/velocity purely from the severity and
// recency of its own risk_events — run for every active zone each sweep
// (not just ones with new events this cycle) so a zone with no recent
// events for the level's cause step back down instead of staying pinned
// at whatever it was in a similar quiet period. Escalates on high-severity
// hits fast (72h window) and eases off gradually as the window empties.
function computeZoneRisk(events) {
  const weight = (lvl) => (lvl === 'high' ? 3 : lvl === 'medium' ? 2 : 1);
  const hoursAgo = (e) => (Date.now() - new Date(e.occurred_at).getTime()) / 3600000;
  const within = (hours) => events.filter(e => hoursAgo(e) <= hours);

  const last72h = within(72);
  const highCount72h = last72h.filter(e => e.level === 'high').length;
  const mediumCount72h = last72h.filter(e => e.level === 'medium').length;

  let level = 'low';
  if (highCount72h >= 1 || mediumCount72h >= 3) level = 'high';
  else if (events.some(e => e.level === 'medium') || last72h.length >= 2) level = 'medium';

  const score7d = events.reduce((s, e) => s + weight(e.level), 0);
  const confidence = Math.max(40, Math.min(95, 40 + score7d * 8));

  const recentScore = last72h.reduce((s, e) => s + weight(e.level), 0);
  const priorScore = events.filter(e => hoursAgo(e) > 72).reduce((s, e) => s + weight(e.level), 0);
  let velocity = 'stable';
  if (recentScore > 0 && recentScore > priorScore * 1.3) velocity = 'rising';
  else if (recentScore < priorScore * 0.7) velocity = 'falling';

  return { level, confidence, velocity };
}

const LEVEL_RANK = { low: 1, medium: 2, high: 3 };

async function recomputeZoneLevels(zones) {
  const zoneIds = zones.map(z => z.id);
  const { rows } = await query(
    `SELECT zone_id, level, occurred_at FROM risk_events
     WHERE zone_id = ANY($1::uuid[]) AND occurred_at >= now() - interval '7 days'`,
    [zoneIds]
  );
  const byZone = new Map();
  for (const r of rows) {
    if (!byZone.has(r.zone_id)) byZone.set(r.zone_id, []);
    byZone.get(r.zone_id).push(r);
  }

  const orgsTouched = new Set();
  let changed = 0;
  for (const zone of zones) {
    const computed = computeZoneRisk(byZone.get(zone.id) || []);
    let levelSource = zone.level_source;

    // An admin-set level is a floor, not just a starting point: the sweep
    // finding zero matching OSINT events for a zone means "we found no
    // evidence", not "this place is now safe" — a manually curated 'high'
    // (or the original seed data) must never get quietly wiped to 'low'
    // just because this cycle's searches came up empty. Once real evidence
    // pushes a zone's severity past that floor, it's under the sweep's
    // control from then on and can move both up and down with it.
    if (zone.level_source === 'manual' && LEVEL_RANK[computed.level] < LEVEL_RANK[zone.level]) {
      computed.level = zone.level;
    } else if (LEVEL_RANK[computed.level] > LEVEL_RANK[zone.level]) {
      levelSource = 'auto';
    }

    if (computed.level === zone.level && computed.confidence === zone.confidence && computed.velocity === zone.velocity && levelSource === zone.level_source) continue;
    await query(
      `UPDATE risk_zones SET level = $1, confidence = $2, velocity = $3, level_source = $4, updated_at = NOW() WHERE id = $5`,
      [computed.level, computed.confidence, computed.velocity, levelSource, zone.id]
    );
    orgsTouched.add(zone.org_id);
    changed++;
  }

  for (const orgId of orgsTouched) {
    await publish(`risk:updates:${orgId}`, { type: 'zone_updated', org_id: orgId }).catch(() => {});
  }
  return changed;
}

module.exports = { runOsintSweep, isSweeping };
