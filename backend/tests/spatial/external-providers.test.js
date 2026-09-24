const { normalizeVessel } = require('../../src/services/spatial/kplerAisGateway');
const { normalizeTrafficFeature } = require('../../src/services/spatial/mapboxTrafficGateway');
const { normalizeIncident } = require('../../src/services/spatial/tomtomTrafficGateway');
const { normalizeEvent } = require('../../src/services/spatial/nasaEonetGateway');

describe('external spatial provider normalizers', () => {
  test('normalizes AIS vessel telemetry without inventing timestamps', () => {
    const observed='2026-09-24T12:00:00.000Z';
    const received='2026-09-24T12:00:20.000Z';
    const obs=normalizeVessel({id:'node-1',staticData:{name:'MV Test',mmsi:'123456789',imo:'9876543',shipType:'cargo'},lastPositionUpdate:{timestamp:observed,latitude:-4.05,longitude:39.68,heading:90,speed:10,accuracy:1,course:89,navigationalStatus:'under_way'}},received);
    expect(obs.entityType).toBe('vessel');
    expect(obs.source).toBe('kpler-ais');
    expect(obs.speedMps).toBeCloseTo(5.14444,4);
    expect(obs.observedAt).toBe(observed);
    expect(obs.quality.freshnessClass).toBe('LIVE');
  });

  test('rejects AIS records without valid coordinates', () => {
    expect(normalizeVessel({id:'bad',staticData:{mmsi:'1'},lastPositionUpdate:{timestamp:'2026-09-24T12:00:00Z',latitude:null,longitude:36}},'2026-09-24T12:00:20Z')).toBeNull();
  });

  test('normalizes traffic congestion and keeps provider timestamp unknown when absent', () => {
    const obs=normalizeTrafficFeature({id:'seg-1',geometry:{coordinates:[36.81,-1.29]},properties:{congestion:'severe',closed:'no',class:'primary'}},'2026-09-24T12:00:20.000Z',{latitude:-1.29,longitude:36.81});
    expect(obs.entityType).toBe('traffic_segment');
    expect(obs.status).toBe('severe');
    expect(obs.quality.freshnessClass).toBe('UNKNOWN');
    expect(obs.observedAt).toBeNull();
  });

  test('normalizes Mapbox LineString geometry without accepting invalid coordinates', () => {
    const obs = normalizeTrafficFeature({
      id: 'seg-line',
      geometry: { type: 'LineString', coordinates: [[36.80, -1.30], [36.82, -1.31], [36.84, -1.32]] },
      properties: { congestion: 'heavy', closed: false }
    }, '2026-09-24T12:00:20.000Z', { latitude: -1.31, longitude: 36.82 });
    expect(obs.latitude).toBeCloseTo(-1.31, 5);
    expect(obs.longitude).toBeCloseTo(36.82, 5);
    expect(obs.status).toBe('heavy');
  });
  test('normalizes external road closure as high-confidence actionable incident data', () => {
    const obs=normalizeIncident({id:'inc-1',geometry:{type:'Point',coordinates:[36.82,-1.30]},properties:{id:'inc-1',iconCategory:'roadClosed',magnitudeOfDelay:'major',lastReportTime:'2026-09-24T12:00:10Z',events:[{description:'Road closed'}],roadNumbers:['A104']}},'2026-09-24T12:00:20Z');
    expect(obs.entityType).toBe('traffic_incident');
    expect(obs.status).toBe('roadClosed');
    expect(obs.quality.freshnessClass).toBe('LIVE');
    expect(obs.operationalConfidence).toBeGreaterThan(0.8);
  });

  test('normalizes NASA EONET hazard geometry with provenance and explicit derived-position uncertainty', () => {
    const obs=normalizeEvent({id:'E1',title:'Wildfire test',description:'Fire',link:'https://example.invalid/e1',categories:[{id:'wildfires',title:'Wildfires'}],geometry:[{date:'2026-09-24T10:00:00Z',type:'Polygon',coordinates:[[[36.8,-1.3],[36.9,-1.3],[36.9,-1.2],[36.8,-1.2],[36.8,-1.3]]]}]},'2026-09-24T12:00:00Z');
    expect(obs.entityType).toBe('natural_hazard');
    expect(obs.provenance.sourceName).toBe('NASA EONET');
    expect(obs.quality.freshnessClass).toBe('LIVE');
    expect(obs.attributes.representativePointDerived).toBe(true);
    expect(obs.interpretationConfidence).toBeLessThan(0.8);
  });
});