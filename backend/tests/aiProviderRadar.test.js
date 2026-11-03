'use strict';

describe('AI provider radar',()=>{
  beforeEach(()=>{
    jest.resetModules();
    delete process.env.REDIS_URL;
    process.env.INTEL_AI_RADAR_ENABLED='true';
    process.env.INTEL_AI_RADAR_PERSIST='false';
    delete process.env.INTEL_AI_RADAR_HYDRATION_TIMEOUT_MS;
  });

  afterEach(()=>{
    jest.dontMock('../src/config/redis');
    delete process.env.REDIS_URL;
  });

  test('scores real provider outcomes without synthetic probes',()=>{
    const radar=require('../src/utils/aiProviderRadar');
    radar.recordSuccess('provider-a',{latencyMs:400});
    expect(radar.status('provider-a')).toMatchObject({
      status:'healthy',successes:1,failures:0,consecutive_failures:0,last_latency_ms:400
    });

    radar.recordFailure('provider-a',{status:429,message:'rate limited'});
    expect(radar.status('provider-a')).toMatchObject({
      status:'degraded',failures:1,consecutive_failures:1,last_status:429,last_outcome:'failure'
    });

    radar.recordSuccess('provider-a',{latencyMs:500});
    expect(radar.status('provider-a')).toMatchObject({
      successes:2,failures:1,consecutive_failures:0,last_outcome:'success'
    });
    expect(radar.routingScore('provider-a')).toBeGreaterThan(50);
  });

  test('hydrates persisted provider health from Redis before routing',async()=>{
    const stored={
      'sonalit:intelligence:ai:radar:v1:provider-a':JSON.stringify({
        successes:8,failures:1,consecutiveFailures:0,lastOutcome:'success',lastStatus:200,
        lastSuccessAt:'2026-10-09T08:00:00.000Z',lastFailureAt:'2026-10-09T07:00:00.000Z',
        lastLatencyMs:450,avgLatencyMs:600,updatedAt:'2026-10-09T08:00:00.000Z'
      }),
      'sonalit:intelligence:ai:radar:v1:provider-b':JSON.stringify({
        successes:0,failures:4,consecutiveFailures:4,lastOutcome:'failure',lastStatus:429,
        lastSuccessAt:null,lastFailureAt:'2026-10-09T08:00:00.000Z',
        lastLatencyMs:null,avgLatencyMs:null,updatedAt:'2026-10-09T08:00:00.000Z'
      }),
      'sonalit:intelligence:ai:radar:v1:bad-entry':'not-json'
    };
    const client={
      scan:jest.fn(async(cursor)=>{
        if(String(cursor)==='0')return ['0',Object.keys(stored)];
        return ['0',[]];
      }),
      get:jest.fn(async(key)=>stored[key]??null)
    };
    process.env.REDIS_URL='redis://redis.test';
    process.env.INTEL_AI_RADAR_PERSIST='true';
    process.env.INTEL_AI_RADAR_HYDRATION_TIMEOUT_MS='1000';
    jest.doMock('../src/config/redis',()=>({getRedis:()=>client}));

    const radar=require('../src/utils/aiProviderRadar');
    await radar.hydrate();

    expect(radar.snapshot()).toMatchObject({
      hydrated:true,persistence:true,persistence_available:true
    });
    expect(radar.status('provider-a')).toMatchObject({
      successes:8,failures:1,last_outcome:'success',last_latency_ms:450,avg_latency_ms:600
    });
    expect(radar.status('provider-b')).toMatchObject({
      successes:0,failures:4,consecutive_failures:4,status:'unhealthy',last_status:429
    });
    expect(radar.routingScore('provider-a')).toBeGreaterThan(radar.routingScore('provider-b'));
    expect(radar.status('bad-entry').status).toBe('unknown');
    expect(client.scan).toHaveBeenCalledWith(
      '0','MATCH','sonalit:intelligence:ai:radar:v1:*','COUNT',100
    );
  });

  test('does not retain prompt bodies or credentials',()=>{
    const radar=require('../src/utils/aiProviderRadar');
    radar.recordFailure('provider-with-creds',{status:403,message:'private prompt: do not persist'});
    const serialized=JSON.stringify(radar.snapshot());
    expect(serialized).not.toContain('private prompt');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('secret');
  });
});
