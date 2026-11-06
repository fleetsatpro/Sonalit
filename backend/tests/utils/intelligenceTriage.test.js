'use strict';
const {plainText,incidentCategory,assessIncidentSeverity,securityRelevance,independentSourceKey}=require('../../src/utils/intelligenceTriage');
describe('Intelligence observation text normalization and threat triage',()=>{
 test('strips RSS attributes and decodes entities retaining visible text',()=>{
  const raw='<a href="https://news.google.com/rss/articles/example?q=protest+Nairobi" target="_blank">Tickets sale opens for highly anticipated Bayern Munich vs AFC Ajax clash</a>&nbsp;<font color="#6f6f6f">Kenya News Agency</font>',text=plainText(raw);
  expect(text).toBe('Tickets sale opens for highly anticipated Bayern Munich vs AFC Ajax clash Kenya News Agency');expect(text).not.toMatch(/href=|target=|<a|&nbsp;|<font/i);expect(incidentCategory(text)).toBe('other');expect(assessIncidentSeverity('other',text).severity).toBe('low');
 });
 test('cleans encoded markup and suppresses script/style blocks',()=>{
  expect(plainText('&lt;a href=&quot;https://example.test/?q=attack&quot;&gt;Local match tickets&lt;/a&gt;&amp;nbsp;')).toBe('Local match tickets');
  expect(plainText('<style>.x{content:"protest"}</style><script>IED attack</script>Weather report')).toBe('Weather report');expect(plainText('A&nbsp;road&nbsp;closure &mdash; updated')).toBe('A road closure — updated');
 });
 test('keeps peaceful protest, rally, routine traffic and minor accident Low',()=>{
  expect(assessIncidentSeverity('protest','Peaceful protest in Nairobi with no reported injuries').severity).toBe('low');expect(assessIncidentSeverity('political_rally','Political rally held peacefully').severity).toBe('low');expect(assessIncidentSeverity('traffic','Heavy traffic congestion in CBD').severity).toBe('low');expect(assessIncidentSeverity('accident','Minor road accident; no injuries').severity).toBe('low');
 });
 test('raises bounded disruption/injury without inflating it to Critical',()=>{
  const result=assessIncidentSeverity('protest','Protesters block the main highway, disrupting access to the airport');expect(result.severity).toBe('medium');expect(result.impact).toBe('material');expect(assessIncidentSeverity('accident','Multi-vehicle collision leaves several injured').severity).toBe('medium');expect(assessIncidentSeverity('accident','Multi-vehicle collision leaves several seriously injured').severity).toBe('high');
 });
 test('escalates two or more reported deaths to Critical, not mere casualty counts',()=>{
  expect(assessIncidentSeverity('armed_attack','Two people killed in an armed attack').severity).toBe('critical');
  expect(assessIncidentSeverity('armed_attack','Armed attack kills one person').severity).toBe('high');
  expect(assessIncidentSeverity('armed_attack','Armed attack leaves two people injured, no deaths').severity).toBe('high');
 });
 test('does not treat generic fatal wording as evidence of a fatality',()=>{
  expect(assessIncidentSeverity('other','A fatal flaw in the county allocation process').severity).toBe('low');
  expect(assessIncidentSeverity('accident','Fatal crash reported on the highway').severity).toBe('high');
 });
 test('reserves High/Critical for explicit serious impact',()=>{
  expect(assessIncidentSeverity('armed_attack','Ongoing armed attack reported near the town').severity).toBe('high');expect(assessIncidentSeverity('kidnapping','Two people kidnapped from their home').severity).toBe('high');
  const critical=assessIncidentSeverity('armed_attack','Terrorist attack with at least 8 people killed');expect(critical.severity).toBe('critical');expect(critical.impact).toBe('catastrophic');expect(critical.urgency).toBe('immediate');
 });
 test('does not mistake a sports fixture clash for a protest/security incident',()=>{
  const title='Tickets sale opens for highly anticipated Bayern Munich vs AFC Ajax clash';
  expect(incidentCategory(title)).toBe('other');
  expect(assessIncidentSeverity(incidentCategory(title),title).severity).toBe('low');
  expect(incidentCategory('Protesters clash with police in Nairobi')).toBe('protest');
  expect(incidentCategory('Armed clashes reported near the border')).toBe('armed_attack');
  expect(incidentCategory('Terrorist attack reported in the region')).toBe('armed_attack');
 });
 test('separates security-relevant leads from ordinary public news',()=>{
  const sports='Tickets sale opens for highly anticipated Bayern Munich vs AFC Ajax clash';
  const journalism='Journalists challenged to tell stories that matter';
  expect(securityRelevance(incidentCategory(sports),sports)).toBe('not_security_relevant');
  expect(securityRelevance(incidentCategory(journalism),journalism)).toBe('not_security_relevant');
  expect(securityRelevance('protest','Peaceful protest announced in Nairobi')).toBe('security_relevant');
  expect(securityRelevance('traffic','Traffic congestion reported in the CBD')).toBe('not_security_relevant');
  expect(securityRelevance('traffic','Road blocked after a roadblock closes airport access')).toBe('operationally_relevant');
  expect(securityRelevance('protest','Roadblock shuts airport access with no confrontation')).toBe('operationally_relevant');
  expect(securityRelevance('accident','Minor fender-bender; no injuries')).toBe('not_security_relevant');
  expect(securityRelevance('accident','Multi-vehicle collision leaves several seriously injured')).toBe('operationally_relevant');
  expect(securityRelevance('political_rally','Candidate announces a campaign rally')).toBe('not_security_relevant');
  expect(securityRelevance('political_rally','Thousands gather for a rally as roads close and clashes erupt')).toBe('potential_security_relevant');
  expect(securityRelevance('protest','CRA ignores governors’ protests, sticks to Sh440.8bn county allocation')).toBe('not_security_relevant');
  expect(securityRelevance('protest','Lawyers stage protests in Nairobi CBD over abduction saga')).toBe('security_relevant');
  expect(securityRelevance('protest','Protesters block a highway over budget cuts')).toBe('security_relevant');
  expect(assessIncidentSeverity('other','Police investigate suspicious package near an embassy').severity).toBe('medium');
  expect(securityRelevance('other','Police investigate suspicious package near an embassy')).toBe('potential_security_relevant');
  expect(securityRelevance('other','Confirmed cyber attack against hospital systems')).toBe('potential_security_relevant');
  expect(securityRelevance(incidentCategory('Nationwide power outage across multiple cities'),'Nationwide power outage across multiple cities')).toBe('operationally_relevant');
 });
 test('does not inflate generic armed-group and prevention language',()=>{
  expect(incidentCategory('Militia leaders attend peace talks')).toBe('other');
  expect(assessIncidentSeverity('other','Militia leaders attend peace talks').severity).toBe('low');
  expect(assessIncidentSeverity('kidnapping','Police launch an anti-kidnapping prevention campaign').severity).toBe('low');
  expect(assessIncidentSeverity('ied','Bomb disposal team removes an unexploded device').severity).toBe('medium');
  expect(assessIncidentSeverity('armed_attack','A militia group announces a political meeting').severity).toBe('low');
 });
 test('reserves Critical hostage classification for catastrophic-scale cases',()=>{
  expect(incidentCategory('One person taken hostage during a robbery')).toBe('kidnapping');
  expect(assessIncidentSeverity('kidnapping','One person taken hostage during a robbery').severity).toBe('high');
  expect(assessIncidentSeverity('kidnapping','Armed men take multiple hostages at a school').severity).toBe('critical');
  expect(incidentCategory('Armed men take multiple hostages at a school')).toBe('kidnapping');
 });
 test('counts independent publishers rather than feed records',()=>{
  const a=independentSourceKey({provider:'newsmesh',source_id:'feed-a',url:'https://www.example-news.test/story/one'});
  const b=independentSourceKey({provider:'newsmesh',source_id:'feed-b',url:'https://example-news.test/story/two'});
  expect(a).toBe('example-news.test');expect(b).toBe(a);
  expect(independentSourceKey({provider:'newsmesh',source_id:'feed-c',raw_metadata:{feed:'The Star Kenya'},url:'https://news.google.com/rss/articles/a'})).toBe('the star kenya');
  expect(independentSourceKey({provider:'telegram',source_id:'tg-a',raw_metadata:{channel:'security_updates'}})).toBe('telegram:security_updates');
  expect(independentSourceKey({provider:'telegram',source_id:'tg-b',raw_metadata:{channel:'another_channel'}})).not.toBe('telegram:security_updates');
  expect(independentSourceKey({provider:'x',source_id:'x-feed',raw_metadata:{author_id:'1001'}})).toBe('x:1001');
 });
 test('keeps an unverified bomb threat below Critical',()=>{
  const threat=assessIncidentSeverity('ied','Police investigate a bomb threat; no device found and no injuries');expect(threat.severity).toBe('medium');expect(threat.preliminary).toBe(true);expect(threat.caveat).toMatch(/does not establish that the report is true/i);
 });
});
