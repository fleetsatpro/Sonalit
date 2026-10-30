'use strict';

const aviation=require('../src/services/sjmAviationIntelligence');

describe('SJM federated aviation intelligence',()=>{
  const now=Date.parse('2026-10-30T10:00:00.000Z');

  beforeEach(()=>aviation.resetCacheForTests());

  test('fails closed for ADSB.lol until production access and ODbL compliance are confirmed',()=>{
    expect(aviation.getAdsbLolConfig({SJM_ADSBLOL_ENABLED:'true'})).toMatchObject({
      enabled:false,reason:'production_access_not_confirmed_with_provider',
    });
    expect(aviation.getAdsbLolConfig({
      SJM_ADSBLOL_ENABLED:'true',SJM_ADSBLOL_PRODUCTION_APPROVED:'true',
    })).toMatchObject({enabled:false,reason:'odbl_database_obligations_not_reviewed'});
    expect(aviation.getAdsbLolConfig({
      SJM_ADSBLOL_ENABLED:'true',SJM_ADSBLOL_PRODUCTION_APPROVED:'true',
      SJM_ADSBLOL_ODBL_COMPLIANCE_CONFIRMED:'true',
    })).toMatchObject({enabled:true,reason:null});
  });

  test('requires AeroDataBox commercial and downstream derived-work rights independently',()=>{
    const base={
      SJM_AERODATABOX_ENABLED:'true',
      AERODATABOX_API_KEY:'secret',
      AERODATABOX_API_BASE_URL:'https://prod.api.market/api/v1/aedbx/aerodatabox',
    };
    expect(aviation.getAeroDataBoxConfig(base)).toMatchObject({
      enabled:false,reason:'commercial_api_license_not_confirmed',
    });
    expect(aviation.getAeroDataBoxConfig({...base,SJM_AERODATABOX_COMMERCIAL_LICENSE_CONFIRMED:'true'})).toMatchObject({
      enabled:false,reason:'downstream_derived_work_rights_not_confirmed',
    });
    expect(aviation.getAeroDataBoxConfig({
      ...base,SJM_AERODATABOX_COMMERCIAL_LICENSE_CONFIRMED:'true',
      SJM_AERODATABOX_DERIVED_WORK_LICENSE_CONFIRMED:'true',
    })).toMatchObject({
      enabled:true,baseUrl:'https://prod.api.market/api/v1/aedbx/aerodatabox',
    });
  });

  test('rejects non-HTTPS or untrusted AeroDataBox gateways',()=>{
    expect(aviation.validBaseUrl('http://aerodatabox.com',['aerodatabox.com'])).toBeNull();
    expect(aviation.validBaseUrl('https://evil.example/aerodatabox',['aerodatabox.com'])).toBeNull();
    expect(aviation.validBaseUrl('https://user:pass@aerodatabox.com',['aerodatabox.com'])).toBeNull();
    expect(aviation.validBaseUrl('https://aerodatabox.com/path?secret=x',['aerodatabox.com'])).toBeNull();
  });

  test('normalises aviation weather times and leaves absent measurements null',()=>{
    const records=aviation.normaliseWeatherRecords([{
      icaoId:'HKJK',obsTime:now/1000,rawOb:'HKJK 301000Z 09008KT CAVOK 27/18 Q1018',
      wdir:90,wspd:8,wgst:null,temp:27,dewp:18,altim:1018,
    }],'METAR',now);
    expect(records[0]).toMatchObject({
      kind:'METAR',station_icao:'HKJK',observed_at:new Date(now).toISOString(),
      wind_direction_deg:90,wind_speed_kt:8,wind_gust_kt:null,
      temperature_c:27,dewpoint_c:18,altimeter_hpa:1018,
      raw:'HKJK 301000Z 09008KT CAVOK 27/18 Q1018',
      provider:'aviationweather_gov',evidence_class:'OBSERVED',
    });
    expect(aviation.normaliseWeatherRecords([{
      icaoId:'HKJK',obsTime:null,wdir:null,wspd:null,temp:null,
    }],'METAR',now)[0]).toMatchObject({
      observed_at:null,wind_direction_deg:null,wind_speed_kt:null,temperature_c:null,
    });
  });

  test('does not issue AviationWeather queries for an unresolved three-letter airport code',async()=>{
    const fetcher=jest.fn();
    const result=await aviation.loadWeather({airportIcao:'NBO',fetcher,now});
    expect(result).toMatchObject({status:'NOT_REQUESTED',reason:'journey_airport_icao_required',station_icao:null});
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('loads worldwide METAR, TAF and international SIGMET using a scoped ICAO station and caches the result',async()=>{
    const fetcher=jest.fn(async(url)=>{
      const path=String(url);
      const body=path.includes('/metar')
        ?[{icaoId:'HKJK',obsTime:now/1000,rawOb:'HKJK METAR TEST',wdir:100,wspd:6}]
        :path.includes('/taf')
          ?[{icaoId:'HKJK',issueTime:now/1000,rawTAF:'HKJK TAF TEST'}]
          :[{firId:'HKNA',validTimeFrom:now/1000,validTimeTo:now/1000+3600,rawAirSigmet:'SIGMET TEST'}];
      return {ok:true,status:200,json:async()=>body};
    });
    const result=await aviation.loadWeather({airportIcao:'HKJK',fetcher,now});
    expect(result).toMatchObject({
      status:'AVAILABLE',station_icao:'HKJK',
      metar:[{kind:'METAR',raw:'HKJK METAR TEST'}],
      taf:[{kind:'TAF',raw:'HKJK TAF TEST'}],
      international_sigmets:[{kind:'SIGMET',raw:'SIGMET TEST'}],
      source:'AviationWeather.gov Data API',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const cached=await aviation.loadWeather({airportIcao:'HKJK',fetcher:jest.fn(),now:now+1_000});
    expect(cached.cache_state).toBe('HIT');
  });

  test('normalises an ADSB.lol record without inventing an origin, destination or observation timestamp',()=>{
    const item=aviation.normaliseAdsbLolRecord({
      hex:'abc123',flight:'KQ 100 ',r:'5Y-KZA',lat:-1.3,lon:36.8,
      alt_geom:12400,alt_baro:12000,gs:220,track:90,seen_pos:12,
    },now);
    expect(item).toMatchObject({
      id:'abc123',ident:'KQ 100',registration:'5Y-KZA',
      latitude:-1.3,longitude:36.8,ground_speed_kt:220,heading_deg:90,
      provider:'adsb_lol',age_seconds:12,evidence_class:'OBSERVED',
      timestamp_basis:'derived_from_provider_seen_pos',
    });
    expect(item.observed_at).toBe(new Date(now-12_000).toISOString());
    expect(aviation.normaliseAdsbLolRecord({hex:'abc123',flight:'KQ100',lat:null,lon:36.8},now)).toBeNull();
  });

  test('performs an ADSB.lol callsign lookup only after production and ODbL gates are enabled',async()=>{
    const fetcher=jest.fn().mockResolvedValue({
      ok:true,status:200,json:async()=>({ac:[{
        hex:'abc123',flight:'KQ100',lat:-1.3,lon:36.8,seen_pos:5,gs:210,track:90,
      }]}),
    });
    const disabled=await aviation.loadAdsbLolCallsign({callsign:'KQ100',fetcher,now});
    expect(disabled).toMatchObject({status:'NOT_CONFIGURED',records:[]});
    expect(fetcher).not.toHaveBeenCalled();
    const env={
      SJM_ADSBLOL_ENABLED:'true',SJM_ADSBLOL_PRODUCTION_APPROVED:'true',
      SJM_ADSBLOL_ODBL_COMPLIANCE_CONFIRMED:'true',
    };
    const result=await aviation.loadAdsbLolCallsign({callsign:'KQ100',env,fetcher,now});
    expect(result).toMatchObject({
      status:'AVAILABLE',source:'adsb.lol',licence:'ODbL-1.0',
      records:[{id:'abc123',ident:'KQ100',provider:'adsb_lol'}],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('/v2/callsign/KQ100');
  });

  test('performs a commercial flight lookup only with both licences and keeps the API key server-side',async()=>{
    const env={
      SJM_AERODATABOX_ENABLED:'true',
      SJM_AERODATABOX_COMMERCIAL_LICENSE_CONFIRMED:'true',
      SJM_AERODATABOX_DERIVED_WORK_LICENSE_CONFIRMED:'true',
      AERODATABOX_API_KEY:'server-secret',
      AERODATABOX_API_BASE_URL:'https://prod.api.market/api/v1/aedbx/aerodatabox',
      AERODATABOX_API_KEY_HEADER:'x-api-key',
    };
    const fetcher=jest.fn().mockResolvedValue({
      ok:true,status:200,json:async()=>[{number:'KQ100',status:'EnRoute'}],
    });
    const result=await aviation.loadCommercialFlight({flightNumber:'KQ 100',env,fetcher,now});
    expect(result).toMatchObject({
      status:'AVAILABLE',flight_number:'KQ100',source:'AeroDataBox',
      flights:[{number:'KQ100',status:'EnRoute'}],
      commercial_data:true,derived_work_rights_confirmed:true,
    });
    expect(fetcher.mock.calls[0][0]).toBe('https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/KQ100?dateLocalRole=Both');
    expect(fetcher.mock.calls[0][1].headers['x-api-key']).toBe('server-secret');
    expect(JSON.stringify(result)).not.toContain('server-secret');
  });

  test('does not use Eurocontrol EAD Basic as an operational NOTAM source',()=>{
    const providers=aviation.buildSourceRegistry({
      opensky:{status:'LIVE'},
      weather:{status:'AVAILABLE'},
      adsbLol:{status:'NOT_CONFIGURED'},
      commercial:{status:'NOT_CONFIGURED'},
    });
    expect(providers.find(item=>item.id==='kcaa_aim')).toMatchObject({
      status:'ACCESS_REQUIRED',operational_authority:true,url:'https://aim.kcaa.or.ke/',
    });
    expect(providers.find(item=>item.id==='eurocontrol_ead')).toMatchObject({
      status:'AGREEMENT_REQUIRED',operational_authority:true,
    });
    expect(providers.find(item=>item.id==='ourairports')).toMatchObject({status:'AVAILABLE_NOT_SYNCED'});
  });

  test('returns no fake flight or weather records when optional providers are not configured',async()=>{
    const baseSnapshot={provider:'opensky_rest',status:'NOT_CONFIGURED',aircraft:[]};
    const result=await aviation.getSnapshot({baseSnapshot,env:{},fetcher:jest.fn(),now});
    expect(result.intelligence).toMatchObject({
      provenance:{multi_provider:true,fabricated_data_used:false,providers_are_not_equivalent_authorities:true},
      flight_status:{status:'NOT_CONFIGURED',flights:[]},
      aircraft_cross_check:{status:'NOT_CONFIGURED',records:[]},
      aviation_weather:{status:'NOT_REQUESTED',metar:[],taf:[],international_sigmets:[]},
      notams:{status:'ACCESS_REQUIRED'},
    });
  });
});
