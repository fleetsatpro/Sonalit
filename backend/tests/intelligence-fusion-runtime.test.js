'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/utils/intelligenceExtendedProviders', () => ({ buildExtendedAdapters: jest.fn(() => []) }));

const { query } = require('../src/config/database');
const { fuseOrg } = require('../src/utils/intelligenceFusionRuntime');

const ORG = '00000000-0000-0000-0000-000000000001';
const EVENT = '00000000-0000-0000-0000-000000000002';
const OBS = '00000000-0000-0000-0000-000000000003';

describe('intelligence fused-event persistence contract', () => {
  beforeEach(() => query.mockReset());

  test('uses impact thresholds for threat severity while keeping confidence separate',()=>{
    const {severityFor,confidenceFor,sourceKey}=require('../src/utils/intelligenceFusionRuntime');
    const {assessIncidentSeverity}=require('../src/utils/intelligenceTriage');

    expect(severityFor('Peaceful protest held in Nairobi')).toBe('low');
    expect(severityFor('Routine traffic congestion on the highway')).toBe('low');
    expect(severityFor('Ongoing armed attack reported near town')).toBe('high');
    expect(severityFor('Terrorist attack with at least 8 people killed')).toBe('critical');
    expect(severityFor('Terrorist attack with at least 10 people killed')).toBe('critical');
    expect(severityFor('More than 9 people killed in an armed attack')).toBe('critical');
    expect(severityFor('Hundreds killed in an armed attack')).toBe('critical');
    expect(severityFor('Two people were killed during an armed attack')).toBe('critical');
    expect(severityFor('Several people killed in an armed attack')).toBe('critical');
    expect(severityFor('Multiple fatalities reported after an armed attack')).toBe('critical');
    expect(severityFor('Massacre reported near the town')).toBe('critical');
    expect(severityFor('Ongoing bomb threat at a public venue')).toBe('moderate');
    expect(severityFor('Foiled bomb plot before a device was deployed')).toBe('moderate');
    expect(severityFor('A mass-casualty attack is only a possible future threat')).toBe('moderate');
    expect(severityFor('No multiple fatalities were reported')).toBe('low');
    expect(severityFor('No multiple fatalities, but two people were killed in the attack')).toBe('critical');
    expect(severityFor('No mass-casualty event was reported')).toBe('low');
    expect(severityFor('No mass-hostage crisis was reported')).toBe('low');
    expect(severityFor('No mass hostage crisis was reported')).toBe('low');
    expect(severityFor('No mass hostage-taking was reported')).toBe('low');
    expect(severityFor('No nationwide power outage was reported')).toBe('low');
    expect(severityFor('No armed attack was reported near the border')).toBe('low');
    expect(severityFor('No evidence of an armed attack was found')).toBe('low');
    expect(severityFor('No hostage crisis was reported')).toBe('low');
    expect(severityFor('No kidnapping was reported')).toBe('low');
    expect(severityFor('Bomb threat reported; no explosion or detonation occurred')).toBe('moderate');
    expect(severityFor('An unexploded device was found at the station')).toBe('moderate');
    expect(severityFor('No unexploded device was found at the station')).toBe('low');
    expect(severityFor('Bomb threat reported; no device found')).toBe('moderate');
    expect(severityFor('Two people were killed in an armed attack, but no mass-casualty event was declared')).toBe('critical');
    expect(severityFor('The armed attack killed two people')).toBe('critical');
    expect(severityFor('Five people were taken hostage, but no mass-hostage crisis was declared')).toBe('critical');
    expect(severityFor('One person was taken hostage, but no mass-hostage crisis was declared')).toBe('high');
    expect(severityFor('One person has been taken hostage, but no mass-hostage crisis was declared')).toBe('high');
    expect(severityFor('No nationwide power outage was reported, but a suspicious device was found')).toBe('moderate');
    expect(severityFor('There were no deaths reported after the incident')).toBe('low');
    expect(severityFor('Nationwide power outage across multiple cities')).toBe('critical');
    expect(severityFor('Risk of a nationwide power outage')).toBe('moderate');
    expect(assessIncidentSeverity('kidnapping','Five people were taken hostage')).toMatchObject({severity:'critical'});
    expect(assessIncidentSeverity('kidnapping','Two people were taken hostage')).toMatchObject({severity:'high'});
    expect(assessIncidentSeverity('kidnapping','Planned armed men take multiple hostages at a school')).toMatchObject({severity:'medium'});
    expect(assessIncidentSeverity('kidnapping','Two people were taken hostage')).toMatchObject({severity:'high'});
    expect(assessIncidentSeverity('kidnapping','Armed men take multiple hostages at a school')).toMatchObject({severity:'critical'});
    expect(assessIncidentSeverity('other','No one was killed during a peaceful protest')).toMatchObject({severity:'low'});

    const criticalAssessment=assessIncidentSeverity('armed_attack','Terrorist attack with at least 8 people killed');
    expect(criticalAssessment).toMatchObject({severity:'critical',urgency:'immediate'});
    const speculativeMassCasualty=assessIncidentSeverity('other','A mass-casualty attack is only a possible future threat');
    expect(speculativeMassCasualty).toMatchObject({severity:'medium',urgency:'routine'});

    const preliminary=assessIncidentSeverity('armed_attack','Ongoing armed attack reported near town');
    expect(preliminary.verification_state).toBe('unverified');
    expect(preliminary.preliminary).toBe(true);
    expect(preliminary.reason_codes).toContain('ARMED_ATTACK_REPORTED');
    expect(preliminary.thresholds.critical_fatalities).toBe(2);

    const observations=[{reliability:95,observed_at:new Date().toISOString(),source_id:'a'}];
    expect(confidenceFor(observations,1,0)).toBeLessThanOrEqual(45);
    expect(sourceKey({provider:'newsmesh',source_id:'a',raw_metadata:{aggregator_source:'The Star'}})).toBe('the star');
    expect(sourceKey({provider:'newsmesh',source_id:'b',raw_metadata:{aggregator_source:'The Star'}})).toBe('the star');
    expect(sourceKey({provider:'newsmesh',source_id:'feed-1',url:'https://www.example-news.test/story/one'})).toBe('example-news.test');
    expect(sourceKey({provider:'newsmesh',source_id:'feed-2',url:'https://example-news.test/story/two'})).toBe('example-news.test');
  });
  test('excludes unrelated observations from corroboration and event evidence',async()=>{
    const observedAt=new Date().toISOString();
    query.mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[
        {id:OBS,source_id:'feed-security',provider:'newsmesh',reliability:80,country_code:'KE',title:'Regional incident bulletin',body:'Armed attack reported near Nairobi',url:'https://publisher-one.test/story',observed_at:observedAt,content_hash:'h1',manipulation_score:0},
        {id:'00000000-0000-0000-0000-000000000004',source_id:'feed-sports',provider:'newsmesh',reliability:90,country_code:'KE',title:'Regional incident bulletin',body:'Football league match preview and tickets are now available',url:'https://publisher-two.test/story',observed_at:observedAt,content_hash:'h2',manipulation_score:0}
      ]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{id:EVENT}]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{id:'quality-2'}]});
    const result=await fuseOrg(ORG);
    expect(result.created).toBe(1);
    const insert=query.mock.calls[3];
    expect(insert[1][12]).toBe(1);
    expect(insert[1][13]).toBe(1);
    expect(query.mock.calls[4][1][1]).toEqual([OBS]);
  });

  test('inserts a fused intel event with exactly one value per target column', async () => {
    const observedAt = new Date().toISOString();
    query
      // watchlists
      .mockResolvedValueOnce({ rows: [] })
      // observations
      .mockResolvedValueOnce({ rows: [{
        id: OBS,
        source_id: '00000000-0000-0000-0000-000000000010',
        provider: 'test-source',
        reliability: 80,
        country_code: 'KE',
        title: 'Armed attack reported near Nairobi',
        body: 'Test incident body',
        observed_at: observedAt,
        content_hash: 'hash-1',
        manipulation_score: 0,
      }] })
      // existing event lookup
      .mockResolvedValueOnce({ rows: [] })
      // fused event insert
      .mockResolvedValueOnce({ rows: [{ id: EVENT }] })
      // observation linkage
      .mockResolvedValueOnce({ rows: [] })
      // quality history
      .mockResolvedValueOnce({ rows: [{ id: 'quality-1' }] });

    const result = await fuseOrg(ORG);

    expect(result.created).toBe(1);
    const insert = query.mock.calls[3];
    expect(insert).toBeDefined();
    expect(insert[0]).toContain('INSERT INTO intel_events');
    expect(insert[0]).toContain('manipulation_score)');
    expect(insert[0]).toContain('$15) RETURNING id');
    expect(insert[0]).not.toContain('$16');
    expect(insert[1]).toHaveLength(15);
    expect(query).toHaveBeenCalledTimes(6);
  });
});
