/**
 * VoiceNoteRecorder — records audio via MediaRecorder, uploads via presigned URL,
 * then commits the note. Gracefully degrades when microphone is unavailable.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuthStore } from '../stores/auth.js';
import {
  enqueueVoiceNote, drainMediaOutbox, getMediaUploadEntry, listVoiceNotesForParent,
  retryMediaUpload, subscribeMediaOutbox,
} from '../lib/offline/mediaOutbox.js';
import { Mic, MicOff, Square, Upload, CheckCircle, AlertTriangle } from 'lucide-react';

type ParentType = 'shift_handover' | 'incident' | 'convoy' | 'claim';

interface Props {
  parentType: ParentType;
  parentId: string;
  onCommitted?: (noteId: string) => void;
  disabled?: boolean;
}

type RecorderState = 'idle' | 'recording' | 'recorded' | 'uploading' | 'queued' | 'done' | 'error';

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

function getSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

export default function VoiceNoteRecorder({ parentType, parentId, onCommitted, disabled }: Props) {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  const blobRef = useRef<Blob | null>(null);
  const notifiedCommittedRef = useRef<string | null>(null);
  const user = useAuthStore(s => s.user);

  const mimeType = getSupportedMimeType();
  const supported = mimeType !== null;

  const announceCommitted = useCallback((noteId: string) => {
    if (notifiedCommittedRef.current === noteId) return;
    notifiedCommittedRef.current = noteId;
    setState('done');
    setError(null);
    onCommitted?.(noteId);
  }, [onCommitted]);

  const startRecording = useCallback(async () => {
    setError(null);
    setState('idle');
    chunksRef.current = [];
    secondsRef.current = 0;
    setSeconds(0);
    setQueuedId(null);
    setError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      setError('Microphone access denied.');
      return;
    }

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRef.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      blobRef.current = new Blob(chunksRef.current, { type: mimeType ?? 'audio/webm' });
      setState('recorded');
    };
    recorder.start(250);
    setState('recording');
    timerRef.current = setInterval(() => {
      const next = secondsRef.current + 1;
      secondsRef.current = next;
      setSeconds(next);
      // Voice notes are deliberately bounded to 60 seconds for low-bandwidth
      // and storage safety. Stop the actual recorder, not just the timer.
      if (next >= 60) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        if (mediaRef.current?.state === 'recording') mediaRef.current.stop();
      }
    }, 1000);
  }, [mimeType]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRef.current?.stop();
  }, []);

  const upload = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;
    if (!user?.id || !user.org_id) {
      setState('error');
      setError('Sign in again with the same account to save this recording.');
      return;
    }
    setState('uploading');
    setError(null);

    try {
      // Durably persist the Blob before any network request. From this point on
      // a failed connection never destroys the only copy of the recording.
      const entry = await enqueueVoiceNote({
        ownerUserId: user.id,
        ownerOrgId: user.org_id,
        parentType,
        parentId,
        blob,
        mimeType: blob.type || mimeType || 'audio/webm',
        durationSec: Math.max(1, secondsRef.current || seconds),
      });
      setQueuedId(entry.id);
      setState('queued');
      blobRef.current = null;

      // Opportunistic immediate send. The same persistent entry is retried if
      // the page closes, the network drops, or the API cannot sign R2 uploads.
      await drainMediaOutbox(user.id, user.org_id, { onlyId: entry.id, force: true, limit: 1 });
      const latest = await getMediaUploadEntry(entry.id, user.id, user.org_id);
      if (latest?.status === 'ACKNOWLEDGED') {
        announceCommitted(entry.id);
      } else if (latest?.status === 'FAILED_PERMANENT') {
        setState('error');
        setError(latest.lastErrorMessage || 'Sonalit did not accept this recording. It remains saved on this device for review.');
      } else if (latest) {
        setState('queued');
        setError(latest.lastErrorMessage || 'Saved on this device. Upload will retry when the connection and storage service are ready.');
      }
    } catch (err) {
      // Enqueue errors happen before the Blob is durably accepted; retain the
      // in-memory recording and allow Retry to enqueue it again.
      setState('error');
      setError(err instanceof Error ? err.message : 'The recording could not be saved locally. Keep this screen open and retry.');
    }
  }, [user?.id, user?.org_id, parentType, parentId, mimeType, seconds, announceCommitted]);

  const retry = useCallback(async () => {
    if (!queuedId) {
      await upload();
      return;
    }
    if (!user?.id || !user.org_id) {
      setError('Sign in again with the same account to resume this recording.');
      return;
    }
    setState('uploading');
    setError(null);
    try {
      const result = await retryMediaUpload(queuedId, user.id, user.org_id);
      const latest = await getMediaUploadEntry(queuedId, user.id, user.org_id);
      if (result.acknowledged > 0 || latest?.status === 'ACKNOWLEDGED') announceCommitted(queuedId);
      else if (latest?.status === 'FAILED_PERMANENT') {
        setState('error');
        setError(latest.lastErrorMessage || 'Sonalit did not accept this recording. It remains on this device for review.');
      } else {
        setState('queued');
        setError(latest?.lastErrorMessage || 'Recording remains saved on this device.');
      }
    } catch (err) {
      setState('queued');
      setError(err instanceof Error ? err.message : 'Retry could not finish; the recording remains saved on this device.');
    }
  }, [queuedId, user?.id, user?.org_id, upload, announceCommitted]);

  const reset = () => {
    // Reset/discard is available only before a recording has entered the
    // durable queue. A queued evidence item requires its explicit upload retry.
    if (queuedId) return;
    setState('idle');
    setError(null);
    setSeconds(0);
    secondsRef.current = 0;
    blobRef.current = null;
  };

  useEffect(() => {
    if (!user?.id || !user.org_id) return;
    let active = true;
    const refreshQueued = async () => {
      try {
        let entry = queuedId
          ? await getMediaUploadEntry(queuedId, user.id, user.org_id)
          : null;
        if (!entry) {
          const rows = await listVoiceNotesForParent(user.id, user.org_id, parentType, parentId);
          entry = rows[rows.length - 1] ?? null;
          if (entry && active) setQueuedId(entry.id);
        }
        if (!active || !entry) return;
        if (entry.status === 'ACKNOWLEDGED') {
          announceCommitted(entry.id);
        } else if (entry.status === 'FAILED_PERMANENT') {
          setState('error');
          setError(entry.lastErrorMessage || 'Sonalit did not accept this recording. It remains on this device for review.');
        } else {
          setState('queued');
          setError(entry.lastErrorMessage || null);
        }
      } catch {
        // Status is unknown if IndexedDB cannot be read; do not fake an empty queue.
        if (active && queuedId) setError('Upload status is unavailable. Keep this recording on the device and retry.');
      }
    };
    void refreshQueued();
    const unsubscribe = subscribeMediaOutbox(() => { void refreshQueued(); });
    window.addEventListener('focus', refreshQueued);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('focus', refreshQueued);
    };
  }, [user?.id, user?.org_id, parentType, parentId, queuedId, announceCommitted]);

  if (!supported) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-xs">
        <MicOff className="w-4 h-4" />
        <span>Audio recording not supported in this browser</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {state === 'idle' && (
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled}
          className="flex items-center gap-2 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white rounded-lg text-xs transition-colors"
        >
          <Mic className="w-3.5 h-3.5" /> Record Note
        </button>
      )}

      {state === 'recording' && (
        <>
          <span className="flex items-center gap-1.5 text-red-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {Math.floor(seconds / 60).toString().padStart(2, '0')}:{(seconds % 60).toString().padStart(2, '0')}
          </span>
          <button
            type="button"
            onClick={stopRecording}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs"
          >
            <Square className="w-3.5 h-3.5 fill-current" /> Stop
          </button>
        </>
      )}

      {state === 'recorded' && (
        <>
          <span className="text-gray-400 text-xs">{seconds}s recorded</span>
          <button
            type="button"
            onClick={upload}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs"
          >
            <Upload className="w-3.5 h-3.5" /> Save Note
          </button>
          <button type="button" onClick={reset} className="text-xs text-gray-500 hover:text-gray-300">Discard</button>
        </>
      )}

      {state === 'uploading' && (
        <span className="text-blue-400 text-xs flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5 animate-bounce" /> Uploading…
        </span>
      )}

      {state === 'queued' && (
        <span className="flex items-center gap-2 text-amber-300 text-xs" role="status" aria-live="polite">
          <Upload className="h-3.5 w-3.5" /> {error || 'Saved on this device — awaiting Sonalit confirmation.'}
          <button type="button" onClick={() => { void retry(); }} className="underline hover:no-underline">Retry upload</button>
        </span>
      )}

      {state === 'done' && (
        <span className="text-green-400 text-xs flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5" /> Note saved
          <button type="button" onClick={() => { setState('idle'); setError(null); setSeconds(0); secondsRef.current = 0; notifiedCommittedRef.current = null; }} className="underline hover:no-underline">Record another</button>
        </span>
      )}

      {state === 'error' && (
        <span className="text-red-400 text-xs flex items-center gap-1.5" role="alert">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
          <button type="button" onClick={() => { void retry(); }} className="underline hover:no-underline">Retry</button>
        </span>
      )}
    </div>
  );
}
