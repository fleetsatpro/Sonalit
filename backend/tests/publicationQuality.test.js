// Regression suite: publication prose must remain non-repetitive and source-traceable.
const {
  cleanPublicationText,
  dedupeSentences,
  uniqueStrings,
  dedupeSources,
  isAggregatorDomain,
  repetitionRatio,
  auditPublicationContent,
  assessPublicationQuality
}=require('../src/utils/publicationQuality');

describe('publication content quality controls',()=>{
  test('removes known Google News and legacy boilerplate without damaging incident prose',()=>{
    const value=cleanPublicationText(
      'The incident affected the corridor. Comprehensive up-to-date news coverage, aggregated from sources all over the world by Google News. The duration remains unclear.'
    );
    expect(value).toBe('The incident affected the corridor. The duration remains unclear.');
  });

  test('deduplicates semantically identical sentences',()=>{
    const seen=new Set();
    const value=dedupeSentences(
      'Movement was disrupted on the corridor. Movement was disrupted on the corridor. Authorities responded to the disruption.',
      seen
    );
    expect(value).toMatch(/Movement was disrupted on the corridor\./);
    expect(value).toMatch(/Authorities responded to the disruption\./);
    expect((value.match(/Movement was disrupted on the corridor/gi)||[]).length).toBe(1);
    expect(repetitionRatio(value)).toBe(0);
  });

  test('removes aggregator sources and duplicate stories while preserving distinct domains',()=>{
    const sources=dedupeSources([
      {url:'https://news.google.com/articles/x',domain:'news.google.com',title:'Same story'},
      {url:'https://example.com/a',domain:'example.com',title:'Road closure after attack'},
      {url:'https://example.com/b',domain:'example.com',title:'Road closure after attack - update'},
      {url:'https://un.example/report',domain:'un.example',title:'Transport disruption'},
      {url:'https://another.example/report',domain:'another.example',title:'Independent confirmation'}
    ]);
    expect(isAggregatorDomain('news.google.com')).toBe(true);
    expect(sources.some(x=>x.domain==='news.google.com')).toBe(false);
    expect(sources).toHaveLength(3);
    expect(new Set(sources.map(x=>x.domain)).size).toBe(3);
  });

  test('normalizes unique lists without repeated boilerplate',()=>{
    expect(uniqueStrings([
      'The event remains bounded by the evidence recorded in Sonalit.',
      'The event remains bounded by the evidence recorded in Sonalit.',
      'The affected corridor supports commercial movement.'
    ])).toEqual(['The affected corridor supports commercial movement.']);
  });
});


test('treats intra-incident sentence reuse as an editorial diagnostic rather than a false blocking failure',()=>{
  const audit=auditPublicationContent([{
    event_id:'1',
    what_happened:'Authorities closed the corridor after an armed attack.',
    context:'Authorities closed the corridor after an armed attack.',
    assessment:'The closure may persist.'
  }]);
  expect(audit.passed).toBe(true);
  expect(audit.duplicate_sentence_count).toBe(0);
  expect(audit.intra_incident_repeat_count).toBe(1);
});

test('blocks exact sentence reuse across separate incident dossiers',()=>{
  const repeated='Authorities closed the corridor after an armed attack while emergency services responded.';
  const audit=auditPublicationContent([
    {event_id:'1',what_happened:repeated,context:'The incident affected access.',assessment:'Exposure increased temporarily.'},
    {event_id:'2',what_happened:repeated,context:'The second location remained open.',assessment:'No wider impact was established.'}
  ]);
  expect(audit.passed).toBe(false);
  expect(audit.duplicate_sentence_count).toBe(1);
});

test('flags lightly rephrased cross-incident copy when similarity is exceptionally high',()=>{
  const audit=auditPublicationContent([
    {event_id:'1',what_happened:'Authorities closed the affected corridor after an armed attack disrupted movement for commercial vehicles and emergency services during the morning response.',context:'The closure lasted through the morning.',assessment:'The evidence supports a short-term access risk.'},
    {event_id:'2',what_happened:'Authorities closed the affected corridor after an armed attack disrupted movement for commercial vehicles and emergency services during the morning response temporarily.',context:'The second location remained open.',assessment:'A different assessment is required.'}
  ]);
  expect(audit.near_duplicate_sentence_count).toBeGreaterThan(0);
  expect(audit.passed).toBe(false);
});

test('blocks repeated watchpoint templates across separate incidents',()=>{
  const template='Monitor whether this incident persists or spreads beyond the reported area.';
  const audit=auditPublicationContent([
    {event_id:'1',what_happened:'A new development was reported in area one.',context:template,assessment:'The evidence remains limited.'},
    {event_id:'2',what_happened:'A separate development was reported in area two.',context:template,assessment:'The evidence remains limited.'}
  ]);
  expect(audit.repeated_template_count).toBeGreaterThan(0);
  expect(audit.passed).toBe(false);
});


