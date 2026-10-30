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

  test('caches the worldwide SIGMET response across distinct airport weather lookups',async()=>{
    const fetcher=jest.fn(async(url)=>{
      const path=String(url);
      const body=path.includes('/metar')
        ?[{icaoId:path.includes('HKMO')?'HKMO':'HKJK',obsTime:now/1000,rawOb:'METAR'}]
        :path.includes('/taf')
          ?[{icaoId:path.includes('HKMO')?'HKMO':'HKJK',issueTime:now/1000,rawTAF:'TAF'}]
          :[{firId:'HKNA',validTimeFrom:now/1000,rawAirSigmet:'GLOBAL SIGMET'}];
      return {ok:true,status:200,json:async()=>body};
    });
    await aviation.loadWeather({airportIcao:'HKJK',fetcher,now});
    await aviation.loadWeather({airportIcao:'HKMO',fetcher,now:now+1_000});
    expect(fetcher).toHaveBeenCalledTimes(5);
    const sigmetCalls=fetcher.mock.calls.filter(call=>String(call[0]).includes('/isigmet'));
    expect(sigmetCalls).toHaveLength(1);
  });

  test('does not mark the federation live when only the provider registry is populated',async()=>{
    const baseSnapshot={provider:'opensky_rest',status:'NOT_CONFIGURED',configured:false,aircraft:[]};
    const fetcher=jest.fn();
    const result=await aviation.getSnapshot({baseSnapshot,env:{},fetcher,now:now+2_000});
    expect(result.intelligence.provenance).toMatchObject({
      multi_provider:false,active_provider_count:0,provider_registry_present:true,
    });
  });

  test('marks a multi-provider view only when OpenSky and another source return records',async()=>{
    const fetcher=jest.fn(async(url)=>{
      const path=String(url);
      const body=path.includes('/metar')?[{icaoId:'HKJK',obsTime:now/1000,rawOb:'METAR'}]
        :path.includes('/taf')?[{icaoId:'HKJK',issueTime:now/1000,rawTAF:'TAF'}]
          :[{firId:'HKNA',validTimeFrom:now/1000,rawAirSigmet:'SIGMET'}];
      return {ok:true,status:200,json:async()=>body};
    });
    const baseSnapshot={provider:'opensky_rest',status:'LIVE',configured:true,connected:true,aircraft:[]};
    const result=await aviation.getSnapshot({airportIcao:'HKJK',baseSnapshot,env:{},fetcher,now:now+3_000});
    expect(result.intelligence.provenance).toMatchObject({
      multi_provider:true,active_provider_count:2,provider_registry_present:true,
    });
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
      ok:true,status:200,json:async()=>[{
        number:'KQ100',status:'EnRoute',airline:{name:'Kenya Airways',iata:'KQ',icao:'KQA'},
        departure:{
          airport:{name:'Jomo Kenyatta International',iata:'NBO',icao:'HKJK',countryCode:'KE'},
          scheduledTime:{utc:'2026-10-30T08:00:00Z',local:'2026-10-30 11:00+03'},revisedTime:{utc:'2026-10-30T08:20:00Z',local:'2026-10-30 11:20+03'},
          gate:'12',terminal:'1',
        },
        arrival:{
          airport:{name:'Heathrow',iata:'LHR',icao:'EGLL',countryCode:'GB'},
          scheduledTime:{utc:'2026-10-30T16:00:00Z'},
        },
        aircraft:{reg:'5Y-KZA',model:'B789'},
        quality:['LiveFlightInfo'],
      }],
    });
    const result=await aviation.loadCommercialFlight({flightNumber:'KQ 100',env,fetcher,now});
    expect(result).toMatchObject({
      status:'AVAILABLE',flight_number:'KQ100',source:'AeroDataBox',
      flights:[{
        flight_number:'KQ100',status:'EnRoute',airline_name:'Kenya Airways',
        departure:{airport_iata:'NBO',airport_icao:'HKJK',scheduled_at:'2026-10-30T08:00:00.000Z',scheduled_local:'2026-10-30 11:00+03',revised_at:'2026-10-30T08:20:00.000Z',revised_local:'2026-10-30 11:20+03',gate:'12'},
        arrival:{airport_iata:'LHR',airport_icao:'EGLL',scheduled_at:'2026-10-30T16:00:00.000Z'},
        aircraft_registration:'5Y-KZA',aircraft_type:'B789',
        evidence_class:'COMMERCIAL_PROVIDER_FLIGHT_INFORMATION',
      }],
      commercial_data:true,derived_work_rights_confirmed:true,
    });
    expect(fetcher.mock.calls[0][0]).toBe('https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/KQ100?dateLocalRole=Both');
    expect(fetcher.mock.calls[0][1].headers['x-api-key']).toBe('server-secret');
    expect(JSON.stringify(result)).not.toContain('server-secret');
  });

  test('normalises commercial flight schedule fields while keeping missing milestones null',()=>{
    const flight=aviation.normaliseCommercialFlight({
      number:'KQ100',status:'Expected',
      departure:{airport:{iata:'NBO'},scheduledTime:{utc:'2026-10-30T08:00:00Z',local:'2026-10-30 11:00+03'}},
      arrival:{airport:{iata:'LHR'},scheduledTime:{utc:'2026-10-30T16:00:00Z'}},
    });
    expect(flight).toMatchObject({
      flight_number:'KQ100',status:'Expected',
      departure:{airport_iata:'NBO',scheduled_at:'2026-10-30T08:00:00.000Z',scheduled_local:'2026-10-30 11:00+03',actual_at:null,actual_local:null,gate:null},
      arrival:{airport_iata:'LHR',scheduled_at:'2026-10-30T16:00:00.000Z',actual_at:null,gate:null},
      evidence_class:'COMMERCIAL_PROVIDER_FLIGHT_INFORMATION',
    });
  });

  test('corroborates two independent aircraft observations only when ICAO24, time and position agree',()=>{
    const opensky={
      configured:true,status:'LIVE',
      aircraft:[{id:'abc123',ident:'KQ100',latitude:-1.3,longitude:36.8,observed_at:new Date(now).toISOString()}],
    };
    const adsbLol={
      status:'AVAILABLE',
      records:[{id:'abc123',ident:'KQ100',latitude:-1.31,longitude:36.81,observed_at:new Date(now-10_000).toISOString()}],
    };
    expect(aviation.compareAircraftSources({flightNumber:'KQ100',opensky,adsbLol})).toMatchObject({
      status:'CORROBORATED',primary_count:1,secondary_count:1,
    });
  });

  test('does not merge mismatching ICAO24 identifiers for an exact callsign',()=>{
    const opensky={configured:true,status:'LIVE',aircraft:[{
      id:'abc123',ident:'KQ100',latitude:-1.3,longitude:36.8,observed_at:new Date(now).toISOString(),
    }]};
    const adsbLol={status:'AVAILABLE',records:[{
      id:'def456',ident:'KQ100',latitude:-1.3,longitude:36.8,observed_at:new Date(now).toISOString(),
    }]};
    expect(aviation.compareAircraftSources({flightNumber:'KQ100',opensky,adsbLol}).status).toBe('AIRCRAFT_ID_DISAGREEMENT');
  });

  test('keeps one-provider-only aircraft matches explicitly uncorroborated',()=>{
    const opensky={configured:true,status:'LIVE',aircraft:[{
      id:'abc123',ident:'KQ100',latitude:-1.3,longitude:36.8,observed_at:new Date(now).toISOString(),
    }]};
    const adsbLol={status:'NO_MATCH',records:[]};
    expect(aviation.compareAircraftSources({flightNumber:'KQ100',opensky,adsbLol})).toMatchObject({
      status:'SINGLE_SOURCE_ONLY',primary_count:1,secondary_count:0,
    });
  });

  test('does not claim multi-provider operation from an empty provider registry',async()=>{
    const result=await aviation.getSnapshot({
      baseSnapshot:{provider:'opensky_rest',status:'NOT_CONFIGURED',configured:false,aircraft:[]},
      env:{},fetcher:jest.fn(),now:now+1_000,
    });
    expect(result.intelligence.provenance).toMatchObject({
      multi_provider:false,active_provider_count:0,provider_registry_present:true,
    });
  });

  const airportCsv=[
    'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,gps_code,iata_code,local_code',
    '1,HKJK,large_airport,Jomo Kenyatta International,-1.3192,36.9278,5334,AF,KE,KE-30,Nairobi,yes,HKJK,NBO,',
    '2,HKMO,large_airport,Moi International,-4.0348,39.5942,200,AF,KE,KE-28,Mombasa,yes,HKMO,MBA,',
    '3,HKNC,small_airport,Coastal Field,-4.1,39.6,20,AF,KE,KE-28,Mombasa,no,HKNC,MBA,',
    '4,HKSP,small_airport,Remote Field,-3.1,37.2,10,AF,KE,KE-00,Remote,no,HKSP,,',
  ].join('\n');

  test('parses quoted CSV airport names and preserves embedded commas',()=>{
    const rows=aviation.parseCsvRows('ident,name\nHKJK,"Jomo Kenyatta, International"\n');
    expect(rows).toEqual([
      ['ident','name'],
      ['HKJK','Jomo Kenyatta, International'],
    ]);
  });

  test('builds exact IATA/ICAO airport mappings from the public OurAirports dataset',()=>{
    const index=aviation.buildAirportReferenceIndex(airportCsv);
    expect(aviation.resolveAirportCode('NBO',index)).toMatchObject({
      status:'RESOLVED',supplied_code_type:'IATA',
      airport:{iata:'NBO',icao:'HKJK',name:'Jomo Kenyatta International'},
    });
    expect(aviation.resolveAirportCode('HKMO',index)).toMatchObject({
      status:'RESOLVED',supplied_code_type:'ICAO',
      airport:{iata:'MBA',icao:'HKMO',municipality:'Mombasa'},
    });
    expect(aviation.resolveAirportCode('HKSP',index)).toMatchObject({
      status:'RESOLVED',supplied_code_type:'ICAO',
      airport:{iata:null,icao:'HKSP',name:'Remote Field'},
    });
  });

  test('does not guess when one IATA code maps to more than one airport',()=>{
    const index=aviation.buildAirportReferenceIndex(airportCsv);
    expect(aviation.resolveAirportCode('MBA',index)).toMatchObject({
      status:'AMBIGUOUS',candidate_count:2,airport:null,
    });
  });

  test('keeps unknown airport codes unresolved instead of converting or guessing',()=>{
    const index=aviation.buildAirportReferenceIndex(airportCsv);
    expect(aviation.resolveAirportCode('XYZ',index)).toMatchObject({
      status:'NOT_FOUND',reason:'no_exact_iata_icao_reference_match',airport:null,
    });
    expect(aviation.resolveAirportCode('NBO',null)).toMatchObject({
      status:'UNAVAILABLE',reason:'airport_reference_dataset_unavailable',airport:null,
    });
  });

  test('loads the reference index once per cache period and resolves a journey IATA code before METAR/TAF',async()=>{
    aviation.resetCacheForTests();
    const fetcher=jest.fn(async(url)=>{
      const path=String(url);
      if(path.includes('airports.csv'))return {
        ok:true,status:200,headers:{get:()=>String(airportCsv.length)},text:async()=>airportCsv,
      };
      const body=path.includes('/metar')?[{icaoId:'HKJK',obsTime:now/1000,rawOb:'HKJK METAR'}]
        :path.includes('/taf')?[{icaoId:'HKJK',issueTime:now/1000,rawTAF:'HKJK TAF'}]
          :[{firId:'HKNA',validTimeFrom:now/1000,rawAirSigmet:'SIGMET'}];
      return {ok:true,status:200,json:async()=>body};
    });
    const result=await aviation.getSnapshot({
      airportCode:'NBO',
      baseSnapshot:{provider:'opensky_rest',status:'NOT_CONFIGURED',configured:false,aircraft:[]},
      env:{},fetcher,now,
    });
    expect(result.intelligence.airport_reference).toMatchObject({
      status:'RESOLVED',supplied_code:'NBO',supplied_code_type:'IATA',
      airport:{iata:'NBO',icao:'HKJK'},
    });
    expect(result.intelligence.aviation_weather).toMatchObject({
      status:'AVAILABLE',station_icao:'HKJK',
      metar:[{station_icao:'HKJK',raw:'HKJK METAR'}],
    });
    const airportCsvRequests=fetcher.mock.calls.filter(call=>String(call[0]).includes('airports.csv'));
    expect(airportCsvRequests).toHaveLength(1);
    const metarCall=fetcher.mock.calls.find(call=>String(call[0]).includes('/metar'));
    expect(metarCall[0]).toContain('ids=HKJK');
  });

  test('does not call AviationWeather when an IATA code is ambiguous',async()=>{
    aviation.resetCacheForTests();
    const fetcher=jest.fn(async(url)=>{
      if(String(url).includes('airports.csv'))return {
        ok:true,status:200,headers:{get:()=>String(airportCsv.length)},text:async()=>airportCsv,
      };
      throw new Error('Weather endpoints must not be requested for an ambiguous code.');
    });
    const result=await aviation.getSnapshot({
      airportCode:'MBA',
      baseSnapshot:{provider:'opensky_rest',status:'NOT_CONFIGURED',configured:false,aircraft:[]},
      env:{},fetcher,now,
    });
    expect(result.intelligence.airport_reference.status).toBe('AMBIGUOUS');
    expect(result.intelligence.aviation_weather).toMatchObject({
      status:'NOT_REQUESTED',station_icao:null,
    });
    expect(fetcher.mock.calls.filter(call=>/\/metar|\/taf|\/isigmet/.test(String(call[0])))).toHaveLength(0);
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
    expect(providers.find(item=>item.id==='ourairports')).toMatchObject({status:'NOT_REQUESTED'});
  });

  test('returns no fake flight or weather records when optional providers are not configured',async()=>{
    const baseSnapshot={provider:'opensky_rest',status:'NOT_CONFIGURED',aircraft:[]};
    const result=await aviation.getSnapshot({baseSnapshot,env:{},fetcher:jest.fn(),now});
    expect(result.intelligence).toMatchObject({
      provenance:{multi_provider:false,active_provider_count:0,provider_registry_present:true,fabricated_data_used:false,providers_are_not_equivalent_authorities:true},
      flight_status:{status:'NOT_CONFIGURED',flights:[]},
      aircraft_cross_check:{status:'NOT_CONFIGURED',records:[]},
      aviation_weather:{status:'NOT_REQUESTED',metar:[],taf:[],international_sigmets:[]},
      notams:{status:'ACCESS_REQUIRED'},
    });
  });
});
