const { cleanPublicationText, dedupeSentences, uniqueStrings, dedupeSources: dedupeQualitySources, auditPublicationContent, isRepetitiveTemplateText } = require('./publicationQuality');

const COUNTRY_NAMES = { KE:'Kenya', SO:'Somalia', ET:'Ethiopia', UG:'Uganda', TZ:'Tanzania', RW:'Rwanda', BI:'Burundi', SS:'South Sudan', DJ:'Djibouti', ER:'Eritrea', SD:'Sudan', CD:'DR Congo' };
const SEVERITIES = ['critical','high','moderate','low','informational'];
const DOMAINS = ['POLITICAL','MILITARY','ECONOMY','SOCIAL','INFORMATION & MEDIA'];

function clean(v, n=1200) {
  return cleanPublicationText(v, n);
}
function severityScore(v) {
  return { critical:4, high:3, moderate:2, low:1, informational:0 }[String(v || '').toLowerCase()] == null
    ? 2
    : { critical:4, high:3, moderate:2, low:1, informational:0 }[String(v || '').toLowerCase()];
}
function eventType(e) {
  return String(e && e.intelligence_type || 'OTHER').toUpperCase();
}

function fallbackContext(e,type,region){
  const headline=clean(e?.headline||e?.title||'the recorded development',180);
  if(type==='LOGISTICS')return 'Operational context: '+headline+' is recorded in '+region+'. The key question is whether the disruption affects continuity, routing or delivery performance beyond the reported location.';
  if(type==='POLITICAL')return 'Political context: '+headline+' is recorded in '+region+'. The key question is whether the activity remains localized or develops into sustained disruption, institutional friction or wider mobilisation.';
  if(type==='NATURAL_HAZARD')return 'Hazard context: '+headline+' is recorded in '+region+'. The key question is whether conditions persist or expand into access, infrastructure, population or service impacts.';
  if(type==='ECONOMIC')return 'Economic context: '+headline+' is recorded in '+region+'. The key question is whether the reported development creates sustained pressure on commerce, supply, access or operating costs.';
  if(type==='HEALTH')return 'Health context: '+headline+' is recorded in '+region+'. The key question is whether the reported condition persists, spreads or creates material access and continuity consequences.';
  return 'Security context: '+headline+' is recorded in '+region+'. The key question is whether the signal remains isolated or is corroborated by recurrence, wider geographic reach or a material change in operating conditions.';
}
function domainFor(e) {
  const t = eventType(e);
  if (t === 'POLITICAL') return 'POLITICAL';
  if (t === 'SECURITY' || t === 'MARITIME' || t === 'BORDER') return 'MILITARY';
  if (t === 'ECONOMIC' || t === 'LOGISTICS') return 'ECONOMY';
  if (t === 'NATURAL_HAZARD' || t === 'HEALTH' || t === 'CRIME') return 'SOCIAL';
  const text = clean((e && (e.headline || e.title)) || '').toLowerCase();
  if (/cyber|information|media|internet|misinformation|disinformation|data breach/.test(text)) return 'INFORMATION & MEDIA';
  return 'SOCIAL';
}
function formatDate(v,timeZone=process.env.INTEL_PUBLICATION_TIMEZONE||'Africa/Nairobi') {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', timeZone });
}
function formatPeriod(start, end, timeZone) {
  return formatDate(start,timeZone) + ' — ' + formatDate(new Date(new Date(end).getTime() - 1),timeZone);
}
function sourceRefs(e) {
  return (Array.isArray(e && e.evidence) ? e.evidence : [])
    .map(o => ({
      observation_id: o.id,
      source_id: o.source_id,
      source: clean(o.source_name || o.source || 'Unattributed source', 140),
      title: clean(o.title || 'Evidence record', 240),
      url: o.url || null,
      observed_at: o.observed_at || null,
      published_at: o.published_at || null,
      credibility: Number(o.credibility || 0) || null,
    }))
    .filter(x => x.source || x.title);
}
function topEvents(events, n) {
  return events.slice().sort((a,b) => severityScore(b.severity) - severityScore(a.severity) || new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0)).slice(0,n);
}
function posture(events, confidence) {
  const counts = { critical:0, high:0, moderate:0, low:0, informational:0 };
  for (const e of events) counts[String(e.severity || 'moderate').toLowerCase()] = (counts[String(e.severity || 'moderate').toLowerCase()] || 0) + 1;
  const score = counts.critical ? 'CRITICAL' : counts.high ? 'HIGH' : counts.moderate ? 'MODERATE' : counts.low ? 'LOW' : 'INFORMATIONAL';
  const velocities = events.map(e => Number(e.risk_velocity || 0)).filter(Number.isFinite);
  const avgVelocity = velocities.length ? velocities.reduce((a,b)=>a+b,0) / velocities.length : 0;
  const trajectory = avgVelocity > 0.25 ? 'RISING' : avgVelocity < -0.25 ? 'FALLING' : 'STABLE';
  return {
    level: score,
    confidence: Math.round(confidence || 0),
    change: 'CURRENT PERIOD · ' + events.length + ' EVENTS',
    trajectory,
    counts,
    rationale: events.length
      ? 'Posture is derived from the severity distribution and confidence of the stored event ledger; it is not an assertion that the reporting period captured every incident.'
      : 'No event objects were recorded by the current collection and fusion pipeline for this period.'
  };
}
function eventNarrative(e) {
  const research = e && e.research && e.research.agent ? e.research.agent : (e && e.research ? e.research : {});
  const brief = clean(research.narrative || e.brief || e.summary || e.headline || e.title || 'Evidence record available.', 4200);
  const severity = String(e.severity || 'moderate').toUpperCase();
  const type = eventType(e);
  const region = clean(e.region || 'Location not specified', 160);
  const evidence = Number(e.observation_count || (Array.isArray(e.evidence) ? e.evidence.length : 0));
  const sources = Number(e.source_count || new Set((Array.isArray(e.evidence) ? e.evidence : []).map(x => x.source_id).filter(Boolean)).size);
  const keyFacts = Array.isArray(research.confirmed_facts) && research.confirmed_facts.length ? research.confirmed_facts.map(x => clean(x,650)).filter(Boolean).slice(0,6) : (Array.isArray(e.key_facts) ? e.key_facts.map(x => clean(x,500)).filter(Boolean).slice(0,6) : []);
  const rawWhy = Array.isArray(research.why_it_matters) && research.why_it_matters.length
    ? research.why_it_matters.map(x => clean(x,800)).filter(Boolean)
    : (Array.isArray(e.why_it_matters) ? e.why_it_matters.map(x => clean(x,700)).filter(Boolean) : []);
  const why = rawWhy.filter(x => !isRepetitiveTemplateText(x)).slice(0,5);
  const rawCaveats = Array.isArray(research.uncertainty) && research.uncertainty.length
    ? research.uncertainty.map(x => clean(x,800)).filter(Boolean)
    : (Array.isArray(e.caveats) ? e.caveats.map(x => clean(x,700)).filter(Boolean) : []);
  const caveats = rawCaveats.filter(x => !/^evidence coverage is limited to the sources linked to this event in sonalit\./i.test(x)).slice(0,5);
  const assessment = e.assessment && typeof e.assessment === 'object' ? e.assessment : {};
  const judgement = clean(research.analytical_assessment || assessment.judgement || assessment.headline || '', 1800);
  const upgradeTriggers = Array.isArray(assessment.upgrade_triggers) ? assessment.upgrade_triggers.map(x => clean(x,500)).filter(Boolean).slice(0,5) : [];
  const downgradeTriggers = Array.isArray(assessment.downgrade_triggers) ? assessment.downgrade_triggers.map(x => clean(x,500)).filter(Boolean).slice(0,5) : [];
  return {
    event_id: e.id,
    headline: clean(e.headline || e.title || 'Security development', 220),
    what_happened: dedupeSentences(brief, new Set(), 2400),
    key_facts: uniqueStrings(keyFacts, 5),
    assessment: judgement ? dedupeSentences(judgement, new Set(), 1000) : '',
    why_it_matters: why.length ? uniqueStrings(why, 4) : [],
    caveats: uniqueStrings(caveats, 4),
    context: research.context ? dedupeSentences(clean(research.context, 1800), new Set(), 1200) : '',
    reported_or_disputed: Array.isArray(research.reported_or_disputed) ? uniqueStrings(research.reported_or_disputed.map(x=>clean(x,900)), 4) : [],
    chronology: Array.isArray(research.chronology) ? research.chronology.slice(0,8).map(x=>({time:clean(x?.time,120),event:clean(x?.event,700)})).filter(x=>x.time||x.event) : [],
    research_status: research.status || null,
    research_provider: research.provider || null,
    research_method: research.research_method || null,
    degraded_evidence_eligible: research.degraded_evidence_eligible === true,
    web_sources_retrieved: Number(research.web_sources_retrieved || 0) || 0,
    research_sources: Array.isArray(research.sources) ? dedupeQualitySources(research.sources.map(src => ({
      ...src,
      image_url: (() => {
        const hit = Array.isArray(e?.research?.packet?.fetched_pages)
          ? e.research.packet.fetched_pages.find(p => String(p.url||'')===String(src?.url||''))
          : null;
        return hit?.image_url || null;
      })()
    })), 8) : [],
    search_notes: clean(research.search_notes || '', 1200),
    outlook_triggers: { upgrade: upgradeTriggers, downgrade: downgradeTriggers },
    synthesis: { confidence: Number(e.synthesis_confidence || e.confidence || 0) || 0, provider: e.synthesis_provider || null },
    severity,
    confidence: Math.round(Number(e.confidence || 0) || 0),
    evidence_count: evidence,
    source_count: sources,
    region,
    latitude: Number.isFinite(Number(e.latitude)) ? Number(e.latitude) : null,
    longitude: Number.isFinite(Number(e.longitude)) ? Number(e.longitude) : null,
    occurred_from: e.occurred_from || null,
    occurred_to: e.occurred_to || null,
    source_refs: sourceRefs(e),
  };
}
function pmesi(events) {
  return DOMAINS.map(domain => {
    const candidates = events.filter(e => domainFor(e) === domain);
    const top = topEvents(candidates, 1)[0];
    if (!top) return { domain, status:'NO MATERIAL UPDATE', update:null, event_ids:[], confidence:null };
    return {
      domain,
      status: String(top.severity || 'moderate').toUpperCase(),
      update: candidates.length + ' recorded event(s); highest severity ' + String(top.severity || 'moderate').toUpperCase() + '. Key signal: ' + clean(top.headline || top.title || 'Unspecified development', 220) + '.',
      event_ids: candidates.slice(0,8).map(e => e.id),
      confidence: Number(top.confidence || 0) || null
    };
  });
}

