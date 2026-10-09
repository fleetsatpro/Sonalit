/**
 * Durable voice-note upload queue.
 *
 * Binary media lives in IndexedDB, separate from the JSON operational outbox.
 * A row is removed from the automatic work set only after the API confirms the
 * note commit. Presigned URLs are intentionally never persisted because they
 * expire; retries request a fresh URL for the same stable note ID/object key.
 */
import { api } from '../api.js';
import { db } from './db.js';
import type { MediaUploadEntry, MediaUploadStatus, VoiceNoteParentType } from './types.js';

export const MAX_VOICE_NOTE_BYTES = 25 * 1024 * 1024;
export const MAX_PENDING_MEDIA_BYTES = 100 * 1024 * 1024;
export const MAX_PENDING_MEDIA_COUNT = 100;
export const MAX_MEDIA_AUTOMATIC_ATTEMPTS = 5;
export const MEDIA_ACK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const UPLOAD_LEASE_MS = 2 * 60 * 1000;
const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;
const ALLOWED_PARENT_TYPES: VoiceNoteParentType[] = ['shift_handover', 'incident', 'convoy', 'claim'];
const ALLOWED_AUDIO_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4']);

export class MediaQueueError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MediaQueueError';
    this.code = code;
  }
}

export interface EnqueueVoiceNoteInput {
  ownerUserId: string;
  ownerOrgId: string;
  parentType: VoiceNoteParentType;
  parentId: string;
  blob: Blob;
  mimeType: string;
  durationSec: number;
}

export interface MediaQueueCounts {
  pending: number;
  uploading: number;
  failedRetryable: number;
  failedPermanent: number;
  acknowledged: number;
  pendingBytes: number;
}

export interface MediaDrainSummary {
  attempted: number;
  acknowledged: number;
  retryable: number;
  permanent: number;
  acknowledgedIds: string[];
}

type Failure = { code: string; message: string; retryable: boolean };
type Listener = () => void;
const listeners = new Set<Listener>();

function announce(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* observer failure must not stop uploads */ }
  }
}

export function subscribeMediaOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new MediaQueueError('secure_id_unavailable', 'This browser cannot safely create a durable upload ID.');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

function canonicalMimeType(value: string): string {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.has(type)) {
    throw new MediaQueueError('unsupported_audio_type', 'This audio format cannot be queued safely.');
  }
  return type;
}

async function digestBlob(blob: Blob): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new MediaQueueError('integrity_unavailable', 'Secure media integrity checks are unavailable in this browser.');
  }
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The backend currently signs directly against the Cloudflare R2 S3 endpoint.
 * A malformed or unexpected signing response must never exfiltrate field audio
 * to an arbitrary HTTPS host.
 */
export function isAllowedR2UploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

function parentIdLooksValid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function enqueueVoiceNote(input: EnqueueVoiceNoteInput): Promise<MediaUploadEntry> {
  if (!input.ownerUserId?.trim() || !input.ownerOrgId?.trim()) {
    throw new MediaQueueError('identity_required', 'Sign in before saving a voice note.');
  }
  if (!ALLOWED_PARENT_TYPES.includes(input.parentType) || !parentIdLooksValid(input.parentId)) {
    throw new MediaQueueError('invalid_parent', 'The voice note is not linked to a valid Sonalit record.');
  }
  if (!(typeof Blob !== 'undefined' && input.blob instanceof Blob) || input.blob.size <= 0) {
    throw new MediaQueueError('empty_media', 'The recording is empty and was not queued.');
  }
  if (input.blob.size > MAX_VOICE_NOTE_BYTES) {
    throw new MediaQueueError('media_too_large', 'This recording exceeds the 25 MB voice-note limit.');
  }
  const mimeType = canonicalMimeType(input.mimeType || input.blob.type || 'audio/webm');
  const durationSec = Math.max(1, Math.min(60, Math.round(Number(input.durationSec) || 1)));
  const sha256 = await digestBlob(input.blob);
  const now = Date.now();
  const id = createId();

  const entry: MediaUploadEntry = {
    id,
    kind: 'voice_note',
    ownerUserId: input.ownerUserId,
    ownerOrgId: input.ownerOrgId,
    parentType: input.parentType,
    parentId: input.parentId,
    blob: input.blob,
    mimeType,
    fileSizeBytes: input.blob.size,
    durationSec,
    sha256,
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: now,
    lastAttemptAt: null,
    leaseUntil: null,
    createdAt: now,
    updatedAt: now,
    acknowledgedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };

  await db.transaction('rw', db.media_outbox, async () => {
    const rows = await db.media_outbox.where('[ownerUserId+ownerOrgId]').equals([input.ownerUserId, input.ownerOrgId]).toArray();
    const pending = rows.filter(row => row.status !== 'ACKNOWLEDGED');
    if (pending.length >= MAX_PENDING_MEDIA_COUNT) {
      throw new MediaQueueError('media_queue_full', 'The device has too many pending recordings. Sync or review them before recording more.');
    }
    const usedBytes = pending.reduce((sum, row) => sum + (row.blob?.size ?? 0), 0);
    if (usedBytes + input.blob.size > MAX_PENDING_MEDIA_BYTES) {
      throw new MediaQueueError('media_storage_limit', 'Pending recordings would exceed the 100 MB local media limit. Connect and sync first.');
    }
    await db.media_outbox.put(entry);
  });
  announce();
  return entry;
}

