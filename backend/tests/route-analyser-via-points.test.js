'use strict';
jest.mock('../src/config/database',()=>({query:jest.fn(async()=>({rows:[]}))}));
jest.mock('../src/utils/logger',()=>({info:jest.fn(),warn:jest.fn(),error:jest.fn()}));
jest.mock('../src/services/geo/providerEnv',()=>({mapboxToken:()=>'',osrmUrl:()=>'https://osrm.example'}));
jest.mock('../src/services/geo/routePlan',()=>({planRouteAlternatives:jest.fn()}));
jest.mock('../src/services/geo/routeRisk',()=>({rankRoutes:jest.fn()}));
jest.mock('../src/services/geo/routeSafetySwarm',()=>({runSwarm:jest.fn()}));
const { query }=require('../src/config/database');
const { planRouteAlternatives }=require('../src/services/geo/routePlan');
const { rankRoutes }=require('../src/services/geo/routeRisk');
const { runSwarm }=require('../src/services/geo/routeSafetySwarm');
const { analyseRoute }=require('../src/utils/routeAnalyser');
describe('Route Safety ordered via-points',()=>{
 beforeEach(()=>{query.mockClear();planRouteAlternatives.mockReset();rankRoutes.mockReset();runSwarm.mockReset();});
 test('routes through every supplied via-point in sequence and bypasses endpoint-only cache',async()=>{
  const origin={lat:-1.286389,lng:36.817223},stop={lat:-3.396,lng:38.556},destination={lat:-4.043477,lng:39.668206},ordered=[origin,stop,destination];
  planRouteAlternatives.mockResolvedValue([{route:ordered,provider:'osrm',distance_km:610,duration_min:420}]);
  rankRoutes.mockImplementation(candidates=>({ranked:candidates.map(c=>({...c,score:12,blocked:false,exposures:[]})),all_blocked:false}));
  runSwarm.mockResolvedValue({version:'test',agent_count:1,reports:[{provider:'unit-test'}],arbiter:{go_no_go:'GO',risk_level:'LOW',route_selection_reason:'Routed via-point assessment complete.'},critic:null,consensus:{hard_block:false,confidence:0.95},aggregated_risks:[]});
  const result=await analyseRoute({origin,destination,viaPoints:[stop],orgId:'11111111-1111-1111-1111-111111111111'});
  expect(planRouteAlternatives).toHaveBeenCalledWith(ordered,expect.objectContaining({maxPoints:300}));
  expect(result.recommended_route.waypoints).toEqual(ordered);
  expect(result.route_status).toBe('routed');
  expect(result.safety_gate).toBe('GO');
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toMatch(/FROM risk_zones/);
 });
});
