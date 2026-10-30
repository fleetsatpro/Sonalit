'use strict';

const feed=require('../src/services/sjmAirspaceFeed');

describe('SJM licensed live airspace',()=>{
  const oldEnv={};
  const keys=['SJM_AIRSPACE_FEED_ENABLED','SJM_AIRSPACE_LICENSE_CONFIRMED','SJM_AIRSPACE_BOUNDS','FLIGHTAWARE_FIREHOSE_USERNAME','FLIGHTAWARE_FIREHOSE_API_KEY'];
  beforeEach(()=>{
    for(const key of keys){oldEnv[key]=process.env[key];delete process.env[key];}
    feed.resetForTests();
  });
  afterEach(()=>{
    feed.resetForTests();
    for(const key of keys){if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];}
    jest.restoreAllMocks();
  });

  test('does not connect without explicit feed and licence configuration',()=>{
    expect(feed.getConfig({})).toMatchObject({configured:false,reason:'feed_disabled'});
    process.env.SJM_AIRSPACE_FEED_ENABLED='true';
    expect(feed.getConfig()).toMatchObject({configured:false,reason:'provider_licence_not_confirmed'});
    expect(feed.getSnapshot({start:true})).toMatchObject({status:'NOT_CONFIGURED',aircraft:[],configured:false});
  });

  test('requires a small valid contracted coverage rectangle',()=>{
    expect(feed.parseBounds('-5 32 6 42')).toEqual({south:-5,west:32,north:6,east:42});
    expect(feed.parseBounds('-91 32 6 42')).toBeNull();
    expect(feed.parseBounds('-5 32 -6 42')).toBeNull();
    expect(feed.parseBounds('-90 -180 90 180')).toBeNull();
  });

  test('builds the documented single-line Firehose initiation command',()=>{
    const config={
      configured:true,username:'service-user',apiKey:'private-api-key',
      bounds:{south:-5,west:32,north:6,east:42},
    };
    const command=feed.buildInitiationCommand(config);
    expect(command).toContain('username service-user');
    expect(command).toContain('password private-api-key');
    expect(command).toContain('events "position flifo arrival departure cancellation"');
    expect(command).toContain('latlong "-5 32 6 42"');
    expect(command.startsWith('live ')).toBe(true);
    expect(command.endsWith('\n')).toBe(true);
    const resumed=feed.buildInitiationCommand(config,1793333333.25);
    expect(resumed.startsWith('pitr 1793333333.25 ')).toBe(true);
    expect(resumed).not.toContain(' live ');
  });

  test('normalises observed aircraft positions with correct units and provenance',()=>{
    const now=Date.now();
    const position=feed.normalizePosition({
      type:'position',id:'fa-flight-1',ident:'KQ100',hexid:'ABC123',
      lat:-1.3,lon:36.8,clock:now/1000,alt:12000,gs:430,heading_true:90,
      updateType:'A',orig:'HKJK',dest:'EGLL',air_ground:'A',
    },new Date(now).toISOString());
    expect(position).toMatchObject({
      id:'fa-flight-1',ident:'KQ100',latitude:-1.3,longitude:36.8,heading_deg:90,
      origin:'HKJK',destination:'EGLL',update_type:'A',evidence_class:'OBSERVED',
      altitude_reference:'BAROMETRIC_PRESSURE',
      provenance:{provider:'FlightAware Firehose',source_message:'position'},
    });
    expect(position.altitude_m).toBeCloseTo(3657.6,1);
    expect(position.ground_speed_mps).toBeCloseTo(221.2,1);
  });

  test('uses GNSS altitude as WGS84 ellipsoid height when that field is supplied',()=>{
    const position=feed.normalizePosition({type:'position',id:'gnss-1',lat:-1.3,lon:36.8,clock:Date.now()/1000,alt:12000,alt_gnss:11800});
    expect(position.altitude_m).toBeCloseTo(3596.64,1);
    expect(position.altitude_reference).toBe('WGS84_ELLIPSOID');
  });

  test('rejects invalid, missing and future-dated aircraft position evidence',()=>{
    expect(feed.normalizePosition({type:'position',id:'x',lat:100,lon:0,clock:Date.now()/1000})).toBeNull();
    expect(feed.normalizePosition({type:'position',id:'x',lat:0,lon:0,clock:0})).toBeNull();
    expect(feed.classifyFreshness('2099-01-01T00:00:00.000Z',Date.now(),true)).toBe('UNAVAILABLE');
  });

  test('does not regress current aircraft state when PITR replays older position messages',()=>{
    const currentTime=Date.now()/1000;
    feed.processLine(JSON.stringify({type:'position',id:'replay-1',ident:'KQ100',lat:-1.3,lon:36.8,clock:currentTime,pitr:currentTime}));
    feed.processLine(JSON.stringify({type:'position',id:'replay-1',ident:'KQ100',lat:-2.3,lon:37.8,clock:currentTime-30,pitr:currentTime-30}));
    const current=feed.snapshot();
    expect(current.aircraft).toHaveLength(1);
    expect(current.aircraft[0]).toMatchObject({latitude:-1.3,longitude:36.8});
    expect(current.rejected_count).toBe(1);
    expect(current.last_pitr_at).toBe(new Date(currentTime*1000).toISOString());
  });

  test('keeps flight-information events separate from observed aircraft positions',()=>{
    feed.processLine(JSON.stringify({type:'flifo',id:'fa-flight-1',ident:'KQ100',clock:Date.now()/1000}));
    const current=feed.snapshot();
    expect(current.aircraft).toHaveLength(0);
    expect(current.recent_events[0]).toMatchObject({type:'flifo',ident:'KQ100',evidence_class:'OBSERVED'});
  });

  test('returns no synthetic aircraft when the provider is unconfigured',()=>{
    expect(feed.snapshot()).toMatchObject({
      provider:'flightaware_firehose',status:'NOT_CONFIGURED',configured:false,
      connected:false,aircraft:[],provenance:{fabricated_data_used:false},
    });
  });
});
