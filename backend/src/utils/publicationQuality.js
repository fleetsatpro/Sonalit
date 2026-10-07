'use strict';

const GENERIC_PATTERNS = [
  /comprehensive up-to-date news coverage, aggregated from sources all over the world by google news[.!?]?/ig,
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

const REPETITIVE_TEMPLATE_PATTERNS = [
  /the (?:main|key|principal) operational (?:watchpoint|concern) is whether\b/ig,
  /\bmonitor whether .*? persists\b/ig,
  /\bmonitor .*? for persistence, spread or material operational consequence\b/ig,
  /\bmaintain routine monitoring .*? watch for corroboration or deterioration\b/ig,
  /\bthe current evidence set .*? decision-support input rather than a complete picture\b/ig
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

function isRepetitiveTemplateText(value) {
  const cleaned=normalizeWhitespace(value);
  if(!cleaned)return false;
  return REPETITIVE_TEMPLATE_PATTERNS.some(pattern=>{
    const hit=pattern.test(cleaned);
    pattern.lastIndex=0;
    return hit;
  });
}

function tokenSet(value) {
  return new Set(
    normalizeForComparison(value)
      .split(' ')
      .map(x => x.trim())
      .filter(x => x.length >= 3)
  );
}
function tokenJaccard(a,b) {
  const A=tokenSet(a), B=tokenSet(b);
  if(!A.size||!B.size)return 0;
  let intersection=0;
  for(const token of A)if(B.has(token))intersection++;
  return intersection/(A.size+B.size-intersection);
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
  const allSentences=[];
  const crossIncidentDuplicates=[];
  const intraIncidentRepeats=[];
  const nearDuplicates=[];
  let boilerplateHits=0;
  let repetitiveTemplateHits=0;
  const templateIncidents=new Map();

  for(const incident of Array.isArray(incidents)?incidents:[]){
    const incidentId=String(incident?.event_id);
    for(const field of ['what_happened','context','assessment']){
      const value=String(incident?.[field]||'');
      for(const pattern of GENERIC_PATTERNS){
        if(pattern.test(value))boilerplateHits++;
        pattern.lastIndex=0;
      }
      REPETITIVE_TEMPLATE_PATTERNS.forEach((pattern,index)=>{
        if(pattern.test(value)){
          repetitiveTemplateHits++;
          if(!templateIncidents.has(index))templateIncidents.set(index,new Set());
          templateIncidents.get(index).add(incidentId);
        }
        pattern.lastIndex=0;
      });
      for(const sentence of sentenceParts(value)){
        const key=normalizeForComparison(sentence);
        if(key.length<30)continue;
        const current={incidentId,field,sentence,key,tokens:key.split(' ').length};
        allSentences.push(current);
        const prior=seen.get(key);
        if(prior){
          const item={
            sentence,
            first_incident:prior.incidentId,
            first_field:prior.field,
            duplicate_incident:incidentId,
            duplicate_field:field,
            scope:prior.incidentId===incidentId?'intra_incident':'cross_incident'
          };
          if(prior.incidentId===incidentId)intraIncidentRepeats.push(item);
          else crossIncidentDuplicates.push(item);
        }else{
          seen.set(key,current);
        }
      }
    }
  }

  // Conservative near-duplicate detection. This catches lightly rephrased copy
  // across different incident dossiers without treating ordinary analytic language
  // as a blocker. Only long, information-bearing sentences are considered.
  for(let i=0;i<allSentences.length;i++){
    const a=allSentences[i];
    if(a.tokens<10)continue;
    for(let j=i+1;j<allSentences.length;j++){
      const b=allSentences[j];
      if(a.incidentId===b.incidentId||b.tokens<12)continue;
      if(Math.abs(a.tokens-b.tokens)>8)continue;
      const similarity=tokenJaccard(a.sentence,b.sentence);
      if(similarity<0.90)continue;
      nearDuplicates.push({
        first_incident:a.incidentId,
        first_field:a.field,
        first_sentence:a.sentence,
        duplicate_incident:b.incidentId,
        duplicate_field:b.field,
        duplicate_sentence:b.sentence,
        similarity:Number(similarity.toFixed(3))
      });
      if(nearDuplicates.length>=20)break;
    }
    if(nearDuplicates.length>=20)break;
  }

  const repeatedTemplateCount=Array.from(templateIncidents.values()).filter(set=>set.size>1).length;
  const uniqueByKey=(items,keyFn)=>Array.from(new Map(items.map(item=>[keyFn(item),item])).values());
  const exactCrossIncident=uniqueByKey(crossIncidentDuplicates,x=>normalizeForComparison(x.sentence));
  const intra=uniqueByKey(intraIncidentRepeats,x=>String(x.incidentId)+'|'+normalizeForComparison(x.sentence));
  const near=uniqueByKey(nearDuplicates,x=>String(x.first_incident)+'|'+String(x.duplicate_incident)+'|'+normalizeForComparison(x.first_sentence));

  return {
    passed:boilerplateHits===0&&exactCrossIncident.length===0&&near.length===0&&repeatedTemplateCount===0,
    boilerplate_hits:boilerplateHits,
    duplicate_sentence_count:exactCrossIncident.length,
    duplicate_sentences:exactCrossIncident.slice(0,10),
    intra_incident_repeat_count:intra.length,
    intra_incident_repeats:intra.slice(0,10),
    near_duplicate_sentence_count:near.length,
    near_duplicate_sentences:near.slice(0,10),
    repetitive_template_hits:repetitiveTemplateHits,
    repeated_template_count:repeatedTemplateCount
  };
}

function repetitionRatio(value) {
  const sentences = sentenceParts(value);
  if (sentences.length < 2) return 0;
  const keys = sentences.map(normalizeForComparison).filter(Boolean);
  const duplicates = keys.length - new Set(keys).size;
  return duplicates / Math.max(keys.length, 1);
}


function textLength(value) {
  return normalizeWhitespace(stripMarkup(value)).length;
}

function distinctDomains(items) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .map(x => normalizeDomain(x?.domain || x?.url || ''))
      .filter(Boolean)
  ).size;
}

