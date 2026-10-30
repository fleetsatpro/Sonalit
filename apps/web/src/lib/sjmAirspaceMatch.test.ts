import { describe, expect, it } from 'vitest';
import { correlateJourneyFlight, normaliseFlightIdent } from './sjmAirspaceMatch.js';

const aircraft={
  id:'abc123',ident:'KQ100',origin:null,destination:null,
  observed_at:'2026-10-30T11:59:30.000Z',freshness:'LIVE',
  latitude:-1.3,longitude:36.8,altitude_m:10800,altitude_reference:'GEOMETRIC',ground_speed_mps:220,heading_deg:280,
};

describe('SJM airspace display status',()=>{
  it('preserves regional stale state when OpenSky is not configured',()=>{
    expect(resolveAirspaceDisplayStatus('NOT_CONFIGURED','STALE')).toBe('STALE');
  });
  it('surfaces a regional rate limit when the primary feed is not configured',()=>{
    expect(resolveAirspaceDisplayStatus('NOT_CONFIGURED','RATE_LIMITED')).toBe('RATE_LIMITED');
  });
  it('summarises the freshest observation across the provider federation',()=>{
    expect(resolveAirspaceDisplayStatus('CONNECTED','LIVE')).toBe('LIVE');
    expect(resolveAirspaceDisplayStatus('DELAYED','STALE')).toBe('DELAYED');
  });
  it('does not downgrade a live primary snapshot because a secondary feed is stale',()=>{
    expect(resolveAirspaceDisplayStatus('LIVE','STALE')).toBe('LIVE');
  });
  it('shows regional refreshing when the primary feed is unavailable',()=>{
    expect(resolveAirspaceDisplayStatus('UNAVAILABLE','REFRESHING')).toBe('REFRESHING');
  });
});

describe('SJM journey flight correlation',()=>{
  it('normalises spaces and punctuation without changing the stored reference',()=>{
    expect(normaliseFlightIdent(' kq 100 ')).toBe('KQ100');
    expect(normaliseFlightIdent('KQ-100')).toBe('KQ100');
    expect(normaliseFlightIdent('')).toBe('');
  });

  it('does not claim a match when the journey has no flight reference',()=>{
    const result=correlateJourneyFlight({configured:true,connected:true,providerStatus:'LIVE',aircraft:[aircraft],events:[]});
    expect(result).toMatchObject({status:'NO_REFERENCE',reference:null,aircraft:[],events:[]});
  });

  it('fails closed while the licensed provider is not configured',()=>{
    const result=correlateJourneyFlight({flightReference:'KQ100',configured:false,connected:false,providerStatus:'NOT_CONFIGURED',aircraft:[aircraft],events:[]});
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.aircraft).toEqual([]);
  });

  it('matches one exact callsign and keeps airport alignment distinct',()=>{
    const result=correlateJourneyFlight({flightReference:'KQ 100',airportCode:'NBO',configured:true,connected:true,providerStatus:'LIVE',aircraft:[aircraft],events:[]});
    expect(result).toMatchObject({status:'MATCHED',normalised_reference:'KQ100',airport_alignment:'NOT_ESTABLISHED'});
    expect(result.aircraft).toHaveLength(1);
  });

  it('does not select between multiple exact aircraft matches',()=>{
    const result=correlateJourneyFlight({flightReference:'KQ100',configured:true,connected:true,providerStatus:'LIVE',aircraft:[aircraft,{...aircraft,id:'fa-flight-2'}],events:[]});
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.aircraft).toHaveLength(2);
  });


  it('treats two provider records for one ICAO24 as one identity without claiming corroboration early',()=>{
    const openSky={...aircraft,position_provider:'opensky_rest'};
    const secondary={...aircraft,position_provider:'adsb_lol',latitude:-1.31,longitude:36.81};
    const result=correlateJourneyFlight({
      flightReference:'KQ100',configured:true,connected:true,providerStatus:'LIVE',
      aircraft:[openSky,secondary],events:[],sourceComparison:{status:'INSUFFICIENT_DATA'},
    });
    expect(result.status).toBe('MATCHED');
    expect(result.aircraft).toHaveLength(2);
  });

  it('labels shared ICAO24 observations corroborated only when server comparison passes',()=>{
    const openSky={...aircraft,position_provider:'opensky_rest'};
    const secondary={...aircraft,position_provider:'adsb_lol'};
    const result=correlateJourneyFlight({
      flightReference:'KQ100',configured:true,connected:true,providerStatus:'LIVE',
      aircraft:[openSky,secondary],events:[],sourceComparison:{status:'CORROBORATED'},
    });
    expect(result.status).toBe('CORROBORATED');
    expect(result.aircraft).toHaveLength(2);
    expect(result.explanation).toContain('time and position comparison');
  });

  it('surfaces provider identity disagreements rather than collapsing them into an ordinary match',()=>{
    const openSky={...aircraft,position_provider:'opensky_rest'};
    const secondary={...aircraft,id:'def456',position_provider:'adsb_lol'};
    const result=correlateJourneyFlight({
      flightReference:'KQ100',configured:true,connected:true,providerStatus:'LIVE',
      aircraft:[openSky,secondary],events:[],sourceComparison:{status:'AIRCRAFT_ID_DISAGREEMENT'},
    });
    expect(result.status).toBe('SOURCE_DISAGREEMENT');
  });


  it('keeps flight-information events separate from current position matches',()=>{
    const event={type:'arrival',ident:'KQ100',airport:'HKJK',observed_at:'2026-10-30T11:58:00.000Z',received_at:'2026-10-30T11:58:01.000Z'};
    const result=correlateJourneyFlight({flightReference:'KQ100',configured:true,connected:true,providerStatus:'CONNECTED',aircraft:[],events:[event]});
    expect(result.status).toBe('EVENT_ONLY');
    expect(result.events).toEqual([event]);
    expect(result.aircraft).toEqual([]);
  });

  it('does not imply a missing flight is absent when OpenSky is unavailable',()=>{
    const result=correlateJourneyFlight({flightReference:'KQ100',configured:true,connected:false,providerStatus:'RATE_LIMITED',aircraft:[],events:[]});
    expect(result.status).toBe('FEED_UNAVAILABLE');
  });

  it('does not interpret an empty degraded snapshot as a flight not being present',()=>{
    const result=correlateJourneyFlight({flightReference:'KQ100',configured:true,connected:false,providerStatus:'DEGRADED',aircraft:[],events:[]});
    expect(result.status).toBe('FEED_UNAVAILABLE');
  });

  it('does not infer an airport match when provider route data is absent or different',()=>{
    const result=correlateJourneyFlight({flightReference:'KQ100',airportCode:'NBO',configured:true,connected:true,providerStatus:'LIVE',aircraft:[aircraft],events:[]});
    expect(result.status).toBe('MATCHED');
    expect(result.airport_alignment).toBe('NOT_ESTABLISHED');
  });
});