export async function getMediaUploadEntry(
  id: string,
  ownerUserId: string,
  ownerOrgId: string,
): Promise<MediaUploadEntry | null> {
  const row = await db.media_outbox.get(id);
  if (!row || row.ownerUserId !== ownerUserId || row.ownerOrgId !== ownerOrgId) return null;
  return row;
}

export async function listVoiceNotesForParent(
  ownerUserId: string,
  ownerOrgId: string,
  parentType: VoiceNoteParentType,
  parentId: string,
): Promise<MediaUploadEntry[]> {
  const rows = await db.media_outbox.where('[ownerUserId+ownerOrgId]').equals([ownerUserId, ownerOrgId]).toArray();
  return rows
    .filter(row => row.kind === 'voice_note' && row.parentType === parentType && row.parentId === parentId && row.status !== 'ACKNOWLEDGED')
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function getMediaQueueCounts(ownerUserId: string, ownerOrgId: string): Promise<MediaQueueCounts> {
  const rows = await db.media_outbox.where('[ownerUserId+ownerOrgId]').equals([ownerUserId, ownerOrgId]).toArray();
  const result: MediaQueueCounts = { pending: 0, uploading: 0, failedRetryable: 0, failedPermanent: 0, acknowledged: 0, pendingBytes: 0 };
  for (const row of rows) {
    if (row.status === 'ACKNOWLEDGED') result.acknowledged++;
    else {
      result.pendingBytes += row.blob?.size ?? 0;
      if (row.status === 'UPLOADING') result.uploading++;
      else if (row.status === 'FAILED_RETRYABLE') result.failedRetryable++;
      else if (row.status === 'FAILED_PERMANENT') result.failedPermanent++;
      else result.pending++;
    }
  }
  return result;
}

function classifyFailure(error: unknown): Failure {
  const e = error as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { error?: string; message?: string } };
    status?: number;
    stage?: 'object_storage';
  };
  const status = e.response?.status ?? e.status;
  const code = String(e.code || '');
  const serverCode = String(e.response?.data?.error || '');
  if (e.stage === 'object_storage') {
    // Each retry requests a fresh signed URL. In particular, a delayed PUT that
    // reaches an expired URL must not become a permanent account-auth failure.
    if (status != null && [400, 413, 415, 422].includes(status)) {
      return { code: 'object_storage_rejected', message: 'The object store rejected this recording. The bytes remain on this device for review.', retryable: false };
    }
    return { code: status ? `object_storage_http_${status}` : 'object_storage_unreachable', message: 'Object storage did not accept the upload. Sonalit will request a fresh upload URL on retry.', retryable: true };
  }
  if (serverCode === 'storage_not_configured' || serverCode === 'storage_signing_failed') {
    return { code: serverCode, message: 'Voice-note storage is temporarily unavailable. The recording remains on this device.', retryable: true };
  }
  if (status === 401) {
    return { code: 'authorization_required', message: 'Sign in again with the same account to resume this upload.', retryable: true };
  }
  if (status === 403) {
    return { code: 'access_revoked', message: 'This account is not authorised to upload the recording. Keep it for review or contact your Sonalit administrator.', retryable: false };
  }
  if (status != null && [400, 413, 415, 422].includes(status)) {
    return { code: serverCode || 'upload_rejected', message: 'Sonalit rejected this recording. It remains on this device for review.', retryable: false };
  }
  if (code === 'media_integrity_failed' || code === 'missing_media_blob') {
    return { code, message: 'The stored recording failed its integrity check and was not uploaded.', retryable: false };
  }
  return { code: status ? `http_${status}` : 'network_unavailable', message: 'Upload did not complete. The recording remains on this device and will retry.', retryable: true };
}

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
}

