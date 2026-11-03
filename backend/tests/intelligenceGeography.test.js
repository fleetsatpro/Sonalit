'use strict';

const fs=require('fs');
const path=require('path');
const {normalizeCountryCode,countryCodesInText,inferCountryCodeFromText,inferCountryCodeFromItem}=require('../src/utils/intelligenceGeography');

describe('conservative intelligence country attribution',()=>{
  test('normalizes explicit country names and valid ISO codes',()=>{
    expect(normalizeCountryCode(' Kenya ')).toBe('KE');
    expect(normalizeCountryCode('south sudan')).toBe('SS');
    expect(normalizeCountryCode('cd')).toBe('CD');
    expect(normalizeCountryCode('us')).toBe('US');
    expect(normalizeCountryCode('not a country')).toBeNull();
  });

  test.each([
    ['Security forces report clashes near Juba','SS'],
    ['Road access interrupted in Goma, North Kivu','CD'],
    ['Police operation reported in Mogadishu','SO'],
    ['Protest reported near Addis Ababa','ET'],
    ['Flooding closes a road outside Dar es Salaam','TZ'],
    ['Security incident reported in Bujumbura','BI'],
    ['Armed group movement reported near Khartoum','SD'],
    ['Border incident near Kigali','RW'],
    ['Explosion reported in Asmara','ER'],
    ['Road incident reported near Garissa','KE'],
  ])('infers a supported country from local geography in %s',(story,expected)=>{
    expect(inferCountryCodeFromText(story)).toBe(expected);
  });

  test('does not guess when the story mentions multiple supported countries',()=>{
    expect(countryCodesInText('Officials from Kenya and Somalia met to discuss the border')).toEqual(expect.arrayContaining(['KE','SO']));
    expect(inferCountryCodeFromText('Officials from Kenya and Somalia met to discuss the border')).toBeNull();
  });

  test('prefers incident-specific headline to a later cross-country body reference',()=>{
    expect(inferCountryCodeFromItem({title:'Security operations reported in Juba',body:'Regional officials later met in Nairobi and Kampala.'})).toBe('SS');
  });

  test('both canonical collectors infer location and repair previously unscoped observations',()=>{
    const collection=fs.readFileSync(path.join(__dirname,'../src/utils/collectionFabric.js'),'utf8');
    const aggressive=fs.readFileSync(path.join(__dirname,'../src/utils/aggressiveIntelligenceAgents.js'),'utf8');
    for(const source of [collection,aggressive]){
      expect(source).toContain("require('./intelligenceGeography')");
      expect(source).toContain('COALESCE(intel_observations.country_code,EXCLUDED.country_code)');
      expect(source).toContain('country_scope_repaired');
    }
    expect(collection).toContain('safeFetchPublicResearch(url,{timeoutMs:TIMEOUT_MS,maxBytes:MAX_PUBLIC_RESEARCH_RESPONSE_BYTES})');
    expect(collection).toContain('process.env.INTEL_RSS_FEEDS');
    expect(aggressive).toContain("name:'The Standard · Mashinani', country_hint:'KE'");
    expect(aggressive).toContain('country_hint_authoritative:false');
    expect(aggressive).not.toContain('sourceCountryHint');
    expect(aggressive).not.toContain("name:'TUKO.co.ke', country_hint:'KE'");
  });
});
