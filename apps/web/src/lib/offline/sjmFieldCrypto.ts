import { db, SJM_FIELD_KEY_PREFIX } from './db.js';

export const SJM_FIELD_EVENT_OPERATION = 'sjm.field_event.create';
const ENVELOPE_VERSION = 1;
const REQUIRED_NOTE_TYPES = new Set(['delay', 'vehicle_issue', 'incident', 'security_concern']);
const ALLOWED_EVENT_TYPES = new Set([
  'driver_en_route','driver_at_pickup','principal_on_board','destination_reached',
  'vehicle_issue','delay','safety_check_in','cpo_en_route','meet_point_confirmed',
  'principal_met','security_check_in','security_concern','incident','handover_completed',
  'meet_greet_positioned','flight_status_observed','principal_contact_established',
  'principal_received','handover_to_cpo','escort_started',
]);
const JOURNEY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SjmFieldCryptoScope { userId: string; orgId: string; }
export interface SjmFieldEventPayload { journey_id: string; event_type: string; note: string | null; }
export interface EncryptedSjmFieldPayload extends Record<string, unknown> {
  __sjm_field_ciphertext: true;
  version: 1;
  iv: string;
  ciphertext: string;
}
interface SjmFieldKeyBundle { version: 1; encryptionKey: CryptoKey; indexKey: CryptoKey; }

export class SjmFieldCryptoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SjmFieldCryptoError';
    this.code = code;
  }
}

function requireScope(scope: SjmFieldCryptoScope): void {
  if (!scope.userId?.trim() || !scope.orgId?.trim()) {
    throw new SjmFieldCryptoError('identity_required', 'Sign in again before storing an encrypted field report.');
  }
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new SjmFieldCryptoError('secure_crypto_unavailable', 'This browser cannot protect offline field reports. Keep the connection active and report this limitation to dispatch.');
  }
}

