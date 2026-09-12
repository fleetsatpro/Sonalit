import { useState, useCallback } from 'react';
import type { ConvoyReport, GPS } from '../types/ConvoyReport';
import { reportApi } from '../api/reportApi';

export function useConvoyReport(token: string, convoyId: string) {
  const [report, setReport] = useState<ConvoyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await reportApi.getReport(convoyId, token);
      setReport(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err?.response?.data?.error ?? err?.message ?? 'Failed to fetch report');
    } finally {
      setLoading(false);
    }
  }, [token, convoyId]);

  const confirmArrival = useCallback(
    async (reportId: string, gps: GPS) => {
      const data = await reportApi.submitArrival(reportId, gps, token);
      setReport(data);
      return data;
    },
    [token]
  );

  const submitSOD = useCallback(
    async (reportId: string, photos: string[], gps: GPS) => {
      const data = await reportApi.submitSOD(reportId, photos, gps, token);
      setReport(data);
      return data;
    },
    [token]
  );

  const submitEOD = useCallback(
    async (reportId: string, photos: string[], gps: GPS) => {
      const data = await reportApi.submitEOD(reportId, photos, gps, token);
      setReport(data);
      return data;
    },
    [token]
  );

  return { report, loading, error, fetchReport, confirmArrival, submitSOD, submitEOD };
}
