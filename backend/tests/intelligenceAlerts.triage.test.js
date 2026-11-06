'use strict';
const request=require('supertest');
const mockDb=jest.fn();
describe('incident alert triage visibility boundary',()=>{
 let app;
 beforeEach(()=>{
  jest.resetModules();mockDb.mockReset();mockDb.mockResolvedValue({rows:[]});
  const express=require('express'),router=require('../src/routes/intelligenceAlerts');
  app=express();app.use((req,_res,next)=>{req.user={org_id:'00000000-0000-0000-0000-000000000002'};req.db=mockDb;next()});
  app.use('/alerts',router);app.use((err,_req,res,_next)=>res.status(err.status||500).json({error:err.message}));
 });
 test('incident stream excludes records triaged as non-security news',async()=>{
  const res=await request(app).get('/alerts?scope=KE');
  expect(res.status).toBe(200);
  const [sql]=mockDb.mock.calls[0];
  expect(sql).toContain("COALESCE(a.metadata->>'triage_disposition','')<>'not_security_relevant'");
 });
 test('headline status totals and category counts exclude non-security news',async()=>{
  const res=await request(app).get('/alerts/status?scope=KE');
  expect(res.status).toBe(200);expect(mockDb).toHaveBeenCalledTimes(2);
  for(const [sql] of mockDb.mock.calls)expect(sql).toContain("COALESCE(a.metadata->>'triage_disposition','')<>'not_security_relevant'");
 });
 test('suppressed non-security alert cannot be fetched through its detail URL',async()=>{
  const res=await request(app).get('/alerts/33333333-3333-4333-8333-333333333333');
  expect(res.status).toBe(404);
  const [sql]=mockDb.mock.calls[0];
  expect(sql).toContain("COALESCE(a.metadata->>'triage_disposition','')<>'not_security_relevant'");
 });
});
