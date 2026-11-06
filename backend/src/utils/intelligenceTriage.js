'use strict';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'",
  nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’',
  lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™',
};

function decodeEntities(value) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (whole, token) => {
    const key = String(token).toLowerCase();
    if (key[0] !== '#') return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : whole;
    const codePoint = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return whole;
    try { return String.fromCodePoint(codePoint); } catch { return whole; }
  });
}

function plainText(value, maxLength = 6000) {
  let text = String(value == null ? '' : value);
  for (let i = 0; i < 3; i += 1) {
    text = decodeEntities(text)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|iframe|svg)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, ' ')
      .replace(/<\s*br\b[^>]*\/?>/gi, ' ')
      .replace(/<\/\s*(p|div|li|article|section|tr|h[1-6])\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ');
  }
  return decodeEntities(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function incidentCategory(value) {
  const text = plainText(value, 12000).toLowerCase();
  if (/\b(?:ied|improvised explosive device|explosive device|bomb(?:ing)?|explosion|detonat(?:ed|ion))\b/.test(text)) return 'ied';
  if (/\b(?:armed attack|armed clashes?|intercommunal clashes?|ethnic clashes?|terrorist attack|terror attack|gunfire|shooting|ambush|militia (?:attack|attacks|attacked|ambush|ambushed)|insurgents? (?:attack|attacks|attacked|ambush|ambushed)|insurgency attack|massacre|mass shooting|mass[- ]casualt(?:y|ies)(?: incident| event| attack))\b/.test(text)) return 'armed_attack';
  if (/\b(?:kidnap(?:ped|ping|pings)?|abduct(?:ed|ion)|taken hostage|held hostage|hostage[- ]taking|hostages? held|(?:take|takes|took|taking) (?:multiple )?hostages?|hostage crisis)\b/.test(text)) return 'kidnapping';
  if (/\b(?:protests?|protesters?|riots?|rioting|unrest|demonstrations?|demonstrators?|roadblocks?|violent clashes?|clashes? with (?:police|security forces|troops|armed forces))\b/.test(text)) return 'protest';
  if (/\b(?:political rally|rally|campaign gathering)\b/.test(text)) return 'political_rally';
  if (/\b(?:fire|blaze|burning)\b/.test(text)) return 'fire';
  if (/\b(?:accident|crash|collision|overturned|derailment)\b/.test(text)) return 'accident';
  if (/\b(?:traffic|congestion|gridlock|road closed|highway closed|bridge closed)\b/.test(text)) return 'traffic';
  if (/\b(?:flood(?:ing)?|landslide|earthquake|cyclone|storm|weather warning|heavy rain|wind warning)\b/.test(text)) return 'natural_hazard';
  if (/\b(?:robbery|carjacking|mugging|murder|violent assault|home invasion|burglary|theft)\b/.test(text)) return 'crime';
  return 'other';
}

function securityRelevance(category, value) {
  const text = plainText(value, 12000).toLowerCase();
  const cat = String(category || incidentCategory(text) || 'other').toLowerCase();
  const rhetoricalObjection = /\b(?:ignore[sd]?|dismiss(?:es|ed|ing)?|reject(?:s|ed|ing)?|stands? by|defends?)\b.{0,90}\b(?:protests?|objections?|outcry)\b/i.test(text)
    && /\b(?:allocation|budget|funding|policy|decision|proposal|bill|plan|appointment|ruling)\b/i.test(text)
    && !/\b(?:protesters?|demonstrators?|march(?:ed|ing)?|rall(?:y|ies)|crowd|gather(?:ed|ing)|roadblock|clash|riot|police|security forces|tear gas|blocked road|thousands|hundreds|mass demonstration)\b/i.test(text);
  if (cat === 'protest' && rhetoricalObjection) return 'not_security_relevant';

  const securityCategories = ['ied', 'armed_attack', 'kidnapping', 'protest', 'crime'];
  if (cat === 'protest'
    && ['roadblock', 'blocked road', 'road closed', 'highway closed', 'airport access blocked'].some(term => text.includes(term))
    && !['protester', 'demonstration', 'riot', 'unrest', 'clash', 'police', 'security forces'].some(term => text.includes(term))) {
    return 'operationally_relevant';
  }
  if (securityCategories.includes(cat)) return 'security_relevant';
  if (cat === 'traffic') {
    return /\b(?:roadblock|blocked road|road closed|highway closed|gridlock|major congestion|airport access blocked|transport disruption|protest route)\b/.test(text)
      ? 'operationally_relevant' : 'not_security_relevant';
  }
  if (cat === 'accident') {
    return /\b(?:fatal|fatality|killed|dead|serious(?:ly)? injured|multiple injured|multi[- ]vehicle|major collision|bus crash|train crash|derailment|road closed|highway blocked)\b/.test(text)
      ? 'operationally_relevant' : 'not_security_relevant';
  }
  if (cat === 'fire') return /\b(?:fire|blaze|burning|arson)\b/.test(text) ? 'operationally_relevant' : 'not_security_relevant';
  if (cat === 'natural_hazard') return 'operationally_relevant';
  if (/\b(?:power outage|water supply cut|communications outage|hospital evacuation|critical service disruption|airport closed|port closed|widespread infrastructure disruption)\b/.test(text)) return 'operationally_relevant';
  if (cat === 'political_rally') {
    return /\b(?:large crowd|mass gathering|thousands|tens of thousands|clash|violence|unrest|road closure|security alert|security concerns|heavy security|disruption)\b/.test(text)
      ? 'potential_security_relevant' : 'not_security_relevant';
  }
  const explicit = /\b(?:security incident|security alert|security threat|credible threat|imminent threat|threat to (?:life|personal safety|public safety)|suspicious (?:package|device|vehicle|activity)|explosive device|bomb threat|terror plot|terrorist cell|hostage (?:taking|crisis)|armed incursion|border incursion|cross[- ]border attack|sabotage|arson attack|targeted attack|armed men (?:seen|reported|approached)|weapons cache|arms cache|cyber[- ]attack|ransomware attack|data breach|critical infrastructure attack|embassy attack|attack on (?:police|civilians|security forces|checkpoint|convoy)|kidnapp(?:ed|ing)|abduct(?:ed|ion)|mass[- ]casualt(?:y|ies)|massacre|mass killing|mass shooting|genocide)\b/.test(text);
  return explicit ? 'potential_security_relevant' : 'not_security_relevant';
}

function independentSourceKey(observation) {
  const item = observation && typeof observation === 'object' ? observation : {};
  const meta = item.raw_metadata && typeof item.raw_metadata === 'object' ? item.raw_metadata : {};
  const provider = String(item.provider || meta.provider || '').trim().toLowerCase();
  const normalizeDomain = value => String(value || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '').replace(/^m\./, '');

  if (provider === 'telegram' && meta.channel) return 'telegram:' + String(meta.channel).replace(/^@/, '').trim().toLowerCase();
  if ((provider === 'x' || provider === 'twitter') && meta.author_id) return 'x:' + String(meta.author_id).trim().toLowerCase();

  const directDomain = normalizeDomain(meta.publisher_domain || meta.domain);
  if (directDomain) return directDomain;
  try {
    const host = normalizeDomain(new URL(String(item.url || '')).hostname);
    if (host && !['news.google.com', 'google.com', 'www.google.com'].includes(host) && !host.endsWith('.google.com')) return host;
  } catch (_) { /* Source identity falls through to explicit publisher metadata. */ }

  const publisher = String(meta.aggregator_source || meta.feed || meta.source_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (publisher) return publisher;
  const queryDomain = String(meta.query || '').match(/site:([a-z0-9.-]+)/i);
  if (queryDomain) return normalizeDomain(queryDomain[1]);
  if (provider === 'newsmesh') return 'google-news-discovery';
  return String(item.source_id || provider || 'unknown-source').trim().toLowerCase();
}

const NUMBER_WORDS = {
  one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
  eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
  seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,
  fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,dozens:24,scores:20,hundred:100,hundreds:100,thousands:1000,
};
function countBeforeTerms(value, terms) {
  const text = plainText(value, 12000).toLowerCase();
  const number = '(\\d{1,5}|' + Object.keys(NUMBER_WORDS).join('|') + ')';
  const qualifiers = '(?:(?:at least|more than|over|about|around|approximately)\\s+)?';
  const people = '(?:(?:people|persons|civilians|victims)\\s+)?';
  const verb = '(?:(?:were|are|have been|taken|held)\\s+)?';
  const forward = new RegExp('\\b' + qualifiers + number + '\\s+' + people + verb + '(?:' + terms + ')\\b', 'i');
  const reverse = new RegExp('\\b(?:' + terms + ')\\s+' + qualifiers + number + '\\s+(?:people|persons|civilians|victims)\\b', 'i');
  const match = text.match(forward) || text.match(reverse);
  if (!match) return null;
  const raw = String(match[1] || '').toLowerCase();
  const count = NUMBER_WORDS[raw] ?? Number(raw);
  const strictLowerBound = /\b(?:more than|over)\s+\d+/i.test(match[0]);
  return Number.isFinite(count) ? count + (strictLowerBound ? 1 : 0) : null;
}

function assessIncidentSeverity(category, value) {
  const text = plainText(value, 12000).toLowerCase();
  const cat = String(category || incidentCategory(text) || 'other').toLowerCase();

  const nonEvent = /\b(?:false alarm|hoax|fictional|movie|film|documentary|training exercise|security drill|simulation|tabletop exercise)\b/.test(text);
  const fatalityCount = countBeforeTerms(text, '(?:killed|dead|died|fatalities|deaths)');
  const hostageCount = countBeforeTerms(text, '(?:(?:taken|held)\\s+)?hostages?');
  const noFatalityClaim = /\b(?:no|zero|0|without)\s+(?:reported\s+)?(?:deaths?|fatalities|casualties|people killed)\b|\bno\s+(?:one|people|persons|civilians|victims)\s+(?:was|were\s+)?(?:killed|dead|injured)\b/.test(text);
  const affirmativeFatality = /\b(?:killed|dead|died|death|fatalit(?:y|ies)|fatal (?:crash|collision|attack|shooting|explosion|stabbing|assault|accident|incident))\b/.test(text);
  const fatal = (fatalityCount != null && fatalityCount > 0) || (affirmativeFatality && !noFatalityClaim);
  const multipleFatalities = /\b(?:multiple fatalities|several (?:people )?(?:killed|dead|died|fatalities)|dozens (?:of )?(?:people )?(?:killed|dead|died)|scores (?:of )?(?:people )?(?:killed|dead|died))\b/.test(text)
    || (fatalityCount != null && fatalityCount >= 2);
  const massFatalityLabel = /\b(?:mass[- ]casualt(?:y|ies)(?:\s+(?:incident|event|attack))?|massacre|mass killing|genocide|dozens (?:of )?(?:people )?(?:killed|dead|died)|scores (?:of )?(?:people )?(?:killed|dead|died))\b/.test(text);
  const prospectiveMassEvent = /\b(?:threat|risk|fear|warning|warns?|possible|potential|planned|plan|plot|foiled|thwarted|intercepted|prevented|preventing|averted|averting)\b.{0,80}\b(?:mass[- ]casualt|massacre|mass killing|genocide|mass hostage|multiple hostages?|hostage crisis|widespread|nationwide)\b/.test(text)
    || /\b(?:mass[- ]casualt|massacre|mass killing|genocide|mass hostage|multiple hostages?|hostage crisis|widespread|nationwide)\b.{0,80}\b(?:threat|risk|fear|warning|possible|potential|planned|plan|plot|foiled|thwarted|intercepted|prevented|averted)\b/.test(text);
  const massFatalities = (fatalityCount != null && fatalityCount >= 2 && fatal && !prospectiveMassEvent)
    || (massFatalityLabel && !prospectiveMassEvent);

  const noInjuryClaim = /\b(?:no|zero|0|without)\s+(?:reported\s+)?injur(?:y|ies)\b/.test(text);
  const seriousInjury = !noInjuryClaim && /\b(?:seriously injured|severely injured|critical condition|serious injuries|life[- ]threatening injuries)\b/.test(text);
  const multipleInjury = !noInjuryClaim && /\b(?:multiple injured|several injured|many injured|multiple injuries|several injuries|many injuries)\b/.test(text);

  const active = /\b(?:ongoing|underway|under way|active|in progress|currently|right now|continues|continuing)\b/.test(text);
  const violent = /\b(?:violent clashes?|clashes? with police|riot(?:ing)?|looting|armed confrontation|live ammunition|shots fired|police fired|set ablaze|buildings? torched)\b/.test(text);
  const disruption = /\b(?:roadblock|highway blocked|roads? closed|airport closed|port closed|rail service suspended|evacuat(?:ed|ion)|critical service disrupted|power outage|water supply cut|communications outage|(?:blocks?|blocked|blocking)\s+(?:the\s+)?(?:main\s+)?(?:highway|road|airport access)|(?:main\s+)?(?:highway|road|airport access)\s+(?:is\s+)?blocked)\b/.test(text);
  const widespread = /\b(?:nationwide|countrywide|region[- ]wide|widespread|multiple provinces|multiple counties|several counties|several provinces|across multiple cities|throughout the country|entire region)\b/.test(text)
    && /\b(?:power outage|water supply|communications|hospital|airport|port|transport network|critical infrastructure|evacuat|disruption|shutdown|essential services?)\b/.test(text);

  const massHostageLabel = /\b(?:mass hostage[- ]taking|large[- ]scale hostage crisis|mass hostage crisis|dozens of hostages?|multiple hostages? at (?:a )?(?:school|hospital|embassy|airport|public venue))\b/.test(text);
  const massHostageCrisis = (hostageCount != null && hostageCount >= 5 && /\b(?:hostages?|hostage crisis|hostage[- ]taking)\b/.test(text))
    || (massHostageLabel && !prospectiveMassEvent);
  const hostage = /\b(?:hostage crisis|hostage[- ]taking|hostages? held|taken hostage|held hostage|take(?:s|n|ing)? (?:multiple )?hostages?|kidnapped|abducted)\b/.test(text);
  const foiled = /\b(?:foiled|thwarted|intercepted|prevented)\b/.test(text);
  const prospectiveThreat = /\b(?:threat|risk|warning|warns?|possible|potential|suspected|planned|plan|plot|attempt)\b.{0,80}\b(?:attack|ambush|kidnap(?:ping)?|abduct(?:ion)?|hostage|bomb|explosion|massacre|terrorist|armed incursion)\b/.test(text)
    || /\b(?:attack|ambush|kidnap(?:ping)?|abduct(?:ion)?|hostage|bomb|explosion)\b.{0,80}\b(?:threat|risk|warning|possible|potential|suspected|foiled|thwarted)\b/.test(text);
  const preventive = /\b(?:anti[- ]?kidnapping|anti[- ]?terror(?:ism)?|counter[- ]?terror(?:ism)?|disarmament|peace talks|ceasefire talks|prevention campaign|prevent(?:ed|ing)? kidnapping|security drill|training exercise|simulation|bomb disposal exercise)\b/.test(text);
  const denied = /\b(?:no (?:armed )?attack occurred|attack did not occur|no kidnapping occurred|no abduction occurred|false report(?:s)? of (?:an? )?(?:attack|kidnapping|abduction)|unconfirmed reports? of (?:an? )?(?:attack|kidnapping|abduction))\b/.test(text);

  let severity = 'low';
  const basis = [];
  const reasonCodes = [];
  const catastrophicDisruption = widespread && !prospectiveMassEvent;
  const catastrophicHostageEvent = massHostageCrisis && !prospectiveMassEvent;

  if (!nonEvent && !preventive && !denied && !foiled && (massFatalities || catastrophicHostageEvent || catastrophicDisruption)) {
    severity = 'critical';
    if (massFatalities) {
      basis.push('Reported mass-casualty threshold met (two or more reported fatalities or an explicitly reported mass-casualty event)');
      reasonCodes.push('MASS_CASUALTY_IMPACT');
    }
    if (catastrophicHostageEvent) {
      basis.push('Reported large-scale hostage crisis (five or more hostages or explicit mass-hostage event)');
      reasonCodes.push('MASS_HOSTAGE_CRISIS');
    }
    if (catastrophicDisruption) {
      basis.push('Reported widespread disruption to essential infrastructure or services');
      reasonCodes.push('WIDESPREAD_ESSENTIAL_SERVICE_FAILURE');
    }
  } else if (!nonEvent && fatal) {
    severity = 'high';
    basis.push('A single reported fatality; two or more reported deaths meet the CRITICAL threshold');
    reasonCodes.push('FATALITY_REPORTED');
  } else if (!nonEvent && seriousInjury) {
    severity = 'high';
    basis.push('Reported serious, life-threatening or critical-condition injuries');
    reasonCodes.push('SERIOUS_INJURY_REPORTED');
  } else if (!nonEvent && ['ied', 'armed_attack', 'kidnapping'].includes(cat)) {
    if (preventive || denied) {
      severity = 'low';
      basis.push('Preventive, denied or exercise context; no active incident is established');
      reasonCodes.push('PREVENTIVE_OR_DENIED_CONTEXT');
    } else if (prospectiveThreat || prospectiveMassEvent) {
      severity = 'medium';
      basis.push('Reported prospective threat, warning or plot; no completed high-impact incident is established');
      reasonCodes.push('PROSPECTIVE_THREAT_REPORTED');
    } else if (cat === 'ied') {
      const detonation = /\b(?:bombing|bomb exploded|bomb detonated|ied attack|explosion|exploded|detonated|detonation)\b/.test(text);
      const deviceThreat = /\b(?:bomb threat|suspicious package|suspicious device|explosive device found|bomb found|ied found|device discovered|device confirmed|device defused|bomb disposal|explosive ordnance disposal)\b/.test(text);
      if (detonation) {
        severity = 'high';
        basis.push('Reported explosive detonation or explosive attack; no mass-casualty threshold established');
        reasonCodes.push('EXPLOSIVE_ATTACK_REPORTED');
      } else if (deviceThreat || foiled) {
        severity = 'medium';
        basis.push('Reported explosive threat, device or disrupted plot without established catastrophic impact');
        reasonCodes.push('EXPLOSIVE_THREAT_OR_PLOT');
      } else {
        basis.push('Explosive terminology appears without a specific reported device, threat or detonation');
        reasonCodes.push('EXPLOSIVE_REFERENCE_UNSPECIFIED');
      }
    } else if (cat === 'armed_attack') {
      const armedIncident = /\b(?:armed attack|armed clashes?|intercommunal clashes?|ethnic clashes?|terrorist attack|terror attack|gunfire|shooting|ambush|militia (?:attack|attacks|attacked|ambush|ambushed)|insurgents? (?:attack|attacks|attacked|ambush|ambushed)|insurgency attack|massacre|mass shooting)\b/.test(text);
      if (armedIncident && !foiled) {
        severity = 'high';
        basis.push('Reported armed attack, ambush, gunfire or violent armed clash; no critical mass-casualty threshold established');
        reasonCodes.push('ARMED_ATTACK_REPORTED');
      } else if (foiled) {
        severity = 'medium';
        basis.push('Reported attack plot or attempt was disrupted; residual threat and impact require corroboration');
        reasonCodes.push('ATTACK_PLOT_DISRUPTED');
      } else {
        basis.push('Armed-group terminology appears without a reported attack or violent act');
        reasonCodes.push('ARMED_GROUP_REFERENCE_UNSPECIFIED');
      }
    } else {
      const abductionEvent = /\b(?:kidnapped|abducted|taken hostage|held hostage|hostage[- ]taking|hostages? held|take(?:s|n|ing) (?:multiple )?hostages?|hostage crisis|kidnapping(?:s)? reported|abduction reported|kidnapping of|kidnapping)\b/.test(text);
      if (abductionEvent && !foiled && !preventive) {
        severity = 'high';
        basis.push('Reported kidnapping, abduction or hostage-taking; scale and victim status remain separate questions');
        reasonCodes.push('ABDUCTION_REPORTED');
      } else if (foiled) {
        severity = 'medium';
        basis.push('Reported abduction attempt was disrupted; residual threat and victim safety require review');
        reasonCodes.push('ABDUCTION_ATTEMPT_DISRUPTED');
      } else {
        basis.push('Kidnapping terminology appears without a reported abduction event');
        reasonCodes.push('KIDNAPPING_REFERENCE_UNSPECIFIED');
      }
    }
  } else if (!nonEvent && cat === 'protest') {
    if (violent && (seriousInjury || multipleInjury || disruption)) {
      severity = 'high';
      basis.push('Reported violent disorder with injury or material access disruption');
      reasonCodes.push('VIOLENT_DISORDER_WITH_IMPACT');
    } else if (violent || disruption || multipleInjury) {
      severity = 'medium';
      basis.push(violent ? 'Reported disorder or clashes; scale and harm require verification' : 'Reported road/access disruption or multiple injuries');
      reasonCodes.push('CIVIL_UNREST_WITH_LIMITED_IMPACT');
    } else {
      basis.push('No violence, injury or material disruption is stated; peaceful protest/mobilisation is low impact');
      reasonCodes.push('PEACEFUL_OR_LOW_IMPACT_PROTEST');
    }
  } else if (!nonEvent && cat === 'accident') {
    if (seriousInjury || multipleInjury || /\b(?:multi[- ]vehicle|major collision|multiple vehicles|major derailment|building collapse)\b/.test(text)) {
      severity = 'medium';
      basis.push('Reported serious injury or major transport accident indicators');
      reasonCodes.push('MAJOR_ACCIDENT_IMPACT');
    } else {
      basis.push('Accident headline without stated serious harm or wider disruption');
      reasonCodes.push('ACCIDENT_IMPACT_UNSTATED');
    }
  } else if (!nonEvent && cat === 'fire') {
    if (/\b(?:industrial fire|factory fire|hospital fire|school fire|fuel depot fire|large fire|spreading fire|wildfire)\b/.test(text) || disruption) {
      severity = 'high';
      basis.push('Reported substantial fire or evacuation/disruption indicator');
      reasonCodes.push('MAJOR_FIRE_IMPACT');
    } else if (multipleInjury || /\b(?:building fire|house fire|warehouse fire|market fire)\b/.test(text)) {
      severity = 'medium';
      basis.push('Reported structural/property fire; scale and casualties are not established');
      reasonCodes.push('STRUCTURAL_FIRE_REPORTED');
    } else {
      basis.push('Fire-related mention without sufficient evidence of significant impact');
      reasonCodes.push('FIRE_IMPACT_UNSTATED');
    }
  } else if (!nonEvent && cat === 'natural_hazard') {
    if (/\b(?:major flooding|flash flood|dam failure|landslide|earthquake|cyclone|evacuat(?:ed|ion)|red alert|severe storm)\b/.test(text) || disruption) {
      severity = 'high';
      basis.push('Reported severe hazard, evacuation or material infrastructure impact');
      reasonCodes.push('SEVERE_HAZARD_IMPACT');
    } else if (multipleInjury || /\b(?:flood|storm|heavy rain|weather warning|wind warning)\b/.test(text)) {
      severity = 'medium';
      basis.push('Reported weather/hazard signal; local impact and official warning level need confirmation');
      reasonCodes.push('HAZARD_SIGNAL_REQUIRES_IMPACT_CHECK');
    } else {
      basis.push('Hazard-related mention without stated material impact');
      reasonCodes.push('HAZARD_IMPACT_UNSTATED');
    }
  } else if (!nonEvent && (cat === 'traffic' || cat === 'crime')) {
    if (cat === 'crime' && /\b(?:armed robbery|carjacking|violent assault|home invasion)\b/.test(text)) {
      severity = 'medium';
      basis.push('Reported violent/armed property crime; harm and source reliability require corroboration');
      reasonCodes.push('VIOLENT_CRIME_REPORTED');
    } else if ((cat === 'traffic' && disruption) || multipleInjury) {
      severity = 'medium';
      basis.push('Reported transport/access disruption or multiple injuries');
      reasonCodes.push('OPERATIONAL_DISRUPTION_REPORTED');
    } else {
      basis.push('Routine traffic or crime report without evidence of serious harm or wider exposure');
      reasonCodes.push('LIMITED_OPERATIONAL_IMPACT');
    }
  } else if (!nonEvent && multipleInjury) {
    severity = 'medium';
    basis.push('Reported multiple injuries without explicit serious or life-threatening harm');
    reasonCodes.push('MULTIPLE_INJURIES_REPORTED');
  } else if (!nonEvent && /\b(?:suspicious package|suspicious device|credible threat|imminent threat|security threat|hostage crisis|armed incursion|border incursion|sabotage|data breach|ransomware attack|critical infrastructure attack)\b/.test(text)) {
    severity = 'medium';
    basis.push('Reported security-risk indicator requires corroboration and impact assessment');
    reasonCodes.push('SECURITY_THREAT_INDICATOR');
  } else if (!nonEvent && /\b(?:attack(?:ed)?|ambush(?:ed)?|gunfire|shooting|bombing|explosion|detonated|explosive device found|kidnapp(?:ed|ing)|abduct(?:ed|ion))\b/.test(text)) {
    severity = 'medium';
    basis.push('Potential security-related event requires categorisation and corroboration');
    reasonCodes.push('SECURITY_EVENT_NEEDS_CLASSIFICATION');
  } else if (!nonEvent && (prospectiveThreat || prospectiveMassEvent)) {
    severity = 'medium';
    basis.push('Reported prospective threat or disruption; no completed high-impact event is established');
    reasonCodes.push('PROSPECTIVE_THREAT_REPORTED');
  } else {
    basis.push('No high-impact security indicator is established by the supplied text');
    reasonCodes.push(nonEvent ? 'NON_EVENT_OR_EXERCISE' : 'NO_MATERIAL_IMPACT_INDICATOR');
  }

  const impact = severity === 'critical' ? 'catastrophic' : severity === 'high' ? 'severe' : severity === 'medium' ? 'material' : 'limited_or_unstated';
  const urgency = severity === 'critical' ? (active ? 'immediate' : 'urgent')
    : severity === 'high' ? (active ? 'immediate' : 'urgent')
      : severity === 'medium' ? (active ? 'elevated' : 'routine') : 'routine';

  return {
    model: 'sonalit-impact-urgency-v2',
    severity,
    impact,
    urgency,
    preliminary: true,
    verification_state: 'unverified',
    basis,
    reason_codes: reasonCodes,
    indicators: {
      reported_fatality: fatal,
      reported_fatality_count: fatalityCount,
      multiple_fatalities_below_critical: multipleFatalities && !massFatalities,
      mass_casualty_threshold_met: massFatalities,
      serious_injury: seriousInjury,
      multiple_injury: multipleInjury,
      active_signal_in_text: active,
      violent_disorder: violent,
      material_disruption: disruption,
      widespread_essential_service_disruption: catastrophicDisruption,
      reported_hostage_count: hostage ? hostageCount : null,
      mass_hostage_crisis: catastrophicHostageEvent,
      foiled_or_disrupted_attempt: foiled,
      preventive_or_denied_context: preventive || denied,
    },
    thresholds: {
      critical_fatalities: 2,
      critical_hostages: 5,
      critical_other: 'Explicit mass-casualty event or widespread essential-service failure',
    },
    caveat: 'Deterministic text-based preliminary impact triage. It does not establish that the report is true, current, independently corroborated or analyst-verified. Source confidence and severity remain separate.',
  };
}
module.exports = {
  plainText,
  incidentCategory,
  assessIncidentSeverity,
  securityRelevance,
  independentSourceKey,
};