async function claim(id: string, ownerUserId: string, ownerOrgId: string, force: boolean): Promise<MediaUploadEntry | null> {
  return db.transaction('rw', db.media_outbox, async () => {
    const row = await db.media_outbox.get(id);
    if (!row || row.ownerUserId !== ownerUserId || row.ownerOrgId !== ownerOrgId || row.status === 'ACKNOWLEDGED') return null;
    const now = Date.now();
    const staleLease = row.status === 'UPLOADING' && (row.leaseUntil ?? 0) <= now;
    const retryable = row.status === 'PENDING' || row.status === 'FAILED_RETRYABLE' || staleLease;
    if (!retryable) return null;
    if (!force && row.nextAttemptAt > now) return null;
    const claimed: MediaUploadEntry = {
      ...row,
      status: 'UPLOADING',
      attempts: row.attempts + 1,
      lastAttemptAt: now,
      leaseUntil: now + UPLOAD_LEASE_MS,
      updatedAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
    await db.media_outbox.put(claimed);
    announce();
    return claimed;
  });
}

async function finishFailure(entry: MediaUploadEntry, failure: Failure): Promise<void> {
  const permanent = !failure.retryable || entry.attempts >= MAX_MEDIA_AUTOMATIC_ATTEMPTS;
  const status: MediaUploadStatus = permanent ? 'FAILED_PERMANENT' : 'FAILED_RETRYABLE';
  const now = Date.now();
  // Compare-and-set the lease. A late result from an older attempt must never
  // overwrite a newer retry or replace an authoritative acknowledgement.
  const updated = await db.media_outbox
    .where('id').equals(entry.id)
    .and(row =>
      row.ownerUserId === entry.ownerUserId &&
      row.ownerOrgId === entry.ownerOrgId &&
      row.status === 'UPLOADING' &&
      row.attempts === entry.attempts &&
      row.leaseUntil === entry.leaseUntil,
    )
    .modify({
      status,
      nextAttemptAt: permanent ? Number.MAX_SAFE_INTEGER : now + backoffMs(entry.attempts),
      lastAttemptAt: entry.lastAttemptAt,
      leaseUntil: null,
      updatedAt: now,
      lastErrorCode: failure.code,
      lastErrorMessage: failure.message,
    });
  if (updated > 0) announce();
}

async function uploadOne(entry: MediaUploadEntry): Promise<void> {
  if (!entry.blob) {
    const err = new MediaQueueError('missing_media_blob', 'Stored recording bytes are missing.');
    throw Object.assign(err, { code: err.code, permanent: true });
  }
  const actualDigest = await digestBlob(entry.blob);
  if (actualDigest !== entry.sha256 || entry.blob.size !== entry.fileSizeBytes) {
    throw Object.assign(new MediaQueueError('media_integrity_failed', 'Stored recording integrity check failed.'), { code: 'media_integrity_failed', permanent: true });
  }

  const presign = await api.post<{
    note_id: string;
    storage_key: string;
    upload_url: string;
    expires_in: number;
  }>('/voice-notes/upload-url', {
    note_id: entry.id,
    parent_type: entry.parentType,
    parent_id: entry.parentId,
    mime_type: entry.mimeType,
    duration_sec: entry.durationSec,
    file_size_bytes: entry.fileSizeBytes,
  });
  const signed = presign.data;
  const expectedExtension = entry.mimeType === 'audio/mp4' ? 'mp4' : entry.mimeType === 'audio/ogg' ? 'ogg' : 'webm';
  const expectedKey = `voice-notes/${entry.ownerOrgId}/${entry.parentType}/${entry.parentId}/${entry.id}.${expectedExtension}`;
  if (signed.note_id !== entry.id || signed.storage_key !== expectedKey) {
    throw Object.assign(new MediaQueueError('invalid_storage_contract', 'The storage service returned an unexpected upload destination.'), { code: 'invalid_storage_contract', permanent: true });
  }
  if (typeof signed.expires_in !== 'number' || signed.expires_in < 1 || signed.expires_in > 300 ||
      !isAllowedR2UploadUrl(signed.upload_url)) {
    throw Object.assign(new MediaQueueError('invalid_upload_url', 'The storage service returned an invalid or untrusted upload URL.'), { code: 'invalid_upload_url', permanent: true });
  }

  const put = await fetch(target.toString(), {
    method: 'PUT',
    body: entry.blob,
    headers: { 'Content-Type': entry.mimeType },
  });
  if (!put.ok) {
    throw Object.assign(new Error('media_put_failed'), { status: put.status, code: `http_${put.status}`, stage: 'object_storage' as const });
  }

  const committed = await api.post<{ data?: { id?: string } }>('/voice-notes/commit', {
    note_id: entry.id,
    parent_type: entry.parentType,
    parent_id: entry.parentId,
    storage_key: signed.storage_key,
    duration_sec: entry.durationSec,
    file_size_bytes: entry.fileSizeBytes,
    mime_type: entry.mimeType,
  });
  if (committed.data?.data?.id !== entry.id) {
    throw Object.assign(new Error('voice_note_commit_unconfirmed'), { code: 'commit_unconfirmed' });
  }
}

async function uploadClaimed(entry: MediaUploadEntry): Promise<boolean> {
  try {
    await uploadOne(entry);
    const now = Date.now();
    const updated = await db.media_outbox
      .where('id').equals(entry.id)
      .and(row =>
        row.ownerUserId === entry.ownerUserId &&
        row.ownerOrgId === entry.ownerOrgId &&
        row.status === 'UPLOADING' &&
        row.attempts === entry.attempts &&
        row.leaseUntil === entry.leaseUntil,
      )
      .modify({
        status: 'ACKNOWLEDGED',
        blob: null,
        acknowledgedAt: now,
        updatedAt: now,
        leaseUntil: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextAttemptAt: Number.MAX_SAFE_INTEGER,
      });
    if (updated > 0) announce();
    return updated > 0;
  } catch (error) {
    const e = error as { permanent?: boolean; code?: string; status?: number; response?: { status?: number; data?: { error?: string } } };
    const failure = e.permanent
      ? { code: String(e.code || 'invalid_media'), message: error instanceof Error ? error.message : 'Invalid recording.', retryable: false }
      : classifyFailure(error);
    await finishFailure(entry, failure);
    return false;
  }
}

export async function drainMediaOutbox(
  ownerUserId: string,
  ownerOrgId: string,
  options: { limit?: number; onlyId?: string; force?: boolean } = {},
): Promise<MediaDrainSummary> {
  const summary: MediaDrainSummary = { attempted: 0, acknowledged: 0, retryable: 0, permanent: 0, acknowledgedIds: [] };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return summary;
  const limit = Math.max(1, Math.min(5, Math.floor(options.limit ?? 1)));
  const rows = options.onlyId
    ? [await db.media_outbox.get(options.onlyId)].filter((row): row is MediaUploadEntry => !!row)
    : await db.media_outbox.where('[ownerUserId+ownerOrgId]').equals([ownerUserId, ownerOrgId]).toArray();
  const due = rows
    .filter(row => row.ownerUserId === ownerUserId && row.ownerOrgId === ownerOrgId && row.status !== 'ACKNOWLEDGED')
    .filter(row => row.status === 'PENDING' || row.status === 'FAILED_RETRYABLE' || (row.status === 'UPLOADING' && (row.leaseUntil ?? 0) <= Date.now()))
    .filter(row => options.force || row.nextAttemptAt <= Date.now())
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit);
  for (const row of due) {
    const claimed = await claim(row.id, ownerUserId, ownerOrgId, Boolean(options.force));
    if (!claimed) continue;
    summary.attempted++;
    const ok = await uploadClaimed(claimed);
    if (ok) {
      summary.acknowledged++;
      summary.acknowledgedIds.push(claimed.id);
    } else {
      const after = await db.media_outbox.get(claimed.id);
      if (after?.status === 'FAILED_PERMANENT') summary.permanent++;
      else summary.retryable++;
    }
  }
  return summary;
}