function emergingTrends(events, baselineEvents=[]) {
  const counts = new Map();
  for (const e of events) {
    const key = eventType(e);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = Math.max(events.length, 1);
  const baseline = new Map();
  for (const e of Array.isArray(baselineEvents)?baselineEvents:[]) {
    const key = eventType(e);
    baseline.set(key,(baseline.get(key)||0)+1);
  }
  const hasBaseline=baseline.size>0;
  return Array.from(counts.entries())
    .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))
    .slice(0,5)
    .map(([theme,count]) => {
      const share=Math.round((count/total)*100);
      const previous=baseline.get(theme)||0;
      const delta=hasBaseline ? count-previous : null;
      return {
        theme,
        count,
        share_percent:share,
        previous_count:previous,
        change_delta:delta,
        basis:hasBaseline?'PERIOD_COMPARISON':'CURRENT_PERIOD_CONCENTRATION',
        assessment:hasBaseline
          ? `${theme} accounts for ${count} of ${events.length} recorded event objects, compared with ${previous} in the available baseline period (change: ${delta>=0?'+':''}${delta}).`
          : `${theme} accounts for ${count} of ${events.length} recorded event objects. This is a current-period concentration, not a time-series trend.`
      };
    });
}
function keyDrivers(events) {
  const drivers = [];
  const regions = new Map();
  const types = new Map();
  for (const e of events) {
    const region = clean(e.region || 'NATIONAL / UNALLOCATED', 100).toUpperCase();
    regions.set(region, (regions.get(region) || 0) + 1);
    const type = eventType(e);
    types.set(type, (types.get(type) || 0) + 1);
  }
  const topRegion = Array.from(regions.entries()).sort((a,b)=>b[1]-a[1])[0];
  const topType = Array.from(types.entries()).sort((a,b)=>b[1]-a[1])[0];
  if (topRegion) drivers.push({ driver:'Geographic concentration', evidence: `${topRegion[0]} contains ${topRegion[1]} of ${events.length} recorded event objects.` });
  if (topType) drivers.push({ driver:'Dominant intelligence theme', evidence: `${topType[0]} is the largest classified event category with ${topType[1]} recorded event object(s).` });
  const high = events.filter(e => severityScore(e.severity) >= 3).length;
  if (high) drivers.push({ driver:'Severity pressure', evidence: `${high} recorded event object(s) are assessed at high or critical severity.` });
  const corroborated = events.filter(e => Number(e.source_count || 0) >= 2).length;
  if (corroborated) drivers.push({ driver:'Corroboration', evidence: `${corroborated} recorded event object(s) have at least two distinct source records.` });
  return drivers.slice(0,5);
}
function publicSafetyOverview(events, postureState, confidence) {
  return {
    summary: events.length
      ? `${events.length} event object(s) were captured in the reporting period; the highest recorded posture is ${postureState.level}, with an average event confidence of ${Math.round(confidence || 0)}%.`
      : 'No event objects were captured in the reporting period; this is a collection statement rather than a claim of no incidents.',
    indicators: [
      { label:'RECORDED EVENTS', value:events.length },
      { label:'HIGH / CRITICAL', value:events.filter(e=>severityScore(e.severity)>=3).length },
      { label:'CORROBORATED', value:events.filter(e=>Number(e.source_count||0)>=2).length },
      { label:'MAPPED', value:events.filter(e=>Number.isFinite(Number(e.latitude))&&Number.isFinite(Number(e.longitude))).length }
    ],
    methodology:'Indicators are calculated only from the event and evidence fields available to this publication run.'
  };
}
function regionalNews(events) {
  const groups = new Map();
  const ordered = topEvents(events, events.length);
  for (const e of ordered) {
    const region = clean(e.region || 'NATIONAL / UNALLOCATED', 120).toUpperCase();
    if (!groups.has(region)) groups.set(region, []);
    const items = groups.get(region);
    if (items.length >= 5) continue;
    items.push({
      event_id:e.id,
      headline:clean(e.headline || e.title || 'Development', 240),
      severity:String(e.severity || 'moderate').toUpperCase(),
      confidence:Number(e.confidence || 0) || null,
      evidence_count:Number(e.observation_count || (Array.isArray(e.evidence)?e.evidence.length:0)) || 0,
      source_count:Number(e.source_count || 0) || 0
    });
  }
  return Array.from(groups.entries())
    .sort((a,b)=>b[1].length-a[1].length || a[0].localeCompare(b[0]))
    .map(([region,items])=>({
      region,
      event_count:items.length,
      highest_severity:items.slice().sort((a,b)=>severityScore(b.severity)-severityScore(a.severity))[0]?.severity || 'INFORMATIONAL',
      items
    }));
}

