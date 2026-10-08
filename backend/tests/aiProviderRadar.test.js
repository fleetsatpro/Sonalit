'use strict';

describe('AI provider radar',()=>{
  beforeEach(()=>{
    jest.resetModules();
    delete process.env.REDIS_URL;
    process.env.INTEL_AI_RADAR_ENABLED='true';
    process.env.INTEL_AI_RADAR_PERSIST='false';
  });

  test('scores real provider outcomes without synthetic probes',()=>{
    const radar=require('../src/utils/aiProviderRadar');
    radar.recordSuccess('provider-a',{latencyMs:400});
    expect(radar.status('provider-a')).toMatchObject({
      status:'healthy',successes:1,failures:0,consecutive_failures:0,last_latency_ms:400
    });

    radar.recordFailure('provider-a',{status:429,message:'rate limited'});
    expect(radar.status('provider-a')).toMatchObject({
      status:'unhealthy',failures:1,consecutive_failures:1,last_status:429,last_outcome:'failure'
    });

    radar.recordSuccess('provider-a',{latencyMs:500});
    expect(radar.status('provider-a')).toMatchObject({
      successes:2,failures:1,consecutive_failures:0,last_outcome:'success'
    });
    expect(radar.routingScore('provider-a')).toBeGreaterThan(50);
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