export async function retryMediaUpload(id: string, ownerUserId: string, ownerOrgId: string): Promise<MediaDrainSummary> {
  await db.transaction('rw', db.media_outbox, async () => {
    const row = await db.media_outbox.get(id);
    if (!row || row.ownerUserId !== ownerUserId || row.ownerOrgId !== ownerOrgId || row.status === 'ACKNOWLEDGED') {
      throw new MediaQueueError('media_not_found', 'This queued recording is not available to the current account.');
    }
    if (row.status === 'UPLOADING' && (row.leaseUntil ?? 0) > Date.now()) {
      throw new MediaQueueError('media_already_uploading', 'This recording is already uploading. Keep this panel open while Sonalit confirms it.');
    }
    await db.media_outbox.update(id, {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: Date.now(),
      leaseUntil: null,
      updatedAt: Date.now(),
      lastErrorCode: null,
      lastErrorMessage: null,
    });
  });
  announce();
  return drainMediaOutbox(ownerUserId, ownerOrgId, { onlyId: id, force: true, limit: 1 });
}

export async function pruneAcknowledgedMedia(
  ownerUserId: string,
  ownerOrgId: string,
  olderThanMs = MEDIA_ACK_RETENTION_MS,
): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  const rows = await db.media_outbox.where('[ownerUserId+ownerOrgId]').equals([ownerUserId, ownerOrgId]).toArray();
  const ids = rows.filter(row => row.status === 'ACKNOWLEDGED' && (row.acknowledgedAt ?? 0) < cutoff).map(row => row.id);
  if (ids.length) {
    await db.media_outbox.bulkDelete(ids);
    announce();
  }
  return ids.length;
}