function references(events) {
  const out = [];
  const candidates = [];
  for (const e of events) {
    for (const ref of sourceRefs(e)) {
      candidates.push({ ...ref, event_id:e.id, source_layer:'original_evidence' });
    }
    const research = e?.research?.agent || e?.research || {};
    for (const ref of Array.isArray(research.sources) ? research.sources : []) {
      if (!ref?.url) continue;
      candidates.push({
        observation_id:null,
        source_id:null,
        source:clean(ref.domain || ref.source_type || 'Web research', 140),
        title:clean(ref.title || 'Research source', 240),
        url:ref.url,
        observed_at:null,
        published_at:null,
        credibility:null,
        event_id:e.id,
        source_layer:'incident_research'
      });
    }
  }
  const unique = dedupeQualitySources(candidates, 120);
  for (const ref of unique) out.push(ref);
  return out;
}

function buildEvidencePublication({ country, type, start, end, events, evidenceCount, sourceCount, evidenceContract, publicationTimezone }) {
  const name = COUNTRY_NAMES[country] || country;
  const ordered = topEvents(events, Math.max(events.length, 1));
  const confidence = events.length
    ? Math.round(events.reduce((sum,e)=>sum + (Number(e.confidence || 0) || 0),0) / events.length)
    : 0;
  const p = posture(events, confidence);
  const high = (p.counts.critical || 0) + (p.counts.high || 0);
  const typeCounts = {};
  for (const e of events) {
    const t = eventType(e);
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const topTypes = Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]).join(', ') || 'no classified threat type';
  const keyEvents = ordered.slice(0,8).map(eventNarrative);
  const top = keyEvents[0];
  const assessmentHighlights=uniqueStrings(
    keyEvents
      .map(e=>e.assessment)
      .filter(Boolean),
    4
  ).map((judgement,i)=>({
    id:keyEvents.find(e=>e.assessment===judgement)?.event_id || String(i+1),
    judgement,
    confidence:keyEvents.find(e=>e.assessment===judgement)?.confidence ?? null,
    headline:keyEvents.find(e=>e.assessment===judgement)?.headline || null
  }));
  const qualityControl=auditPublicationContent(keyEvents.map(e=>({event_id:e.event_id,what_happened:e.what_happened,context:e.context,assessment:e.assessment})));
  const qualityGateNote=qualityControl.passed?'PASS':'HOLD - duplicate or boilerplate content detected; publication requires editorial correction.';

  let executive;
  if (!events.length) {
    executive = 'No security-relevant event objects were recorded by the Sonalit evidence and fusion ledger for ' + name + ' during the reporting period. This is a collection statement, not a claim that no incidents occurred. Collection coverage and unresolved gaps should therefore be reviewed before operational decisions are made.';
  } else {
    executive = name + ' recorded ' + events.length + ' security-relevant event objects during the reporting period, including ' + high + ' high/critical signals. The dominant classified themes were ' + topTypes + '. The current evidence-derived posture is ' + p.level + ' with average event confidence of ' + confidence + '%.';
    if (top) executive += ' The most significant recorded development was: ' + top.headline + '.';
  }
  const gaps = [];
  const noCoordinates = events.filter(e => !Number.isFinite(Number(e.latitude)) || !Number.isFinite(Number(e.longitude))).length;
  const singleSource = events.filter(e => Number(e.source_count || 0) < 2).length;
  const lowConfidence = events.filter(e => Number(e.confidence || 0) < 60).length;
  if (noCoordinates) gaps.push(noCoordinates + ' event(s) lack usable coordinates and are therefore absent from the incident plot.');
  if (singleSource) gaps.push(singleSource + ' event(s) have fewer than two distinct source records; corroboration should be prioritised.');
  if (lowConfidence) gaps.push(lowConfidence + ' event(s) carry confidence below 60% and should remain under review.');
  if (!gaps.length) gaps.push('No structural collection gap was identified in the fields available to the publication builder; source quality and completeness still require normal analyst review.');
  const operationalImplications = high
    ? [
        'Prioritise monitoring of locations associated with high/critical event objects.',
        'Review personnel, route and asset exposure where repeated or geographically concentrated reporting is present.',
        'Escalate the operating posture if new corroborated reporting increases severity, geographic spread or event persistence.'
      ]
    : [
        'Maintain routine monitoring of current reporting and watch for corroboration or deterioration.',
        'Use the current evidence set as a decision-support input rather than a complete picture of all incidents.'
      ];
  const watchRegions = Array.from(new Set(events.map(e=>clean(e.region||'',80).toUpperCase()).filter(Boolean))).slice(0,3);
  const operatingSummary = events.length
    ? 'The recorded operating picture contains ' + events.length + ' event object(s), including ' + high + ' high/critical signal(s)' + (watchRegions.length ? ' concentrated across ' + watchRegions.join(', ') + '.' : '.')
    : 'No event objects were recorded in the current collection window; this does not establish an absence of incidents.';
  const outlook = [
    watchRegions.length
      ? 'Primary watch areas: ' + watchRegions.join(', ') + '. The next collection cycle should test recurrence, geographic spread and any change in severity.'
      : 'No geographic concentration was established beyond the recorded event set; the next collection cycle should test for recurrence, spread and severity change.',
    top
      ? 'Escalation indicator: new independent reporting that confirms or materially expands ' + top.headline + '.'
      : 'Escalation indicator: a new corroborated material event or a clear increase in severity within the next collection cycle.',
    high
      ? 'Downgrade indicator: sustained reduction in high/critical reporting with adequate collection coverage; absence of reporting alone is insufficient.'
      : 'Downgrade indicator: sustained de-escalation supported by adequate collection coverage rather than a single quiet reporting interval.'
  ];
  return {
    title: name + (type === 'weekly' ? ' Weekly Security Intelligence' : type === 'monthly' ? ' Monthly Security Intelligence' : ' Daily Security Intelligence') + ' — ' + formatPeriod(start,end,publicationTimezone),
    subtitle: 'Security-only reporting · completed period · ' + formatPeriod(start, end, publicationTimezone),
    executive_assessment: dedupeSentences(executive, new Set(), 1500),
    assessment_highlights: assessmentHighlights,
    threat_posture: p,
    change_analysis: {
      headline: 'CURRENT PERIOD CHANGE',
      summary: 'The publication records ' + events.length + ' event object(s) in the current period. A directly comparable prior-period baseline is not stored in the publication record, so no numerical trend claim is made.',
      trajectory: p.trajectory,
    },
    key_developments: keyEvents.slice(0,6).map(x => ({
      event_id:x.event_id,
      headline:x.headline,
      severity:x.severity,
      region:x.region,
      confidence:x.confidence,
      assessment:dedupeSentences(x.assessment, new Set(), 700),
      significance:x.why_it_matters?.[0] || null
    })),
    incident_dossiers: keyEvents,
    publication_quality: {...qualityControl,gate:qualityGateNote},
    security_environment: {
      summary: operatingSummary,
      highest_priority: top ? top.headline : 'No material event recorded.',
      severity_distribution: p.counts,
    },
    public_safety_security_overview: publicSafetyOverview(events, p, confidence),
    emerging_trends: emergingTrends(events),
    key_drivers: keyDrivers(events),
    key_findings_assessment: {
      findings: keyEvents.slice(0,5).map(e => ({headline:e.headline, assessment:e.assessment, why_it_matters:e.why_it_matters, event_id:e.event_id})),
      note:'Findings are ranked from the recorded event ledger and do not imply complete collection of all incidents.'
    },
    regional_news: regionalNews(events),
    pmesi: pmesi(events),
    operational_implications: operationalImplications,
    outlook,
    intelligence_gaps: gaps,
    weekly_calendar: {
      status: 'SOURCE_NOT_AVAILABLE',
      note: 'No dedicated forward events-calendar feed is attached to the current publication evidence contract.',
      items: []
    },
    incident_map: {
      points: keyEvents.filter(e => e.latitude != null && e.longitude != null).map(e => ({
        event_id:e.event_id, headline:e.headline, latitude:e.latitude, longitude:e.longitude, severity:e.severity
      }))
    },
    references: references(events),
    deep_research: {
      enabled: keyEvents.some(e=>Boolean(e&&e.research_status)),
      incidents_requested: keyEvents.length,
      incidents_researched: keyEvents.filter(e=>e&&['researched','researched_limited'].includes(e.research_status)).length,
      incidents_researched_limited: keyEvents.filter(e=>e&&e.research_status==='researched_limited').length,
      incidents_web_researched: keyEvents.filter(e=>e&&['ai_web_search','live_web_packet'].includes(e.research_method)).length,
      incidents_agent_researched: keyEvents.filter(e=>e&&['researched','researched_limited'].includes(e.research_status)).length,
      incidents_packet_synthesized: keyEvents.filter(e=>e&&e.research_method==='live_web_packet').length,
      incidents_fallback: keyEvents.filter(e=>e&&e.research_status==='fallback').length,
      web_sources_discovered: keyEvents.reduce((n,e)=>n+Number(e?.research_sources?.length||0),0)
    },
    collection_coverage: {
      event_count: events.length,
      evidence_count: evidenceCount,
      source_count: sourceCount,
      evidence_contract_met: evidenceContract,
      contract: evidenceContract ? 'Publication basis satisfies the configured evidence-source threshold.' : 'At least 3 original evidence observations from at least 2 distinct sources.'
    },
    disclaimer: 'This product is evidence-governed decision support. It does not guarantee completeness or accuracy and should not replace appropriate operational or professional judgement.',
    reporting_standard: 'SONALIT · security collection → verification → fusion → deep research → assessment → QA → dissemination',
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    country_code: country,
    country_name: name,
    publication_type: type,
    publication_timezone: publicationTimezone || process.env.INTEL_PUBLICATION_TIMEZONE || 'Africa/Nairobi',
  };
}
module.exports = { buildEvidencePublication, eventNarrative, formatPeriod, posture, references };