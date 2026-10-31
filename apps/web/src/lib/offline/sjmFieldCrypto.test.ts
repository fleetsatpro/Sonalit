import { beforeEach, describe, expect, it, vi } from 'vitest';

const state=vi.hoisted(()=>({
  meta:new Map<string,unknown>(),
  outbox:[] as Array<Record<string,unknown>>,
}));
const database=vi.hoisted(()=>({sync_meta:{get:vi.fn(),put:vi.fn()},outbox:{where:vi.fn()},transaction:vi.fn()}));

vi.mock('./db.js',()=>({SJM_FIELD_KEY_PREFIX:'sjm-field-key:v1:',db:database}));
database.sync_meta.get.mockImplementation(async(key:string)=>{
  const value=state.meta.get(key);
  return value===undefined?undefined:{key,value};
});
database.sync_meta.put.mockImplementation(async(row:{key:string;value:unknown})=>{
  state.meta.set(row.key,row.value);
});
database.outbox.where.mockImplementation((_index:string)=>({
  equals:vi.fn((userId:string)=>({toArray:vi.fn(async()=>state.outbox.filter(row=>row.ownerUserId===userId))})),
}));
database.transaction.mockImplementation(async(...args:unknown[])=>{
  const cb=args[args.length-1];
  if(typeof cb!=='function')throw new Error('transaction callback missing');
  return cb();
});

import { decryptSjmFieldPayload, encryptSjmFieldPayload, isEncryptedSjmFieldPayload, sjmJourneyBlindIndex } from './sjmFieldCrypto.js';

const scope={userId:'user-1',orgId:'org-1'};
const payload={journey_id:'33333333-3333-4333-8333-333333333333',event_type:'security_concern',note:'Unidentified person approached the vehicle.'};

describe('SJM field at-rest protection',()=>{
  beforeEach(()=>{
    state.meta.clear();
    state.outbox.length=0;
  });
  it('encrypts journey identifiers and field notes and binds decryption to the signed-in tenant',async()=>{
    const ciphertext=await encryptSjmFieldPayload(scope,payload);
    expect(isEncryptedSjmFieldPayload(ciphertext)).toBe(true);
    expect(JSON.stringify(ciphertext)).not.toContain(payload.journey_id);
    expect(JSON.stringify(ciphertext)).not.toContain(payload.note);
    expect(await decryptSjmFieldPayload(scope,ciphertext)).toEqual(payload);
    await expect(decryptSjmFieldPayload({...scope,orgId:'other-org'},ciphertext)).rejects.toMatchObject({code:'authentication_failed'});
  });
  it('uses a fresh AES-GCM IV for each report',async()=>{
    const first=await encryptSjmFieldPayload(scope,payload);
    const second=await encryptSjmFieldPayload(scope,payload);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });
  it('uses a deterministic opaque, tenant-scoped HMAC index for local mission filtering',async()=>{
    const first=await sjmJourneyBlindIndex(scope,payload.journey_id);
    const again=await sjmJourneyBlindIndex(scope,payload.journey_id);
    const other=await sjmJourneyBlindIndex({...scope,orgId:'other-org'},payload.journey_id);
    expect(first).toMatch(/^sjm1_[0-9a-f]{64}$/);
    expect(first).toBe(again);
    expect(first).not.toContain(payload.journey_id);
    expect(first).not.toBe(other);
  });
  it('never regenerates a missing key while ciphertext records still exist',async()=>{
    const ciphertext=await encryptSjmFieldPayload(scope,payload);
    state.outbox.push({ownerUserId:scope.userId,ownerOrgId:scope.orgId,type:'sjm.field_event.create',payload:ciphertext});
    state.meta.delete('sjm-field-key:v1:user-1:org-1');
    await expect(decryptSjmFieldPayload(scope,ciphertext)).rejects.toMatchObject({code:'key_missing'});
  });
  it('rejects invalid event types before creating any key',async()=>{
    await expect(encryptSjmFieldPayload(scope,{...payload,event_type:'journey_closed'})).rejects.toMatchObject({code:'invalid_payload'});
    expect(state.meta.size).toBe(0);
  });
});