function toHex(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new SjmFieldCryptoError('invalid_ciphertext', 'The encrypted field report is malformed and remains preserved on this device.');
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let i=0;i<bytes.length;i++) bytes[i]=Number.parseInt(value.slice(i*2,i*2+2),16);
  return bytes;
}
function isCryptoKey(value: unknown, algorithm: string, usage: KeyUsage): value is CryptoKey {
  if (!value || typeof value !== 'object') return false;
  const key=value as CryptoKey;
  return key.type==='secret' && key.extractable===false &&
    key.algorithm?.name===algorithm && Array.isArray(key.usages) && key.usages.includes(usage);
}
function isKeyBundle(value: unknown): value is SjmFieldKeyBundle {
  if (!value || typeof value !== 'object') return false;
  const bundle=value as Partial<SjmFieldKeyBundle>;
  return bundle.version===1 &&
    isCryptoKey(bundle.encryptionKey,'AES-GCM','encrypt') &&
    bundle.encryptionKey.usages.includes('decrypt') &&
    isCryptoKey(bundle.indexKey,'HMAC','sign');
}
function keyRecordName(scope:SjmFieldCryptoScope):string {
  return SJM_FIELD_KEY_PREFIX+scope.userId+':'+scope.orgId;
}
function keyInfo(label:string):Uint8Array {
  return new TextEncoder().encode('sonalit/sjm/offline-field/'+label+'/v1');
}
async function createKeyBundle():Promise<SjmFieldKeyBundle> {
  const seed=globalThis.crypto.getRandomValues(new Uint8Array(32));
  const salt=globalThis.crypto.getRandomValues(new Uint8Array(32));
  try {
    const root=await globalThis.crypto.subtle.importKey('raw',seed,'HKDF',false,['deriveKey']);
    const encryptionKey=await globalThis.crypto.subtle.deriveKey(
      {name:'HKDF',hash:'SHA-256',salt,info:keyInfo('aes-gcm')},
      root,{name:'AES-GCM',length:256},false,['encrypt','decrypt'],
    );
    const indexKey=await globalThis.crypto.subtle.deriveKey(
      {name:'HKDF',hash:'SHA-256',salt,info:keyInfo('journey-index')},
      root,{name:'HMAC',hash:'SHA-256',length:256},false,['sign'],
    );
    return {version:1,encryptionKey,indexKey};
  } catch {
    throw new SjmFieldCryptoError('secure_crypto_unavailable','Secure offline encryption could not be initialised. No plaintext report was saved.');
  } finally {
    seed.fill(0);
  }
}
function isEncryptedPayload(value:unknown):value is EncryptedSjmFieldPayload {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return v.__sjm_field_ciphertext===true && v.version===ENVELOPE_VERSION &&
    typeof v.iv==='string' && /^[0-9a-f]{24}$/i.test(v.iv) &&
    typeof v.ciphertext==='string' && v.ciphertext.length>=32 &&
    v.ciphertext.length%2===0 && /^[0-9a-f]+$/i.test(v.ciphertext);
}
export function isEncryptedSjmFieldPayload(value:unknown):value is EncryptedSjmFieldPayload {
  return isEncryptedPayload(value);
}
async function getKeyBundle(scope:SjmFieldCryptoScope):Promise<SjmFieldKeyBundle> {
  requireScope(scope);
  const keyName=keyRecordName(scope);
  try {
    const existing=await db.sync_meta.get(keyName);
    if(existing) {
      if(!isKeyBundle(existing.value)) {
        throw new SjmFieldCryptoError('key_corrupt','The protected field-report key is unavailable. Do not clear this device; contact dispatch.');
      }
      return existing.value;
    }
  } catch(error) {
    if(error instanceof SjmFieldCryptoError)throw error;
    throw new SjmFieldCryptoError('key_storage_unavailable','Secure device storage is temporarily unavailable. The field report has not been queued.');
  }
  const candidate=await createKeyBundle();
  try {
    return await db.transaction('rw',db.sync_meta,db.outbox,async()=>{
      const raced=await db.sync_meta.get(keyName);
      if(raced) {
        if(!isKeyBundle(raced.value)) {
          throw new SjmFieldCryptoError('key_corrupt','The protected field-report key is unavailable. Do not clear this device; contact dispatch.');
        }
        return raced.value;
      }
      const rows=await db.outbox.where('ownerUserId').equals(scope.userId).toArray();
      const hasEncryptedReports=rows.some(row =>
        row.ownerOrgId===scope.orgId && row.type===SJM_FIELD_EVENT_OPERATION && isEncryptedPayload(row.payload)
      );
      if(hasEncryptedReports) {
        throw new SjmFieldCryptoError('key_missing','The key for one or more encrypted field reports is missing. Their ciphertext is preserved; contact dispatch and do not clear browser storage.');
      }
      await db.sync_meta.put({key:keyName,value:candidate});
      const persisted=await db.sync_meta.get(keyName);
      if(!isKeyBundle(persisted?.value)) {
        throw new SjmFieldCryptoError('key_storage_unavailable','This browser could not persist the protected field-report key. No offline report was saved.');
      }
      return persisted.value;
    });
  } catch(error) {
    if(error instanceof SjmFieldCryptoError)throw error;
    throw new SjmFieldCryptoError('key_storage_unavailable','Secure device storage is temporarily unavailable. The field report has not been queued.');
  }
}
function normalisePayload(value:unknown):SjmFieldEventPayload {
  if(!value||typeof value!=='object'||Array.isArray(value)) {
    throw new SjmFieldCryptoError('invalid_payload','The field report is invalid and was not stored.');
  }
  const input=value as Record<string,unknown>;
  const journeyId=typeof input.journey_id==='string'?input.journey_id:'';
  const eventType=typeof input.event_type==='string'?input.event_type:'';
  const noteValue=input.note;
  if(!JOURNEY_UUID.test(journeyId)||!ALLOWED_EVENT_TYPES.has(eventType)) {
    throw new SjmFieldCryptoError('invalid_payload','The field report is missing a valid journey or check-in type.');
  }
  if(noteValue!=null&&(typeof noteValue!=='string'||noteValue.trim().length>1200)) {
    throw new SjmFieldCryptoError('invalid_payload','The field note must be text no longer than 1,200 characters.');
  }
  const note=typeof noteValue==='string'?noteValue.trim():'';
  if(REQUIRED_NOTE_TYPES.has(eventType)&&note.length<5) {
    throw new SjmFieldCryptoError('invalid_payload','Add at least five characters describing the reported issue.');
  }
  return {journey_id:journeyId,event_type:eventType,note:note||null};
}
function additionalData(scope:SjmFieldCryptoScope):Uint8Array {
  return new TextEncoder().encode('sonalit:sjm-field-event:v'+ENVELOPE_VERSION+':'+scope.userId+':'+scope.orgId);
}
export async function encryptSjmFieldPayload(scope:SjmFieldCryptoScope,value:unknown):Promise<EncryptedSjmFieldPayload> {
  requireScope(scope);
  const payload=normalisePayload(value);
  const bundle=await getKeyBundle(scope);
  const iv=globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext=new TextEncoder().encode(JSON.stringify(payload));
  try {
    const ciphertext=await globalThis.crypto.subtle.encrypt(
      {name:'AES-GCM',iv,additionalData:additionalData(scope),tagLength:128},
      bundle.encryptionKey,plaintext,
    );
    return {__sjm_field_ciphertext:true,version:1,iv:toHex(iv),ciphertext:toHex(ciphertext)};
  } catch {
    throw new SjmFieldCryptoError('encryption_failed','The field report could not be encrypted and was not queued.');
  }
}
export async function decryptSjmFieldPayload(scope:SjmFieldCryptoScope,value:unknown):Promise<SjmFieldEventPayload> {
  requireScope(scope);
  if(!isEncryptedPayload(value)) {
    throw new SjmFieldCryptoError('invalid_ciphertext','The encrypted field report is malformed and remains preserved on this device.');
  }
  const bundle=await getKeyBundle(scope);
  try {
    const plaintext=await globalThis.crypto.subtle.decrypt(
      {name:'AES-GCM',iv:fromHex(value.iv),additionalData:additionalData(scope),tagLength:128},
      bundle.encryptionKey,fromHex(value.ciphertext),
    );
    return normalisePayload(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch(error) {
    if(error instanceof SjmFieldCryptoError)throw error;
    throw new SjmFieldCryptoError('authentication_failed','This encrypted report does not match the signed-in account and tenant. Its bytes remain preserved.');
  }
}
export async function sjmJourneyBlindIndex(scope:SjmFieldCryptoScope,journeyId:string):Promise<string> {
  requireScope(scope);
  if(!JOURNEY_UUID.test(journeyId)) {
    throw new SjmFieldCryptoError('invalid_journey_id','A valid assigned journey is required.');
  }
  const bundle=await getKeyBundle(scope);
  const data=new TextEncoder().encode('sonalit:sjm-field-index:v1:'+scope.userId+':'+scope.orgId+':'+journeyId);
  const signature=await globalThis.crypto.subtle.sign('HMAC',bundle.indexKey,data);
  return 'sjm1_'+toHex(signature);
}
