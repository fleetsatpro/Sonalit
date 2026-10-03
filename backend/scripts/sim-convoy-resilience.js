#!/usr/bin/env node
'use strict';
const { evaluateConvoySnapshot } = require('../src/services/convoyOperationalResilience');
const route = [{lat:0,lng:0},{lat:0,lng:1},{lat:0,lng:2}];
const base = (id,lng) => ({
  truck_id:id, vehicle_id:'v-'+id, lat:0, lng, speed_kmh:60,
  last_fix_at:'2026-10-03T06:20:00Z', cfo_user_id:'cfo-'+id,
  cfo_lat:0, cfo_lng:lng, cfo_last_seen_at:'2026-10-03T06:20:00Z'
});
const scenarios = {
  normal:[base('t1',.70),base('t2',.68),base('t3',.66)],
  lagging:[{...base('t1',.25),speed_kmh:8},base('t2',.72),base('t3',.75)],
  breakdown:[base('t1',.72),{...base('t2',.42),speed_kmh:0,breakdown_signal:true},base('t3',.70)],
  coverage:[{...base('t1',.42),cfo_user_id:'shared',cfo_lng:.42},{...base('t2',.92),cfo_user_id:'shared',cfo_lng:.42}],
  comms:[{...base('t1',.72),last_fix_at:'2026-10-03T05:50:00Z'},base('t2',.70)],
  split:[base('t1',.20),base('t2',.95)]
};
const name = process.argv[2] || 'normal';
if (!scenarios[name]) { console.error('Unknown scenario: '+name+'; choose '+Object.keys(scenarios).join(', ')); process.exit(2); }
const result = evaluateConvoySnapshot({
  now:'2026-10-03T06:20:00Z', convoy:{id:'SIM-CONVOY',status:'active'}, route,
  trucks:scenarios[name],
  response_resources:[
    {id:'MRT-1',type:'mobile_response',status:'standby',active:true},
    {id:'REC-1',type:'recovery',status:'standby',active:true},
    {id:'SG-1',type:'static_guard',status:'standby',active:true}
  ]
});
console.log(JSON.stringify({scenario:name,result},null,2));
