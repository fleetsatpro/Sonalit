import { useState, useCallback } from 'react';
import type { SOSEvent, IncidentType } from '../types/SOSEvent';
import { sosApi } from '../api/sosApi';

export function useSOSBroadcast(token: string, cfoId: string, convoyId: string) {
  const [sent, setSent] = useState<SOSEvent | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendPanic = useCallback(
    async (
      incidentType: IncidentType,
      lat: number | null,
      lng: number | null,
      accuracy: number | null
    ) => {
      setSending(true);
      setError(null);
      try {
        const event = await sosApi.sendPanic(
          convoyId,
          cfoId,
          incidentType,
          lat,
          lng,
          accuracy,
          token
        );
        setSent(event);
        return event;
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        setError(err?.response?.data?.error ?? err?.message ?? 'SOS failed');
        throw e;
      } finally {
        setSending(false);
      }
    },
    [token, cfoId, convoyId]
  );

  const reset = useCallback(() => {
    setSent(null);
    setError(null);
  }, []);

  return { sent, sending, error, sendPanic, reset };
}
