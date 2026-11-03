'use strict';

const { inferRiskZoneTask } = require('../src/utils/riskZoneCommandIntent');

describe('deterministic Copilot risk-zone intent', () => {
  test('recognises explicit requests with a named location and bounded radius', () => {
    expect(inferRiskZoneTask('Create a high-risk zone around Nairobi')).toMatchObject({
      task: 'create_risk_zone',
      location: 'Nairobi',
      risk_level: 'high',
      radius_km: 5,
    });
    expect(inferRiskZoneTask('Create a critical flood hazard zone around Kisumu with radius 12 km')).toMatchObject({
      location: 'Kisumu',
      risk_level: 'critical',
      zone_type: 'flood',
      radius_km: 12,
    });
    expect(inferRiskZoneTask('Mark a banditry zone near -0.456, 36.234 with radius 750 m')).toMatchObject({
      location: '-0.456,36.234',
      zone_type: 'banditry',
      radius_km: 0.75,
    });
  });

  test('does not turn advice, instructions or geofence operations into risk-zone writes', () => {
    expect(inferRiskZoneTask('How do I create a high-risk zone around Nairobi?')).toBeNull();
    expect(inferRiskZoneTask('What is a high-risk zone?')).toBeNull();
    expect(inferRiskZoneTask('Assess risk zones around Nairobi')).toBeNull();
    expect(inferRiskZoneTask('Create a geofence around Nairobi near a risk zone')).toBeNull();
    expect(inferRiskZoneTask('Create a high-risk zone')).toBeNull();
  });

  test('fails closed for invalid coordinates and excessive radii', () => {
    expect(inferRiskZoneTask('Create a high-risk zone around 95,200')).toBeNull();
    expect(inferRiskZoneTask('Create a high-risk zone around Nairobi with radius 200 km')).toBeNull();
    expect(inferRiskZoneTask('Create a high-risk zone around Nairobi with radius 20 m')).toBeNull();
  });
});
