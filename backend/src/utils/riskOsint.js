// Risk Intel OSINT sweep: pulls real-world security incidents from three
// sources and inserts them as risk_events so zone activity reflects live
// media coverage instead of only manual admin entries.
//   - GDELT (free, no key): global news-monitoring index, geo/keyword search.
//   - ReliefWeb (free, no key): humanitarian/conflict situation reports.
//   - Claude web search (needs ANTHROPIC_API_KEY): broader synthesis across
//     the open web, covering breaking coverage the structured feeds miss.
// Every inserted row carries a source_url hashed into external_id so re-runs
// don't duplicate the same article (see risk_events_zone_external_uniq).
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
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

async function fetchGdeltForZone(zone) {
  const q = `"${zone.name}" (attack OR conflict OR violence OR kidnap OR ambush OR unrest OR clash OR insurgent OR banditry OR militant OR terrorist)`;
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
    if (!item?.description || !item?.source_url) continue;
    const level = ['high', 'medium', 'low'].includes(item.level) ? item.level : 'medium';
    const externalId = crypto.createHash('sha1').update(item.source_url).digest('hex');
    const { rowCount } = await query(
      `INSERT INTO risk_events (org_id, zone_id, description, level, source, external_url, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (zone_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
      [zone.org_id, zone.id, item.description.slice(0, 500), level, item.source || 'osint', item.source_url, externalId]
    );
    inserted += rowCount;
  }
  return inserted;
}

async function runOsintSweep() {
  const { rows: zones } = await query(
    `SELECT id, org_id, name, region, continent FROM risk_zones WHERE is_active = true`
  );
  if (!zones.length) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const client = (apiKey && apiKey.length >= 20) ? new Anthropic({ apiKey }) : null;
  if (!client) logger.warn('Risk Intel OSINT: skipping Claude web search — ANTHROPIC_API_KEY not configured');

  let claudeByZone = {};
  if (client) {
    try {
      claudeByZone = await fetchClaudeForZones(client, zones);
    } catch (e) {
      logger.warn(`Risk Intel OSINT: Claude web search sweep failed: ${e.message}`);
    }
  }

  const orgsTouched = new Set();
  let totalInserted = 0;

  for (const zone of zones) {
    const found = [];
    try { found.push(...await fetchGdeltForZone(zone)); }
    catch (e) { logger.warn(`Risk Intel OSINT: GDELT failed for "${zone.name}": ${e.message}`); }

    try { found.push(...await fetchReliefWebForZone(zone)); }
    catch (e) { logger.warn(`Risk Intel OSINT: ReliefWeb failed for "${zone.name}": ${e.message}`); }

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

  logger.info(`Risk Intel OSINT sweep complete: ${zones.length} zones checked, ${totalInserted} new events, ${orgsTouched.size} orgs updated`);
}

module.exports = { runOsintSweep };
