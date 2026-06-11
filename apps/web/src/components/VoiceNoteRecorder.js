/**
 * VoiceNoteRecorder — records audio via MediaRecorder, uploads via presigned URL,
 * then commits the note. Gracefully degrades when microphone is unavailable.
 */
import { useState, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Mic, MicOff, Square, Upload, CheckCircle, AlertTriangle } from 'lucide-react';
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
function getSupportedMimeType() {
    if (typeof MediaRecorder === 'undefined')
        return null;
    for (const t of MIME_TYPES) {
        if (MediaRecorder.isTypeSupported(t))
            return t;
    }
    return null;
}
export default function VoiceNoteRecorder({ parentType, parentId, onCommitted, disabled }) {
    const [state, setState] = useState('idle');
    const [error, setError] = useState(null);
    const [seconds, setSeconds] = useState(0);
    const mediaRef = useRef(null);
    const chunksRef = useRef([]);
    const timerRef = useRef(null);
    const blobRef = useRef(null);
    const mimeType = getSupportedMimeType();
    const supported = mimeType !== null;
    const commitMut = useMutation({
        mutationFn: async ({ noteId, storageKey, blob }) => {
            await api.post('/voice-notes/commit', {
                note_id: noteId,
                parent_type: parentType,
                parent_id: parentId,
                storage_key: storageKey,
                duration_sec: seconds,
                file_size_bytes: blob.size,
                mime_type: blob.type || mimeType,
            });
            return noteId;
        },
        onSuccess: (noteId) => {
            setState('done');
            onCommitted?.(noteId);
        },
        onError: () => { setState('error'); setError('Failed to save voice note.'); },
    });
    const startRecording = useCallback(async () => {
        setError(null);
        setState('idle');
        chunksRef.current = [];
        setSeconds(0);
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        catch (_) {
            setError('Microphone access denied.');
            return;
        }
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRef.current = recorder;
        recorder.ondataavailable = (e) => { if (e.data.size > 0)
            chunksRef.current.push(e.data); };
        recorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            blobRef.current = new Blob(chunksRef.current, { type: mimeType ?? 'audio/webm' });
            setState('recorded');
        };
        recorder.start(250);
        setState('recording');
        timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    }, [mimeType]);
    const stopRecording = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        mediaRef.current?.stop();
    }, []);
    const upload = useCallback(async () => {
        if (!blobRef.current)
            return;
        setState('uploading');
        try {
            const urlRes = await api.post('/voice-notes/upload-url', { parent_type: parentType, parent_id: parentId, mime_type: blobRef.current.type || mimeType, duration_sec: seconds, file_size_bytes: blobRef.current.size });
            const { note_id, storage_key, upload_url } = urlRes.data;
            if (upload_url) {
                await fetch(upload_url, { method: 'PUT', body: blobRef.current, headers: { 'Content-Type': blobRef.current.type || 'audio/webm' } });
            }
            commitMut.mutate({ noteId: note_id, storageKey: storage_key, blob: blobRef.current });
        }
        catch (_) {
            setState('error');
            setError('Upload failed. Please try again.');
        }
    }, [parentType, parentId, mimeType, seconds, commitMut]);
    const reset = () => { setState('idle'); setError(null); setSeconds(0); blobRef.current = null; };
    if (!supported) {
        return (<div className="flex items-center gap-2 text-gray-500 text-xs">
        <MicOff className="w-4 h-4"/>
        <span>Audio recording not supported in this browser</span>
      </div>);
    }
    return (<div className="flex items-center gap-3">
      {state === 'idle' && (<button type="button" onClick={startRecording} disabled={disabled} className="flex items-center gap-2 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white rounded-lg text-xs transition-colors">
          <Mic className="w-3.5 h-3.5"/> Record Note
        </button>)}

      {state === 'recording' && (<>
          <span className="flex items-center gap-1.5 text-red-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>
            {Math.floor(seconds / 60).toString().padStart(2, '0')}:{(seconds % 60).toString().padStart(2, '0')}
          </span>
          <button type="button" onClick={stopRecording} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs">
            <Square className="w-3.5 h-3.5 fill-current"/> Stop
          </button>
        </>)}

      {state === 'recorded' && (<>
          <span className="text-gray-400 text-xs">{seconds}s recorded</span>
          <button type="button" onClick={upload} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs">
            <Upload className="w-3.5 h-3.5"/> Save Note
          </button>
          <button type="button" onClick={reset} className="text-xs text-gray-500 hover:text-gray-300">Discard</button>
        </>)}

      {state === 'uploading' && (<span className="text-blue-400 text-xs flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5 animate-bounce"/> Uploading…
        </span>)}

      {state === 'done' && (<span className="text-green-400 text-xs flex items-center gap-1.5">
          <CheckCircle className="w-3.5 h-3.5"/> Note saved
        </span>)}

      {state === 'error' && (<span className="text-red-400 text-xs flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5"/> {error}
          <button type="button" onClick={reset} className="underline hover:no-underline">Retry</button>
        </span>)}
    </div>);
}