test('tradecraft gate rejects evidence-only generic publications',()=>{
  const quality=assessPublicationQuality({
    executive_assessment:'A country recorded several security-relevant events during the reporting period. The available material indicates elevated concern, but the implications for operations require further verification and stronger incident-level research before a broader judgement can be supported.',
    deep_research:{incidents_requested:1,incidents_researched:0,incidents_researched_limited:0,incidents_fallback:1},
    incident_dossiers:[{
      event_id:'e1',
      research_status:'fallback',
      what_happened:'An incident was reported in the affected area.',
      context:'The event occurred in a location relevant to movement.',
      assessment:'The event was reported in the affected area and may matter operationally.',
      key_facts:['The event was reported.','The location was identified.'],
      why_it_matters:['The event may affect operations.'],
      caveats:['The full extent remains unclear.'],
      research_sources:[{domain:'one.example',url:'https://one.example/a'}]
    }],
    outlook:['Watch for further reporting.','Review for deterioration.'],
    intelligence_gaps:['Independent corroboration remains incomplete.'],
    emerging_trends:[{theme:'SECURITY',basis:'CURRENT_PERIOD_CONCENTRATION',assessment:'SECURITY accounts for most current-period event objects.'}]
  });
  expect(quality.passed).toBe(false);
  expect(quality.research_complete).toBe(false);
  expect(quality.blocking_issues.length).toBeGreaterThan(0);
});


test('tradecraft gate accepts controlled limited research with two independent domains',()=>{
  const quality=assessPublicationQuality({
    executive_assessment:'The reporting period contains a localized security development with corroboration from independent reporting streams. The evidence does not establish a wider deterioration, but the event creates a defined exposure for the affected corridor while the duration and geographic extent remain subject to confirmation.',
    deep_research:{incidents_requested:1,incidents_researched:1,incidents_researched_limited:1,incidents_fallback:0},
    incident_dossiers:[{
      event_id:'e-limited',
      research_status:'researched_limited',
      what_happened:'Authorities reported a security disruption along the affected corridor. Two independent non-aggregator reporting domains carried material on the development, although the available source set did not establish every operational detail or the full duration of the disruption.',
      context:'The incident affects a corridor used for commercial movement between the reported area and connected markets. The immediate operational question is the duration of access disruption and whether adjacent approaches are subsequently affected.',
      assessment:'The available evidence supports a bounded local risk assessment rather than a confirmed wider deterioration. Greater concern would require independent reporting of recurrence, broader geographic reach or sustained disruption beyond the current period.',
      key_facts:['The security disruption was reported along the affected corridor.','Two independent reporting domains provided material relevant to the incident.'],
      why_it_matters:['A prolonged disruption could delay commercial movement and require route or security adjustments.'],
      caveats:['The full duration and geographic extent remain unresolved.'],
      research_sources:[{domain:'source-one.example',url:'https://source-one.example/a'},{domain:'source-two.example',url:'https://source-two.example/b'}]
    }],
    outlook:['Over the next 24 hours, confirmation of continued access disruption is the principal operational indicator.','Over the next 72 hours, recurrence or spread to adjacent approaches would change the current localised-risk assessment.'],
    intelligence_gaps:['Duration and geographic extent are not fully established.'],
    emerging_trends:[]
  });
  expect(quality.passed).toBe(true);
  expect(quality.research_complete).toBe(true);
  expect(quality.blocking_issues).toHaveLength(0);
});

test('tradecraft gate accepts a fully researched, differentiated dossier',()=>{
  const quality=assessPublicationQuality({
    executive_assessment:'The principal change is a localized disruption along a commercially important corridor. Two independent reporting streams corroborate the initial closure, but neither establishes sustained displacement of the threat. The immediate operational exposure is therefore elevated for vehicles using the affected segment rather than across the wider network.',
    deep_research:{incidents_requested:1,incidents_researched:1,incidents_researched_limited:0,incidents_fallback:0},
    incident_dossiers:[{
      event_id:'e1',
      research_status:'researched',
      what_happened:'Authorities closed the northern approach after an armed attack was reported near the corridor. Local reporting and a separate regional source both describe the closure, while available accounts differ on its duration. No source reviewed establishes that the incident extended beyond the immediate area.',
      context:'The corridor is a routine commercial movement route connecting the affected district with the regional freight network. A short closure creates delay exposure at the northern approach, while a prolonged closure would increase diversion and escort requirements.',
      assessment:'The evidence supports a localized, near-term access risk rather than a confirmed wider security deterioration. The assessment would move higher if independent reporting confirmed repeated attacks on adjacent approaches or persistent closure beyond the current reporting window.',
      key_facts:['The northern approach was closed after the reported attack.','Two independent reporting domains corroborate the closure.'],
      why_it_matters:['Persistent closure would increase transit time and route-exposure for commercial vehicles using the corridor.'],
      caveats:['The duration and full geographic extent of the disruption remain unresolved.'],
      research_sources:[{domain:'source-one.example',url:'https://source-one.example/a'},{domain:'source-two.example',url:'https://source-two.example/b'}]
    }],
    outlook:['Over the next 24 hours, confirmation of reopening or continued closure is the principal operational indicator.','Over the next 72 hours, repeated incidents on adjacent approaches would indicate a broader deterioration hypothesis.'],
    intelligence_gaps:['The duration of the closure is not independently established.'],
    emerging_trends:[{theme:'SECURITY',basis:'CURRENT_PERIOD_CONCENTRATION',assessment:'SECURITY dominates the current-period event set; this is not treated as a time-series trend.'}]
  });
  expect(quality.passed).toBe(true);
  expect(quality.score).toBeGreaterThanOrEqual(82);
});
