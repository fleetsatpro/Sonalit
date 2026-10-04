'use strict';

const GENERIC_PATTERNS = [
  /comprehensive up-to-date news coverage, aggregated from sources all over the world by google news/ig,
  /the current evidence does not justify filling those gaps with assumption/ig,
  /the event remains bounded by the evidence recorded in sonalit/ig,
  /evidence-derived event record retained; automated analytical synthesis is unavailable/ig,
  /automated ai synthesis unavailable; no unsupported inference added/ig,
  /a live research pass was then run against current web reporting rather than relying only on the original event record/ig,
  /the reporting record for .*? points to an incident in the reported area/ig,
  /the retrieved material broadly frames the incident through google news/ig,
  /the source material describes:/ig,
  /the operational significance turns on persistence, geographic reach, recurrence and independent corroboration/ig,
  /no corroborative web narrative was retrieved during this publication run/ig,
  /no event chronology was established by the research agent/ig,
  /research pass located \d+ usable source record\(s\)/ig,
  /the available record supports a bounded account of the development/ig,
  /details that cannot be established from the source base are not presented as fact/ig
];

const AGGREGATOR_DOMAINS = new Set([
  'news.google.com',
  'google.com',
  'bing.com',
  'search.yahoo.com',
  'news.yahoo.com'
]);

function decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripMarkup(value) {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForComparison(value) {
  return normalizeWhitespace(stripMarkup(value))
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\b(the|a|an|and|or|of|to|in|on|for|with|from|by|is|are|was|were|reported|reports|according|said|says|this|that|during|amid|after|before)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPublicationText(value, max=5000, {removeGeneric=true}={}) {
  let out = normalizeWhitespace(stripMarkup(value));
  if (removeGeneric) {
    for (const pattern of GENERIC_PATTERNS) out = out.replace(pattern, ' ');
    out = normalizeWhitespace(out);
  }
  return out.slice(0, max);
}

function sentenceParts(value) {
  const cleaned = cleanPublicationText(value, 20000);
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(s => normalizeWhitespace(s))
    .filter(Boolean);
}

function dedupeSentences(value, seen=new Set(), max=5000) {
  const out = [];
  for (const sentence of sentenceParts(value)) {
    const key = normalizeForComparison(sentence);
    if (!key || key.length < 12 || seen.has(key)) continue;
    seen.add(key);
    out.push(sentence);
    if (out.join(' ').length >= max) break;
  }
  return cleanPublicationText(out.join(' '), max);
}

function uniqueStrings(values, max=8) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const cleaned = cleanPublicationText(value, 1200);
    const key = normalizeForComparison(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeDomain(urlOrDomain) {
  try {
    const raw = String(urlOrDomain || '').trim();
    if (!raw) return '';
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL('https://' + raw);
    return url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return String(urlOrDomain || '').trim().toLowerCase().replace(/^www\./, '');
  }
}

function isAggregatorDomain(domain) {
  return AGGREGATOR_DOMAINS.has(normalizeDomain(domain));
}

function sourceTitleKey(title) {
  return normalizeForComparison(title)
    .replace(/\b(source|report|update|breaking|latest)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeSources(items, max=120) {
  const out = [];
  const seenUrl = new Set();
  const seenStory = new Set();
  const domainCounts = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const url = String(item?.url || '').trim();
    const domain = normalizeDomain(item?.domain || item?.source || url);
    const title = cleanPublicationText(item?.title || 'Source record', 400);
    const story = sourceTitleKey(title);
    if (!url || isAggregatorDomain(domain)) continue;
    const normalizedUrl = url.replace(/\/+$/, '');
    if (seenUrl.has(normalizedUrl)) continue;
    const storyKey = domain + '|' + story;
    if (story && seenStory.has(storyKey)) continue;

    const count = Number(domainCounts.get(domain) || 0);
    if (domain && count >= 3) continue;

    seenUrl.add(normalizedUrl);
    if (story) seenStory.add(storyKey);
    domainCounts.set(domain, count + 1);
    out.push({
      ...item,
      url,
      domain: domain || item?.domain || null,
      title
    });
    if (out.length >= max) break;
  }
  return out;
}

function sourceIsSubstantive(source) {
  if (!source || !source.url) return false;
  const domain = normalizeDomain(source.domain || source.url);
  if (!domain || isAggregatorDomain(domain)) return false;
  const title = cleanPublicationText(source.title || '', 400);
  const desc = cleanPublicationText(source.description || source.snippet || '', 1200);
  if (/comprehensive up-to-date news coverage, aggregated from sources all over the world/i.test(desc)) return false;
  if (source.kind === 'corroborative_discovery' && !title) return false;
  return Boolean(title || desc || cleanPublicationText(source.text || '', 600));
}

function auditPublicationContent(incidents){
  const seen=new Map();
  const duplicateSentences=[];
  let boilerplateHits=0;
  for(const incident of Array.isArray(incidents)?incidents:[]){
    for(const field of ['what_happened','context','assessment']){
      const value=String(incident?.[field]||'');
      for(const pattern of GENERIC_PATTERNS){
        if(pattern.test(value))boilerplateHits++;
        pattern.lastIndex=0;
      }
      for(const sentence of sentenceParts(value)){
        const key=normalizeForComparison(sentence);
        if(key.length<30)continue;
        const prior=seen.get(key);
        if(prior){
          duplicateSentences.push({
            sentence,
            first_incident:prior.incidentId,
            first_field:prior.field,
            duplicate_incident:String(incident?.event_id),
            duplicate_field:field
          });
        }else{
          seen.set(key,{incidentId:String(incident?.event_id),field});
        }
      }
    }
  }
  const uniqueDuplicates=[];
  const dupKeys=new Set();
  for(const item of duplicateSentences){
    const key=normalizeForComparison(item.sentence);
    if(dupKeys.has(key))continue;
    dupKeys.add(key);
    uniqueDuplicates.push(item);
  }
  return {
    passed:boilerplateHits===0&&uniqueDuplicates.length===0,
    boilerplate_hits:boilerplateHits,
    duplicate_sentence_count:uniqueDuplicates.length,
    duplicate_sentences:uniqueDuplicates.slice(0,10)
  };
}

function repetitionRatio(value) {
  const sentences = sentenceParts(value);
  if (sentences.length < 2) return 0;
  const keys = sentences.map(normalizeForComparison).filter(Boolean);
  const duplicates = keys.length - new Set(keys).size;
  return duplicates / Math.max(keys.length, 1);
}

module.exports = {
  GENERIC_PATTERNS,
  AGGREGATOR_DOMAINS,
  cleanPublicationText,
  dedupeSentences,
  uniqueStrings,
  normalizeForComparison,
  normalizeDomain,
  isAggregatorDomain,
  sourceTitleKey,
  dedupeSources,
  sourceIsSubstantive,
  repetitionRatio,
  auditPublicationContent
};