function analyticalOverlap(a, b) {
  return tokenJaccard(a || '', b || '');
}

function assessPublicationQuality(body) {
  const report = body && typeof body === 'object' ? body : {};
  const blockers = [];
  const warnings = [];
  let score = 100;

  const executive = cleanPublicationText(report.executive_assessment || '', 2200);
  if (textLength(executive) < 280) {
    blockers.push('Executive assessment is too thin to establish a substantive senior judgement.');
    score -= 18;
  }

  const dossiers = Array.isArray(report.incident_dossiers) ? report.incident_dossiers : [];
  const deep = report.deep_research && typeof report.deep_research === 'object' ? report.deep_research : {};
  const requested = Number(deep.incidents_requested || dossiers.length || 0);
  const researched = Number(deep.incidents_researched || 0);
  const limited = Number(deep.incidents_researched_limited || 0);
  const fallbacks = Number(deep.incidents_fallback || 0);
  const researchComplete = requested === 0 || (researched >= requested && limited === 0 && fallbacks === 0);

  if (requested > 0 && !researchComplete) {
    blockers.push(`Deep research incomplete: ${researched}/${requested} priority incidents fully researched; ${limited} limited and ${fallbacks} fallback.`);
    score -= 30;
  }

  const dossierScores = [];
  for (const dossier of dossiers.slice(0, 8)) {
    let ds = 100;
    const narrative = cleanPublicationText(dossier.what_happened || dossier.brief || '', 3200);
    const context = cleanPublicationText(dossier.context || '', 1800);
    const assessment = cleanPublicationText(dossier.assessment || '', 1800);
    const facts = Array.isArray(dossier.key_facts) ? dossier.key_facts.filter(Boolean) : [];
    const why = Array.isArray(dossier.why_it_matters) ? dossier.why_it_matters.filter(Boolean) : [];
    const uncertainty = Array.isArray(dossier.caveats) ? dossier.caveats.filter(Boolean) : [];
    const sources = Array.isArray(dossier.research_sources) ? dossier.research_sources : [];

    if (textLength(narrative) < 260) { ds -= 20; blockers.push(`Incident ${dossier.event_id || dossier.id || 'unknown'} lacks a substantive narrative.`); }
    if (textLength(context) < 100) { ds -= 10; warnings.push(`Incident ${dossier.event_id || dossier.id || 'unknown'} has limited contextual explanation.`); }
    if (textLength(assessment) < 100) { ds -= 20; blockers.push(`Incident ${dossier.event_id || dossier.id || 'unknown'} lacks a substantive analytical judgement.`); }
    if (facts.length < 2) { ds -= 8; warnings.push(`Incident ${dossier.event_id || dossier.id || 'unknown'} has fewer than two explicit evidence-backed facts.`); }
    if (why.length < 1) { ds -= 10; blockers.push(`Incident ${dossier.event_id || dossier.id || 'unknown'} does not explain decision relevance.`); }
    if (uncertainty.length < 1) { ds -= 5; warnings.push(`Incident ${dossier.event_id || dossier.id || 'unknown'} has no explicit uncertainty statement.`); }
    if (String(dossier.research_status || '').toLowerCase() !== 'researched') {
      ds -= 35;
      blockers.push(`Incident ${dossier.event_id || dossier.id || 'unknown'} is not fully researched.`);
    }
    if (distinctDomains(sources) < 2) {
      ds -= 18;
      blockers.push(`Incident ${dossier.event_id || dossier.id || 'unknown'} lacks two independent research domains.`);
    }
    const overlap = analyticalOverlap(narrative, assessment);
    if (overlap > 0.72) {
      ds -= 15;
      blockers.push(`Incident ${dossier.event_id || dossier.id || 'unknown'} assessment substantially restates the incident narrative.`);
    }
    dossierScores.push(Math.max(0, ds));
  }

  if (dossierScores.length) {
    score -= Math.max(0, 100 - Math.round(dossierScores.reduce((a,b)=>a+b,0) / dossierScores.length)) * 0.38;
  }

  const outlook = Array.isArray(report.outlook) ? uniqueStrings(report.outlook, 6) : [];
  if (dossiers.length && outlook.length < 2) {
    blockers.push('Outlook must contain at least two distinct, evidence-grounded forward judgements.');
    score -= 12;
  }

  const gaps = Array.isArray(report.intelligence_gaps) ? report.intelligence_gaps : [];
  if (dossiers.length && gaps.length < 1) {
    warnings.push('Publication does not state material intelligence gaps.');
    score -= 4;
  }

  const trends = Array.isArray(report.emerging_trends) ? report.emerging_trends : [];
  const falseTrend = trends.some(x => { const a=String(x?.assessment||''); return x && x.basis !== 'PERIOD_COMPARISON' && /trend|increase|decrease|rise|fall|growth/i.test(a) && !/not (?:treated as )?a time-series trend/i.test(a); });
  if (falseTrend) {
    blockers.push('A current-period concentration is being expressed as a time-series trend without a baseline.');
    score -= 14;
  }

  const genericSentenceAudit = auditPublicationContent(
    dossiers.map(d => ({
      event_id:d.event_id || d.id,
      what_happened:d.what_happened || d.brief,
      context:d.context,
      assessment:d.assessment
    }))
  );
  if (genericSentenceAudit.boilerplate_hits || genericSentenceAudit.duplicate_sentence_count || genericSentenceAudit.near_duplicate_sentence_count || genericSentenceAudit.repeated_template_count) {
    blockers.push('Cross-dossier boilerplate or repeated analytical language detected.');
    score -= 20;
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    passed: blockers.length === 0 && finalScore >= 90,
    score: finalScore,
    threshold: 82,
    research_complete: researchComplete,
    dossier_count: dossiers.length,
    blocking_issues: blockers.slice(0, 30),
    warnings: warnings.slice(0, 30),
    dimensions: {
      executive_depth: textLength(executive),
      researched,
      requested_research: requested,
      limited_research: limited,
      fallbacks,
      dossier_average_score: dossierScores.length ? Math.round(dossierScores.reduce((a,b)=>a+b,0)/dossierScores.length) : null,
      outlook_items: outlook.length,
      intelligence_gap_items: gaps.length,
      generic_audit: genericSentenceAudit
    }
  };
}

module.exports = {
  GENERIC_PATTERNS,
  REPETITIVE_TEMPLATE_PATTERNS,
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
  auditPublicationContent,
  assessPublicationQuality,
  tokenJaccard,
  isRepetitiveTemplateText
};
