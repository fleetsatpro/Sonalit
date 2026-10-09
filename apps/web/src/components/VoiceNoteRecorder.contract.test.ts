import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAllowedR2UploadUrl } from '../lib/offline/mediaOutbox.js';

const recorder = readFileSync(new URL('./VoiceNoteRecorder.tsx', import.meta.url), 'utf8');
const mediaQueue = readFileSync(new URL('../lib/offline/mediaOutbox.ts', import.meta.url), 'utf8');

describe('voice-note recorder delivery contract', () => {
  it('writes the recording to durable storage before attempting network upload', () => {
    expect(recorder).toContain('const entry = await enqueueVoiceNote({');
    expect(recorder.indexOf('enqueueVoiceNote({')).toBeLessThan(recorder.indexOf('drainMediaOutbox(user.id, user.org_id'));
    const uploadStart = recorder.indexOf('const upload = useCallback');
    const uploadEnd = recorder.indexOf('const retry = useCallback', uploadStart);
    const uploadSource = recorder.slice(uploadStart, uploadEnd);
    expect(uploadSource.indexOf('setQueuedId(entry.id)')).toBeGreaterThanOrEqual(0);
    expect(uploadSource.indexOf('blobRef.current = null;')).toBeGreaterThan(uploadSource.indexOf('setQueuedId(entry.id)'));
  });

  it('retries the durable entry rather than clearing the original Blob', () => {
    expect(recorder).toContain('retryMediaUpload(queuedId, user.id, user.org_id)');
    expect(recorder).not.toContain("onClick={reset}>Retry</button>");
    expect(recorder).toContain('if (queuedId) return;');
    expect(mediaQueue).toContain("status: 'UPLOADING'");
    expect(mediaQueue).toContain("status: 'ACKNOWLEDGED'");
  });

  it('does not claim success until the backend returns the same committed note ID', () => {
    expect(mediaQueue).toContain("if (committed.data?.data?.id !== entry.id)");
    expect(mediaQueue).toContain("status: 'ACKNOWLEDGED'");
    expect(mediaQueue).toContain("blob: null");
    expect(recorder).not.toContain("api.post('/voice-notes/commit'");
  });

  it('retries expired or rejected presigned PUT URLs without treating them as account revocation', () => {
    expect(mediaQueue).toContain("stage: 'object_storage' as const");
    expect(mediaQueue).toContain("if (e.stage === 'object_storage')");
    expect(mediaQueue).toContain('object_storage_http_');
    expect(mediaQueue).toContain("if (status === 403)");
  });

  it('pins upload URLs to the Cloudflare R2 account host and exact object key', () => {
    expect(isAllowedR2UploadUrl('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/bucket/key?signature=opaque')).toBe(true);
    expect(isAllowedR2UploadUrl('https://attacker.r2.cloudflarestorage.com/bucket/key')).toBe(false);
    expect(mediaQueue).toContain('signed.storage_key !== expectedKey');
    expect(mediaQueue).toContain('row.attempts === entry.attempts');
    expect(mediaQueue).toContain('row.leaseUntil === entry.leaseUntil');
    expect(mediaQueue).toContain('media_already_uploading');
  });

  it('bounds media size, local queue capacity and automatic retries', () => {
    expect(mediaQueue).toContain('MAX_VOICE_NOTE_BYTES = 25 * 1024 * 1024');
    expect(mediaQueue).toContain('MAX_PENDING_MEDIA_BYTES = 100 * 1024 * 1024');
    expect(mediaQueue).toContain('MAX_PENDING_MEDIA_COUNT = 100');
    expect(mediaQueue).toContain('MAX_MEDIA_AUTOMATIC_ATTEMPTS = 5');
  });

  it('accepts only credential-free HTTPS URLs on the canonical R2 endpoint shape', () => {
    expect(isAllowedR2UploadUrl('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/bucket/key?signature=opaque')).toBe(true);
    expect(isAllowedR2UploadUrl('http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/bucket/key')).toBe(false);
    expect(isAllowedR2UploadUrl('https://r2.cloudflarestorage.com/bucket/key')).toBe(false);
    expect(isAllowedR2UploadUrl('https://attacker.example/bucket/key')).toBe(false);
    expect(isAllowedR2UploadUrl('https://attacker.r2.cloudflarestorage.com/bucket/key')).toBe(false);
    expect(isAllowedR2UploadUrl('https://user:password@0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/bucket/key')).toBe(false);
    expect(isAllowedR2UploadUrl('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com:8443/bucket/key')).toBe(false);
  });

});
