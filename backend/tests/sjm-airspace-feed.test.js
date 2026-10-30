'use strict';

const feed=require('../src/services/sjmAirspaceFeed');

describe('SJM OpenSky REST airspace feed',()=>{
  const originalEnv={};
  const envKeys=[
    'SJM_AIRSPACE_FEED_ENABLED','SJM_AIRSPACE_LICENSE_CONFIRMED',
    'SJM_AIRSPACE_BOUNDS','OPENSKY_CLIENT_ID','OPENSKY_CLIENT_SECRET',
    'OPENSKY_DAILY_CREDIT_BUDGET','OPENSKY_CREDIT_TIER','OPENSKY_CREDIT_WINDOW','OPENSKY_CREDIT_BUDGET','OPENSKY_POLL_INTERVAL_SECONDS',
  ];
  const now=Date.parse('2026-10-30T12:00:00.000Z');

  beforeEach(()=>{
    for(const key of envKeys){originalEnv[key]=process.env[key];delete process.env[key];}
    feed.resetForTests();
  });
  afterEach(()=>{
    feed.resetForTests();
    for(const key of envKeys){if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key];}
    jest.restoreAllMocks();
  });

  test('fails closed without explicit operational enablement and written licence confirmation',()=>{
    expect(feed.getConfig({})).toMatchObject({configured:false,reason:'feed_disabled'});
    expect(feed.getSnapshot()).resolves.toMatchObject({status:'NOT_CONFIGURED',provider:'opensky_rest',aircraft:[]});
    const env={
      SJM_AIRSPACE_FEED_ENABLED:'true',
      SJM_AIRSPACE_BOUNDS:'-5 32 6 42',
      OPENSKY_CLIENT_ID:'client',OPENSKY_CLIENT_SECRET:'secret',
    };
    expect(feed.getConfig(env)).toMatchObject({
      configured:false,reason:'provider_written_operational_and_commercial_license_not_confirmed',
    });
  });

  test('validates a bounded coverage rectangle and computes official state-query credit bands',()=>{
    expect(feed.parseBounds('-5 32 6 42')).toMatchObject({south:-5,west:32,north:6,east:42,area_sq_degrees:110});
    expect(feed.parseBounds('-91 32 6 42')).toBeNull();
    expect(feed.parseBounds('-5 32 -6 42')).toBeNull();
    expect(feed.parseBounds('-90 -180 90 180')).toBeNull();
    expect(feed.creditsForBounds({south:-2.5,west:32,north:2.5,east:36})).toBe(1);
    expect(feed.creditsForBounds({south:-5,west:32,north:5,east:42})).toBe(2);
    expect(feed.creditsForBounds({south:-5,west:32,north:6,east:42})).toBe(3);
    expect(feed.creditsForBounds({south:-10,west:-20,north:10,east:5})).toBe(4);
  });

  test('budgets state-vector polling below the standard authenticated daily credit allowance',()=>{
    const config=feed.getConfig({
      SJM_AIRSPACE_FEED_ENABLED:'true',
      SJM_AIRSPACE_LICENSE_CONFIRMED:'true',
      SJM_AIRSPACE_BOUNDS:'-5 32 6 42',
      OPENSKY_CLIENT_ID:'client-id',
      OPENSKY_CLIENT_SECRET:'client-secret',
      OPENSKY_POLL_INTERVAL_SECONDS:'60',
    });
    expect(config).toMatchObject({
      configured:true,creditsPerRequest:3,pollIntervalSeconds:87,creditBudget:3000,
    });
    expect(config.projectedCreditsPerWindow).toBeLessThanOrEqual(3000);
  });

  test('permits five-second snapshots only under an explicitly configured licensed hourly quota',()=>{
    const config=feed.getConfig({
      SJM_AIRSPACE_FEED_ENABLED:'true',SJM_AIRSPACE_LICENSE_CONFIRMED:'true',
      SJM_AIRSPACE_BOUNDS:'-5 32 6 42',OPENSKY_CLIENT_ID:'client-id',OPENSKY_CLIENT_SECRET:'client-secret',
      OPENSKY_CREDIT_TIER:'licensed',OPENSKY_CREDIT_WINDOW:'hourly',OPENSKY_CREDIT_BUDGET:'12000',OPENSKY_POLL_INTERVAL_SECONDS:'5',
    });
    expect(config).toMatchObject({configured:true,creditWindow:'hourly',creditBudget:12000,pollIntervalSeconds:5});
    expect(config.projectedCreditsPerWindow).toBeLessThanOrEqual(12000);
  });

  test('does not permit licensed hourly polling without the licensed account tier',()=>{
    const config=feed.getConfig({
      SJM_AIRSPACE_FEED_ENABLED:'true',SJM_AIRSPACE_LICENSE_CONFIRMED:'true',
      SJM_AIRSPACE_BOUNDS:'-5 32 6 42',OPENSKY_CLIENT_ID:'client-id',OPENSKY_CLIENT_SECRET:'client-secret',
      OPENSKY_CREDIT_WINDOW:'hourly',OPENSKY_CREDIT_BUDGET:'12000',OPENSKY_POLL_INTERVAL_SECONDS:'5',
    });
    expect(config).toMatchObject({configured:false,reason:'licensed_hourly_entitlement_not_confirmed'});
  });

  test('caps standard and active-feeder daily budgets at their documented credit ceilings',()=>{
    const base={
      SJM_AIRSPACE_FEED_ENABLED:'true',SJM_AIRSPACE_LICENSE_CONFIRMED:'true',
      SJM_AIRSPACE_BOUNDS:'-5 32 6 42',OPENSKY_CLIENT_ID:'client-id',OPENSKY_CLIENT_SECRET:'client-secret',
      OPENSKY_CREDIT_BUDGET:'8000',
    };
    expect(feed.getConfig({...base,OPENSKY_CREDIT_TIER:'standard'}).creditBudget).toBe(4000);
    expect(feed.getConfig({...base,OPENSKY_CREDIT_TIER:'active_feeder'}).creditBudget).toBe(8000);
  });

  test('uses a query bounding box and requests extended state-vector fields',()=>{
    const url=new URL(feed.buildStatesUrl({south:-5,west:32,north:6,east:42}));
    expect(url.origin).toBe('https://opensky-network.org');
    expect(url.pathname).toBe('/api/states/all');
    expect(url.searchParams.get('lamin')).toBe('-5');
    expect(url.searchParams.get('lomin')).toBe('32');
    expect(url.searchParams.get('lamax')).toBe('6');
    expect(url.searchParams.get('lomax')).toBe('42');
    expect(url.searchParams.get('extended')).toBe('1');
  });

  test('normalises the documented OpenSky state-vector indexes, units and evidence provenance',()=>{
    const vector=[
      'abc123','KQ100','Kenya',now/1000,now/1000,36.8,-1.3,12000,false,
      220,90,-2.4,null,12400,'1234',false,0,4,
    ];
    const item=feed.normaliseStateVector(vector,now);
    expect(item).toMatchObject({
      id:'abc123',ident:'KQ100',origin_country:'Kenya',latitude:-1.3,longitude:36.8,
      ground_speed_mps:220,heading_deg:90,vertical_rate_mps:-2.4,on_ground:false,
      barometric_altitude_m:12000,geometric_altitude_m:12400,altitude_m:12400,
      altitude_reference:'WGS84_ELLIPSOID',squawk:'1234',position_source_label:'ADSB',
      category:4,category_label:'LARGE',evidence_class:'OBSERVED',provider:'opensky_rest',
    });
  });

  test('does not turn a missing position timestamp or invalid coordinates into a current fix',()=>{
    const vector=['abc123','KQ100','Kenya',null,now/1000,36.8,-1.3,12000,false,220,90,-2.4,null,12400,'1234',false,0,4];
    expect(feed.normaliseStateVector(vector,now)).toBeNull();
    const invalid=['abc123','KQ100','Kenya',now/1000,now/1000,36.8,95,12000,false,220,90,-2.4,null,12400,'1234',false,0,4];
    expect(feed.normaliseStateVector(invalid,now)).toBeNull();
  });

  test('does not label a missing OpenSky source code as ADS-B',()=>{
    const vector=['abc123','KQ100','Kenya',now/1000,now/1000,36.8,-1.3,12000,false,220,90,-2.4,null,12400,'1234',false,null,4];
    const item=feed.normaliseStateVector(vector,now);
    expect(item.position_source).toBeNull();
    expect(item.position_source_label).toBe('UNKNOWN');
    expect(item.altitude_reference).toBe('GEOMETRIC');
  });

  test('rejects null coordinates instead of coercing them to zero degrees',()=>{
    const noLongitude=['abc123','KQ100','Kenya',now/1000,now/1000,null,-1.3,12000,false,220,90,-2.4,null,12400,'1234',false,0,4];
    const noLatitude=['abc123','KQ100','Kenya',now/1000,now/1000,36.8,null,12000,false,220,90,-2.4,null,12400,'1234',false,0,4];
    expect(feed.normaliseStateVector(noLongitude,now)).toBeNull();
    expect(feed.normaliseStateVector(noLatitude,now)).toBeNull();
  });

  test('classifies observed position age without accepting future timestamps',()=>{
    expect(feed.classifyFreshness(new Date(now-10_000).toISOString(),now)).toBe('LIVE');
    expect(feed.classifyFreshness(new Date(now-90_000).toISOString(),now)).toBe('DELAYED');
    expect(feed.classifyFreshness(new Date(now-300_000).toISOString(),now)).toBe('STALE');
    expect(feed.classifyFreshness(new Date(now-900_000).toISOString(),now)).toBe('UNAVAILABLE');
    expect(feed.classifyFreshness(new Date(now+60_000).toISOString(),now)).toBe('UNAVAILABLE');
  });

  test('refreshes OAuth2 client-credentials tokens before expiry and never uses account passwords',async()=>{
    const fetcher=jest.fn().mockResolvedValue({
      ok:true,status:200,json:async()=>({access_token:'oauth-token',expires_in:1800}),
    });
    const config={clientId:'api-client-id',clientSecret:'api-client-secret'};
    await expect(feed.getAccessToken(config,{fetcher,now})).resolves.toBe('oauth-token');
    await expect(feed.getAccessToken(config,{fetcher,now:now+60_000})).resolves.toBe('oauth-token');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request=fetcher.mock.calls[0][1];
    expect(request.method).toBe('POST');
    expect(request.body).toContain('grant_type=client_credentials');
    expect(request.body).toContain('client_id=api-client-id');
    expect(request.body).toContain('client_secret=api-client-secret');
    expect(request.body).not.toContain('username=');
    expect(request.body).not.toContain('password=');
  });

  test('retries one expired bearer token and returns only the bounded state snapshot',async()=>{
    const fetcher=jest.fn()
      .mockResolvedValueOnce({ok:true,status:200,json:async()=>({access_token:'expired-token',expires_in:1800})})
      .mockResolvedValueOnce({ok:false,status:401,headers:{get:()=>null}})
      .mockResolvedValueOnce({ok:true,status:200,json:async()=>({access_token:'new-token',expires_in:1800})})
      .mockResolvedValueOnce({
        ok:true,status:200,
        headers:{get:(name)=>name.toLowerCase()==='x-rate-limit-remaining'?'3997':null},
        json:async()=>({time:now/1000,states:[[ 'abc123','KQ100','Kenya',now/1000,now/1000,36.8,-1.3,12000,false,220,90,-2.4,null,12400,'1234',false,0,4]]}),
      });
    const config={clientId:'client-id',clientSecret:'client-secret',bounds:{south:-5,west:32,north:6,east:42}};
    const result=await feed.fetchStates(config,{fetcher,now});
    expect(result.states).toHaveLength(1);
    expect(result.rateLimitRemaining).toBe(3997);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer expired-token');
    expect(fetcher.mock.calls[3][1].headers.Authorization).toBe('Bearer new-token');
  });

  test('surfaces provider retry guidance on HTTP 429 without silently retrying or fabricating data',async()=>{
    const fetcher=jest.fn()
      .mockResolvedValueOnce({ok:true,status:200,json:async()=>({access_token:'token',expires_in:1800})})
      .mockResolvedValueOnce({
        ok:false,status:429,
        headers:{get:(name)=>name.toLowerCase()==='x-rate-limit-retry-after-seconds'?'600':null},
      });
    const config={clientId:'client-id',clientSecret:'client-secret',bounds:{south:-5,west:32,north:6,east:42}};
    await expect(feed.fetchStates(config,{fetcher,now})).rejects.toMatchObject({
      code:'rate_limited',retryAfterSeconds:600,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('preserves chronological aircraft trails and refuses out-of-order samples',()=>{
    const first=feed.normaliseStateVector([
      'abc123','KQ100','Kenya',now/1000,now/1000,36.8,-1.3,12000,false,220,90,-2.4,null,12400,'1234',false,0,4,
    ],now);
    const older=feed.normaliseStateVector([
      'abc123','KQ100','Kenya',(now-30_000)/1000,(now-30_000)/1000,36.7,-1.4,12000,false,220,90,-2.4,null,12400,'1234',false,0,4,
    ],now);
    expect(feed.rememberPosition(first)).toBe(true);
    expect(feed.rememberPosition(older)).toBe(false);
    const output=feed.snapshot(now,{
      configured:true,bounds:{south:-5,west:32,north:6,east:42},pollIntervalSeconds:120,
      creditWindow:'daily',creditBudget:3000,windowSeconds:86400,creditsPerRequest:3,projectedCreditsPerWindow:2160,
    });
    expect(output.aircraft).toHaveLength(1);
    expect(output.aircraft[0].latitude).toBe(-1.3);
    expect(output.aircraft[0].last_contact_at).toBe(new Date(now).toISOString());
    expect(output.aircraft[0].trail).toHaveLength(1);
  });

  test('keeps a provider rate-limit state visible after the retry time has elapsed',()=>{
    const config=feed.getConfig({
      SJM_AIRSPACE_FEED_ENABLED:'true',SJM_AIRSPACE_LICENSE_CONFIRMED:'true',
      SJM_AIRSPACE_BOUNDS:'-5 32 6 42',OPENSKY_CLIENT_ID:'client-id',OPENSKY_CLIENT_SECRET:'client-secret',
    });
    const observed=new Date(now-5_000).toISOString();
    const result=feed.presentSnapshot({
      provider:'opensky_rest',status:'RATE_LIMITED',last_error_code:'provider_rate_limited',
      last_received_at:new Date(now-5_000).toISOString(),next_poll_at:new Date(now-1_000).toISOString(),
      poll_interval_seconds:config.pollIntervalSeconds,aircraft:[{
        id:'abc123',ident:'KQ100',latitude:-1.3,longitude:36.8,
        observed_at:observed,altitude_m:12000,freshness:'LIVE',
      }],
    },now);
    expect(result.status).toBe('RATE_LIMITED');
    expect(result.connected).toBe(false);
    expect(result.aircraft).toHaveLength(1);
  });

  test('fingerprints coverage and quota config so old-area snapshots cannot be reused',()=>{
    const config=feed.getConfig({
      SJM_AIRSPACE_FEED_ENABLED:'true',SJM_AIRSPACE_LICENSE_CONFIRMED:'true',
      SJM_AIRSPACE_BOUNDS:'-5 32 6 42',OPENSKY_CLIENT_ID:'client-id',OPENSKY_CLIENT_SECRET:'client-secret',
    });
    const changed={...config,bounds:{south:-5,west:30,north:6,east:42,area_sq_degrees:132}};
    expect(feed.configFingerprint(config)).not.toBe(feed.configFingerprint(changed));
    expect(feed.snapshot(now,config).config_fingerprint).toBe(feed.configFingerprint(config));
  });

  test('unconfigured provider snapshot contains no simulated aircraft or flight-information events',async()=>{
    const result=await feed.getSnapshot({start:false});
    expect(result).toMatchObject({
      provider:'opensky_rest',provider_name:'OpenSky Network',
      status:'NOT_CONFIGURED',configured:false,connected:false,
      aircraft:[],recent_events:[],
      provenance:{fabricated_data_used:false,commercial_flight_information:false,position_sources_reported:['ADSB','ASTERIX','MLAT','FLARM']},
    });
  });
});
