const COUNTRY_NAMES = { KE:'Kenya', SO:'Somalia', ET:'Ethiopia', UG:'Uganda', TZ:'Tanzania', RW:'Rwanda', BI:'Burundi', SS:'South Sudan', DJ:'Djibouti', ER:'Eritrea', SD:'Sudan', CD:'DR Congo' };
const SEVERITIES = ['critical','high','moderate','low','informational'];
const DOMAINS = ['POLITICAL','MILITARY','ECONOMY','SOCIAL','INFORMATION & MEDIA'];

function clean(v, n=1200) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
}
function severityScore(v) {
  return { critical:4, high:3, moderate:2, low:1, informational:0 }[String(v || '').toLowerCase()] == null
    ? 2
    : { critical:4, high:3, moderate:2, low:1, informational:0 }[String(v || '').toLowerCase()];
}
function eventType(e) {
  return String(e && e.intelligence_type || 'OTHER').toUpperCase();
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
function formatDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
}
function formatPeriod(start, end) {
  return formatDate(start) + ' — ' + formatDate(new Date(new Date(end).getTime() - 1));
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
  const brief = clean(e.brief || e.summary || e.headline || e.title || 'Evidence record available.', 2200);
  const severity = String(e.severity || 'moderate').toUpperCase();
  const type = eventType(e);
  const region = clean(e.region || 'Location not specified', 160);
  const evidence = Number(e.observation_count || (Array.isArray(e.evidence) ? e.evidence.length : 0));
  const sources = Number(e.source_count || new Set((Array.isArray(e.evidence) ? e.evidence : []).map(x => x.source_id).filter(Boolean)).size);
  const keyFacts = Array.isArray(e.key_facts) ? e.key_facts.map(x => clean(x,500)).filter(Boolean).slice(0,6) : [];
  const why = Array.isArray(e.why_it_matters) ? e.why_it_matters.map(x => clean(x,700)).filter(Boolean).slice(0,5) : [];
  const caveats = Array.isArray(e.caveats) ? e.caveats.map(x => clean(x,700)).filter(Boolean).slice(0,5) : [];
  const assessment = e.assessment && typeof e.assessment === 'object' ? e.assessment : {};
  const judgement = clean(assessment.judgement || assessment.headline || '', 1200);
  const upgradeTriggers = Array.isArray(assessment.upgrade_triggers) ? assessment.upgrade_triggers.map(x => clean(x,500)).filter(Boolean).slice(0,5) : [];
  const downgradeTriggers = Array.isArray(assessment.downgrade_triggers) ? assessment.downgrade_triggers.map(x => clean(x,500)).filter(Boolean).slice(0,5) : [];
  return {
    event_id: e.id,
    headline: clean(e.headline || e.title || 'Security development', 220),
    what_happened: brief,
    key_facts: keyFacts,
    assessment: judgement || (severity + ' ' + type + ' signal recorded in ' + region + '.'),
    why_it_matters: why.length ? why : [severity === 'CRITICAL' || severity === 'HIGH'
      ? 'The development warrants priority monitoring and review of exposure in the affected area.'
      : 'The development warrants continued monitoring for corroboration, persistence or escalation.'],
    caveats,
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
    if (!top) return { domain, status:'NO MATERIAL UPDATE RECORDED', update:'No event object in the current evidence ledger maps to this domain during the reporting period.', event_ids:[], confidence:null };
    return {
      domain,
      status: String(top.severity || 'moderate').toUpperCase(),
      update: clean(top.brief || top.summary || top.headline || top.title, 1000),
      event_ids: candidates.slice(0,8).map(e => e.id),
      confidence: Number(top.confidence || 0) || null
    };
  });
}

function emergingTrends(events) {
  const counts = new Map();
  for (const e of events) {
    const key = eventType(e);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = Math.max(events.length, 1);
  return Array.from(counts.entries())
    .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))
    .slice(0,5)
    .map(([theme,count]) => ({
      theme,
      count,
      share_percent: Math.round((count/total)*100),
      assessment: count > 1
        ? `Observed concentration: ${theme} accounts for ${count} of ${events.length} recorded event objects.`
        : `Observed signal: ${theme} is represented by one recorded event object.`
    }));
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
  for (const e of events) {
    const region = clean(e.region || 'NATIONAL / UNALLOCATED', 120).toUpperCase();
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push(eventNarrative(e));
  }
  return Array.from(groups.entries())
    .sort((a,b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([region, items]) => ({ region, items: items.slice(0,8) }));
}
function references(events) {
  const out = [];
  const seen = new Set();
  for (const e of events) {
    for (const ref of sourceRefs(e)) {
      const key = String(ref.url || '') + '|' + String(ref.source || '') + '|' + String(ref.title || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...ref, event_id:e.id });
    }
  }
  return out.slice(0,80);
}
function buildEvidencePublication({ country, type, start, end, events, evidenceCount, sourceCount, evidenceContract }) {
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
  const outlook = [
    'Near-term posture should remain centred on the conditions currently represented in the evidence ledger.',
    'An upgrade trigger is new corroborated critical/high reporting, clear geographic expansion, or a sustained increase in risk velocity.',
    'A downgrade should be considered only when material threats show sustained de-escalation and the absence of new corroborated reporting is itself supported by adequate collection coverage.'
  ];
  return {
    title: name + (type === 'weekly' ? ' Weekly Insight' : type === 'monthly' ? ' Monthly Security Intelligence' : ' Daily Intelligence'),
    subtitle: 'Evidence-governed intelligence · ' + formatPeriod(start, end),
    executive_assessment: executive,
    assessment_highlights: keyEvents.slice(0,4).map(x => x.headline),
    threat_posture: p,
    change_analysis: {
      headline: 'CURRENT PERIOD CHANGE',
      summary: 'The publication records ' + events.length + ' event object(s) in the current period. A directly comparable prior-period baseline is not stored in the publication record, so no numerical trend claim is made.',
      trajectory: p.trajectory,
    },
    key_developments: keyEvents,
    security_environment: {
      summary: executive,
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
    collection_coverage: {
      event_count: events.length,
      evidence_count: evidenceCount,
      source_count: sourceCount,
      evidence_contract_met: evidenceContract,
      contract: 'At least 3 evidence observations from at least 2 distinct sources.'
    },
    disclaimer: 'This product is evidence-governed decision support. It does not guarantee completeness or accuracy and should not replace appropriate operational or professional judgement.',
    reporting_standard: 'SONALIT 3i · evidence → verification → fusion → assessment → forecast → dissemination',
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    country_code: country,
    country_name: name,
    publication_type: type,
  };
}
module.exports = { buildEvidencePublication, eventNarrative, formatPeriod, posture, references };