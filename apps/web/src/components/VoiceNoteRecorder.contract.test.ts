import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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

  it('bounds media size, local queue capacity and automatic retries', () => {
    expect(mediaQueue).toContain('MAX_VOICE_NOTE_BYTES = 25 * 1024 * 1024');
    expect(mediaQueue).toContain('MAX_PENDING_MEDIA_BYTES = 100 * 1024 * 1024');
    expect(mediaQueue).toContain('MAX_PENDING_MEDIA_COUNT = 100');
    expect(mediaQueue).toContain('MAX_MEDIA_AUTOMATIC_ATTEMPTS = 5');
  });
});
